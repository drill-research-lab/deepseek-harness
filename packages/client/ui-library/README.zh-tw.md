# @deepseek-ai/dsh-client-ui-library

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

Library 介面的瀏覽器半邊：一個 `sidebar.section` 條目在工作階段瀏覽器下方列出知識庫（rail 狀態渲染一個書本圖示），以及一個 `shell.overlay` 條目承載整頁 Library 視圖，版面依 NotebookLM 的知識庫頁 — 帶新增來源入口（上傳檔案、貼上文字、拖放）的來源欄、作為主區的持久有據問答串、以及可收合、有獨立 **Markdown** 與**原始檔（PDF／raw）**模式的預覽面板。Markdown 經共用的 `MarkdownText` 原語渲染；知識庫改名／新增／刪除與來源刪除用 `Modal` 對話框；回答引用是可點的 pill，點了在預覽面板開啟被引用的文件。

顯示中的知識庫與開啟的預覽資源住在共享頁面狀態裡，它同時是頁面的位址：外掛把它鏡射進 `#library/<notebookId>[/resource/<resourceId>]` URL hash（開機與 `hashchange` 時套用、以 `history.replaceState` 改寫），所以文件與問答串能從頁面外連結進來。問答串是持久的 — 它渲染知識庫在主機端的問答紀錄，包括 agent 從聊天中問的（有標記），重新載入與切換知識庫都不會消失。每個持久事實都經 `ctx.remote.library`（JSON）或 `/library` 資料通道（上傳 `POST`、預覽／下載 `GET`，靠同源身分 cookie）傳遞。

## 模型體驗

無：這是純瀏覽器介面；沒有內容進入模型請求。Agent 用 `@deepseek-ai/dsh-tool-library` 的 `library_*` 工具對著同一個 librarian 服務。

#### KV 快取影響

無：提示詞前綴位元組不變。

## 已知限制與延後工作

- 資源清單與問答串靠共享修訂計數器或自身變動後重新抓取；還沒有主機推播（`$on`）訂閱，別的用戶端上傳要等下次抓取才出現。
- 引用會開啟被引用的文件，但不會捲動到被引用的標題。
- 問答輸入框沒有模型選擇器；提問走 librarian 設定的路由。
- 新增來源對話框不支援 URL 入庫；請貼上內容或上傳存好的檔案。
