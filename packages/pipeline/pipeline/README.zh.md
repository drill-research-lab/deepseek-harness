# @deepseek-ai/dsh-pipeline

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

Pipeline 能力接縫：Drill Pipelines 的持久化 `WorkflowJSON` 定義格式、其純載入期驗證、branded id，以及帶僅供觀察 `pipeline/*` 生命週期事件的 `ctx.pipelineEngine` Service Definition。引擎 provider（檔案型 registry、cron 排程器、跑在 run session 上的 DAG 評估器）執行驗證過的定義；consumer 呈現它們。

## 定義格式

一份定義就是一個純 JSON 文件——引擎、驗證器、UI 渲染與匯出/匯入的單一事實來源：

```json
{
  "version": 1,
  "id": "sch-search-arxiv",
  "name": "arXiv weekly scan",
  "template": { "ref": "scheduled-search", "inputs": { "query": "LLM agents" } },
  "trigger": { "kind": "cron", "expression": "0 9 * * 1", "timeZone": "Asia/Taipei", "enabled": true },
  "nodes": [
    { "id": "trigger", "type": "trigger" },
    { "id": "collect", "type": "builtin", "ref": "scheduled-search/search", "config": { "source": "arxiv" } },
    { "id": "summarize", "type": "llm", "prompt": "Summarize the new records." }
  ],
  "edges": [ { "from": "trigger", "to": "collect" }, { "from": "collect", "to": "summarize" } ]
}
```

節點型別是以 `type` 判別欄位構成的 merge-extensible union——未來型別以新增成員擴充，內部 switch 依文件化的 default 落下：

| type | 欄位 | 意義 |
|---|---|---|
| `trigger` | — | 唯一的入口節點；每份定義恰一個；任何 edge 不得指向它 |
| `builtin` | `ref`、`config?` | 引擎 provider 註冊的具名步驟（純轉換）；未知 ref 在載入時 fail loud |
| `llm` | `prompt`、`model?` | 單次 LLM 詢問；回應即節點輸出 |
| `agent` | `prompt`、`skills?`、`tools?` | 一次多步驟 subagent 執行 |

每個節點都帶唯一且穩定的 `id`（edge 以它為參照，顯示名稱改名不會破壞圖），外加選填的 `disabled` 與 `notes`。由內建 template 展開的定義會記錄其展開來源的 `template` 區塊。

## 驗證

`validateWorkflowJson(value)` 是載入期的 parser 邊界：純函式、無 I/O，拋出帶封閉 `PipelineSchemaErrorCode` 的 `PipelineSchemaError`，訊息指出第一個缺陷的欄位路徑（`nodes[2].prompt`）。它檢查每一層的形狀與允許鍵（未知欄位一律拒絕——對 LLM 生成定義的錯字防護）、唯一節點 id、恰一個 trigger 節點、edge 端點/重複/目標規則、無環（含自環）、五欄 cron 結構、經 `Intl` 檢查的 IANA 時區名，並透過排程器自己的模式引擎（croner）驗證 cron 語意：croner 無法計算的運算式在載入期即失敗，早於任何註冊。刻意不在這裡做的：`builtin.ref` 的解析屬於 provider registry。

## 接縫

`PipelineEngine`（default export、`ctx.pipelineEngine`）是引擎 provider 實作的抽象契約：

| 操作 | 契約 |
|---|---|
| `list()` | registry 投影（`PipelineSummary`：狀態、下次/上次執行、失敗連續次數、run 總數） |
| `get(id)` | 驗證過的定義；未知回傳 `undefined` |
| `save({ definition })` | 在持久化 parser 邊界驗證原始 JSON、持久化、提交後發出 `pipeline/definition-changed` |
| `delete(id)` | 移除定義；run session 與產出物保留（刪除不摧毀已記錄資料） |
| `setEnabled(id, enabled)` | 暫停或恢復 cron 觸發 |
| `startRun({ id, trigger })` | 套用重疊政策——每條 pipeline 同時僅一個執行中的 run；後續觸發回傳 `{ outcome: 'skipped', reason: 'already-running' }` 而非排隊；未知 id 拋出 code `'PIPELINE_UNKNOWN'` 的 `PipelineError` |

生命週期事件（`pipeline/definition-changed`、`pipeline/run-start`、`pipeline/node-start`、`pipeline/node-end`、`pipeline/run-end`）是僅供觀察的資料快照，具 per-listener 隔離；不攜帶任何節點輸入或輸出值——run 資料存放在各 run 自己的 session log。

## Model Experience

None, as the schema vocabulary and its validation register no prompt, tool schema, or provider request; the engine provider and its consumers own every model-visible effect.

#### KV Cache effect

None；本套件既不組裝也不發送 provider 請求。

## Known Limitations and Deferred Work

- **僅線性圖**——schema 沒有分支或 fan-out 欄位；它們隨執行它們的引擎切片以附加選填欄位落地。
