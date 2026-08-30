# @deepseek-ai/dsh-client-ui-pipeline

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

流水線表面插件（瀏覽器半部）：側欄 `sidebar.pipelines` 區塊（會話瀏覽器下方的功能導覽座位，由 ui-sidebar 的外殼契約持有）與一個 `shell.overlay` 全視窗編輯器覆蓋層（order 20）。兩個入口共享一個 root 作用域 store——開啟中的流水線 id——在 apply 時建立，身份跟隨插件 fiber；並共享一個面向生成的 `pipelines` Remote 命名空間（`list`、`get`、`save`、`delete`、`setEnabled`、`triggerNow`、`runs`、`run`）的注入面。導覽區塊列出每條流水線的即時狀態、失敗連擊徽章，以及每列的暫停/恢復開關（`setEnabled` 之後重新讀取列表）；點擊流水線寫入 store、開啟覆蓋層並請求側欄展開。沒有開啟的流水線時覆蓋層不渲染任何內容；開啟後顯示頁首（名稱、立即執行、關閉）、唯讀 DAG 畫布——定義不攜帶位置，分層佈局由 elkjs 計算——以及執行列表。立即執行會等待 `triggerNow` 完成並重新整理執行列表。

`/client` 匯出插件體（`apply`/`inject`）、共享 store 工廠（`createPipelineUiStore`）、純函式 `layoutDag` 及其 `LaidOutNode` 形狀，以及注入/prop 型別詞彙。畫布是 `@xyflow/react` 之上的表現元件，處於唯讀模式（不可拖曳、不可連線、不持久化位置）。

## Model Experience

無。表面透過宿主的 `pipelines` Remote 命名空間讀取流水線定義與執行記錄，不新增任何提示內容、會話事件或投影。

#### KV Cache effect

無。

## Known Limitations and Deferred Work

- **尚無範本畫廊與 JSON 匯入** —— Scheduled Search 範本表單與貼上 JSON 匯入路徑隨後續切片交付；`save` 已接受完整 WorkflowJSON 文件。
- **檢查器僅支援選取** —— 點擊畫布節點會高亮它，但檢查器的各窗格（每節點的設定 / 輸入 / 輸出）與溯源檢視隨檢查器切片交付。
- **LLM 節點依賴引擎設定** —— 編輯器無法按節點選擇模型；LLM 節點依賴引擎的 `llmProvider`/`llmModel` 預設值，否則以 `LLM_NODE_UNCONFIGURED` 大聲失敗。
