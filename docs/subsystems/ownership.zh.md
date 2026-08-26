# Ownership

[English](ownership.md) | 简体中文 | [繁體中文](ownership.zh-tw.md)

Ownership 子系统把已验证的 request identity 转换成 Host persistence 使用的可信 principal。`AuthenticatedUserId` 是 authentication 建立、带 provider 限定的 immutable identity，例如 `ldap:<entryUUID>` 或 `local:<uuid>`。用户名、电子邮件、display name 和 LDAP DN 仍是可变的展示或查找值。

`OwnerPrincipal` 只在该 id 上增加可信来源（`request` 或 `background`）。Request principal 来自已验证的 `AuthService` 异步作用域。Background principal 接受先前从可信 persistence 读取的 branded id；client payload、tool argument 和 model output 都没有 principal conversion API。

`ctx.ownership` 把 principal 解析成 `UserHome`。File provider 对完整 id 做 SHA-256 hash，验证 home 的 immutable `identity.json`，然后返回 rooted handle。Hash 只为目录命名，不负责 authorization。Rooted handle 拒绝词法上可逃离 home 的 path syntax；symlink 和 TOCTOU protection 仍由 provider 负责。

产品 profile bootstrap 在修改 shared profile 或启动 Cordis 前取得 Linux deployment writer lease，并持有该 lease 直至 root context dispose。File provider 随后发布 `ctx.ownership`；可变 Web provider 把该 service 作为另一项 availability requirement。Lease 以 resolved `DSH_HOME` 为键，因此不同 users root 无法让两个 writer process 共享同一本地 deployment。一个 DSH process 仍可为 concurrent users 提供 separate homes。POSIX `0700` directory 和 `0600` file 防护其他 OS user，但不能替代 DSH 内的 application authorization。

此 subsystem 只建立 ownership foundation。A1 不迁移既有 resource、不加入 owner authorization，也不改变 sandbox isolation。

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
