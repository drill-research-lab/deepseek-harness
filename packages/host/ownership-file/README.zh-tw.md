# @deepseek-ai/dsh-host-ownership-file

[English](README.md) | [简体中文](README.zh.md) | 繁體中文

為 Web Host 提供 `ctx.ownership`。它只從 `ctx.auth.currentUser()` 衍生 request principal，把完整且帶 provider 限定的 immutable user id 對映成小寫 SHA-256 目錄鍵，並開啟只包含 `identity.json` 的最小 owner home。使用者名稱、電子郵件、display name 和 LDAP DN 不影響對映。

透過 `usersRoot` 或 `DSH_USERS_HOME` 設定 deployment-owned persistence root。兩者都未設定時，提供方使用 `$DSH_HOME/users` 或 `~/.dsh/users`；生產部署應設定 `DSH_USERS_HOME=/var/lib/dsh/users`。提供方以 `0700` mode 建立目錄，以 `0600` mode 建立私有檔案。這些 mode 限制其他 OS 使用者，但不會在同一個 DSH 行程內授權 request。

產品 profile bootstrap 擁有 Linux deployment writer lease，並在初始化 profile 或啟用此 provider 前取得該 lease。`DSH_USERS_HOME` 仍可獨立設定，但不能繞過以 resolved `DSH_HOME` 為鍵的 lease。可變 Web provider 把 `ctx.ownership` 作為另一項 service availability 要求，且 bootstrap 已在此前建立 process exclusion。

每個 home 儲存 schema version `1`、immutable `userId` 及建立/更新時間。首次建立時先寫入並同步隨機 sibling，再以 exclusive hard link 發佈。既有 identity metadata 若 malformed、unsupported 或不符合就 fail closed，且絕不替換。Directory hashing 只提供 filesystem-safe naming，不負責 authorization。

Provider 會拒絕驗證時已經是 symlink 的 UserHome directory 或 identity file。Rooted path 會拒絕 traversal syntax，但不提供 descriptor-relative protection 來防止檢查後的替換。未來提供方可以使用 Linux `openat2` 配合 `RESOLVE_BENEATH`、`RESOLVE_NO_MAGICLINKS` 和 `RESOLVE_NO_SYMLINKS`；A1 不宣稱這些保證。

## Model Experience

無，因為 owner resolution 不增加 model-visible content。

#### KV Cache effect

無；owner metadata 不會進入 provider request。

## Known Limitations and Deferred Work

- PR A1 只建立 ownership foundation；既有 session、settings、attachment、credential、job 和其他資源尚未存入 UserHome，也尚未依 owner authorization。
- Bootstrap 層的 Linux `flock` 對一個本機 DSH deployment 強制單 writer，不提供 distributed 或 multi-host coordination。
- Lexical rooted path 無法排除另一個可寫 users root 的 actor 所發動的 symlink 與 TOCTOU attack。
