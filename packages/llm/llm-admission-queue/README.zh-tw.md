# `@deepseek-ai/dsh-llm-admission-queue`

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

圍繞 `llm/stream` waterfall 的函式外掛,在內部 vLLM 後端前面放一個帶並行上限的 FIFO 准入閘門。它假設每個行程一個佇列——每個 DSH web 行程對應一個 vLLM 後端——因此所有狀態都在記憶體中,不跨行程共享。

## 管制範圍

只有在 `gatedProviders` 白名單裡的 provider 才會進佇列。`GenerateOptions.provider` 是路由鍵:它決定用哪個 adapter 和哪個端點,所以無法偽造——改它就是真的改請求的去向。其餘每一個 provider——每一個外部按量計費 API,以及之後新增的任何 provider——都直接經 `next()` 放行,不入佇列、不等待、不佔名額、不計位置。黑名單每加一個新的外部 provider 都要回來改;白名單預設安全。

所有被管制的呼叫一律入佇列,不分用途(agent step、compaction 摘要、對話標題)。放過這些輔助呼叫會讓真正打向 vLLM 的流量超過上限,並使回報的位置失真。

```yaml
- id: llm-admission-queue
  name: '@deepseek-ai/dsh-llm-admission-queue'
  config:
    limit: 1
    gatedProviders: ['vllm-local']
```

`limit` 是同時被准入的請求上限,預設 `1` —— 一個 vLLM 後端一次服務一個請求,等待因此顯示為位置而不是 vLLM 內部一次不透明的卡頓;後端若真的能並行服務更多再調高。`0` 表示取消上限:被管制的呼叫仍會計數但永不阻塞。`gatedProviders` 預設 `[]`(不管制任何 provider)。兩者都會從 `$DSH_HOME/settings.yaml` 的 `llm-admission-queue:` 段熱重載:調高 `limit` 會立即准入等待者,調低不會中斷正在執行的請求,等 `running` 降回新上限以下才恢復准入。

## 排序與稽核

`ctx.llmAdmissionQueue` 對外提供 `positionFor`、`reorder`、`listAll`、`onChange`、`audit`,供 RPC 與傳輸層使用;`enqueue`/`release` 僅供 `llm/stream` listener 內部使用。`reorder(orderedQueueIds)` 設定仍在等待的 entry 的明確先後順序 —— 不存在或已不在等待的 id 會被丟棄,列表未提到的等待 entry 按 FIFO 排在被點名的那些之後。之後進來的請求排在手動排序的 entry 之後。它永不搶佔執行中的請求、也不增加名額。`audit(record)` 透過 atomic-write 的檔案鎖向 `$DSH_HOME/audit/queue-admin.jsonl` 追加一行 JSON;呼叫方提供 `operator`,本套件只負責持久化寫入。

`onChange` 對每個 1 基等待位置發生變化的 entry 發布一條 `PositionChange`,並在 entry 被准入的那一刻額外發布一條 `running` 通知。

## Model Experience

無,因為閘門只延遲被 gate 的請求何時到達 provider,不改變請求、訊息、工具、回應或 session log。

#### KV Cache effect

無。最終到達 adapter 的請求與 loop 建構的請求逐位元組一致,因此 provider 前綴快取識別不受影響。佇列只是延後傳送。

## Known Limitations and Deferred Work

- **僅限單行程** —— 佇列在記憶體中且按行程隔離。如果部署曾經用多於一個 DSH web 行程對接同一個 vLLM 後端,就需要共享狀態的重新設計;本套件刻意不提供。
- **排序沒有濫用控制** —— 沒有機制限制 admin 的 `reorder` 呼叫頻率或加以審查;粗心的 admin 可以讓某個使用者的請求一直排在後面。稽核日誌是唯一的事後手段。
- **排序無法搶佔** —— 被移到最前的等待者仍需等執行時間最長的 in-flight 請求結束才能拿到那個釋放的名額。
- **手動順序不持久** —— 它只存在於行程記憶體;重啟會遺失,等待佇列回到 FIFO。
- **`audit()` 寫入失敗被吞掉** —— 追加失敗會被記錄並丟棄,而不是向上拋,因此即使稽核行遺失,admin 操作仍然成功。
- **拆分的 provider id 必須全部列出** —— 如果部署宣告了多個指向同一 vLLM 端點的 provider id,它們每一個都必須出現在 `gatedProviders` 中,否則未列出的路由會繞過上限。
