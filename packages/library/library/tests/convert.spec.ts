import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { builtinTextConverter, htmlToMarkdown } from '../src/convert/builtin.ts'
import { safeFileName } from '../src/index.ts'

const roots: string[] = []

async function tempFile(name: string, content: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-library-convert-'))
  roots.push(root)
  const path = join(root, name)
  await writeFile(path, content, 'utf8')
  return path
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('builtinTextConverter', () => {
  it('accepts text formats and refuses binary ones', () => {
    expect(builtinTextConverter.accepts({ path: 'x', name: 'a.md', mediaType: 'text/markdown' })).toBe(true)
    expect(builtinTextConverter.accepts({ path: 'x', name: 'a.HTML', mediaType: 'text/html' })).toBe(true)
    expect(builtinTextConverter.accepts({ path: 'x', name: 'a.pdf', mediaType: 'application/pdf' })).toBe(false)
    expect(builtinTextConverter.accepts({ path: 'x', name: 'noext', mediaType: '' })).toBe(false)
  })

  it('passes Markdown through unchanged', async () => {
    const path = await tempFile('doc.md', '# Title\nbody\n')
    await expect(builtinTextConverter.convert({ path, name: 'doc.md', mediaType: 'text/markdown' }))
      .resolves.toBe('# Title\nbody\n')
  })

  it('fences CSV content', async () => {
    const path = await tempFile('data.csv', 'a,b\n1,2\n')
    const markdown = await builtinTextConverter.convert({ path, name: 'data.csv', mediaType: 'text/csv' })
    expect(markdown).toBe('```csv\na,b\n1,2\n```')
  })

  it('reduces HTML to headed text', async () => {
    const html = '<html><head><style>p{}</style><script>evil()</script></head>'
      + '<body><h1>Hello</h1><p>First &amp; second</p><ul><li>one</li><li>two</li></ul></body></html>'
    const path = await tempFile('page.html', html)
    const markdown = await builtinTextConverter.convert({ path, name: 'page.html', mediaType: 'text/html' })
    expect(markdown).toContain('# Hello')
    expect(markdown).toContain('First & second')
    expect(markdown).toContain('- one')
    expect(markdown).not.toContain('evil()')
  })
})

describe('htmlToMarkdown', () => {
  it('decodes common entities and collapses blank runs', () => {
    expect(htmlToMarkdown('<p>a&nbsp;&lt;b&gt;</p>\n\n\n<p>c&#39;d</p>')).toBe("a <b>\n\nc'd")
  })
})

describe('safeFileName', () => {
  it('replaces separators and control characters', () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })

  it('falls back for empty and dot names', () => {
    expect(safeFileName('')).toBe('document')
    expect(safeFileName('..')).toBe('document')
  })

  it('keeps the extension when truncating overlong names', () => {
    const name = `${'x'.repeat(200)}.pdf`
    const safe = safeFileName(name)
    expect(safe.length).toBeLessThanOrEqual(120)
    expect(safe.endsWith('.pdf')).toBe(true)
  })
})
