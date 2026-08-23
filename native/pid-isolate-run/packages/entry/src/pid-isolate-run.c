/*
 * pid-isolate-run: PID/mount namespace self-restrict-then-exec launcher.
 *
 * The deployed binary carries only cap_sys_admin,cap_setpcap+ep. It uses
 * those capabilities to create private PID and mount namespaces, mounts the
 * namespace's procfs, removes both capabilities from its bounding set and
 * process capability sets, verifies the removal, and only then execs the
 * wrapped command. Every launcher failure exits 125 without exec.
 *
 * CLI:
 *
 *   pid-isolate-run -- <argv>...
 *   pid-isolate-run --probe
 *
 * Plain C11 over libc and stable Linux syscalls. The capability UAPI layouts
 * and values are defined here so the security-relevant ABI stays auditable
 * across toolchain header versions.
 */

#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <sched.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

#define EXIT_LAUNCHER_FAILURE 125

#define CAP_SETPCAP 8
#define CAP_SYS_ADMIN 21
#define LINUX_CAPABILITY_VERSION_3 UINT32_C(0x20080522)

struct user_cap_header {
  uint32_t version;
  int pid;
};

struct user_cap_data {
  uint32_t effective;
  uint32_t permitted;
  uint32_t inheritable;
};

struct cli {
  int probe;
  char **command;
};

static int fail(const char *message, const char *detail) {
  if (detail == NULL) {
    fprintf(stderr, "pid-isolate-run: %s\n", message);
  } else {
    fprintf(stderr, "pid-isolate-run: %s: %s\n", message, detail);
  }
  return EXIT_LAUNCHER_FAILURE;
}

static int fail_usage(const char *message) {
  fprintf(stderr, "pid-isolate-run: usage error: %s\n", message);
  return EXIT_LAUNCHER_FAILURE;
}

static int parse(int argc, char **argv, struct cli *cli) {
  if (argc == 2 && strcmp(argv[1], "--probe") == 0) {
    cli->probe = 1;
    return 0;
  }
  if (argc >= 3 && strcmp(argv[1], "--") == 0) {
    cli->command = &argv[2];
    return 0;
  }
  if (argc > 1 && strcmp(argv[1], "--probe") == 0) {
    return fail_usage("--probe takes no other arguments");
  }
  return fail_usage("expected `--probe` or `-- <argv>...`");
}

#ifndef DROP_NOOP
static int drop_bounding_capability(int capability) {
  if (prctl(PR_CAPBSET_DROP, capability, 0, 0, 0) != 0) {
    return fail("capability bounding-set drop failed", strerror(errno));
  }
  return 0;
}

static int clear_process_capabilities(void) {
  struct user_cap_header header = {
    .version = LINUX_CAPABILITY_VERSION_3,
    .pid = 0,
  };
  struct user_cap_data data[2] = { 0 };
  if (syscall(SYS_capset, &header, &data) != 0) {
    return fail("capability set clear failed", strerror(errno));
  }
  return 0;
}
#endif

static int drop_capabilities(void) {
#ifdef DROP_NOOP
  /* Test-only build: verification below must fail closed before exec. */
  return 0;
#else
  int code = drop_bounding_capability(CAP_SYS_ADMIN);
  if (code != 0) return code;
  code = drop_bounding_capability(CAP_SETPCAP);
  if (code != 0) return code;
  return clear_process_capabilities();
#endif
}

static int capability_is_set(const struct user_cap_data data[2], int capability) {
  const unsigned int word = (unsigned int)capability / 32U;
  const uint32_t bit = UINT32_C(1) << ((unsigned int)capability % 32U);
  return ((data[word].effective | data[word].permitted | data[word].inheritable) & bit) != 0;
}

static int verify_capability_absent(const struct user_cap_data data[2], int capability) {
  if (capability_is_set(data, capability)) return 0;
  errno = 0;
  long bounding = prctl(PR_CAPBSET_READ, capability, 0, 0, 0);
  if (bounding < 0) {
    fail("capability drop verification failed", strerror(errno));
    return 0;
  }
  return bounding == 0;
}

