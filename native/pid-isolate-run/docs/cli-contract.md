# CLI contract

This document defines the observable protocol shared by the native binaries, JavaScript entry package, and sandbox consumer.

## Invocation

- `pid-isolate-run -- <argv>...` performs isolation and executes the exact argv.
- `pid-isolate-run --bind <src> <dst> --chdir <path> -- <argv>...` recursively bind-mounts one absolute source onto one existing absolute destination, changes to the absolute working directory, and executes the exact argv. Either option may be omitted; each may occur at most once.
- `pid-isolate-run --probe` performs the same namespace, procfs, capability-removal, and verification sequence, then prints exactly `pid-isolate: ok` followed by one newline.
- All other argument forms are usage errors.

The launcher reads no environment variable and provides no runtime override for binary selection or security operations.

The bind destination must exist before invocation and have the same directory-or-file kind as the source. The launcher never creates, removes, or changes a path in the host mount namespace. It makes mount propagation private before the bind, creates only the source/destination mapping supplied by the caller, and drops `CAP_SYS_ADMIN` before executing the command. Other paths retain the copied namespace's mounts.

## Results

- A successfully executed command determines the final exit status; a terminating signal is re-raised by the outer waiter.
- `125` (`LAUNCHER_FAILURE_EXIT`) is reserved for launcher failure before exec. The diagnostic prefix is `pid-isolate-run:`.
- A failed probe produces no success line. The entry package returns `false` for a missing binary, timeout, nonzero status, stderr-only failure, or unexpected stdout.

The caller command sees a private procfs for its PID namespace and any requested bind only inside that invocation's mount namespace. It cannot enumerate or signal processes that remain only in the parent namespace.
