# @deepseek-ai/dsh-auth-gateway-ldap

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

为独立于 DSH 进程部署的身份验证网关注册 LDAP 和 DSH 本机登录路由。LDAP 是默认 provider。可选注册只会在网关的文件型 `ctx.localAccounts` 存储中建立账户，绝不会建立 LDAP 账户。只有网关接收凭证、签发短期 Ed25519 身份 Cookie，并为每次登录建立可撤销的文件会话。DSH Host 身份验证边界会验证并移除 Cookie，下游 DSH 工作只会收到 `AuthenticatedUser`。

网关通过 `ctx.credentials` 要求 `AUTH_COOKIE_PRIVATE_KEY`、`AUTH_COOKIE_ISSUER` 和 `AUTH_COOKIE_AUDIENCE`。由于 host-only Cookie 跨端口生效，其 Web 服务器必须使用与 DSH 浏览器来源相同的主机名；生产部署必须在 HTTPS 后启用 `cookieSecure`。

绝不能在 DSH 进程中挂载该包，也不能在可信主机之外暴露 DSH 监听端口。应为网关使用独立的 Cordis 组合和 Web 服务器实例。

运行 `dsh-auth-ldap-gateway` 时必须设置不同于 `DSH_HOME` 的 `DSH_AUTH_HOME`。其中仅所有者可读的 `.credentials.yaml` 保存 LDAP 绑定密码和 `AUTH_COOKIE_PRIVATE_KEY`，`accounts.json` 则保存经 scrypt 派生的本机密码哈希。`sessions/` 目录权限为 `0700`；每次登录建立一个权限为 `0600`、以随机会话 id 哈希命名的记录。DSH 应将 `DSH_AUTH_SESSION_DIRECTORY` 指向此目录。DSH 自己的凭证存储只保存 `AUTH_COOKIE_PUBLIC_KEY` 以及匹配的签发者和受众。严格部署只向 Host 身份验证边界授予会话读取权限，同时不让下游 DSH 接触网关凭证与本机账户。

该可执行程序默认监听回环端口 `3081`。设置 `DSH_AUTH_PUBLIC=true` 可绑定所有接口，`DSH_AUTH_PORT` 可选择其他端口，`DSH_LOCAL_REGISTRATION_ENABLED=true` 可允许本机账户创建，`DSH_APP_URL` 指定成功后跳转的 DSH 浏览器 URL；只有可信 HTTP 开发路径可以设置 `AUTH_COOKIE_SECURE=false`。`AUTH_COOKIE_EXPIRE_SECONDS` 控制身份 Cookie 与可撤销会话的有效期，范围为 60 至 3600 秒，默认值为 300。`GET /auth/login` 显示 LDAP 与本机账户表单，`GET /auth/register` 在启用时显示本机注册表单。每个表单都携带一个与 HttpOnly、SameSite=Strict 网关 Cookie 比对的 token，因此表单 POST 使用不透明 `Origin` 的浏览器仍能防止跨站提交。成功的 POST 会设置身份 Cookie，并跳转至相同 hostname 上配置的 DSH 端口。

JSON 客户端使用相同的凭证路由：`/auth/login` 接受 `{ provider?, username, password }`，省略 provider 表示 `ldap`；`/auth/register` 从 `{ username, password, displayName, email }` 建立 DSH 本机账户。`GET /auth/me` 同时验证签章 Cookie 与仍然有效的文件会话。`POST /auth/logout` 会先删除该会话，再使浏览器 Cookie 过期，因此重放登出前保存的 Cookie 会立即收到 `401`。

## 模型体验

无，因为该网关是独立的身份平面进程，不调用模型。

#### KV Cache 影响

无；凭证和身份 Cookie 绝不进入模型提供方请求。

## 已知限制与延后工作

- 该网关提供最小 HTML 登录与注册表单，但尚未提供密码重置、MFA、电子邮件验证、速率限制或账户管理。
