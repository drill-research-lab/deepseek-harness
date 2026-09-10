import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthService, authenticatedUserId, type AuthenticatedUser } from '@deepseek-ai/dsh-auth'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  FileOwnershipService,
  FileOwnerRootResolver,
  FileUserHomeResolver,
  resolveOwnerRoots,
  resolveUsersRoot,
  userHomeDirectoryKey,
} from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-user-home-'))
  roots.push(root)
  return root
}

function principal(value: string) {
  return { userId: authenticatedUserId(value), source: 'request' as const }
}

describe('owner identity and user-home mapping', () => {
  it('maps the complete immutable id deterministically and ignores username changes', async () => {
    const root = await temporaryRoot()
    const resolver = new FileUserHomeResolver(root)
    const userId = authenticatedUserId('ldap:stable-entry-uuid')
    expect(userHomeDirectoryKey(userId)).toMatch(/^[0-9a-f]{64}$/)
    expect(userHomeDirectoryKey(userId)).toBe(userHomeDirectoryKey(userId))
    expect(userHomeDirectoryKey(userId)).not.toBe(userHomeDirectoryKey(authenticatedUserId('local:stable-entry-uuid')))
    const beforeRename = await resolver.resolve({ userId, source: 'request' })
    const afterRename = await resolver.resolve({ userId, source: 'request' })
    expect(afterRename.path('identity.json')).toBe(beforeRename.path('identity.json'))
  })

  it('creates one private minimal identity and does not overwrite it', async () => {
    const root = await temporaryRoot()
    const resolver = new FileUserHomeResolver(root)
    const owner = principal('ldap:alice')
    const [first, concurrent] = await Promise.all([resolver.resolve(owner), resolver.resolve(owner)])
    const path = first.path('identity.json')
    expect(concurrent.path('identity.json')).toBe(path)
    const original = await readFile(path, 'utf8')
    const repeated = await resolver.resolve(owner)
    expect(await readFile(repeated.path('identity.json'), 'utf8')).toBe(original)
    const storedIdentity: unknown = JSON.parse(original)
    expect(storedIdentity).not.toBeNull()
    expect(typeof storedIdentity).toBe('object')
    const identity = storedIdentity as Record<string, unknown>
    expect(Object.keys(identity).sort()).toEqual(['createdAt', 'schemaVersion', 'updatedAt', 'userId'])
    expect(identity.schemaVersion).toBe(1)
    expect(identity.userId).toBe('ldap:alice')
    expect(typeof identity.createdAt).toBe('string')
    expect(typeof identity.updatedAt).toBe('string')
    expect((await stat(join(root, userHomeDirectoryKey(owner.userId)))).mode & 0o777).toBe(0o700)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('fails closed for mismatched, malformed, and unsupported identity metadata', async () => {
    const cases = [
      JSON.stringify({ schemaVersion: 1, userId: 'ldap:bob', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
      '{',
      'null',
      JSON.stringify({ schemaVersion: 2, userId: 'ldap:alice', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
    ]
    for (const source of cases) {
      const root = await temporaryRoot()
      const owner = principal('ldap:alice')
      const home = join(root, userHomeDirectoryKey(owner.userId))
      await mkdir(home, { recursive: true })
      await writeFile(join(home, 'identity.json'), source)
      await expect(new FileUserHomeResolver(root).resolve(owner)).rejects.toThrow(/identity/)
    }
  })

  it('ignores incomplete temporary publication and safely creates the final identity', async () => {
    const root = await temporaryRoot()
    const owner = principal('local:alice')
    const home = join(root, userHomeDirectoryKey(owner.userId))
    await mkdir(home, { recursive: true })
    await writeFile(join(home, 'identity.json.deadbeef.tmp'), '{')
    const resolved = await new FileUserHomeResolver(root).resolve(owner)
    const storedIdentity: unknown = JSON.parse(await readFile(resolved.path('identity.json'), 'utf8'))
    expect(storedIdentity).toMatchObject({ userId: 'local:alice' })
  })

  it('converges independent resolver instances through exclusive publication', async () => {
    const root = await temporaryRoot()
    const owner = principal('ldap:alice')
    const [first, second] = await Promise.all([
      new FileUserHomeResolver(root).resolve(owner),
      new FileUserHomeResolver(root).resolve(owner),
    ])
    expect(second.path('identity.json')).toBe(first.path('identity.json'))
  })

  it('rejects an identity symlink without changing its target', async () => {
    const root = await temporaryRoot()
    const owner = principal('ldap:alice')
    const home = join(root, userHomeDirectoryKey(owner.userId))
    const target = join(root, 'outside.json')
    const source = JSON.stringify({
      schemaVersion: 1,
      userId: owner.userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await mkdir(home, { recursive: true })
    await writeFile(target, source, { mode: 0o644 })
    await symlink(target, join(home, 'identity.json'))
    await expect(new FileUserHomeResolver(root).resolve(owner)).rejects.toThrow(/regular identity file/)
    expect((await stat(target)).mode & 0o777).toBe(0o644)
  })

  it('rejects link-shaped home paths and non-file identity paths', async () => {
    const root = await temporaryRoot()
    const owner = principal('ldap:alice')
    const home = join(root, userHomeDirectoryKey(owner.userId))
    const outside = await temporaryRoot()
    await symlink(outside, home)
    await expect(new FileUserHomeResolver(root).resolve(owner)).rejects.toThrow(/real directory/)
    await rm(home)
    await mkdir(join(home, 'identity.json'), { recursive: true })
    await expect(new FileUserHomeResolver(root).resolve(owner)).rejects.toThrow()
  })

  it('rejects absolute, traversal, NUL, and platform-separator path components', async () => {
    const home = await new FileUserHomeResolver(await temporaryRoot()).resolve(principal('ldap:alice'))
    for (const value of ['/etc', '..', '.', 'a/b', 'a\\b', 'a\0b', '']) {
      expect(() => home.path(value)).toThrow(TypeError)
    }
    expect(home.path('sessions', 'one.json')).toContain('sessions')
  })

  it('resolves only the configured users root and rejects blank overrides', () => {
    expect(resolveUsersRoot('/srv/dsh-users')).toBe('/srv/dsh-users')
    expect(resolveUsersRoot('')).toBe(join(resolveDshHome(), 'users'))
    expect(resolveUsersRoot(' ')).toBe(join(resolveDshHome(), 'users'))
  })
})

describe('owner-root resolver', () => {
  it('creates, hardens, and canonicalizes one private per-owner root', async () => {
    const root = await temporaryRoot()
    const resolver = new FileOwnerRootResolver(root)
    const owner = principal('ldap:alice')
    const [first, concurrent] = await Promise.all([resolver.resolve(owner), resolver.resolve(owner)])
    const key = userHomeDirectoryKey(owner.userId)
    expect(first.path).toBe(concurrent.path)
    expect(first.path).toBe(await realpath(join(root, key)))
    expect((await stat(first.path)).mode & 0o777).toBe(0o700)
    // Distinct from the user home: no identity.json is published here.
    await expect(readFile(join(first.path, 'identity.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('resolves only the configured owner-roots root and rejects blank overrides', () => {
    expect(resolveOwnerRoots('/srv/dsh-owner-roots')).toBe('/srv/dsh-owner-roots')
    expect(resolveOwnerRoots('')).toBe(join(resolveDshHome(), 'owner-roots'))
    expect(resolveOwnerRoots(' ')).toBe(join(resolveDshHome(), 'owner-roots'))
  })
})

class TestAuthService extends AuthService {
  authenticateRequest(): Promise<AuthenticatedUser | undefined> { return Promise.resolve(undefined) }
}

describe.runIf(process.platform === 'linux')('ownership service trust source', () => {
  it('derives request principals only from AuthService scope and exposes a branded background seam', async () => {
    const root = await temporaryRoot()
    const ctx = new Context()
    const authFiber = ctx.plugin(TestAuthService)
    await authFiber.await()
    const ownershipFiber = ctx.plugin(FileOwnershipService, { usersRoot: root })
    await ownershipFiber.await()
    expect(() => ctx.ownership.currentPrincipal()).toThrow(/authenticated request/)
    const first: AuthenticatedUser = { userId: authenticatedUserId('ldap:stable'), username: 'alice', isAdmin: false }
    const renamed: AuthenticatedUser = { ...first, username: 'alice-renamed' }
    expect(ctx.auth.runAs(first, () => ctx.ownership.currentPrincipal())).toEqual({
      userId: first.userId, source: 'request',
    })
    expect(ctx.auth.runAs(renamed, () => ctx.ownership.currentPrincipal()).userId).toBe(first.userId)
    expect(ctx.ownership.backgroundPrincipal(first.userId)).toEqual({ userId: first.userId, source: 'background' })
    expect(Object.keys(ctx.ownership.backgroundPrincipal(first.userId)).sort()).toEqual(['source', 'userId'])
    await expect(ctx.auth.runAs(first, () => ctx.ownership.resolveUserHome(ctx.ownership.currentPrincipal())))
      .resolves.toMatchObject({ owner: { userId: first.userId, source: 'request' } })
    await expect(ctx.auth.runAs(first, () => ctx.ownership.resolveOwnerRoot(ctx.ownership.currentPrincipal())))
      .resolves.toMatchObject({ owner: { userId: first.userId, source: 'request' } })
    await ownershipFiber.dispose()
    await authFiber.dispose()
  })
})
