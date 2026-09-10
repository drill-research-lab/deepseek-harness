# @deepseek-ai/dsh-host-authentication

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Provides `ctx.auth` by verifying a short-lived Ed25519 identity cookie issued by a separately deployed authentication gateway and requiring its file session to remain live. The verifier accepts only the configured issuer and audience, exposes the verified `{ userId, username, isAdmin }` through request-local storage (`isAdmin` is the login-time admin-group snapshot, taken from the revocable file session rather than trusted from the cookie alone; a token that omits it is read as non-admin), and never registers login, registration, session-issuance, or credential-input routes.

The default credential references are `AUTH_COOKIE_PUBLIC_KEY`, `AUTH_COOKIE_ISSUER`, and `AUTH_COOKIE_AUDIENCE`; `cookieName` defaults to `dsh_identity`. Set `sessionDirectory` (the bundle reads `DSH_AUTH_SESSION_DIRECTORY`) to the gateway's owner-controlled session directory. Store the PEM public key in DSH's credential store. The matching private key belongs only to the authentication gateway and must never exist in the DSH process, configuration, or filesystem.

The HTTP and WebSocket transport calls `authenticateRequest()` before dispatch and runs accepted work through `runAs()`. Invalid, expired, incorrectly targeted, or tampered cookies produce no identity.

## Model Experience

None, as authentication controls whether a browser request may reach the existing API but adds no model-visible content.

#### KV Cache effect

None; identity assertions do not enter model requests.

## Known Limitations and Deferred Work

- Authorization roles are deferred until a consumer requires them.
