# @deepseek-ai/dsh-auth-local

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Provides `ctx.localAccounts`, an owner-only JSON account store for users registered specifically with the DSH authentication gateway. Passwords are derived with scrypt and a random per-account salt; the file contains only the derived hash and account profile. DSH does not load this package or read its file.

The required `path` belongs under the gateway's separate `DSH_AUTH_HOME`. Creation serializes cross-process writers, atomically replaces the complete versioned document with mode `0600`, rejects duplicate case-insensitive usernames or email addresses, and returns a `local:<uuid>` identity. Authentication reads and validates the complete document before comparing a fresh derivation with constant-time equality.

## Model Experience

None, as the store runs in the separate authentication gateway and does not call a model.

#### KV Cache effect

None; account fields and password hashes never enter provider requests.

## Known Limitations and Deferred Work

- Password reset, email verification, MFA, administrative account management, and horizontal database replication are not implemented.
