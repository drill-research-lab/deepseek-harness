# Agent Note: Trusted owner principals and file-backed user homes

Status: implemented

## Problem

Authentication identifies a request but does not provide a durable persistence namespace. Resource providers need one server-trusted owner identity and one rooted filesystem mapping without accepting usernames, request payloads, or mutable identity metadata as path authority. Concurrent requests must safely open the same first home, while the file store supports only one writer process.

## Decision

`@deepseek-ai/dsh-ownership` defines `OwnerPrincipal`, `OwnershipService`, and the minimal `UserHome` rooted handle. Request principals derive only from the verified `AuthService` asynchronous scope. Background reconstruction accepts an already branded `AuthenticatedUserId` read from trusted persistence; there is no generic string-to-principal API.

`@deepseek-ai/dsh-host-ownership-file` maps the complete provider-qualified immutable user id to lowercase SHA-256 and stores schema-versioned `identity.json` metadata under the resulting directory. The hash provides deterministic filesystem-safe naming and is not an authorization check. The provider validates the stored user id before returning a home and fails closed without replacing malformed, unsupported, or mismatching metadata.

First publication writes and syncs a random sibling file, then uses an exclusive hard link to publish the completed inode without replacing a concurrent winner. A process-local single-flight converges concurrent first opens. Directories and private files are hardened to POSIX `0700` and `0600` respectively.

The product profile launcher opens `<resolved DSH_HOME>/.writer.lock` before profile initialization, delegates `flock(2)` acquisition on the inherited file description to the Linux `flock` utility, and attaches its descriptor to the root Cordis effect lifetime before config entries mount. Startup unwinding and normal root disposal release the lease; the kernel releases it on process termination. The file provider later publishes `ctx.ownership`, while mutable web providers inject that service as a separate availability requirement. Other platforms fail before profile mutation instead of claiming an equivalent writer guarantee.

The file provider rejects a home directory or identity file that is a symlink when validated. `UserHome.path()` accepts only individual relative components and rejects absolute paths, dot components, traversal, NUL, slash, and backslash. These checks do not prevent replacement after validation or other TOCTOU races. Descriptor-relative Linux operations such as `openat2` remain a possible stronger file-provider implementation.

## Alternatives considered

**Use usernames or LDAP DNs as home keys.** Both values can change while ownership remains stable. Provider-qualified immutable ids preserve ownership across rename and keep LDAP and local identities distinct.

**Use a persistent `wx` lock file.** File existence cannot distinguish a live writer from an abnormal exit without an unsafe stale-file takeover protocol. A kernel advisory lock follows the lifetime of the retained open file description.

**Treat `path.resolve()` plus a prefix check as complete filesystem confinement.** Lexical containment does not close symlink and check/open races. The rooted handle states its narrower guarantee and leaves descriptor-relative enforcement to a provider that can prove it.

**Add owner fields to existing resources in this change.** Sessions, attachments, settings, credentials, jobs, and API authorization form the next ownership migration layer. Combining them with the root identity and filesystem mechanism would prevent independent review of the foundation.

## Consequences

The web Host fails startup before shared profile mutation when another process owns the same resolved DSH home, regardless of the configured users root, and exposes one trusted path from authenticated identity to a validated UserHome. This change does not migrate existing resources, authorize cross-user APIs, isolate model execution, or qualify production multi-user deployment. Linux and trusted deployment-owned DSH and users roots are required for the stated guarantees.
