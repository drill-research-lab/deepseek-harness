# @deepseek-ai/dsh-auth

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Cordis contracts for a verified external identity and request-scoped authentication. DSH receives only an authenticated user assertion; credential collection, account creation, and session issuance belong to a separately deployed authentication service.

## Model Experience

None, as consumers use the request identity for access control without adding it to model input.

#### KV Cache effect

None; this package does not assemble provider requests.

## Known Limitations and Deferred Work

- Authorization roles and account-linking metadata are not part of `AuthenticatedUser` yet.
