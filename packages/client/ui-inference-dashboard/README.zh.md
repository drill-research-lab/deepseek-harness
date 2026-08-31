# @deepseek-ai/dsh-client-ui-inference-dashboard

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

推理仪表盘是 DSH 设置中的原生分节，用于显示实时 vLLM 运行状态。它留在现有设置对话框中，不嵌入或跳转到其他应用。摘要卡片显示运行中与等待中的请求总数、可用时的 KV 缓存占用率、累计输入与输出 token，以及调度器抢占次数。可搜索表格也会显示受限响应中的每个 vLLM 数值序列，包括指标组、类型、HELP 说明、标签与原始 Prometheus 值。

浏览器调用已认证的 `llm.metrics` RPC。Host 读取由部署通过 `DSH_INFERENCE_METRICS_URL` 配置的 Prometheus 端点，限制每次响应大小、设置截止时间，并返回解析后的 vLLM 指标组，不返回端点地址或非 vLLM 的进程指标。解析器最多保留 10,000 条 vLLM 序列；遇到格式错误或超过限制时会拒绝整份结果，避免显示不完整表格。成功响应会提供下一次刷新间隔。抓取失败会停止自动轮询、保留可见错误状态，并要求用户明确重试。

启动 Web 组合前，将 `DSH_INFERENCE_METRICS_URL` 设为完整的 vLLM 指标网址，通常是 `http://<vllm-host>:<port>/metrics`。不设置时，分节仍然可见，并明确显示尚未配置的状态。

布局参考了 [SparkDash](https://github.com/MiaAI-Lab/sparkDash)，但实现使用 DSH 的设置插槽、设计 token、已认证 RPC 载体与语言系统。系统不会捆绑 SparkDash 源码、服务器、iframe 或额外页面。

## 模型体验

无，因为此包只为面向用户的浏览器分节读取运行指标，不会向模型请求或会话日志添加任何内容。

#### KV 缓存影响

无。显示的占用率仅供观察；仪表盘既不分配缓存，也不修改推理请求。

## 已知限制与后续工作

- **请求数是部署级汇总值** — vLLM 的运行中与等待中 gauge 不会标识当前用户、会话或请求，因此无法确定某个任务的排队位置。精确位置需要 DSH LLM proxy 记录请求身份与生命周期。
- **目前只识别 vLLM 后端** — 如果已配置端点没有公开必需的 vLLM 请求 gauge，画面会显示指标无效错误。
- **已认证用户可以看到指标标签** — vLLM 公开的模型名称、engine id、histogram bucket 与缓存配置标签会出现在完整表格中。内部指标网址与非 vLLM 的进程／运行时序列仍只留在 Host。
- **失败后手动恢复** — 成功取得数据时按照 Host 提供的间隔轮询；抓取失败后等待用户重试，避免形成不受控的重试循环。
