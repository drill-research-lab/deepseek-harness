# identity/ — 共享身份

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

跨產品領域共享的身份合約和值。

| 包 | 職責 | ctx key |
|---|---|---|
| [`anonymous-user-id/`](anonymous-user-id/README.md) | 為遙測、回饋和 DeepSeek 請求持久化一個限定於 Harness home 的匿名關聯 id | — |
| [`auth/`](auth/README.md) | 已驗證使用者和請求作用域合約 | `ctx.auth` |
| [`ownership/`](ownership/README.md) | 可信 owner principal 和 rooted UserHome 合約 | `ctx.ownership` |
| [`auth-ldap/`](auth-ldap/README.md) | 外部閘道使用的 LDAP 驗證 | `ctx.ldapDirectory` |
| [`auth-local/`](auth-local/README.md) | 由外部閘道持有、基於文件的 DSH 本機帳戶 | `ctx.localAccounts` |
| [`auth-gateway-ldap/`](auth-gateway-ldap/README.md) | 外部閘道的 LDAP／本機憑證路由和身份 Cookie 簽名 | `ctx.ldapAuthGateway` |