static int verify_capabilities_dropped(void) {
  struct user_cap_header header = {
    .version = LINUX_CAPABILITY_VERSION_3,
    .pid = 0,
  };
  struct user_cap_data data[2] = { 0 };
  if (syscall(SYS_capget, &header, &data) != 0) {
    return fail("capability drop verification failed", strerror(errno));
  }
  const int sys_admin_absent = verify_capability_absent(data, CAP_SYS_ADMIN);
  const int setpcap_absent = verify_capability_absent(data, CAP_SETPCAP);
  if (!sys_admin_absent || !setpcap_absent) {
    fprintf(stderr, "pid-isolate-run: capability drop verification failed: remaining%s%s\n",
            sys_admin_absent ? "" : " CAP_SYS_ADMIN",
            setpcap_absent ? "" : " CAP_SETPCAP");
    return EXIT_LAUNCHER_FAILURE;
  }
  return 0;
}

static int lock_privilege_state(void) {
  int code = drop_capabilities();
  if (code != 0) return code;
  code = verify_capabilities_dropped();
  if (code != 0) return code;
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
    return fail("no_new_privs setup failed", strerror(errno));
  }
  return 0;
}

static int prepare_child(void) {
  /* A copied mount namespace can retain shared propagation. Make it private
   * before replacing /proc so no mount event can escape this namespace. */
  if (mount(NULL, "/", NULL, MS_REC | MS_PRIVATE, NULL) != 0) {
    return fail("mount namespace privatization failed", strerror(errno));
  }
  if (mount("proc", "/proc", "proc", MS_NOSUID | MS_NODEV | MS_NOEXEC, NULL) != 0) {
    return fail("proc mount failed", strerror(errno));
  }
  return lock_privilege_state();
}

static int await_parent_authorization(int fd) {
  char byte = 0;
  ssize_t count;
  do {
    count = read(fd, &byte, 1);
  } while (count < 0 && errno == EINTR);
  close(fd);
  if (count != 1 || byte != '1') {
    return fail("parent capability drop authorization failed", count < 0 ? strerror(errno) : NULL);
  }
  return 0;
}

static int authorize_child(int fd) {
  const char byte = '1';
  ssize_t count;
  do {
    count = write(fd, &byte, 1);
  } while (count < 0 && errno == EINTR);
  close(fd);
  if (count != 1) return fail("child authorization failed", strerror(errno));
  return 0;
}

static int wait_for_child(pid_t child) {
  int status = 0;
  while (waitpid(child, &status, 0) < 0) {
    if (errno == EINTR) continue;
    return fail("waitpid failed", strerror(errno));
  }
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) {
    const int signal_number = WTERMSIG(status);
    signal(signal_number, SIG_DFL);
    raise(signal_number);
    return 128 + signal_number;
  }
  return fail("child ended in an unknown state", NULL);
}

static void reap_failed_child(pid_t child) {
  int status = 0;
  while (waitpid(child, &status, 0) < 0 && errno == EINTR) {
    /* Retry until the failed child is reaped; preserve the original error. */
  }
}

int main(int argc, char **argv) {
  struct cli cli = { 0 };
  int code = parse(argc, argv, &cli);
  if (code != 0) return code;

  if (signal(SIGPIPE, SIG_IGN) == SIG_ERR) {
    return fail("signal setup failed", strerror(errno));
  }

  if (unshare(CLONE_NEWPID | CLONE_NEWNS) != 0) {
    return fail("namespace creation failed", strerror(errno));
  }

  int authorization[2];
  if (pipe2(authorization, O_CLOEXEC) != 0) {
    return fail("authorization pipe failed", strerror(errno));
  }
  pid_t child = fork();
  if (child < 0) return fail("fork failed", strerror(errno));
  if (child > 0) {
    close(authorization[0]);
    code = lock_privilege_state();
    if (code == 0) code = authorize_child(authorization[1]);
    else close(authorization[1]);
    if (code != 0) {
      kill(child, SIGKILL);
      reap_failed_child(child);
      return code;
    }
    return wait_for_child(child);
  }

  close(authorization[1]);
  code = prepare_child();
  if (code != 0) _exit(code);
  code = await_parent_authorization(authorization[0]);
  if (code != 0) _exit(code);

  if (cli.probe) {
    if (fputs("pid-isolate: ok\n", stdout) < 0 || fflush(stdout) != 0) {
      _exit(fail("probe report failed", strerror(errno)));
    }
    _exit(0);
  }

  execvp(cli.command[0], cli.command);
  _exit(fail("exec failed", strerror(errno)));
}
