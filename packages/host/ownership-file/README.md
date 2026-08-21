# @deepseek-ai/dsh-host-ownership-file

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Provides `ctx.ownership` for the web Host. It derives request principals only from `ctx.auth.currentUser()`, maps the complete provider-qualified immutable user id to a lowercase SHA-256 directory key, and opens a minimal owner home containing `identity.json`. Usernames, email addresses, display names, and LDAP DNs do not affect the mapping.

Set `usersRoot` to the deployment-owned persistence root. When it is omitted or blank, the provider uses `$DSH_HOME/users` or `~/.dsh/users`. The Web bundle maps `DSH_USERS_HOME` into `usersRoot`; the provider does not read that environment variable itself. Production Web deployments should set `DSH_USERS_HOME=/var/lib/dsh/users`. The provider creates directories with mode `0700` and private files with mode `0600`. These modes limit other OS users but do not authorize requests inside one DSH process.

The product profile bootstrap owns the Linux deployment writer lease and acquires it before profile initialization or this provider's activation. The Web bundle's `DSH_USERS_HOME` mapping remains independently configurable but cannot bypass the lease keyed by resolved `DSH_HOME`. Mutable web providers depend on `ctx.ownership` as a separate service-availability requirement after bootstrap has established process exclusion.

Each home stores schema version `1`, its immutable `userId`, and creation/update timestamps. First creation writes and syncs a random sibling, then publishes it with an exclusive hard link. Existing malformed, unsupported, or mismatching identity metadata fails closed and is never replaced. Directory hashing is only filesystem-safe naming, not authorization.

The provider rejects a user-home directory or identity file that is already a symlink when validated. Rooted paths reject traversal syntax but do not provide descriptor-relative protection against replacement after that check. A future provider may use Linux `openat2` with `RESOLVE_BENEATH`, `RESOLVE_NO_MAGICLINKS`, and `RESOLVE_NO_SYMLINKS`; A1 does not claim those guarantees.

## Model Experience

None, as owner resolution adds no model-visible content.

#### KV Cache effect

None; owner metadata does not enter provider requests.

## Known Limitations and Deferred Work

- PR A1 establishes the ownership foundation only; existing sessions, settings, attachments, credentials, jobs, and other resources are not yet stored under UserHome or authorized by owner.
- The bootstrap layer's Linux `flock` enforces one writer for one local DSH deployment, not distributed or multi-host coordination.
- Lexical rooted paths do not eliminate symlink and TOCTOU attacks by another actor with write access to the users root.
