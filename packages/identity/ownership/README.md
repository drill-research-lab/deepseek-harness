# @deepseek-ai/dsh-ownership

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Defines the trusted ownership types shared by Host persistence: `OwnerPrincipal`, `OwnershipService`, `UserHome`, and `UserHomePath`. Request principals come from the verified `AuthService` asynchronous scope; background principals accept only an already branded `AuthenticatedUserId` read from trusted persistence. Neither principal carries usernames, cookies, passwords, or gateway credentials.

`UserHome.path()` accepts individual relative components and rejects empty, absolute, dot, traversal, NUL, slash, and backslash values. This lexical validation prevents caller-controlled path syntax from escaping the configured root. It does not prevent symlink replacement or TOCTOU races; file providers must state and enforce their stronger operation-level guarantees.

## Model Experience

None, as ownership identities and Host paths never enter model input.

#### KV Cache effect

None; this package does not assemble provider requests.

## Known Limitations and Deferred Work

- PR A1 establishes the ownership foundation only; resource migration, cross-user API authorization, production multi-user isolation, and sandbox isolation remain deferred.
