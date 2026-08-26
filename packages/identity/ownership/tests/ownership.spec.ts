import { isAbsolute } from 'node:path'
import { describe, expect, it } from 'vitest'
import { authenticatedUserId } from '@deepseek-ai/dsh-auth'
import { UserHome, validateUserHomePathSegment } from '../src/index.ts'

const principal = {
  userId: authenticatedUserId('test:alice'),
  source: 'background' as const,
}

const identity = {
  schemaVersion: 1 as const,
  userId: principal.userId,
  createdAt: '2026-08-21T00:00:00.000Z',
  updatedAt: '2026-08-21T00:00:00.000Z',
}

describe('validateUserHomePathSegment', () => {
  it.each([
    '',
    '.',
    '..',
    '/etc',
    '/absolute/path',
    'a/b',
    'a\\b',
    'a\0b',
    'C:\\Windows',
    'C:/Windows',
    '\\\\server\\share',
    '//server/share',
  ])('rejects %j', (value) => {
    expect(() => { validateUserHomePathSegment(value) }).toThrow(TypeError)
  })

  it.each(['sessions', 'one.json', 'C:relative', 'two words'])('accepts one child component %j', (value) => {
    expect(() => { validateUserHomePathSegment(value) }).not.toThrow()
  })
})

describe('UserHome.path', () => {
  it('joins only validated components beneath its root', () => {
    const home = new UserHome(principal, identity, '/srv/dsh/users/alice')
    const resolved = home.path('sessions', 'one.json')
    expect(resolved).toBe('/srv/dsh/users/alice/sessions/one.json')
    expect(isAbsolute(resolved)).toBe(true)
  })

  it.each(['', '..', '/etc', 'a/b', 'a\\b', 'a\0b', 'C:\\Windows', '\\\\server\\share'])('rejects unsafe component %j', (value) => {
    const home = new UserHome(principal, identity, '/srv/dsh/users/alice')
    expect(() => home.path('sessions', value)).toThrow(TypeError)
  })
})
