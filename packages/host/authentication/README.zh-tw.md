# @deepseek-ai/dsh-host-authentication

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

透過驗證獨立部署的身分驗證閘道簽發的短期 Ed25519 身份 Cookie，並要求其文件工作階段仍然有效來提供 `ctx.auth`。驗證器只接受所設定的簽發者和受眾，透過請求本機儲存公開已驗證的 `{ userId, username, isAdmin }`（`isAdmin` 是登入時的管理員群組快照，取自可撤銷的檔案工作階段而非單獨信任 Cookie；省略該欄位的權杖按非管理員處理），並且絕不註冊登入、註冊、工作階段簽發或憑證輸入路由。

預設憑證引用為 `AUTH_COOKIE_PUBLIC_KEY`、`AUTH_COOKIE_ISSUER` 和 `AUTH_COOKIE_AUDIENCE`；`cookieName` 預設為 `dsh_identity`。將 `sessionDirectory`（bundle 會讀取 `DSH_AUTH_SESSION_DIRECTORY`）指向閘道所有者控制的工作階段目錄。將 PEM 公鑰存入 DSH 的憑證儲存。匹配的私鑰只屬於身分驗證閘道，絕不能存在於 DSH 行程、設定或檔案系統中。

HTTP 和 WebSocket 傳輸會在分派前呼叫 `authenticateRequest()`，並透過 `runAs()` 執行已接受的工作。無效、過期、目標錯誤或被篡改的 Cookie 不會產生身份。

## 模型體驗

無，因為身分驗證控制瀏覽器請求是否可以到達現有 API，但不增加模型可見內容。

#### KV Cache 影響

無；身份斷言不進入模型請求。

## 已知限制與延後工作

- 授權角色延後到出現消費端需求時處理。
