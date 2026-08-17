# @deepseek-ai/dsh-auth-ldap

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

為身分驗證閘道行程提供 `ctx.ldapDirectory`。它使用受限服務帳戶搜尋使用者，並透過 LDAPS 使用者綁定驗證提交的密碼。DSH 不載入該包；該包也絕不建立或修改 LDAP 條目。

預設憑證引用為 `LDAP_URL`、`LDAP_BASE_DN`、`LDAP_BIND_DN`、`LDAP_BIND_PASSWORD`、`LDAP_USER_SEARCH_FILTER`、`LDAP_USER_ID_ATTRIBUTE` 和 `LDAP_USERNAME_ATTRIBUTE`。`LDAP_URL` 必須使用 `ldaps://`。服務帳戶只需要登入所需的讀取／搜尋權限。

LDAP 身份使用設定的不可變屬性作為 DSH `userId`，格式為 `ldap:<id>`。

LDAP 操作和連線建立預設在十秒後逾時。LDAPS 用戶端提供緊湊的標準 ECDHE key share，以適配受限的 WireGuard MTU，同時保留憑證驗證。透過 `NODE_EXTRA_CA_CERTS` 在閘道行程啟動時提供內部 CA；絕不能向 DSH 提供 LDAP 或 CA 私鑰。

## 模型體驗

無，因為該包在 DSH 外部執行，僅為閘道產生已驗證身份斷言。

#### KV Cache 影響

無；LDAP 憑證和屬性絕不進入模型請求。

## 已知限制與延後工作

- 密碼過期、LDAP 密碼變更和目錄設定仍由外部 LDAP 管理流程負責。
