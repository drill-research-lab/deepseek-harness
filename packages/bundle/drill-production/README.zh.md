# @deepseek-ai/dsh-drill-production

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

Drill 多用户生产组合闭包。此 bundle 必须在 profile 中依次叠加于 `@deepseek-ai/dsh-base` 与 `@deepseek-ai/dsh-web-app` 之后；未加载它时，A3 保证不生效。

## Usage

在 profile 的 `dsh.profile.bundles` 中加入：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@deepseek-ai/dsh-drill-production"]
    }
  }
}
```

此 bundle 是可选部署层，不改变普通单用户 Web 或 CLI/TUI 组合。

## What this closes

- preset 集合严格为 `drill-production`，默认值也必须是它，并关闭用户 preset 根目录。
- 生产 preset 提供受共享逐会话沙箱策略约束的 Bash 或 PowerShell、通用文件系统与文件系统搜索工具。文件系统读取限制在工作区内；Linux 子进程另受 Landlock 文件限制及 `pid-isolate-run` 私有 PID 命名空间保护。workflow、Ralph 与外部进程 subagent 仍不提供。
- permission preset 严格为 `read-only` 与 `workspace-write`，`sandbox-policy.maximumMode` 固定为 `workspace-write`；工具 schema 与执行时授权都不会接受 `danger-full-access`。
- directory picker 直接挂载 browse 后端与 Client 界面；后端在每次请求时解析认证 principal 的规范所有者根目录，并以 `directory-outside-owner-root` 拒绝绝对路径逃逸、`..` traversal、跨所有者根目录及逃逸符号链接。
- `cordis-host-runner` 被停用，动态 Cordis 执行不可用；启动检查同时断言 `dynamicCordisRunner` 未挂载。
- `session-query-sqlite` 保持 `openAt: never`；启动检查会重新核实这一点。

## Startup policy check

启动与单元测试共用纯验证器。所有 patch 应用后，它验证精确的 preset、默认值、用户根开关、permission 映射、沙箱上限 `workspace-write` 与精确升权目标 `{workspace-write}`、`dynamicCordisRunner` 未挂载，以及（当 sqlite session-query 引擎已挂载时）`openAt: 'never'`；偏移会让启动以明确诊断失败，不会静默降级。

## Model Experience

### Production tool roster

#### What the model sees

此 bundle 不添加 prompt 文本。`drill-production` preset 会暴露受限制的 shell、通用文件系统、文件系统搜索与原有保留工具，并省略 workflow、Ralph、外部进程 subagent 与动态 Cordis 工具。shell 与可变更文件系统的 schema 只展示 `workspace-write` 这一升权目标。

#### Token effect

请求只包含保留工具的 schema；bundle 本身不添加文本 token。

#### KV Cache effect

挂载后的生产工具集合保持稳定，因此不会造成逐轮 cache 失效。

## Known Limitations and Deferred Work

- 文件及 Linux 进程隔离不限制出站网络，也不提供 CPU、内存或磁盘配额。
- 用户自定义 preset 完全关闭；未来若开放，必须验证其中每个插件，而不只是 preset id。
- 启动验证器不单独核实 `session-persistence-sqlite`：该后端在此组合中从不挂载，也没有 `openAt` 一类的可漂移设置；只有 `session-query-sqlite`（一个独立的读取／全文索引套件）会被重新核实。
