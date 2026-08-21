# identity/ — shared identity

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Identity contracts and values shared across product domains.

| Package | Role | ctx key |
|---|---|---|
| [`anonymous-user-id/`](anonymous-user-id/README.md) | Persists one anonymous Harness-home correlation id for telemetry, feedback, and DeepSeek requests | — |
| [`auth/`](auth/README.md) | Verified-user and request-scope contracts | `ctx.auth` |
| [`ownership/`](ownership/README.md) | Trusted owner principals and rooted user-home contract | `ctx.ownership` |
| [`auth-ldap/`](auth-ldap/README.md) | LDAP authentication for an external gateway | `ctx.ldapDirectory` |
| [`auth-local/`](auth-local/README.md) | File-backed DSH-local accounts owned by the external gateway | `ctx.localAccounts` |
| [`auth-gateway-ldap/`](auth-gateway-ldap/README.md) | LDAP/local credential routes and identity-cookie signing for the external gateway | `ctx.ldapAuthGateway` |
