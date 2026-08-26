# @deepseek-ai/node-addon-pid-isolate-run

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

JavaScript entry for the `pid-isolate-run` Linux PID/mount namespace launcher. It resolves the current platform binary and performs the full functional probe.

```ts
import { launcherPath, probe } from '@deepseek-ai/node-addon-pid-isolate-run';

const launcher = launcherPath();
const available = probe(launcher);
```

Deployments must apply `setcap cap_sys_admin,cap_setpcap+ep` to the resolved binary after installation. The launcher removes and verifies both capabilities before executing `pid-isolate-run -- <argv>...`; launcher failure exits `125` without exec. The package ships `src/pid-isolate-run.c` for audit.
