# @deepseek-ai/node-addon-pid-isolate-run

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

`pid-isolate-run` Linux PID/mount namespace launcher 的 JavaScript 入口。它解析目前平臺的 binary（二進位執行檔）並執行完整功能探測。

```ts
import { launcherPath, probe } from '@deepseek-ai/node-addon-pid-isolate-run';

const launcher = launcherPath();
const available = probe(launcher);
```

部署必須在安裝後對解析出的 binary 執行 `setcap cap_sys_admin,cap_setpcap+ep`。launcher 會在執行 `pid-isolate-run -- <argv>...` 前移除並驗證兩項 capabilities（能力）；launcher 失敗時以 `125` 結束且不 exec。此包附帶 `src/pid-isolate-run.c` 供稽核。
