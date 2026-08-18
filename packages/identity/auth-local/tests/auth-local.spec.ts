import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import LocalAccountStore, { LocalAccountConflictError } from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function mounted() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-auth-local-'))
  roots.push(root)
  const filename = join(root, 'accounts.json')
  const ctx = new Context()
  const fiber = ctx.plugin(LocalAccountStore, { path: filename })
  await fiber.await()
  return { store: ctx.localAccounts, filename, dispose: () => fiber.dispose() }
}

describe('gateway-local DSH accounts', () => {
  it('creates a local account without persisting its plaintext password and authenticates it', async () => {
    const app = await mounted()
    const registration = {
      username: 'alice', password: 'long-enough-password', displayName: 'Alice Lin', email: 'alice@example.com',
    }
    const created = await app.store.create(registration)
    expect(created.username).toBe('alice')
    expect(created.userId).toMatch(/^local:/)
    const stored = await readFile(app.filename, 'utf8')
    expect(stored).not.toContain(registration.password)
    expect((await stat(app.filename)).mode & 0o777).toBe(0o600)
    await expect(app.store.authenticate('ALICE', registration.password)).resolves.toEqual(created)
    await expect(app.store.authenticate('alice', 'wrong-password')).resolves.toBeUndefined()
    await app.dispose()
  })

  it('rejects a duplicate local username or email', async () => {
    const app = await mounted()
    await app.store.create({
      username: 'alice', password: 'long-enough-password', displayName: 'Alice', email: 'alice@example.com',
    })
    await expect(app.store.create({
      username: 'ALICE', password: 'another-long-password', displayName: 'Other', email: 'other@example.com',
    })).rejects.toBeInstanceOf(LocalAccountConflictError)
    await app.dispose()
  })
})
