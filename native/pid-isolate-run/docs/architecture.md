# Architecture

`pid-isolate-run` is a small privileged setup process that removes its privilege before any caller command can execute.

## Package roles

- The entry package resolves a platform binary, owns the exact probe parser, and ships the C source for audit.
- The linux-x64 and linux-arm64 packages contain static musl binaries and no JavaScript.
- `dsh-sandbox-local` composes this launcher outside `landlock-run`; PID/mount namespace setup therefore happens before Landlock restricts the command's filesystem access.

## Setup sequence

The launcher performs these security operations in order:

1. `unshare(CLONE_NEWPID | CLONE_NEWNS)` creates new PID and mount namespaces together.
2. `fork()` leaves the waiter in the original PID namespace and places the child at PID 1 in the new namespace.
3. The child changes mount propagation to private and mounts procfs on `/proc` with `MS_NOSUID | MS_NODEV | MS_NOEXEC`.
4. Both processes drop `CAP_SYS_ADMIN` and `CAP_SETPCAP` from the bounding set, clear effective/permitted/inheritable capability sets, and set `no_new_privs`.
5. Both processes use `capget()` and `PR_CAPBSET_READ` to verify that both capabilities are absent. A pipe prevents the child from continuing until the parent also passes verification.
6. The child executes the caller command, or prints the exact probe result for `--probe`.

The outer process remains only to reap PID-namespace init and propagate its exit status. No process remains with either setup capability after authorization.

## Failure model

Every setup, verification, usage, or exec failure prints a `pid-isolate-run:` diagnostic, exits `125`, and does not execute the caller command. The `DROP_NOOP` compiler option skips capability removal, and `CAPBSET_READ_FAIL` makes bounding-set inspection fail; tests use these options to prove that verification aborts before exec, and release builds never define either option.
