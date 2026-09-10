# @deepseek-ai/dsh-tool-library

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

Library 知識庫上面向模型的 librarian 工具，依 DeepWiki MCP 的介面形狀設計：`library_ask` 是主要互動（問題進、附行內 `[來源]` 引用的有據回答出；沒有相關內容時婉拒），`library_structure` 列出知識庫、資源、前導標題與每份資源的前導摘錄供導覽 — 由入庫時索引供應，`library_read` 回傳一份資源轉換後的 Markdown（受 `maxReadChars` 限制），`library_ingest` 把文字內容或可讀檔案經 UI 上傳共用的入口歸檔進知識庫。知識庫參數接受 id 或精確標題（簡繁不敏感）；未知的參照會連同當前知識庫清單一起回報錯誤，讓模型能自我修正。

`library_ask` 實作 issue #23 的委派工作流：當 `librarian` subagent 供應者已掛載且呼叫者是 agent 時，問題委派給一個全新的 librarian 子代理，由它以 `library_structure`/`library_read` 導覽知識庫（本工具與 `library_ingest` 被工具過濾排除在子代理之外，因此絕不會遞迴），以行內 `[name]` 引用作答；引用來源依知識庫的資源名稱回收。沒有 subagent 執行環境 — 或呼叫者不是 agent — 時，改由 librarian 服務的直接檢索作答路徑回答。兩條路徑都把問答以 `agent` 條目附加到知識庫的持久問答紀錄，所以從聊天中問的問題會出現在 Library 頁的討論串。

## 模型體驗

註冊四個 `library_*` 工具；其 schema 進入組合中每個 agent 的工具組裝。委派的 `library_ask` 花費一次 subagent 執行（它自己跑一輪 structure/read 的 agent 迴圈）；直接後援花費 librarian 設定路由上的一次輔助模型呼叫。

#### KV 快取影響

工具 schema 跨步驟穩定，提示詞前綴保持可快取；只有工具結果會變。

## 已知限制與延後工作

- 不支援 URL 入庫；先用 `web_fetch` 抓網頁內容，再 `library_ingest` 文字。
- `library_read` 在 `maxReadChars` 處直接截斷，沒有偏移分頁。
- 工具是全域註冊（每個 agent 都看得到）；按 preset 限制留給組合層。
- 委派回答以精確 `[name]` 比對回收引用；子代理改寫資源名稱會遺失該引用（回答文字仍保留行內引用）。
