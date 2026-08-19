# @deepseek-ai/dsh-host-ownership-file

[English](README.md) | 简体中文 | [繁體中文](README.zh-tw.md)

为 Web Host 提供 `ctx.ownership`。它只从 `ctx.auth.currentUser()` 派生 request principal，把完整且带 provider 限定的 immutable user id 映射成小写 SHA-256 目录键，并打开只包含 `identity.json` 的最小 owner home。用户名、电子邮件、display name 和 LDAP DN 不影响映射。

通过 `usersRoot` 或 `DSH_USERS_HOME` 设置 deployment-owned persistence root。两者都未设置时，提供方使用 `$DSH_HOME/users` 或 `~/.dsh/users`；生产部署应设置 `DSH_USERS_HOME=/var/lib/dsh/users`。提供方以 `0700` mode 创建目录，以 `0600` mode 创建私有文件。这些 mode 限制其他 OS 用户，但不会在同一个 DSH 进程内授权 request。

产品 profile bootstrap 拥有 Linux deployment writer lease，并在初始化 profile 或激活此 provider 前取得该 lease。`DSH_USERS_HOME` 仍可独立配置，但不能绕过以 resolved `DSH_HOME` 为键的 lease。可变 Web provider 把 `ctx.ownership` 作为另一项 service availability 要求，且 bootstrap 已在此前建立 process exclusion。

每个 home 保存 schema version `1`、immutable `userId` 及建立/更新时间。首次建立时先写入并同步随机 sibling，再以 exclusive hard link 发布。既有 identity metadata 若 malformed、unsupported 或不匹配就 fail closed，且绝不替换。Directory hashing 只提供 filesystem-safe naming，不负责 authorization。

Provider 会拒绝验证时已经是 symlink 的 UserHome directory 或 identity file。Rooted path 会拒绝 traversal syntax，但不提供 descriptor-relative protection 来防止检查后的替换。未来提供方可以使用 Linux `openat2` 配合 `RESOLVE_BENEATH`、`RESOLVE_NO_MAGICLINKS` 和 `RESOLVE_NO_SYMLINKS`；A1 不宣称这些保证。

## Model Experience

无，因为 owner resolution 不增加 model-visible content。

#### KV Cache effect

无；owner metadata 不会进入 provider request。

## Known Limitations and Deferred Work

- PR A1 只建立 ownership foundation；既有 session、settings、attachment、credential、job 和其他资源尚未存入 UserHome，也尚未依 owner authorization。
- Bootstrap 层的 Linux `flock` 对一个本地 DSH deployment 强制单 writer，不提供 distributed 或 multi-host coordination。
- Lexical rooted path 无法排除另一个可写 users root 的 actor 所发动的 symlink 与 TOCTOU attack。
