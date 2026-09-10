# @deepseek-ai/dsh-library

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

Librarian 服務（`ctx.librarian`）：NotebookLM 形態、可持久保存的多知識庫系統。每本知識庫把上傳的文件保存兩份 — 原始檔供人預覽與下載、轉換後的 Markdown 供 agent 閱讀與檢索 — 放在 `<DSH_HOME>/library/v1/<notebookId>/{original,markdown}` 下。記錄存於 `library` 儲存領域（`notebooks` 與 `resources` 表）。

轉換走供應者接縫：`registerConverter()` 接受 `{ id, priority, accepts, convert }` 供應者，依優先度遞減嘗試。內建兩個 — markitdown Python 子行程（`python -m markitdown`，Office/PDF/EPUB/HTML，可用 `markitdown: false` 關閉）與無依賴的文字後援（Markdown／純文字／CSV／JSON／HTML）。轉換失敗會保留原始檔，並把資源連同失敗摘要落在 `error`。

每次內容變動都會重新生成該知識庫的**入庫時索引**（文件旁的 `index.json`）：每份資源的大綱、前導純文字摘要、以及帶預先統計詞頻的標題分段 chunk。`structure()` 與 `search()` 由這份索引供應 — 一次檔案讀取加計分，查詢時不讀文件、不重新分詞 — 缺失、無法解析或過期的索引（早於此功能的知識庫、被手改的檔案）會在首次讀取時自我修復重建。`search()` 以 TF-IDF 加權關鍵詞為 chunk 計分（CJK 雙字組加拉丁詞，中英混寫的筆記不需分詞器也能命中）。`ask()` 產生有據回答：檢索最佳 chunk，連同問題送給設定的模型（先看 `provider`/`model` 設定，其次 agent 預設選擇），回傳附逐摘錄出處的答案；沒有關鍵詞命中的問題（總覽式提問）退回每份文件的前導內容，只有沒有可讀內容的知識庫才會不呼叫模型直接婉拒（`grounded: false`）。`ingest()` 是共用的程式化入口（UI 上傳、模型工具、未來的 pipeline 目的地），在解析前落定轉換 — 含索引。

每次落定的問答都會附加到知識庫的持久**問答紀錄**（`ask-log.json`，保留最新 200 筆）：`askLog()` 由舊到新讀取歷史，`recordAsk()` 讓工具呼叫端把 subagent 回答的問答記進同一份歷史，以來源（`ui`/`agent`）標記，所以 Library 頁的討論串也會顯示 agent 問過什麼。

## 模型體驗

本套件自身不註冊工具、提示詞區段或工作階段事件；模型經 `@deepseek-ai/dsh-tool-library`（`library_*` 工具）與 `librarian` subagent 觸及它。

#### KV 快取影響

無：這裡沒有任何內容進入模型請求，各步驟間提示詞前綴位元組不變。

## 已知限制與延後工作

- 檢索是對入庫時索引的關鍵詞計分；還沒有 embedding 或 FTS5 後端（接縫已預留），且索引每次變動整本重建而非增量。
- `ingest()` 行內落定轉換，大型 PDF 會讓呼叫端等待轉換期間；背景轉換（UI 輪詢 `converting` 狀態）延後。
- markitdown 轉換器需要主機上裝有 `markitdown` 套件的 Python；可用性只能靠實際執行探測，失敗路徑由文字後援承接。
- llm-wiki 式概念頁、反向連結與排程搜尋匯入不在此範圍（drill-docs 追蹤的規格開放問題）。
- 知識庫屬於安裝而非使用者；檔案根目錄透過 `dshHome` 設定預留所有權移轉。
