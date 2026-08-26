# @deepseek-ai/node-addon-pid-isolate-run

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

`pid-isolate-run` Linux PID/mount namespace launcher 的 JavaScript 入口。它解析当前平台的 binary（可执行文件）并执行完整功能探测。

```ts
import { launcherPath, probe } from '@deepseek-ai/node-addon-pid-isolate-run';

const launcher = launcherPath();
const available = probe(launcher);
```

部署必须在安装后对解析出的 binary 执行 `setcap cap_sys_admin,cap_setpcap+ep`。launcher 会在执行 `pid-isolate-run -- <argv>...` 前移除并验证两项 capabilities（能力）；launcher 失败时以 `125` 退出且不 exec。此包附带 `src/pid-isolate-run.c` 供审计。
