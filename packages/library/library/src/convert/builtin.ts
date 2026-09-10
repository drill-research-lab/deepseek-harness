import { readFile } from 'node:fs/promises'
import type { ConvertInput, LibraryConverter } from './types.ts'

const TEXT_EXTENSIONS = new Set(['md', 'markdown', 'txt', 'csv', 'json', 'html', 'htm'])

/**
 * Extension of a file name, lowercased without the dot.
 * @param name - File name.
 * @returns the extension, or `''` when there is none.
 */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * Reduce an HTML document to readable Markdown-ish text: headings, paragraphs,
 * list items, and line breaks survive; scripts, styles, and every other tag are
 * dropped. A fidelity converter (markitdown) outranks this by priority — this
 * fallback only guarantees the text is not lost.
 * @param html - HTML source.
 * @returns plain Markdown text.
 */
export function htmlToMarkdown(html: string): string {
  const withoutScripts = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
  const withStructure = withoutScripts
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, text: string) => `\n${'#'.repeat(Number(level))} ${text.trim()}\n`)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|section|article|tr|table|ul|ol|blockquote)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
  const text = withStructure.replace(/<[^>]+>/g, '')
  return decodeEntities(text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Decode the HTML entities that commonly survive tag stripping.
 * @param text - Tag-stripped text.
 * @returns decoded text.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Built-in fallback converter for plain-text formats. Markdown and plain text
 * pass through unchanged, CSV becomes a fenced block for structure-safe
 * reading, HTML is reduced by {@link htmlToMarkdown}. Binary formats are
 * refused so higher-fidelity converters (or a clean error) own them.
 */
export const builtinTextConverter: LibraryConverter = {
  id: 'builtin-text',
  priority: 0,
  accepts(input: ConvertInput): boolean {
    return TEXT_EXTENSIONS.has(extensionOf(input.name))
  },
  async convert(input: ConvertInput): Promise<string> {
    const raw = await readFile(input.path, 'utf8')
    const extension = extensionOf(input.name)
    if (extension === 'html' || extension === 'htm') return htmlToMarkdown(raw)
    if (extension === 'csv') return `\`\`\`csv\n${raw.trim()}\n\`\`\``
    if (extension === 'json') return `\`\`\`json\n${raw.trim()}\n\`\`\``
    return raw
  },
}
