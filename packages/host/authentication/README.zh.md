# @deepseek-ai/dsh-host-authentication

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

通过验证独立部署的身份验证网关签发的短期 Ed25519 身份 Cookie，并要求其文件会话仍然有效来提供 `ctx.auth`。验证器只接受所配置的签发者和受众，通过请求本地存储公开已验证的 `{ userId, username, isAdmin }`（`isAdmin` 是登录时的管理员组快照，取自可撤销的文件会话而非单独信任 Cookie；省略该字段的令牌按非管理员处理），并且绝不注册登录、注册、会话签发或凭证输入路由。

默认凭证引用为 `AUTH_COOKIE_PUBLIC_KEY`、`AUTH_COOKIE_ISSUER` 和 `AUTH_COOKIE_AUDIENCE`；`cookieName` 默认为 `dsh_identity`。将 `sessionDirectory`（bundle 会读取 `DSH_AUTH_SESSION_DIRECTORY`）指向网关所有者控制的会话目录。将 PEM 公钥存入 DSH 的凭证存储。匹配的私钥只属于身份验证网关，绝不能存在于 DSH 进程、配置或文件系统中。

HTTP 和 WebSocket 传输会在分派前调用 `authenticateRequest()`，并通过 `runAs()` 运行已接受的工作。无效、过期、目标错误或被篡改的 Cookie 不会产生身份。

## 模型体验

无，因为身份验证控制浏览器请求是否可以到达现有 API，但不增加模型可见内容。

#### KV Cache 影响

无；身份断言不进入模型请求。

## 已知限制与延后工作

- 授权角色延后到出现消费方需求时处理。
