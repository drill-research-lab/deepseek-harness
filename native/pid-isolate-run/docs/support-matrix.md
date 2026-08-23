# Support matrix

| Platform | Package | Requirement |
|---|---|---|
| Linux x64 | `@deepseek-ai/node-addon-pid-isolate-run-linux-x64` | PID/mount namespaces, procfs mount, file capabilities |
| Linux arm64 | `@deepseek-ai/node-addon-pid-isolate-run-linux-arm64` | PID/mount namespaces, procfs mount, file capabilities |

Other operating systems and CPU architectures deliberately have no platform package. Containers or hosts that suppress file capabilities, namespace creation, or procfs mounting probe unavailable and fail closed.

The deployed file needs `cap_sys_admin,cap_setpcap+ep`. Both capabilities exist only for setup: the launcher removes and verifies them in both surviving processes before authorizing the caller command.
