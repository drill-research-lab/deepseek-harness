# `@deepseek-ai/dsh-llm-admission-queue`

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

围绕 `llm/stream` waterfall 的函数插件,在内部 vLLM 后端前面放一个带并发上限的 FIFO 准入闸门。它假设每个进程一个队列——每个 DSH web 进程对应一个 vLLM 后端——因此所有状态都在内存中,不跨进程共享。

## 管制范围

只有在 `gatedProviders` 白名单里的 provider 才会进队列。`GenerateOptions.provider` 是路由键:它决定用哪个 adapter 和哪个端点,所以无法伪造——改它就是真的改请求的去向。其余每一个 provider——每一个外部按量计费 API,以及以后新增的任何 provider——都直接经 `next()` 放行,不入队、不等待、不占名额、不计位置。黑名单每加一个新的外部 provider 都要回来改;白名单默认安全。

所有被管制的调用一律入队,不分用途(agent step、compaction 摘要、会话标题)。放过这些辅助调用会让真正打向 vLLM 的流量超过上限,并使上报的位置失真。

```yaml
- id: llm-admission-queue
  name: '@deepseek-ai/dsh-llm-admission-queue'
  config:
    limit: 1
    gatedProviders: ['vllm-local']
```

`limit` 是同时被准入的请求上限,默认 `1` —— 一个 vLLM 后端一次服务一个请求,等待因此显示为位置而不是 vLLM 内部一次不透明的卡顿;后端若真的能并行服务更多再调高。`0` 表示取消上限:被管制的调用仍会计数但永不阻塞。`gatedProviders` 默认 `[]`(不管制任何 provider)。两者都会从 `$DSH_HOME/settings.yaml` 的 `llm-admission-queue:` 段热重载:调高 `limit` 会立即准入等待者,调低不会中断正在运行的请求,等 `running` 降回新上限以下才恢复准入。

## 排序与审计

`ctx.llmAdmissionQueue` 对外提供 `positionFor`、`reorder`、`listAll`、`onChange`、`audit`,供 RPC 与传输层使用;`enqueue`/`release` 仅供 `llm/stream` listener 内部使用。`reorder(orderedQueueIds)` 设定仍在等待的 entry 的明确先后顺序 —— 不存在或已不在等待的 id 会被丢弃,列表未提到的等待 entry 按 FIFO 排在被点名的那些之后。之后进来的请求排在手动排序的 entry 之后。它永不抢占运行中的请求、也不增加名额。`audit(record)` 通过 atomic-write 的文件锁向 `$DSH_HOME/audit/queue-admin.jsonl` 追加一行 JSON;调用方提供 `operator`,本包只负责持久化写入。

`onChange` 对每个 1 基等待位置发生变化的 entry 发布一条 `PositionChange`,并在 entry 被准入的那一刻额外发布一条 `running` 通知。

## Model Experience

无,因为闸门只延迟被 gate 的请求何时到达 provider,不改变请求、消息、工具、响应或 session log。

#### KV Cache effect

无。最终到达 adapter 的请求与 loop 构造的请求逐字节一致,因此 provider 前缀缓存标识不受影响。队列只是推迟发送。

## Known Limitations and Deferred Work

- **仅限单进程** —— 队列在内存中且按进程隔离。如果部署曾经用多于一个 DSH web 进程对接同一个 vLLM 后端,就需要共享状态的重新设计;本包刻意不提供。
- **排序没有滥用控制** —— 没有机制限制 admin 的 `reorder` 调用频率或加以审查;粗心的 admin 可以让某个用户的请求一直排在后面。审计日志是唯一的事后手段。
- **排序无法抢占** —— 被移到最前的等待者仍需等运行时间最长的 in-flight 请求结束才能拿到那个释放的名额。
- **手动顺序不持久** —— 它只存在于进程内存;重启会丢失,等待队列回到 FIFO。
- **`audit()` 写入失败被吞掉** —— 追加失败会被记录并丢弃,而不是向上抛,因此即使审计行丢失,admin 操作仍然成功。
- **拆分的 provider id 必须全部列出** —— 如果部署声明了多个指向同一 vLLM 端点的 provider id,它们每一个都必须出现在 `gatedProviders` 中,否则未列出的路由会绕过上限。
