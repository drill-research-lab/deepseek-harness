# @deepseek-ai/dsh-library-api

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

面向瀏覽器的 library 閘道（`ctx.library`）：`library` Remote 命名空間（用戶端的 `ctx.remote.library.*`）把 librarian 服務投影成純 JSON 線上契約 — 知識庫 CRUD、資源列舉與刪除、貼上文字入庫、Markdown 預覽負載、有據 `ask`、以及知識庫的持久 `askLog` 歷史 — 加上僅接受 JSON 的 `/api` 閘道載不動的 `/library` 二進位資料通道：`POST /library/upload?notebook=&name=&kind=` 接收一個 raw 請求本體（由 `maxUploadBytes` 限位元組），`GET /library/<resourceId>/raw` 行內串流保存的原始檔（PDF／文字預覽的 `iframe` 來源），`GET /library/<resourceId>/download` 以附件串流。掛載驗證服務時，每個資料通道請求都經 `ctx.auth` 重新驗證；路由只在組合了 `webServer` 時註冊。

## 模型體驗

本套件不註冊工具、提示詞區段或工作階段事件；它只面向瀏覽器。模型經 `@deepseek-ai/dsh-tool-library` 觸及同一個 librarian 能力。

#### KV 快取影響

無：這裡沒有任何內容進入模型請求，各步驟間提示詞前綴位元組不變。

## 已知限制與延後工作

- 上傳在入庫前完整緩衝於記憶體（鏡射 `/api` 橋接）；串流到暫存檔延後。
- 服務的檔案不支援 `Range`；Chromium 的 PDF 檢視器不需要分段抓取也能運作。
- 資料通道只信任同源 cookie；不重查 `/api` 的瀏覽器信任圍欄，與它鏡射的 writing PDF 路由一致。
- 線上視圖沒有分頁；資源極多的知識庫會回傳一次完整列表。
