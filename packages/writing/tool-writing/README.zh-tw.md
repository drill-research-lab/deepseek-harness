# @deepseek-ai/dsh-tool-writing

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

面向模型的寫作工具，為寫作 agent 閉合 寫入 → 編譯 → 修復 迴圈，後端由 `@deepseek-ai/dsh-writing`（`ctx.reports`）與 `@deepseek-ai/dsh-writing-compile`（`ctx.latexCompile`）提供。

註冊在 `ctx.tools` 上的工具：

- `report_create` — 由標題、樣板與選填原始碼建立報告；其原始碼存放在工作階段工作區下以時間戳命名的目錄（`writing/<yyyymmddhhmmss>/main.tex`）中，傳入空 `source` 會得到空白文件。
- `report_write` — 替換當前全部原始碼（自動儲存；不生成快照）。
- `report_read` — 讀取當前原始碼，按 `maxReadChars` 截斷。
- `report_compile` — 編譯當前原始碼，返回診斷，並在成功時自動生成版本快照。
- `report_versions` — 由新到舊列出各版本快照。
- `report_restore` — 將報告復原到較早的快照。

## Configuration

| 鍵 | 預設值 | 含義 |
|---|---|---|
| `maxReadChars` | `20000` | `report_read` 返回的報告原始碼上限。 |
| `maxDiagnostics` | `50` | `report_compile` 返回的診斷上限。 |

## Model Experience

這些工具是寫作能力面向模型的表層。每次呼叫都由工具登錄檔記錄，報告內容與編譯診斷即寫作 agent 所見。報告登錄檔本身（報告項目、快照、樣板）不是模型輸入。

`tool:writing` 系統提示詞分區把這些工具作為 LaTeX 寫作的入口：要求建立、編輯或編譯 LaTeX 文件、文件或報告（包括空白文件）的請求會使用 `report_create` 及其他 `report_*` 工具，而不是通用的 `write`/`edit` 工具，該分區也點明瞭以時間戳命名的原始碼目錄。

#### KV Cache effect

無；這些工具不組裝任何提供方請求。

## Known Limitations and Deferred Work

- `report_write` 僅支援整體原始碼替換；段落級編輯與差分感知的部分更新已推遲。
- 編譯診斷來自編譯服務的日誌解析器；texlab LSP 診斷是另一個已推遲的能力面。
- 這些工具的無金鑰快照記錄覆蓋尚未接通；在加入組裝後以快照釘住模型可見文字。
