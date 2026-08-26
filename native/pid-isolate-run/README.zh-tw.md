# pid-isolate-run

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

`pid-isolate-run` 建立獨立的 PID 與 mount namespace，掛載獨立 procfs，移除用於初始化的 capabilities（能力），驗證移除結果，再執行一條命令。它以靜態 Linux binary（二進位執行檔）與 JavaScript 入口包發布；入口包負責解析並探測目前平臺的 binary。

## 部署

建置需要 Linux 與 `musl-gcc`：

```sh
pnpm build:ts
pnpm build:native
```

部署後的 binary 必須只取得兩項初始化能力：

```sh
setcap cap_sys_admin,cap_setpcap+ep /absolute/path/to/pid-isolate-run
```

npm tarball 不會保留 Linux `security.capability` 延伸屬性。部署必須在安裝後執行 `setcap`，複製、strip（裁剪）、替換或重新簽署 binary 後也必須重新執行。除非 namespace 初始化、獨立 procfs 掛載、capability 移除與自我驗證全部成功，否則 `--probe` 會失敗閉合。

## 使用

```ts
import { launcherPath, probe } from '@deepseek-ai/node-addon-pid-isolate-run';

const launcher = launcherPath();
if (probe(launcher)) {
  const argv = [launcher, '--', 'bash', '-c', command];
}
```

CLI 是 `pid-isolate-run -- <argv>...`；`pid-isolate-run --probe` 會完成整套初始化，但不執行呼叫端命令。launcher 失敗時以 `125` 結束，且不會執行命令。

## 包與支援範圍

- `@deepseek-ai/node-addon-pid-isolate-run`：JavaScript 解析器、功能探測與可稽核的 C 原始碼。
- `@deepseek-ai/node-addon-pid-isolate-run-linux-x64`：靜態 linux-x64 binary。
- `@deepseek-ai/node-addon-pid-isolate-run-linux-arm64`：靜態 linux-arm64 binary。

支援 Linux x64 與 arm64。宿主必須允許 file capabilities、建立 PID/mount namespace 和掛載 procfs。詳見[架構](docs/architecture.md)、[CLI 約定](docs/cli-contract.md)、[支援矩陣](docs/support-matrix.md)與[發布流程](docs/release.md)。
