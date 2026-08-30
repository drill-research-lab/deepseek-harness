# @deepseek-ai/dsh-pipeline

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

Pipeline 能力接縫詞彙：Drill Pipelines 的持久化 `WorkflowJSON` 定義格式、其純載入期驗證，以及標識 pipeline、run 與節點的 branded id。pipeline 引擎 provider 執行驗證過的定義；consumer 呈現它們。`ctx.pipelineEngine` Service Definition 與 `pipeline/*` 生命週期事件隨引擎 provider 落地。

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

`validateWorkflowJson(value)` 是載入期的 parser 邊界：純函式、無 I/O，拋出帶封閉 `PipelineSchemaErrorCode` 的 `PipelineSchemaError`，訊息指出第一個缺陷的欄位路徑（`nodes[2].prompt`）。它檢查每一層的形狀與允許鍵（未知欄位一律拒絕——對 LLM 生成定義的錯字防護）、唯一節點 id、恰一個 trigger 節點、edge 端點/重複/目標規則、無環（含自環）、五欄 cron 結構，以及經 `Intl` 檢查的 IANA 時區名。刻意不在這裡做的：cron 的範圍與步進語意屬於解析該運算式的 scheduler provider；`builtin.ref` 的解析屬於 provider registry。

## Model Experience

None, as the schema vocabulary and its validation register no prompt, tool schema, or provider request; the engine provider and its consumers own every model-visible effect.

#### KV Cache effect

None；本套件既不組裝也不發送 provider 請求。

## Known Limitations and Deferred Work

- **尚無 Service Definition**——`ctx.pipelineEngine` 與 `pipeline/*` 生命週期事件隨引擎 provider 落地；本套件目前只提供詞彙與驗證。
- **僅線性圖**——schema 沒有分支或 fan-out 欄位；它們隨執行它們的引擎切片以附加選填欄位落地。
- **cron 語意延後**——驗證只檢查結構（五欄、字元集）；範圍與步進驗證在 scheduler provider 解析運算式時進行，於註冊時 fail loud。
