# @deepseek-ai/dsh-client-ui-inference-dashboard

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

推理仪表盘是 DSH 设置中的原生分节，用于显示实时 vLLM 运行状态。它留在现有设置对话框中，不嵌入或跳转到其他应用。紧凑的 LLM 面板显示模型与上下文上限、带短期趋势的生成和 prefill 吞吐量、引擎状态、运行中与等待中的请求、KV 缓存占用率、累计生成 token 与抢占次数、prefix cache 与 speculative decoding 接受率，以及 TTFT、端到端和 token 间延迟的 p95。

浏览器调用已认证的 `llm.metrics` RPC。Host 读取由部署通过 `DSH_INFERENCE_METRICS_URL` 配置的 Prometheus 端点，限制每次响应大小、设置截止时间，并只返回面板需要的值，不返回端点地址、原始标签或非 vLLM 的进程指标。URL 以 `/metrics` 结尾时，Host 还会在同源 `/v1/models` 端点尽力获取模型 id 与上下文上限。解析器最多检查 10,000 条 vLLM 样本；遇到格式错误或超过限制时会拒绝整份结果。成功响应会提供下一次刷新间隔。抓取失败会停止自动轮询、保留可见错误状态，并要求用户明确重试。

启动 Web 组合前，将 `DSH_INFERENCE_METRICS_URL` 设为完整的 vLLM 指标网址，通常是 `http://<vllm-host>:<port>/metrics`。不设置时，分节仍然可见，并明确显示尚未配置的状态。

LLM 面板、指标选择、实时速率公式和 sparkline 根据 [SparkDash](https://github.com/MiaAI-Lab/sparkDash) 在 MIT 许可下改编，保留的声明位于 [`SPARKDASH_LICENSE`](SPARKDASH_LICENSE)。实现使用 DSH 的设置插槽、设计 token、已认证 RPC 载体与语言系统，不会捆绑 SparkDash 服务器、iframe 或独立应用。

## 模型体验

无，因为此包只为面向用户的浏览器分节读取运行指标，不会向模型请求或会话日志添加任何内容。

#### KV 缓存影响

无。显示的占用率仅供观察；仪表盘既不分配缓存，也不修改推理请求。

## 已知限制与后续工作

- **请求数是部署级汇总值** — vLLM 的运行中与等待中 gauge 不会标识当前用户、会话或请求，因此无法确定某个任务的排队位置。精确位置需要 DSH LLM proxy 记录请求身份与生命周期。
- **目前只识别 vLLM 后端** — 如果已配置端点没有公开必需的 vLLM 请求 gauge，画面会显示指标无效错误。
- **历史记录只在当前进程内短期保留** — 两条 sparkline 保存最近 30 次成功的浏览器采样。SparkDash 的按日持久化、历史图表、benchmark 与 showcase 工作流不属于这个只读设置分节。
- **失败后手动恢复** — 成功取得数据时按照 Host 提供的间隔轮询；抓取失败后等待用户重试，避免形成不受控的重试循环。
