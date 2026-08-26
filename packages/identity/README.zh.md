# identity/ — 共享身份

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

跨产品领域共享的身份合约和值。

| 包 | 职责 | ctx key |
|---|---|---|
| [`anonymous-user-id/`](anonymous-user-id/README.md) | 为遥测、反馈和 DeepSeek 请求持久化一个限定于 Harness home 的匿名关联 id | — |
| [`auth/`](auth/README.md) | 已验证用户和请求作用域合约 | `ctx.auth` |
| [`ownership/`](ownership/README.md) | 可信 owner principal 和 rooted UserHome 合约 | `ctx.ownership` |
| [`auth-ldap/`](auth-ldap/README.md) | 外部网关使用的 LDAP 验证 | `ctx.ldapDirectory` |
| [`auth-local/`](auth-local/README.md) | 由外部网关持有、基于文件的 DSH 本机账户 | `ctx.localAccounts` |
| [`auth-gateway-ldap/`](auth-gateway-ldap/README.md) | 外部网关的 LDAP／本机凭证路由和身份 Cookie 签名 | `ctx.ldapAuthGateway` |
