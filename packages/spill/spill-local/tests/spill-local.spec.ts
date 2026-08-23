/**
 * Tests for the LOCAL spill backend: `saveText` writes a session-scoped file and
 * returns a locator + byte length + retrieval hint, filename sanitization
 * neutralizes traversal, the configured `root` is honored (and the private
 * default when omitted), and a storage failure rejects. The Cordis-free
 * `store.ts` helpers are exercised directly for the naming/encoding edge cases.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp as mkdtempAsync, rm as rmAsync } from 'node:fs/promises'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, normalize } from 'node:path'
import { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { OwnershipService, UserHome } from '@deepseek-ai/dsh-ownership'
import type { OwnerPrincipal, OwnerRoot } from '@deepseek-ai/dsh-ownership'
import type { SaveTextSpill } from '@deepseek-ai/dsh-spill'
import LocalSpillStore, { encodeSegment, privateRoot, saveTextFile, sessionDir } from '@deepseek-ai/dsh-spill-local'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-spill-test-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function request(overrides: Partial<SaveTextSpill> = {}): SaveTextSpill {
  return {
    owner: { sessionId: SessionId('sess-1') },
    source: { toolName: 'web_fetch', callId: CallId('call-1'), label: 'result' },
    suggestedName: 'web_fetch.txt',
    content: 'the full body',
    ...overrides,
  }
}

describe('encodeSegment', () => {
  it('keeps the safe set literal', () => {
    expect(encodeSegment('web_fetch.txt')).toBe('web_fetch.txt')
    expect(encodeSegment('a-B_9.z')).toBe('a-B_9.z')
  })

  it('escapes separators and tilde (dots are literal except as whole-segment tokens)', () => {
    // `.` is in the safe set, so `..` inside a longer string stays literal; the
    // traversal defense is that separators escape, keeping the result ONE segment.
    expect(encodeSegment('../etc/passwd')).toBe('..~002Fetc~002Fpasswd')
    expect(encodeSegment('a/b')).toBe('a~002Fb')
    expect(encodeSegment('~')).toBe('~007E')
  })

  it('escapes the whole-segment dot tokens', () => {
    expect(encodeSegment('.')).toBe('~002E')
    expect(encodeSegment('..')).toBe('~002E~002E')
  })

  it('encodes the empty string to a non-empty segment', () => {
    expect(encodeSegment('')).toBe('~')
  })
})

describe('sessionDir', () => {
  it('is a stable per-session hash under the root', () => {
    const dir = sessionDir('/spill', 'sess-1')
    expect(dir).toBe(sessionDir('/spill', 'sess-1'))
    expect(dirname(dir)).toBe(normalize('/spill'))
    expect(basename(dir)).toMatch(/^session-[0-9a-f]{12}$/)
    expect(sessionDir('/spill', 'sess-2')).not.toBe(dir)
  })
})

describe('saveTextFile', () => {
  it('writes the content under the session dir and reports bytes', async () => {
    const saved = await saveTextFile({ root, sessionId: 'sess-1', suggestedName: 'r.txt', content: 'héllo' })
    expect(readFileSync(saved.path, 'utf8')).toBe('héllo')
    expect(saved.bytes).toBe(Buffer.byteLength('héllo', 'utf8'))
    expect(dirname(saved.path)).toBe(sessionDir(root, 'sess-1'))
    expect(basename(saved.path)).toMatch(/^[0-9a-f]{12}-r\.txt$/)
  })

  it('sanitizes a traversal-shaped suggested name into one segment', async () => {
    const saved = await saveTextFile({ root, sessionId: 'sess-1', suggestedName: '../../evil', content: 'x' })
    // The separators escaped, so the whole name is one leaf under the session dir.
    expect(dirname(saved.path)).toBe(sessionDir(root, 'sess-1'))
    expect(saved.path.includes('/..')).toBe(false)
  })

  it('creates the session directory and file with owner-only POSIX permissions', async () => {
    const saved = await saveTextFile({ root, sessionId: 'sess-1', suggestedName: 'r.txt', content: 'x' })
    const directory = statSync(dirname(saved.path))
    const file = statSync(saved.path)
    expect(directory.isDirectory()).toBe(true)
    expect(file.isFile()).toBe(true)
    if (process.platform !== 'win32') {
      expect(directory.mode & 0o777).toBe(0o700)
      expect(file.mode & 0o777).toBe(0o600)
    }
  })

  it('gives distinct paths to two saves of the same name', async () => {
    const a = await saveTextFile({ root, sessionId: 'sess-1', suggestedName: 'r.txt', content: 'a' })
    const b = await saveTextFile({ root, sessionId: 'sess-1', suggestedName: 'r.txt', content: 'b' })
    expect(a.path).not.toBe(b.path)
  })
})

describe('privateRoot', () => {
  it('is a stable absolute directory under the temp dir', () => {
    const first = privateRoot()
    expect(isAbsolute(first)).toBe(true)
    expect(privateRoot()).toBe(first)
  })
})

describe('LocalSpillStore service', () => {
  it('registers as ctx.spillStore and saves under the configured root', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSpillStore, { root })
    const ref = await ctx.spillStore.saveText(request())
    expect(dirname(ref.locator)).toBe(sessionDir(root, 'sess-1'))
    expect(readFileSync(ref.locator, 'utf8')).toBe('the full body')
    expect(ref.bytes).toBe(Buffer.byteLength('the full body', 'utf8'))
    expect(ref.retrievalHint).toBe('Use read with offset/limit, or grep this path to search within it.')
  })

  it('resolves a relative configured root to absolute', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSpillStore, { root: '.' })
    expect(isAbsolute((ctx.spillStore as LocalSpillStore).root)).toBe(true)
  })

  it('falls back to the private root when none is configured', async () => {
    const ctx = new Context()
    await ctx.plugin(LocalSpillStore, {})
    expect((ctx.spillStore as LocalSpillStore).root).toBe(privateRoot())
  })

  it('rejects when the root is not writable (missing parent, exclusive open)', async () => {
    const ctx = new Context()
    // A file (not a dir) as the root makes mkdir under it fail — a real storage error.
    const filePath = (await saveTextFile({ root, sessionId: 's', suggestedName: 'f', content: 'x' })).path
    await ctx.plugin(LocalSpillStore, { root: filePath })
    await expect(ctx.spillStore.saveText(request())).rejects.toThrow()
  })
})

class TestOwnership extends OwnershipService {
  principal: OwnerPrincipal | undefined

  constructor(ctx: Context, private readonly usersRoot: string) { super(ctx) }
  currentPrincipal(): OwnerPrincipal {
    if (this.principal === undefined) throw new Error('no test owner')
    return this.principal
  }
  currentPrincipalOrUndefined(): OwnerPrincipal | undefined { return this.principal }
  backgroundPrincipal(userId: OwnerPrincipal['userId']): OwnerPrincipal {
    return { userId, source: 'background' }
  }
  resolveOwnerRoot(): Promise<OwnerRoot> {
    throw new Error('not used by these tests')
  }

  async resolveUserHome(principal: OwnerPrincipal): Promise<UserHome> {
    const homeRoot = join(this.usersRoot, String(principal.userId).replaceAll(':', '-'))
    await mkdir(homeRoot, { recursive: true })
    return new UserHome(principal, {
      schemaVersion: 1,
      userId: principal.userId,
      createdAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:00.000Z',
    }, homeRoot)
  }
}

describe('LocalSpillStore ownership', () => {
  it('persists under the session owner\'s UserHome, never the requester alone', async () => {
    const usersRoot = await mkdtempAsync(join(tmpdir(), 'dsh-spill-owner-'))
    try {
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      const ownershipFiber = ctx.plugin(TestOwnership, usersRoot)
      await ownershipFiber
      const storeFiber = ctx.plugin(LocalSpillStore, {})
      await storeFiber
      const ownership = ctx.ownership as TestOwnership
      const alice = { userId: 'ldap:test-alice' as OwnerPrincipal['userId'], source: 'request' as const }
      const bob = { userId: 'ldap:test-bob' as OwnerPrincipal['userId'], source: 'request' as const }

      ownership.principal = alice
      const aliceSession = ctx.sessions.create()

      const ref = await ctx.spillStore.saveText(request({ owner: { sessionId: aliceSession.id } }))
      expect(dirname(ref.locator)).toBe(sessionDir(join(usersRoot, 'ldap-test-alice', 'spill'), aliceSession.id))

      // Bob cannot write into Alice's session namespace, even though he
      // supplies her real sessionId: the write is rooted in the SESSION's
      // durable owner, not the caller's own identity.
      ownership.principal = bob
      await expect(ctx.spillStore.saveText(request({ owner: { sessionId: aliceSession.id } })))
        .rejects.toThrow(/not found/)

      // A background write (no request principal, e.g. a continuation
      // outside AsyncLocalStorage scope) still resolves to the session's own
      // durable owner rather than failing open into an unscoped location.
      ownership.principal = undefined
      const backgroundRef = await ctx.spillStore.saveText(request({ owner: { sessionId: aliceSession.id } }))
      expect(dirname(backgroundRef.locator)).toBe(dirname(ref.locator))

      // Bob's own session lands under his own, separate namespace.
      ownership.principal = bob
      const bobSession = ctx.sessions.create()
      const bobRef = await ctx.spillStore.saveText(request({ owner: { sessionId: bobSession.id } }))
      expect(dirname(bobRef.locator)).not.toBe(dirname(ref.locator))
      expect(dirname(bobRef.locator)).toBe(sessionDir(join(usersRoot, 'ldap-test-bob', 'spill'), bobSession.id))

      await storeFiber.dispose()
      await ownershipFiber.dispose()
    } finally {
      await rmAsync(usersRoot, { recursive: true, force: true })
    }
  })
})
