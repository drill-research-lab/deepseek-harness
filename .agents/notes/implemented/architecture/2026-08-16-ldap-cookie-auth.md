# Agent Note: External LDAP gateway and verified identity cookies

Status: implemented

## Problem

The web transport's browser trust check prevents DNS rebinding and cross-site requests but does not identify a user. Multi-user isolation requires a stable authenticated identity, while DSH must never receive a login password, registration password, LDAP bind credential, or password-reset material.

## Decision

- `AuthenticatedUser` and request-scoped `AuthService` are the only identity concepts in DSH. The service verifies an external assertion and cannot authenticate credentials or issue sessions.
- A separately deployed authentication gateway owns `/auth/login`, `/auth/register`, `/auth/me`, `/auth/logout`, LDAP binds, the DSH-local account store, and the Ed25519 private signing key. LDAP remains the default login provider. Browser forms use a double-submit CSRF token because a strict referrer policy may produce an opaque `Origin` on form submission.
- DSH holds only the Ed25519 public key and accepts a short-lived identity cookie after verifying its signature, issuer, audience, issued-at time, expiry, and live file-session record. The gateway defaults the lifetime to five minutes and permits deployments to select 60 through 3600 seconds. Logout deletes that record before expiring the browser cookie, making saved-cookie replay fail immediately.
- The gateway and DSH use separate credential homes. The gateway owns mode-`0600` session records under a mode-`0700` directory; only the Host authentication boundary needs access to them. A strict deployment keeps the gateway's LDAP, signing, and local-account material inaccessible to downstream DSH.
- LDAP identities use `ldap:<immutable directory id>` as their stable DSH user id. Usernames remain display values and may change without moving user-owned resources.
- Optional registration is explicit and disabled by default. It creates a DSH-local `local:<uuid>` identity in the gateway's owner-only file store; it never provisions or modifies LDAP.
- LDAPS is mandatory. The client retains certificate verification, operation timeouts, and compact standard ECDHE key shares for the observed WireGuard MTU path.
- After HTTP or WebSocket authentication, Connection removes browser cookies from both normalized and raw request headers before dispatch. Downstream code receives the verified user only through `AuthService` request scope.

## Alternatives considered

**Direct LDAP bind inside DSH.** This reduces deployment components, but DSH receives every submitted password and holds the LDAP service credential, violating the process boundary.

**Provision local registrations into LDAP.** This would make registration depend on directory schema and grant the gateway's bind account write access. DSH-specific accounts instead stay in a separate file-backed store and LDAP remains read-only from the gateway's perspective.

**Shared HMAC session secret.** The gateway and DSH could share one symmetric key, but compromising DSH would then permit session forgery. Ed25519 lets DSH verify assertions with a public key that cannot sign them.

**Online gateway introspection.** It provides centralized revocation but makes every DSH request depend on another HTTP service. This single-host phase instead combines signed assertions with one-file-per-session presence checks; a future multi-gateway deployment can replace that store behind the same authentication boundary.

## Consequences

The shipped DSH web bundle has no login or registration route and loads neither an LDAP client nor the local account store. The browser uses minimal forms served by the gateway, receives a host-only cookie, and is redirected to DSH. The Host authentication layer consumes that cookie; HTTP, dedicated RPC, and WebSocket entry points reject missing or invalid assertions, strip cookie headers after acceptance, and dispatch only inside the verified user's request scope.

Logout revocation is immediate for requests that begin after the logout response: deleting the session makes both `/auth/me` and DSH Host verification reject a saved cookie. Requests authenticated before deletion cannot be retroactively cancelled. Per-user filesystem roots, shell isolation, session ownership, and storage partitioning remain separate work.
