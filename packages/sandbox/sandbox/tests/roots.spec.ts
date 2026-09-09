/**
 * Tests for the writable-root derivation: the mode's meaning as a canonical
 * allow-list. Pinned here so the fs fence and the Seatbelt profile — both
 * deriving from `writableRoots` — cannot drift.
 */

import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { canonicalPath, fromWorkspaceView, readableRoots, toWorkspaceView, writableRoots } from '@deepseek-ai/dsh-sandbox'

const viewPolicy = { mode: 'workspace-write', workspaceRoot: '/home/u/.dsh/owner-roots/abc/proj', workspaceViewRoot: '/workspace' } as const
const noViewPolicy = { mode: 'workspace-write', workspaceRoot: '/home/u/.dsh/owner-roots/abc/proj' } as const

describe('canonicalPath', () => {
  it('resolves symlinks (an existing path realpaths)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-roots-'))
    expect(canonicalPath(dir)).toBe(realpathSync.native(dir))
  })

  it('returns the spelling as-is when the path cannot be resolved (conservative — matches nothing until it exists)', () => {
    expect(canonicalPath('/does/not/exist/anywhere-xyz')).toBe('/does/not/exist/anywhere-xyz')
  })
})

describe('writableRoots', () => {
  it('read-only grants nothing', () => {
    expect(writableRoots({ mode: 'read-only', workspaceRoot: process.cwd() })).toEqual([])
  })

  it('workspace-write grants the workspace root plus the platform temp areas, canonical and deduplicated', () => {
    const ws = mkdtempSync(join(tmpdir(), 'dsh-ws-'))
    const roots = writableRoots({ mode: 'workspace-write', workspaceRoot: ws })
    expect(roots).toContain(realpathSync.native(ws))
    expect(roots).toContain(canonicalPath('/tmp'))
    expect(roots).toContain(realpathSync.native(tmpdir()))
    // Deduplicated after canonicalization (/tmp and os.tmpdir() may coincide).
    expect(new Set(roots).size).toBe(roots.length)
  })
})

describe('readableRoots', () => {
  it.each(['read-only', 'workspace-write'] as const)('%s grants only the canonical workspace root', (mode) => {
    const ws = mkdtempSync(join(tmpdir(), 'dsh-readable-ws-'))
    expect(readableRoots({ mode, workspaceRoot: ws })).toEqual([realpathSync.native(ws)])
  })

  it('danger-full-access has no read allow-list', () => {
    expect(readableRoots({ mode: 'danger-full-access', workspaceRoot: process.cwd() })).toEqual([])
  })
})

describe('fromWorkspaceView', () => {
  it('maps an absolute path under the view root onto the real workspace root', () => {
    expect(fromWorkspaceView('/workspace/src/a.c', viewPolicy)).toBe('/home/u/.dsh/owner-roots/abc/proj/src/a.c')
  })

  it('maps the bare view root to the real workspace root', () => {
    expect(fromWorkspaceView('/workspace', viewPolicy)).toBe('/home/u/.dsh/owner-roots/abc/proj')
  })

  it('leaves a relative path untouched (it already resolves against the real cwd)', () => {
    expect(fromWorkspaceView('src/a.c', viewPolicy)).toBe('src/a.c')
  })

  it('leaves an absolute path outside the view root untouched', () => {
    expect(fromWorkspaceView('/etc/hosts', viewPolicy)).toBe('/etc/hosts')
  })

  it('does not treat a sibling prefix as a match', () => {
    expect(fromWorkspaceView('/workspace-other/x', viewPolicy)).toBe('/workspace-other/x')
  })

  it('is identity when the policy sets no view root, or is undefined', () => {
    expect(fromWorkspaceView('/workspace/src/a.c', noViewPolicy)).toBe('/workspace/src/a.c')
    expect(fromWorkspaceView('/workspace/src/a.c', undefined)).toBe('/workspace/src/a.c')
  })
})

describe('toWorkspaceView', () => {
  it('maps a real resolved path back under the view root', () => {
    expect(toWorkspaceView('/home/u/.dsh/owner-roots/abc/proj/src/a.c', viewPolicy)).toBe('/workspace/src/a.c')
  })

  it('maps the real workspace root to the bare view root', () => {
    expect(toWorkspaceView('/home/u/.dsh/owner-roots/abc/proj', viewPolicy)).toBe('/workspace')
  })

  it('leaves a path outside the real workspace root untouched', () => {
    expect(toWorkspaceView('/home/u/.dsh/owner-roots/abc/other/a.c', viewPolicy)).toBe('/home/u/.dsh/owner-roots/abc/other/a.c')
  })

  it('is identity when the policy sets no view root, or is undefined', () => {
    expect(toWorkspaceView('/home/u/.dsh/owner-roots/abc/proj/src/a.c', noViewPolicy))
      .toBe('/home/u/.dsh/owner-roots/abc/proj/src/a.c')
    expect(toWorkspaceView('/home/u/.dsh/owner-roots/abc/proj/src/a.c', undefined))
      .toBe('/home/u/.dsh/owner-roots/abc/proj/src/a.c')
  })

  it('round-trips with fromWorkspaceView for a path under the workspace', () => {
    const real = '/home/u/.dsh/owner-roots/abc/proj/deep/nested/file.ts'
    expect(fromWorkspaceView(toWorkspaceView(real, viewPolicy), viewPolicy)).toBe(real)
  })
})
