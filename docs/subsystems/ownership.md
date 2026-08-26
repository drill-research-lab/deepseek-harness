# Ownership

English | [简体中文](ownership.zh.md) | [繁體中文](ownership.zh-tw.md)

The ownership subsystem converts verified request identity into the trusted principal used by Host persistence. `AuthenticatedUserId` is the provider-qualified immutable identity established by authentication, such as `ldap:<entryUUID>` or `local:<uuid>`. Usernames, email addresses, display names, and LDAP DNs remain mutable presentation or lookup values.

`OwnerPrincipal` adds only the trusted source (`request` or `background`) to that id. Request principals come from the verified `AuthService` asynchronous scope. Background principals accept a branded id previously read from trusted persistence; client payloads, tool arguments, and model output have no principal conversion API.

`ctx.ownership` resolves a principal to a `UserHome`. The file provider hashes the complete id with SHA-256, validates the home's immutable `identity.json`, and returns a rooted handle. The hash names a directory and does not authorize access. The rooted handle rejects path syntax that can lexically escape the home, while symlink and TOCTOU protection remain provider responsibilities.

The product profile bootstrap acquires the Linux deployment writer lease before shared profile mutation or Cordis startup and holds it through root-context disposal. The file provider publishes `ctx.ownership` later; mutable web providers depend on that service as a separate availability requirement. The lease is keyed by resolved `DSH_HOME`, so different users roots cannot let two writer processes share one local deployment. One DSH process may still serve concurrent users with separate homes. POSIX `0700` directories and `0600` files protect against other OS users but do not replace application authorization within DSH.

This subsystem establishes the ownership foundation only. Existing resources are not migrated or owner-authorized by A1, and sandbox isolation is unchanged.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxownership--ownershipservice-abstract-seam"></a>

### `ctx.ownership` — `OwnershipService` (abstract seam)

Trusted principal and per-owner home resolver.

```ts cordis-catalog
/**
 * Read the principal for the verified authenticated request scope.
 * @returns The current request principal.
 * @throws when called outside an authenticated request scope.
 */
abstract currentPrincipal(): OwnerPrincipal

/**
 * Read the verified request principal when execution is inside an authenticated scope.
 * @returns The current request principal, or `undefined` outside a request.
 */
abstract currentPrincipalOrUndefined(): OwnerPrincipal | undefined

/**
 * Rehydrate a principal from a durable, server-trusted owner id.
 * @param userId - Branded owner id previously read from trusted persistence.
 * @returns A background principal.
 */
abstract backgroundPrincipal(userId: AuthenticatedUserId): OwnerPrincipal

/**
 * Open or create the filesystem namespace for a trusted principal.
 * @param principal - Server-trusted owner identity.
 * @returns A validated owner-scoped home.
 */
abstract resolveUserHome(principal: OwnerPrincipal): Promise<UserHome>

/**
 * Resolve the canonical containment root for a trusted principal. Chosen
 * workspace and session paths must stay beneath this root.
 * @param principal - Server-trusted owner identity.
 * @returns The canonical owner root.
 */
abstract resolveOwnerRoot(principal: OwnerPrincipal): Promise<OwnerRoot>
```

Source: [`packages/identity/ownership/src/index.ts:81`](../../packages/identity/ownership/src/index.ts)
<!-- END GENERATED cordis-surface -->
