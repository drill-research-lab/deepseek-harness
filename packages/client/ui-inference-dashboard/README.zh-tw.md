# @deepseek-ai/dsh-client-ui-inference-dashboard

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

推理儀表板是 DSH 設定中的原生分節，用於顯示即時 vLLM 執行狀態與主機資源。它留在現有設定對話框中，不嵌入或跳轉到其他應用程式。緊湊的 LLM 面板顯示模型與上下文上限、附短期趨勢的生成和 prefill 吞吐量、引擎狀態、執行中與等待中的請求、KV 快取佔用率、累計生成 token 與搶佔次數、prefix cache 與 speculative decoding 接受率，以及 TTFT、端對端和 token 間延遲的 p95。資源群組另以 SparkDash 風格顯示 GPU、已掛載儲存與作用中網路面板。

瀏覽器呼叫已認證的 `llm.metrics` 與 `llm.resources` RPC。Host 讀取由 `DSH_INFERENCE_METRICS_URL` 設定的 Prometheus 端點及由 `DSH_INFERENCE_RESOURCES_URL` 設定的 SparkDash 快照；兩者共用回應大小限制與截止時間。資源回應僅允許 GPU 使用率、溫度、功耗、時脈、顯存及最多五個 GPU 程序，已啟用的掛載儲存容量與 I/O，以及帶位址的作用中網路介面、主要介面狀態、連線速率和傳輸速率。Spark 身分、MAC 位址、停用裝置、非作用中介面、CPU/RAM、來源 URL 與其餘快照不會進入瀏覽器回應。一個 RPC 失敗不會遮蔽另一組面板，並要求使用者明確重試。

啟動 Web 組合前，將 `DSH_INFERENCE_METRICS_URL` 設為完整的 vLLM 指標網址（通常是 `http://<vllm-host>:<port>/metrics`），並將 `DSH_INFERENCE_RESOURCES_URL` 設為 SparkDash 快照網址（通常是 `http://<sparkdash-host>:5555/api/sparks/<spark-id>/metrics`）。缺少其中一個 URL 時，對應面板群組仍然可見，並明確顯示尚未設定的狀態。

LLM 與資源面板、指標選擇、即時速率公式和 sparkline 根據 [SparkDash](https://github.com/MiaAI-Lab/sparkDash) 在 MIT 授權下改編，保留的聲明位於 [`SPARKDASH_LICENSE`](SPARKDASH_LICENSE)。實作使用 DSH 的設定插槽、設計 token、已認證 RPC 載體與語言系統，不會捆綁 SparkDash 伺服器、iframe 或獨立應用程式。

## 模型體驗

無，因為此套件只為面向使用者的瀏覽器分節讀取執行指標，不會向模型請求或工作階段日誌加入任何內容。

#### KV 快取影響

無。顯示的佔用率僅供觀察；儀表板既不配置快取，也不修改推理請求。

## 已知限制與後續工作

- **請求數是部署級彙總值** — vLLM 的執行中與等待中 gauge 不會識別目前使用者、工作階段或請求，因此無法確定某個任務的排隊位置。精確位置需要 DSH LLM proxy 記錄請求身分與生命週期。
- **目前只識別 vLLM 後端** — 如果已設定端點沒有公開必要的 vLLM 請求 gauge，畫面會顯示指標無效錯誤。
- **歷史記錄只在目前程序內短期保留** — 吞吐量、GPU 使用率與 GPU 溫度 sparkline 保存最近 30 次成功的瀏覽器取樣。SparkDash 的按日持久化、歷史圖表、benchmark 與 showcase 工作流程不屬於這個唯讀設定分節。
- **資源面板僅供觀測** — DSH 不暴露 SparkDash 的重新整理、裝置開關、Wake-on-LAN 或設定寫入。Host 必須能存取已設定的唯讀快照網址。
- **失敗後手動恢復** — 成功取得資料時依照 Host 提供的間隔輪詢；抓取失敗後等待使用者重試，避免形成不受控的重試循環。
