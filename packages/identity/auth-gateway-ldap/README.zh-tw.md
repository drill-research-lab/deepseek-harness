# @deepseek-ai/dsh-auth-gateway-ldap

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

為獨立於 DSH 行程部署的身分驗證閘道註冊 LDAP 和 DSH 本機登入路由。LDAP 是預設 provider。選填註冊只會在閘道的文件型 `ctx.localAccounts` 儲存中建立帳戶，絕不會建立 LDAP 帳戶。只有閘道接收憑證、簽發短期 Ed25519 身份 Cookie，並為每次登入建立可撤銷的文件工作階段。DSH Host 身分驗證邊界會驗證並移除 Cookie，下游 DSH 工作只會收到 `AuthenticatedUser`。

閘道透過 `ctx.credentials` 要求 `AUTH_COOKIE_PRIVATE_KEY`、`AUTH_COOKIE_ISSUER` 和 `AUTH_COOKIE_AUDIENCE`。由於 host-only Cookie 跨埠生效，其 Web 伺服器必須使用與 DSH 瀏覽器來源相同的主機名；生產部署必須在 HTTPS 後啟用 `cookieSecure`。

絕不能在 DSH 行程中掛載該包，也不能在可信主機之外暴露 DSH 監聽埠。應為閘道使用獨立的 Cordis 組合和 Web 伺服器實例。

執行 `dsh-auth-ldap-gateway` 時必須設定不同於 `DSH_HOME` 的 `DSH_AUTH_HOME`。其中僅所有者可讀的 `.credentials.yaml` 保存 LDAP 綁定密碼和 `AUTH_COOKIE_PRIVATE_KEY`，`accounts.json` 則保存經 scrypt 派生的本機密碼雜湊。`sessions/` 目錄權限為 `0700`；每次登入建立一個權限為 `0600`、以隨機會話 id 雜湊命名的記錄。DSH 應將 `DSH_AUTH_SESSION_DIRECTORY` 指向此目錄。DSH 自己的憑證儲存只保存 `AUTH_COOKIE_PUBLIC_KEY` 以及匹配的簽發者和受眾。嚴格部署只向 Host 身分驗證邊界授予工作階段讀取權限，同時不讓下游 DSH 接觸閘道憑證與本機帳戶。

該可執行程序預設監聽回環埠 `3081`。設定 `DSH_AUTH_PUBLIC=true` 可綁定所有介面，`DSH_AUTH_PORT` 選填擇其他埠，`DSH_LOCAL_REGISTRATION_ENABLED=true` 可允許本機帳戶建立，`DSH_APP_URL` 指定成功後跳轉的 DSH 瀏覽器 URL；只有可信 HTTP 開發路徑可以設定 `AUTH_COOKIE_SECURE=false`。`GET /auth/login` 顯示 LDAP 與本機帳戶表單，`GET /auth/register` 在啟用時顯示本機登錄檔單。每個表單都攜帶一個與 HttpOnly、SameSite=Strict 閘道 Cookie 比對的 token，因此表單 POST 使用不透明 `Origin` 的瀏覽器仍能防止跨站提交。成功的 POST 會設定身份 Cookie，並跳轉至相同 hostname 上設定的 DSH 埠。

JSON 用戶端使用相同的憑證路由：`/auth/login` 接受 `{ provider?, username, password }`，省略 provider 表示 `ldap`；`/auth/register` 從 `{ username, password, displayName, email }` 建立 DSH 本機帳戶。`GET /auth/me` 同時驗證簽章 Cookie 與仍然有效的文件工作階段。`POST /auth/logout` 會先刪除該工作階段，再使瀏覽器 Cookie 過期，因此重放登出前保存的 Cookie 會立即收到 `401`。

## 模型體驗

無，因為該閘道是獨立的身份平面行程，不呼叫模型。

#### KV Cache 影響

無；憑證和身份 Cookie 絕不進入模型提供方請求。

## 已知限制與延後工作

- 該閘道提供最小 HTML 登入與登錄檔單，但尚未提供密碼重設、MFA、電子郵件驗證、速率限制或帳戶管理。
