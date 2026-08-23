# Release procedure

Use the dedicated `PID Isolate Run Release` workflow. Each native architecture builds its own static binary, applies the two file capabilities to an ephemeral CI build, and runs the real positive and `DROP_NOOP` negative tests. The pack job assembles the artifacts, verifies package versions and manifests, and rehearses installation from the produced tarballs.

Publication uses one version across the entry and both platform packages. Deployment tooling must apply this command to the installed platform binary:

```sh
setcap cap_sys_admin,cap_setpcap+ep /absolute/path/to/pid-isolate-run
```

Reapply it after any operation that replaces or rewrites the file. Run `pid-isolate-run --probe` as the deployment readiness check; a false result leaves the Linux Landlock rung unavailable.
