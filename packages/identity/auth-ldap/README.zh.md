# @deepseek-ai/dsh-auth-ldap

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

为身份验证网关进程提供 `ctx.ldapDirectory`。它使用受限服务账户搜索用户，并通过 LDAPS 用户绑定验证提交的密码。DSH 不加载该包；该包也绝不创建或修改 LDAP 条目。

默认凭证引用为 `LDAP_URL`、`LDAP_BASE_DN`、`LDAP_BIND_DN`、`LDAP_BIND_PASSWORD`、`LDAP_USER_SEARCH_FILTER`、`LDAP_USER_ID_ATTRIBUTE` 和 `LDAP_USERNAME_ATTRIBUTE`。`LDAP_URL` 必须使用 `ldaps://`。服务账户只需要登录所需的读取／搜索权限。

LDAP 身份使用配置的不可变属性作为 DSH `userId`，格式为 `ldap:<id>`。

LDAP 操作和连接建立默认在十秒后超时。LDAPS 客户端提供紧凑的标准 ECDHE key share，以适配受限的 WireGuard MTU，同时保留证书验证。通过 `NODE_EXTRA_CA_CERTS` 在网关进程启动时提供内部 CA；绝不能向 DSH 提供 LDAP 或 CA 私钥。

## 模型体验

无，因为该包在 DSH 外部运行，仅为网关产生已验证身份断言。

#### KV Cache 影响

无；LDAP 凭证和属性绝不进入模型请求。

## 已知限制与延后工作

- 密码过期、LDAP 密码变更和目录配置仍由外部 LDAP 管理流程负责。
