import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { authenticatedUserId } from '../src/index.ts'
import { FileSessionStore } from '../src/file-session-store.ts'

const roots: string[] = []
const expiresAt = Math.floor(Date.now() / 1000) + 300

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function store(): Promise<FileSessionStore> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-file-session-'))
  roots.push(root)
  return new FileSessionStore(join(root, 'sessions'))
}

/** Read the single JSON record a create() call wrote. */
async function onlyRecord(sessions: FileSessionStore): Promise<Record<string, unknown>> {
  const files = (await readdir(sessions.directory)).filter(name => name.endsWith('.json'))
  expect(files).toHaveLength(1)
  return JSON.parse(await readFile(join(sessions.directory, files[0]!), 'utf8')) as Record<string, unknown>
}

/** Write a hand-crafted record for a fixed 43-char token and return that token. */
async function seedRecord(sessions: FileSessionStore, token: string, record: Record<string, unknown>): Promise<string> {
  await mkdir(sessions.directory, { recursive: true, mode: 0o700 })
  const name = `${createHash('sha256').update(token).digest('hex')}.json`
  await writeFile(join(sessions.directory, name), `${JSON.stringify(record)}\n`, 'utf8')
  return token
}

describe('FileSessionStore isAdmin', () => {
  it('writes isAdmin into the record and returns it from find()', async () => {
    const sessions = await store()
    const token = await sessions.create(
      { userId: authenticatedUserId('ldap:admin-uuid'), username: 'admin', isAdmin: true },
      expiresAt,
    )
    expect(await onlyRecord(sessions)).toMatchObject({ userId: 'ldap:admin-uuid', username: 'admin', isAdmin: true })
    await expect(sessions.find(token)).resolves.toEqual({
      userId: 'ldap:admin-uuid', username: 'admin', isAdmin: true,
    })
  })

  it('persists isAdmin: false for a non-admin user', async () => {
    const sessions = await store()
    const token = await sessions.create(
      { userId: authenticatedUserId('ldap:plain-uuid'), username: 'plain', isAdmin: false },
      expiresAt,
    )
    expect(await onlyRecord(sessions)).toMatchObject({ isAdmin: false })
    await expect(sessions.find(token)).resolves.toEqual({
      userId: 'ldap:plain-uuid', username: 'plain', isAdmin: false,
    })
  })

  it('reads a legacy record that omits isAdmin as isAdmin: false without throwing', async () => {
    const sessions = await store()
    const token = await seedRecord(sessions, 'A'.repeat(43), {
      v: 1, userId: 'ldap:legacy-uuid', username: 'legacy', expiresAt,
    })
    await expect(sessions.find(token)).resolves.toEqual({
      userId: 'ldap:legacy-uuid', username: 'legacy', isAdmin: false,
    })
  })

  it('reads a corrupt non-boolean isAdmin as false without invalidating the session', async () => {
    const sessions = await store()
    const token = await seedRecord(sessions, 'B'.repeat(43), {
      v: 1, userId: 'ldap:x', username: 'x', isAdmin: 'nope', expiresAt,
    })
    await expect(sessions.find(token)).resolves.toEqual({ userId: 'ldap:x', username: 'x', isAdmin: false })
  })
})
