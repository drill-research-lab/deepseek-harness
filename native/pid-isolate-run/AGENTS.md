# AGENTS.md — pid-isolate-run

This workspace owns the privileged Linux namespace launcher consumed by `dsh-sandbox-local`. Read the root instructions and this package's [architecture](docs/architecture.md) and [CLI contract](docs/cli-contract.md) before changing it.

The release binary requires exactly `cap_sys_admin,cap_setpcap+ep` at deployment. Preserve the setup order, the parent/child capability verification, exit code `125`, fatal prefix, and exact probe output. `DROP_NOOP` is test-only and must never enter a platform package.

Build each platform natively with static musl. Keep the entry and both platform packages on one version, rehearse packed installs, and run the real capability/namespace launcher tests on Linux.
