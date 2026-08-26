# pid-isolate-run

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

`pid-isolate-run` 创建独立的 PID 与 mount namespace，挂载独立 procfs，移除用于初始化的 capabilities（能力），验证移除结果，再执行一条命令。它以静态 Linux binary（可执行文件）与 JavaScript 入口包发布；入口包负责解析并探测当前平台的 binary。

## 部署

构建需要 Linux 与 `musl-gcc`：

```sh
pnpm build:ts
pnpm build:native
```

部署后的 binary 必须只获得两项初始化能力：

```sh
setcap cap_sys_admin,cap_setpcap+ep /absolute/path/to/pid-isolate-run
```

npm tarball 不会保留 Linux `security.capability` 扩展属性。部署必须在安装后执行 `setcap`，复制、strip（裁剪）、替换或重新签名 binary 后也必须重新执行。除非 namespace 初始化、独立 procfs 挂载、capability 移除与自我验证全部成功，否则 `--probe` 会失败闭合。

## 使用

```ts
import { launcherPath, probe } from '@deepseek-ai/node-addon-pid-isolate-run';

const launcher = launcherPath();
if (probe(launcher)) {
  const argv = [launcher, '--', 'bash', '-c', command];
}
```

CLI 是 `pid-isolate-run [--bind <src> <dst>] [--chdir <path>] -- <argv>...`；绝对 bind 目标必须已经存在。bind 与目录切换只会在新的私有 mount namespace 内、移除初始化 capabilities 之前发生。`pid-isolate-run --probe` 会完成整套初始化，但不执行调用方命令。launcher 失败时以 `125` 退出，且不会执行命令。

## 包与支持范围

- `@deepseek-ai/node-addon-pid-isolate-run`：JavaScript 解析器、功能探测与可审计的 C 源码。
- `@deepseek-ai/node-addon-pid-isolate-run-linux-x64`：静态 linux-x64 binary。
- `@deepseek-ai/node-addon-pid-isolate-run-linux-arm64`：静态 linux-arm64 binary。

支持 Linux x64 与 arm64。宿主必须允许 file capabilities、创建 PID/mount namespace 和挂载 procfs。详见[架构](docs/architecture.md)、[CLI 约定](docs/cli-contract.md)、[支持矩阵](docs/support-matrix.md)与[发布流程](docs/release.md)。
