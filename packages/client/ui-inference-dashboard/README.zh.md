# @deepseek-ai/dsh-client-ui-inference-dashboard

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

推理仪表盘是 DSH 设置中的原生分节，用于显示实时 vLLM 运行状态与主机资源。它留在现有设置对话框中，不嵌入或跳转到其他应用。紧凑的 LLM 面板显示模型与上下文上限、带短期趋势的生成和 prefill 吞吐量、引擎状态、运行中与等待中的请求、KV 缓存占用率、累计生成 token 与抢占次数、prefix cache 与 speculative decoding 接受率，以及 TTFT、端到端和 token 间延迟的 p95。资源组另以 SparkDash 风格显示 GPU、已挂载存储与活跃网络面板。

浏览器调用已认证的 `llm.metrics` 与 `llm.resources` RPC。Host 读取由 `DSH_INFERENCE_METRICS_URL` 配置的 Prometheus 端点及由 `DSH_INFERENCE_RESOURCES_URL` 配置的 SparkDash 快照；两者共用响应大小限制与截止时间。资源响应仅允许 GPU 使用率、温度、功耗、时钟、显存及最多五个 GPU 进程，已启用的挂载存储容量与 I/O，以及带地址的活跃网络接口、主接口状态、链路速度和传输速率。Spark 身份、MAC 地址、停用设备、非活跃接口、CPU/RAM、源 URL 与其余快照不会进入浏览器响应。一个 RPC 失败不会遮蔽另一组面板，并要求用户明确重试。

启动 Web 组合前，将 `DSH_INFERENCE_METRICS_URL` 设为完整的 vLLM 指标网址（通常是 `http://<vllm-host>:<port>/metrics`），并将 `DSH_INFERENCE_RESOURCES_URL` 设为 SparkDash 快照网址（通常是 `http://<sparkdash-host>:5555/api/sparks/<spark-id>/metrics`）。缺少其中一个 URL 时，对应面板组仍然可见，并明确显示尚未配置的状态。

LLM 与资源面板、指标选择、实时速率公式和 sparkline 根据 [SparkDash](https://github.com/MiaAI-Lab/sparkDash) 在 MIT 许可下改编，保留的声明位于 [`SPARKDASH_LICENSE`](SPARKDASH_LICENSE)。实现使用 DSH 的设置插槽、设计 token、已认证 RPC 载体与语言系统，不会捆绑 SparkDash 服务器、iframe 或独立应用。

## 模型体验

无，因为此包只为面向用户的浏览器分节读取运行指标，不会向模型请求或会话日志添加任何内容。

#### KV 缓存影响

无。显示的占用率仅供观察；仪表盘既不分配缓存，也不修改推理请求。

## 已知限制与后续工作

- **请求数是部署级汇总值** — vLLM 的运行中与等待中 gauge 不会标识当前用户、会话或请求，因此无法确定某个任务的排队位置。精确位置需要 DSH LLM proxy 记录请求身份与生命周期。
- **目前只识别 vLLM 后端** — 如果已配置端点没有公开必需的 vLLM 请求 gauge，画面会显示指标无效错误。
- **历史记录只在当前进程内短期保留** — 吞吐量、GPU 使用率与 GPU 温度 sparkline 保存最近 30 次成功的浏览器采样。SparkDash 的按日持久化、历史图表、benchmark 与 showcase 工作流不属于这个只读设置分节。
- **资源面板只用于观测** — DSH 不暴露 SparkDash 的刷新、设备开关、Wake-on-LAN 或设置写入。Host 必须能访问已配置的只读快照网址。
- **失败后手动恢复** — 成功取得数据时按照 Host 提供的间隔轮询；抓取失败后等待用户重试，避免形成不受控的重试循环。
