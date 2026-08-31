# @deepseek-ai/dsh-pipeline-local

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

pipeline 能力接縫（`ctx.pipelineEngine`）的檔案型 provider：在設定的儲存根目錄下持久化 `WorkflowJSON` 定義、投影帶 run 指標的 registry 摘要，並評估定義——`builtin` 與 `llm` 節點——套用重疊政策。它實作的 Service Definition 是 [`dsh-pipeline`](../../pipeline/pipeline)。

## 儲存版面配置

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

`registerBuiltin(ref, step)` 掛載 `builtin` 節點引用的具名純轉換；未知的 ref 在執行時 fail loud（`STEP_UNKNOWN`）。LLM 節點呼叫掛載的 `ctx.llm` runtime，使用 `llmProvider`/`llmModel` 設定預設（節點層級 `model` 覆寫模型）；未設定的路由 fail loud（`LLM_NODE_UNCONFIGURED`）。

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

- **agent 節點 fail loud**——執行 agent 節點會拋出 `AGENT_NODE_RUNTIME_UNAVAILABLE`；背景 agent runtime（經 agent factory 的 run session、subagent 委派）是下一個切片，屆時 skills 選項也會有執行故事。
- **run session 尚未投影**——run 紀錄是 `runs/` 下的檔案指標；把節點生命週期投影進每個 run 的 session log（含 SDK expected-output 漣漪）是後續切片。
- **單一儲存根目錄**——provider 持有一個 `storageDir`；per-workspace 範圍隨選擇根目錄的 BFF/UI 接線落地。
