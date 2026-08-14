/**
 * Convert Simplified Chinese (zh-CN) Markdown into Traditional Chinese
 * (zh-TW). The pipeline protects code spans and link targets from conversion,
 * applies OpenCC `s2twp` for character and phrase conversion, then applies the
 * repo's [terminology-zh-tw.md](../docs/i18n/terminology-zh-tw.md) correction
 * table for terms OpenCC mis-converts (e.g. 权限 → 許可權 is wrong; 權限 is
 * correct) and for repo-specific renderings.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import * as OpenCC from 'opencc-js'

/** A parsed simplified-to-traditional correction entry. */
export type ZhTwCorrections = Map<string, string>

/** Pre-conversion (simplified keys) and post-conversion (OpenCC-output keys) corrections. */
export interface ZhTwCorrectionSets {
  /** Applied before OpenCC: replacement-table rows keyed on simplified Chinese. */
  pre: ZhTwCorrections
  /** Applied after OpenCC: mechanical-trap rows keyed on OpenCC's wrong output. */
  post: ZhTwCorrections
}

const CORRECTION_LINE = /^\|\s*([^|\s][^|]*?)\s*\|\s*([^|\s][^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|$/
const TRAP_LINE = /^\|\s*([^|\s][^|]*?)\s*\|\s*([^|\s][^|]*?)\s*\|\s*([^|\s][^|]*?)\s*\|\s*([^|]*?)\s*\|$/

/** Sort a correction map longest-key-first so multi-character terms win. */
function sorted(map: Map<string, string>): Map<string, string> {
  return new Map([...map].sort(([left], [right]) => right.length - left.length))
}

/**
 * Parse the `docs/i18n/terminology-zh-tw.md` tables into pre- and
 * post-conversion correction sets. The replacement table (simplified keys,
 * applied before OpenCC) keeps only rows whose columns differ; same-form rows
 * (同形词) are skipped because OpenCC already leaves them unchanged. The
 * mechanical-trap table maps OpenCC's wrong output (e.g. 許可權) back to the
 * correct form (權限), applied after the converter runs.
 *
 * Rows whose traditional form contains the key as a substring are dropped
 * from both tables: a second application would compound the replacement
 * (工作流 → 工作流程 → 工作流程程). Such renderings belong to the review
 * pass, not to mechanical correction.
 *
 * @param table - Full Markdown of the terminology-zh-tw table.
 * @returns Pre- and post-conversion correction sets, longest-key-first.
 */
export function loadZhTwCorrections(table: string): ZhTwCorrectionSets {
  const pre = new Map<string, string>()
  const post = new Map<string, string>()
  let inReplacementTable = false
  let inTrapTable = false
  for (const line of table.split('\n')) {
    if (line.startsWith('## ')) {
      inReplacementTable = line.includes('需要替换的词条')
      inTrapTable = line.includes('机械转换陷阱')
      continue
    }
    if (inReplacementTable) {
      const match = CORRECTION_LINE.exec(line)
      if (!match?.[1] || !match[2]) continue
      const simplified = match[1].trim()
      const traditional = match[2].trim()
      if (simplified !== traditional && !traditional.includes(simplified)) pre.set(simplified, traditional)
    } else if (inTrapTable) {
      // Column 2 is OpenCC's wrong output; column 3 is the correct form.
      const match = TRAP_LINE.exec(line)
      if (!match?.[2] || !match[3]) continue
      const wrongOutput = match[2].trim()
      const correctForm = match[3].trim()
      if (wrongOutput !== correctForm && !correctForm.includes(wrongOutput)) post.set(wrongOutput, correctForm)
    }
  }
  return { pre: sorted(pre), post: sorted(post) }
}

/** Apply the correction table longest-first to one text span. */
function applyCorrections(text: string, corrections: ZhTwCorrections): string {
  let out = text
  for (const [simplified, traditional] of corrections) {
    out = out.split(simplified).join(traditional)
  }
  return out
}

/** A protected span kept verbatim through conversion. */
interface ProtectedSpan {
  token: string
  content: string
}

const TOKEN_PREFIX = '\u0000ZH_TW\u0000'

/** Extract code spans, fenced blocks, and link targets into protected tokens. */
function protectSpans(markdown: string): { text: string; spans: ProtectedSpan[] } {
  const spans: ProtectedSpan[] = []
  let index = 0
  const replace = (content: string): string => {
    const token = `${TOKEN_PREFIX}${index++}`
    spans.push({ token, content })
    return token
  }
  // Fenced code blocks first (their content may contain inline-backtick text).
  const withFences = markdown.replace(
    /(```[^\n]*\n[\s\S]*?```)/g,
    (_match, block: string) => replace(block),
  )
  // Inline code spans.
  const withInline = withFences.replace(/`[^`\n]+`/g, match => replace(match))
  // Link targets — convert only the visible text, never the destination.
  const withLinks = withInline.replace(
    /\[([^\]]*)\]\(([^)\s]+)(?:\s+([^)]*))?\)/g,
    (_match, text: string, target: string, rest: string | undefined) => {
      const protectedTarget = replace(target)
      const protectedRest = rest === undefined ? '' : replace(rest)
      return `[${text}](${protectedTarget}${rest === undefined ? '' : ` ${protectedRest}`})`
    },
  )
  return { text: withLinks, spans }
}

/** Restore protected tokens to their original content in one pass. */
function restoreSpans(text: string, spans: ProtectedSpan[]): string {
  const byToken = new Map(spans.map(span => [span.token, span.content]))
  return text.replace(/\u0000ZH_TW\u0000\d+/g, token => byToken.get(token) ?? token)
}

/** Fix the language-switcher line for the Traditional Chinese side. */
function fixSwitcher(markdown: string): string {
  return markdown.replace(/^(\[English\]\([^)]*\.md\)) \| 中文$/gm, '$1 | 繁體中文')
}

/**
 * Convert one zh-CN Markdown document into zh-TW.
 *
 * The replacement table (simplified → traditional repo terms) runs BEFORE
 * OpenCC so its simplified keys still exist; the mechanical-trap table (OpenCC
 * wrong output → correct form) runs AFTER OpenCC. Code spans and link targets
 * stay protected throughout.
 *
 * @param markdown - Simplified Chinese Markdown source.
 * @param corrections - Pre/post correction sets; defaults to the repo table.
 * @returns The converted Traditional Chinese Markdown.
 */
export function convertChineseMarkdown(markdown: string, corrections?: ZhTwCorrectionSets): string {
  const table = corrections ?? loadZhTwCorrections(
    readFileSync(resolve(import.meta.dirname, '../docs/i18n/terminology-zh-tw.md'), 'utf8'),
  )
  const { text, spans } = protectSpans(markdown)
  const converter = OpenCC.Converter({ from: 'cn', to: 'twp' })
  const preCorrected = applyCorrections(text, table.pre)
  const converted = applyCorrections(converter(preCorrected), table.post)
  const restored = restoreSpans(converted, spans)
  return fixSwitcher(restored)
}

/** Convert one zh-CN file into its `.zh-tw.md` sibling. */
export function convertFile(path: string): string {
  const source = resolve(import.meta.dirname, '..', path)
  const target = source.replace(/\.zh\.md$/, '.zh-tw.md')
  if (!source.endsWith('.zh.md')) {
    throw new Error(`convert-zh-tw: expected a .zh.md path, got ${JSON.stringify(path)}`)
  }
  if (!existsSync(source)) throw new Error(`convert-zh-tw: source file missing: ${path}`)
  const converted = convertChineseMarkdown(readFileSync(source, 'utf8'))
  writeFileSync(target, converted)
  return target.replace(resolve(import.meta.dirname, '..'), '').replace(/^\//, '')
}

/** Repo root for corpus discovery. */
const root = resolve(import.meta.dirname, '..')

/** Convert every paired zh-CN file named on the command line, or the whole corpus. */
export function main(argv: string[]): void {
  const allMode = argv.includes('--all')
  const paths = argv.filter(argument => !argument.startsWith('--'))
  if (allMode && paths.length > 0) {
    throw new Error('convert-zh-tw: --all takes no path arguments')
  }
  let targets: string[]
  if (allMode) {
    const scope = readFileSync(resolve(import.meta.dirname, '../scripts/translation-pairing.manifest.json'), 'utf8')
    const excluded = (JSON.parse(scope) as { excluded: string[] }).excluded
    targets = []
    const walk = (dir: string): void => {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === '.git' || entry.name === 'vendor') continue
        const full = join(dir, entry.name)
        const rel = full.slice(root.length + 1).split(sep).join('/')
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.zh.md') && !excluded.some(prefix => rel === prefix || rel.startsWith(`${prefix}/`))) {
          targets.push(rel)
        }
      }
    }
    walk(root)
  } else if (paths.length === 0) {
    throw new Error('convert-zh-tw: expected one or more .zh.md paths, or --all for the whole corpus')
  } else {
    targets = paths
  }
  for (const path of targets) {
    const written = convertFile(path)
    console.log(`convert-zh-tw: wrote ${written}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(`convert-zh-tw: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
