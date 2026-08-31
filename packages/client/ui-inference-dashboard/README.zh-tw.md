# @deepseek-ai/dsh-client-ui-inference-dashboard

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

推理儀表板是 DSH 設定中的原生分節，用於顯示即時 vLLM 執行狀態。它留在現有設定對話框中，不嵌入或跳轉到其他應用程式。卡片顯示執行中與等待中的請求總數、可用時的 KV 快取佔用率、累計輸入與輸出 token，以及排程器搶佔次數。

瀏覽器呼叫已認證的 `llm.metrics` RPC。Host 讀取由部署透過 `DSH_INFERENCE_METRICS_URL` 設定的 Prometheus 端點，限制每次回應大小、設定截止時間、只解析畫面所需的 vLLM 指標，並且不回傳端點位址。成功回應會提供下一次重新整理間隔。抓取失敗會停止自動輪詢、保留可見錯誤狀態，並要求使用者明確重試。

啟動 Web 組合前，將 `DSH_INFERENCE_METRICS_URL` 設為完整的 vLLM 指標網址，通常是 `http://<vllm-host>:<port>/metrics`。不設定時，分節仍然可見，並明確顯示尚未設定的狀態。

版面參考了 [SparkDash](https://github.com/MiaAI-Lab/sparkDash)，但實作使用 DSH 的設定插槽、設計 token、已認證 RPC 載體與語言系統。系統不會捆綁 SparkDash 原始碼、伺服器、iframe 或額外頁面。

## 模型體驗

無，因為此套件只為面向使用者的瀏覽器分節讀取執行指標，不會向模型請求或工作階段日誌加入任何內容。

#### KV 快取影響

無。顯示的佔用率僅供觀察；儀表板既不配置快取，也不修改推理請求。

## 已知限制與後續工作

- **請求數是部署級彙總值** — vLLM 的執行中與等待中 gauge 不會識別目前使用者、工作階段或請求，因此無法確定某個任務的排隊位置。精確位置需要 DSH LLM proxy 記錄請求身分與生命週期。
- **目前只識別 vLLM 後端** — 如果已設定端點沒有公開必要的 vLLM 請求 gauge，畫面會顯示指標無效錯誤。
- **失敗後手動恢復** — 成功取得資料時依照 Host 提供的間隔輪詢；抓取失敗後等待使用者重試，避免形成不受控的重試循環。
