import { describe, expect, it } from 'vitest'
import { chunkMarkdown, outlineOf, scoreChunks, termsOf } from '../src/chunk.ts'

describe('chunkMarkdown', () => {
  it('splits at headings and keeps heading text on each chunk', () => {
    const markdown = '# Intro\nhello world\n\n## Details\nmore text\n'
    const chunks = chunkMarkdown('r1', 'doc.md', markdown)
    expect(chunks.map(chunk => chunk.heading)).toEqual(['Intro', 'Details'])
    expect(chunks[0]?.resourceId).toBe('r1')
    expect(chunks[0]?.resourceName).toBe('doc.md')
  })

  it('keeps preamble text before the first heading with an empty heading', () => {
    const chunks = chunkMarkdown('r1', 'doc.md', 'preamble\n\n# Later\nbody')
    expect(chunks[0]?.heading).toBe('')
    expect(chunks[0]?.text).toBe('preamble')
  })

  it('re-splits oversized sections at blank lines', () => {
    const paragraph = 'p'.repeat(700)
    const markdown = `# Big\n${paragraph}\n\n${paragraph}\n\n${paragraph}`
    const chunks = chunkMarkdown('r1', 'doc.md', markdown)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(1800)
  })

  it('returns nothing for blank content', () => {
    expect(chunkMarkdown('r1', 'doc.md', '\n\n')).toEqual([])
  })
})

describe('termsOf', () => {
  it('tokenizes latin words and CJK bigrams together', () => {
    const terms = termsOf('DeepSeek 知識庫 v2')
    expect(terms).toContain('deepseek')
    expect(terms).toContain('知識')
    expect(terms).toContain('識庫')
    expect(terms).toContain('v2')
  })

  it('keeps a lone Han character as a term', () => {
    expect(termsOf('好 ok')).toContain('好')
  })
})

describe('scoreChunks', () => {
  const chunks = [
    { resourceId: 'a', resourceName: 'shader.md', heading: 'Vertex', text: 'The vertex shader transforms positions with gl_Position.' },
    { resourceId: 'b', resourceName: 'fragment.md', heading: 'Fragment', text: 'The fragment shader writes gl_FragColor for every pixel.' },
    { resourceId: 'c', resourceName: 'other.md', heading: 'Cooking', text: '今天的晚餐是滷肉飯與燙青菜。' },
  ]

  it('ranks the chunk sharing rare query terms first', () => {
    const scored = scoreChunks(chunks, 'what does gl_FragColor do in the fragment shader?', 2)
    expect(scored[0]?.resourceId).toBe('b')
  })

  it('matches Chinese queries through bigrams', () => {
    const scored = scoreChunks(chunks, '晚餐吃什麼', 3)
    expect(scored[0]?.resourceId).toBe('c')
  })

  it('returns nothing when no term overlaps', () => {
    expect(scoreChunks(chunks, 'quantum entanglement', 3)).toEqual([])
    expect(scoreChunks(chunks, '', 3)).toEqual([])
    expect(scoreChunks([], 'shader', 3)).toEqual([])
  })
})

describe('outlineOf', () => {
  it('lists headings in order up to the limit', () => {
    const markdown = '# A\ntext\n## B\ntext\n### C\ntext\n## D\n'
    expect(outlineOf(markdown, 3)).toEqual(['A', 'B', 'C'])
  })

  it('returns nothing for heading-free content', () => {
    expect(outlineOf('just text', 5)).toEqual([])
  })
})
