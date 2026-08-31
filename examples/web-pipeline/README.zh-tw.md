# 排程流水線

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

本 overlay 讓一個 `dsh web` 行程接入排程流水線 seam，不改變出廠預設的 Web 組合：

```sh
dsh web --patch examples/web-pipeline/cordis.yml
```

該組合掛載檔案支撐的引擎（`@deepseek-ai/dsh-pipeline-local`）並關閉調度器，因此執行只經手動通道（`pipelines/triggerNow`）或模型工具呼叫啟動——cron 觸發在部署顯式開啟前保持關閉。run-session 投影詞彙（`@deepseek-ai/dsh-session` 與 JSONL 持久化）把每次執行的日誌落到 `./.sessions`（每次執行一個目錄）；定義與執行記錄在 `./.pipelines`。

引擎隨附 Scheduled Search 範本（`scheduled-search/*` 內建步驟）：透過 UI 範本畫廊或 `pipelines/createFromTemplate` 建立流水線時，會展開為 trigger → search → normalize → dedupe → persist（可選 summarize）節點。search 步驟每次執行在 arXiv 的禮貌窗口內向 arXiv API 發一次真實請求；需要確定性或離線執行的部署改為註冊自己的內建步驟（`tests/` 裡的 snapshot 測試展示了註冊與一次全程無網路的手動執行）。

每次執行把節點生命週期——started/settled 結果、JSON 輸出、耗時與錯誤——投影進自己的背景工作階段，事件附帶 `ignorable` 讀取安全標記；`pipelines/run` 把該投影摺疊回編輯器的執行詳情。刪除流水線保留其執行記錄與產物；保留上界（`retainedRuns`，預設 50）會連同執行日誌一起修剪最舊的記錄。

已知限制：隨附的 llm 節點只聚合 text-delta 輸出。回應走 reasoning 通道的推理模型會得到空摘要；部署可選擇文字優先的模型，或使用按節點的模型覆寫（後續切片會聚合 reasoning 內容）。
