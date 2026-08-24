# @deepseek-ai/dsh-auth-dev

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

**Local development only — never mount in a production composition.**

A dev-only `ctx.auth` provider (`AuthService`). `authenticateRequest` trusts every request as one fixed local user (`local:dev`, username `local`, or the configured `username`), so a developer can exercise the Web UI without running the external identity-cookie gateway that `@deepseek-ai/dsh-host-authentication` verifies.

## Model Experience

None. The provider issues no model input.

#### KV Cache effect

None; it assembles no provider request.

## Known Limitations and Deferred Work

- It grants unauthenticated access to anyone who can reach the server; bind to loopback only.
- It does not model per-user isolation, ownership, or revocation — those are the production auth's job.
