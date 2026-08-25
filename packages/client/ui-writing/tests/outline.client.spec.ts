// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildOutline, jumpToLine } from '../src/client/outline.ts'

describe('buildOutline', () => {
  it('extracts sectioning commands with their line numbers', () => {
    const source = [
      '\\documentclass{article}',
      '\\section{Intro}',
      'body',
      '\\subsection*{Setup}',
      '\\chapter{Part}',
      '\\part{Preamble}',
    ].join('\n')
    expect(buildOutline(source)).toEqual([
      { line: 2, title: 'Intro', depth: 2 },
      { line: 4, title: 'Setup', depth: 3 },
      { line: 5, title: 'Part', depth: 1 },
      { line: 6, title: 'Preamble', depth: 0 },
    ])
  })

  it('returns an empty outline when no sectioning command is present', () => {
    expect(buildOutline('no headings here')).toEqual([])
  })
})

describe('jumpToLine', () => {
  it('moves the caret to the requested 1-based line', () => {
    const source = ['line1', 'line2', 'line3'].join('\n')
    const textarea = document.createElement('textarea')
    let caret = 0
    textarea.focus = () => {}
    textarea.setSelectionRange = (start: number) => { caret = start }
    jumpToLine(textarea, source, 3)
    expect(caret).toBe('line1\nline2\n'.length)
  })
})
