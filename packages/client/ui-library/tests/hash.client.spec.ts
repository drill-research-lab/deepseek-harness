// The page's URL-hash address round-trips: parse and project are inverses on
// every reachable page state, so deep links from outside the page land where
// the writer intended.
import { describe, expect, it } from 'vitest'
import { hashFromState, stateFromHash } from '../src/client/index.ts'

describe('library hash address', () => {
  it('projects page states to their hash addresses', () => {
    expect(hashFromState({ open: false })).toBe('')
    expect(hashFromState({ open: true })).toBe('#library')
    expect(hashFromState({ open: true, notebookId: 'nb1' })).toBe('#library/nb1')
    expect(hashFromState({ open: true, notebookId: 'nb1', resourceId: 'r1' })).toBe('#library/nb1/resource/r1')
    // A resource without its notebook is unaddressable and stays off the hash.
    expect(hashFromState({ open: true, resourceId: 'r1' })).toBe('#library')
  })

  it('parses hash addresses back into page states', () => {
    expect(stateFromHash('')).toBeUndefined()
    expect(stateFromHash('#other')).toBeUndefined()
    expect(stateFromHash('#library')).toEqual({ open: true })
    expect(stateFromHash('#library/nb1')).toEqual({ open: true, notebookId: 'nb1' })
    expect(stateFromHash('#library/nb1/resource/r1')).toEqual({ open: true, notebookId: 'nb1', resourceId: 'r1' })
    expect(stateFromHash('#library/nb1/resource/r1/extra')).toBeUndefined()
  })

  it('round-trips ids that need percent-encoding', () => {
    const state = { open: true, notebookId: 'nb/勾', resourceId: 'r#1' } as const
    expect(stateFromHash(hashFromState(state))).toEqual(state)
  })
})
