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
- 生产 preset 不提供 Bash、PowerShell、通用文件系统、workflow、Ralph 或外部进程 subagent。
- permission preset 严格为 `read-only` 与 `workspace-write`；服务端不存在 `danger-full-access`。
- directory picker 使用 disabled provider；所有真实 picker RPC 返回 `directory-picker-unavailable`。
- `cordis-host-runner` 被停用，动态 Cordis 执行不可用。
- `session-query-sqlite` 保持 `openAt: never`。

## Startup policy check

启动与单元测试共用纯验证器。所有 patch 应用后，它验证精确的 preset、默认值、用户根开关和 permission 映射；偏移会让启动以明确诊断失败，不会静默降级。

## Model Experience

### Production tool roster

#### What the model sees

此 bundle 不添加 prompt 文本。`drill-production` preset 只暴露保留的安全工具，并省略 shell、通用文件系统、workflow、Ralph、外部进程 subagent 与动态 Cordis 工具。

#### Token effect

请求只包含保留工具的 schema；bundle 本身不添加文本 token。

#### KV Cache effect

挂载后的生产工具集合保持稳定，因此不会造成逐轮 cache 失效。

## Known Limitations and Deferred Work

- A3 不实现操作系统级沙箱。文件读取、网络、Unix socket、进程/PID 和资源限制属于 Issue #5。
- 用户自定义 preset 完全关闭；未来若开放，必须验证其中每个插件，而不只是 preset id。
- SQLite 查询索引不是 host 执行路径，因此未纳入启动验证器。
