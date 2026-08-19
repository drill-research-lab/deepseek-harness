# @deepseek-ai/dsh-ownership

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

定义 Host 持久化共享的可信 ownership 类型：`OwnerPrincipal`、`OwnershipService`、`UserHome` 和 `UserHomePath`。Request principal 来自已经验证的 `AuthService` 异步作用域；background principal 只接受从可信持久化中读取、已经 branded 的 `AuthenticatedUserId`。两种 principal 都不携带用户名、cookie、密码或网关凭据。

`UserHome.path()` 接受逐个提供的相对路径组件，并拒绝空值、绝对路径、点、遍历、NUL、斜线和反斜线。此词法验证防止调用方控制的路径语法逃离配置的根目录，但不防止符号链接替换或 TOCTOU 竞态；文件提供方必须说明并执行更强的操作级保证。

## Model Experience

无，因为 ownership identity 和 Host 路径不会进入模型输入。

#### KV Cache effect

无；此包不组装提供方请求。

## Known Limitations and Deferred Work

- PR A1 只建立 ownership foundation；资源迁移、跨用户 API authorization、生产 multi-user isolation 和 sandbox isolation 仍属后续工作。
