# Ownership

[English](ownership.md) | [简体中文](ownership.zh.md) | 繁體中文

Ownership 子系統把已驗證的 request identity 轉換成 Host persistence 使用的可信 principal。`AuthenticatedUserId` 是 authentication 建立、帶 provider 限定的 immutable identity，例如 `ldap:<entryUUID>` 或 `local:<uuid>`。使用者名稱、電子郵件、display name 和 LDAP DN 仍是可變的展示或查找值。

`OwnerPrincipal` 只在該 id 上增加可信來源（`request` 或 `background`）。Request principal 來自已驗證的 `AuthService` 非同步作用域。Background principal 接受先前從可信 persistence 讀取的 branded id；client payload、tool argument 和 model output 都沒有 principal conversion API。

`ctx.ownership` 把 principal 解析成 `UserHome`。File provider 對完整 id 做 SHA-256 hash，驗證 home 的 immutable `identity.json`，然後返回 rooted handle。Hash 只為目錄命名，不負責 authorization。Rooted handle 拒絕詞法上可逃離 home 的 path syntax；symlink 和 TOCTOU protection 仍由 provider 負責。

產品 profile bootstrap 在修改 shared profile 或啟動 Cordis 前取得 Linux deployment writer lease，並持有該 lease 直至 root context dispose。File provider 隨後發布 `ctx.ownership`；可變 Web provider 把該 service 作為另一項 availability requirement。Lease 以 resolved `DSH_HOME` 為鍵，因此不同 users root 無法讓兩個 writer process 共享同一本機 deployment。一個 DSH process 仍可為 concurrent users 提供 separate homes。POSIX `0700` directory 和 `0600` file 防護其他 OS user，但不能替代 DSH 內的 application authorization。

此 subsystem 只建立 ownership foundation。A1 不遷移既有 resource、不加入 owner authorization，也不改變 sandbox isolation。

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
```

Source: [`packages/identity/ownership/src/index.ts:66`](../../packages/identity/ownership/src/index.ts)
<!-- END GENERATED cordis-surface -->
