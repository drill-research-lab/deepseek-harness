# Naming

The native executable is `pid-isolate-run`. The package family uses `@deepseek-ai/node-addon-pid-isolate-run` for the entry and appends `-linux-x64` or `-linux-arm64` for platform payloads.

Public JavaScript names are `launcherPath`, `probe`, `LAUNCHER_BIN`, and `LAUNCHER_FAILURE_EXIT`. The test-only strictness variable is `NPIR_REQUIRE_PID_ISOLATION`; the production binary does not read it. `DROP_NOOP` names the test-only compiler fault injection.
