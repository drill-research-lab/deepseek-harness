/** Canonical paths, parsing, and rendering for language-pairing records. */

import { basename } from 'node:path'

/** Language keys understood by the pairing system, in canonical order. */
export const PAIRED_LANGUAGES = ['en', 'zh', 'zh-TW'] as const

/** A language the pairing system tracks. */
export type PairedLanguage = (typeof PAIRED_LANGUAGES)[number]

/** File suffix applied to the English source basename for each language. */
export const LANGUAGE_SUFFIX: Record<PairedLanguage, string> = {
  en: '',
  zh: '.zh',
  'zh-TW': '.zh-tw',
}

/** Language key → repository-relative path for one pair. */
export type TranslationPairLanguages = Record<PairedLanguage, string>

/** The repository-relative paths that form one language pair. */
export interface TranslationPairPaths {
  /** English document path. */
  source: string
  /** Counterpart path per language. */
  languages: TranslationPairLanguages
  /** Generated consistency-record path. */
  meta: string
}

/** Language key → git blob hash for one confirmed pair. */
export type TranslationPairingRecord = Record<PairedLanguage, string>

const META_LINE = /^([^:#]+\.md): ([0-9a-f]{40})$/

/**
 * Derive the counterpart and consistency-record paths from an English document.
 *
 * @param source - Repository-relative English Markdown path.
 * @returns The complete path set for every paired language.
 */
export function translationPairPaths(source: string): TranslationPairPaths {
  if (!source.endsWith('.md') || source.endsWith('.zh.md') || source.endsWith('.zh-tw.md')) {
    throw new Error(`expected an English Markdown path, received ${JSON.stringify(source)}`)
  }
  const languages = Object.fromEntries(PAIRED_LANGUAGES.map((language) => {
    const stem = source.slice(0, -'.md'.length)
    return [language, `${stem}${LANGUAGE_SUFFIX[language]}.md`]
  })) as TranslationPairLanguages
  return {
    source,
    languages,
    meta: source.replace(/\.md$/, '.i18n.yaml'),
  }
}

/**
 * Derive one pair from its consistency-record path.
 *
 * @param meta - Repository-relative `foo.i18n.yaml` path.
 * @returns The complete path set for every paired language.
 */
export function translationPairPathsFromMeta(meta: string): TranslationPairPaths {
  if (!meta.endsWith('.i18n.yaml')) {
    throw new Error(`expected a language-pairing consistency-record path, received ${JSON.stringify(meta)}`)
  }
  return translationPairPaths(meta.replace(/\.i18n\.yaml$/, '.md'))
}

/**
 * Parse a consistency record for its expected sibling names.
 *
 * @param content - Complete sidecar text.
 * @param paths - Expected sibling paths.
 * @returns The hash per language, or `undefined` for malformed, duplicate,
 *   missing, or unexpected keys.
 */
export function parseTranslationPairingRecord(
  content: string,
  paths: TranslationPairPaths,
): TranslationPairingRecord | undefined {
  const hashes = new Map<string, string>()
  for (const line of content.split('\n')) {
    if (line === '' || line.startsWith('#')) continue
    const match = META_LINE.exec(line)
    if (!match?.[1] || !match[2] || hashes.has(match[1])) return undefined
    hashes.set(match[1], match[2])
  }
  if (hashes.size !== PAIRED_LANGUAGES.length) return undefined
  const record = {} as TranslationPairingRecord
  for (const language of PAIRED_LANGUAGES) {
    const hash = hashes.get(basename(paths.languages[language]))
    if (hash === undefined) return undefined
    record[language] = hash
  }
  return record
}

/**
 * Render the canonical consistency record for a pair.
 *
 * @param paths - Pair paths written into the record and its recovery command.
 * @param record - Confirmed content hashes.
 * @returns Canonical YAML text with exactly one trailing newline.
 */
export function renderTranslationPairingRecord(
  paths: TranslationPairPaths,
  record: TranslationPairingRecord,
): string {
  return [
    '# Language-pair consistency record (docs/i18n/README.md): the git blob hash of each',
    '# side as of the last confirmed-consistent state. All languages carry equal authority;',
    '# after editing either side, bring the other along and re-record with:',
    `#   pnpm run verify-translation-pairing --write ${paths.source}`,
    ...PAIRED_LANGUAGES.map(language => `${basename(paths.languages[language])}: ${record[language]}`),
    '',
  ].join('\n')
}
