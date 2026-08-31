# @deepseek-ai/dsh-pipeline-local

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

pipeline 能力接縫（`ctx.pipelineEngine`）的檔案型 provider：在設定的儲存根目錄下持久化 `WorkflowJSON` 定義、投影帶 run 指標的 registry 摘要，並評估定義——`builtin` 與 `llm` 節點——套用重疊政策。它實作的 Service Definition 是 [`dsh-pipeline`](../../pipeline/pipeline)。

## 儲存布局

```
<storageDir>/
  registry.json               # index: per-pipeline metrics projection (name, enabled, last/next run, failure streak, run count)
  definitions/<id>.json       # one validated WorkflowJSON per pipeline (atomic write)
  runs/<id>/<ordinal>.json    # one settled run's record; retained per `retainedRuns`, pruned oldest-first
  state/<id>/                 # per-pipeline directory builtin steps may use for cross-run state (dedupe indexes)
```

每次寫入都是 atomic（暫存檔 + rename）；每次載入都經 `validateWorkflowJson` 驗證，手改或截斷的儲存會在啟動時 fail loud。有定義檔而無索引項會被採納（定義是持久化的事實來源、索引是衍生投影）；有索引項而無定義檔屬損壞，拒絕載入。

## 評估

`startRun` 套用重疊政策——每條 pipeline 同時僅一個執行中的 run；後續觸發以資料回傳 `{ outcome: 'skipped', reason: 'already-running' }`，不進佇列。run 自 trigger 起拓撲序評估：每個節點的輸入是其單一上游的輸出（多個上游合併成以節點 id 為鍵的 record；無上游則為 `null`），每個節點發出 start/end 對，失敗的節點使 run 失敗並停止下游執行。disabled 節點與僅經由它們可達的節點一律跳過。指標在提交時更新：`lastRunAt`、`lastStatus`、`lastError`，以及成功 run 會歸零的 `failureStreak`。

`registerBuiltin(ref, step)` 掛載 `builtin` 節點引用的具名純轉換；未知的 ref 在執行時 fail loud（`STEP_UNKNOWN`）。LLM 節點呼叫掛載的 `ctx.llm` runtime，使用 `llmProvider`/`llmModel` 設定預設（節點層級 `model` 覆寫模型）；未設定的路由 fail loud（`LLM_NODE_UNCONFIGURED`）。Scheduled Search 內建步驟（`scheduled-search/*`）隨附已預掛，`createFromTemplate` 把 `scheduled-search` 範本展開為驗證過的定義——trigger → search → normalize → dedupe → persist，另加選配的 llm `summarize` 節點。

## Run session

每次 run 都投影進自己的背景 session（origin `'pipeline'`、不在可見表面）：定義快照、每節點的 started/settled 事件（帶 JSON 輸出與耗時）、與一筆 run-settled 事件——全部攜帶 envelope 的 `ignorable` 標記，pipeline seam 之外的 session 讀取方能安全跳過。run 紀錄攜帶 minted session id（run id 加隨機後綴，跨刪除重建週期唯一），已結束 run 的節點明細從持久化 log 折疊回來，flush 先於指標 commit。retention 修剪退役 run 的紀錄與其 log，一併經持久化 `forget` seam 註銷。

## 排程

引擎掛載 cron tick 迴圈（interval 經 `ctx.effect`、隨 fiber 銷毀）。每輪先以 croner 補齊缺漏的下一次觸發時間，對到期的排程以 `'scheduled'` lane 走 `startRun`（重疊跳過計入摘要的 `skippedCount`），並嚴格以當下時間重算下一次觸發——latest-only 補跑，永不重播積壓。恢復已暫停的 pipeline 以當下重算、不追溯觸發；儲存定義會清掉投影，下一輪 tick 重算。

## Config

| key | 必填 | 意義 |
|---|---|---|
| `storageDir` | 是 | 絕對儲存根目錄；缺漏在掛載時失敗 |
| `retainedRuns` | 否 | 每條 pipeline 保留的 run 紀錄數（預設 50） |
| `llmProvider` | 否 | llm 節點的 provider 路由 |
| `llmModel` | 否 | 無節點層級覆寫時 llm 節點的模型 |
| `scheduler` | 否 | 是否掛載 tick 迴圈（預設 true） |
| `tickSeconds` | 否 | tick 間隔秒數（預設 60） |

## Model Experience

None, as the engine registers no prompt, tool schema, or provider request; the model-facing consumer and the llm nodes' own requests own every model-visible effect.

#### KV Cache effect

None；本套件既不組裝也不發送 provider 請求。

## Known Limitations and Deferred Work

- **agent 節點 fail loud**——執行 agent 節點會拋出 `AGENT_NODE_RUNTIME_UNAVAILABLE`；經 agent factory 與 subagent 委派的背景 agent runtime 延後落地，屆時 skills 選項也會有執行故事。
- **reasoning 通道模型摘要為空**——llm 節點只聚合 `text-delta` 輸出；把文字放在 reasoning 通道回應的模型（`content: null`）會得到空字串。部署應選擇文字優先的模型；聚合 reasoning 內容屬後續切片。
- **單一儲存根目錄**——provider 持有一個 `storageDir`（web bundle 掛載 dsh-home 的 `pipelines` 目錄）；per-workspace 範圍隨 workspace 感知的接線落地。
