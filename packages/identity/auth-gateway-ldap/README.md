# @deepseek-ai/dsh-auth-gateway-ldap

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Registers LDAP and DSH-local login routes for an authentication gateway deployed as a process separate from DSH. LDAP is the default provider. Optional registration creates an account only in the gateway's file-backed `ctx.localAccounts` store; it never creates an LDAP account. The gateway alone receives credentials, signs short-lived Ed25519 identity cookies, and creates one revocable file session per login. The DSH Host authentication boundary validates and removes the cookie before downstream DSH work, which receives only `AuthenticatedUser`.

The gateway requires `AUTH_COOKIE_PRIVATE_KEY`, `AUTH_COOKIE_ISSUER`, and `AUTH_COOKIE_AUDIENCE` through `ctx.credentials`. Its web server must use a hostname shared with the DSH browser origin because host-only cookies apply across ports, and production deployments must enable `cookieSecure` behind HTTPS.

Never mount this package in the DSH process or expose the DSH listen port outside the trusted host. Use a separate Cordis composition and web-server instance for the gateway.

Run `dsh-auth-ldap-gateway` with a required `DSH_AUTH_HOME` that differs from `DSH_HOME`. Its owner-only `.credentials.yaml` contains the LDAP bind password and `AUTH_COOKIE_PRIVATE_KEY`, while `accounts.json` contains scrypt-derived local password hashes. The `sessions/` directory has mode `0700`; each login creates a mode-`0600` record named by a hash of its random session id. Set `DSH_AUTH_SESSION_DIRECTORY` on DSH to this directory. DSH's credential store contains only `AUTH_COOKIE_PUBLIC_KEY` plus the matching issuer and audience. A strict deployment grants only the Host authentication boundary read access to sessions while keeping gateway credentials and local accounts inaccessible to downstream DSH.

The executable listens on loopback port `3081`. Set `DSH_AUTH_PUBLIC=true` to bind all interfaces, `DSH_AUTH_PORT` to select another port, `DSH_LOCAL_REGISTRATION_ENABLED=true` to permit local account creation, `DSH_APP_URL` to the DSH browser URL used after success, and `AUTH_COOKIE_SECURE=false` only for a trusted HTTP development path. `AUTH_COOKIE_EXPIRE_SECONDS` controls the identity cookie and revocable session lifetime from 60 to 3600 seconds; it defaults to 300. `GET /auth/login` presents LDAP and local-account forms, while `GET /auth/register` presents local registration when enabled. Each form carries a token matched against an HttpOnly, SameSite=Strict gateway cookie, so browsers whose form POST uses an opaque `Origin` remain protected against cross-site submission. Successful posts set the identity cookie and redirect to the same hostname on DSH's configured port.

JSON clients use the same credential routes: `/auth/login` accepts `{ provider?, username, password }`, where the omitted provider means `ldap`, and `/auth/register` creates a DSH-local account from `{ username, password, displayName, email }`. `GET /auth/me` verifies both the signed identity cookie and its live file session. `POST /auth/logout` deletes that session before expiring the browser cookie, so replaying a saved pre-logout cookie receives `401` immediately.

## Model Experience

None, as the gateway is a separate identity-plane process and does not call a model.

#### KV Cache effect

None; credentials and identity cookies never enter provider requests.

## Known Limitations and Deferred Work

- The gateway provides minimal HTML login and registration forms, but does not yet provide password reset, MFA, email verification, rate limiting, or account administration.
