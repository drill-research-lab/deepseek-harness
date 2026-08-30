/**
 * Markdown chunking and keyword retrieval for Library search and grounded
 * question answering. Deliberately dependency-free: heading-aware chunking
 * plus a TF-IDF-weighted keyword score with CJK bigram tokenization. Vector
 * or FTS5 retrieval backends are a recorded follow-up on the Library seam,
 * not this module's business.
 */

/** Retrieval unit: one heading-scoped block of a converted Markdown file. */
export interface Chunk {
  /** Owning resource id. */
  resourceId: string
  /** Owning resource display name, used for citations. */
  resourceName: string
  /** Nearest enclosing heading text; `''` before the first heading. */
  heading: string
  /** Chunk body (includes its heading line when one exists). */
  text: string
}

/** A chunk with its query relevance score. */
export interface ScoredChunk extends Chunk {
  /** Relevance score; higher is more relevant, `0` means no term overlap. */
  score: number
}

/** Chunks longer than this are re-split at blank lines. */
const MAX_CHUNK_CHARS = 1800

const HEADING_RE = /^(#{1,3})\s+(.+?)\s*$/

/**
 * Split converted Markdown into heading-scoped chunks. Splits at ATX headings
 * of level 1-3; oversized sections are further split at blank-line boundaries
 * so every chunk stays under {@link MAX_CHUNK_CHARS} (a single overlong
 * paragraph is kept whole rather than split mid-sentence).
 * @param resourceId - Owning resource id stamped on every chunk.
 * @param resourceName - Owning resource name stamped on every chunk.
 * @param markdown - Converted Markdown content.
 * @returns chunks in document order; empty for blank content.
 */
export function chunkMarkdown(resourceId: string, resourceName: string, markdown: string): Chunk[] {
  const sections: { heading: string; lines: string[] }[] = [{ heading: '', lines: [] }]
  for (const line of markdown.split(/\r?\n/)) {
    const heading = HEADING_RE.exec(line)
    if (heading) sections.push({ heading: heading[2] ?? '', lines: [line] })
    else sections.at(-1)?.lines.push(line)
  }
  const chunks: Chunk[] = []
  for (const section of sections) {
    const body = section.lines.join('\n').trim()
    if (!body) continue
    for (const text of splitOversized(body)) {
      chunks.push({ resourceId, resourceName, heading: section.heading, text })
    }
  }
  return chunks
}

/**
 * Split one section body at blank lines into pieces under {@link MAX_CHUNK_CHARS}.
 * @param body - Trimmed section text.
 * @returns non-empty pieces in order.
 */
function splitOversized(body: string): string[] {
  if (body.length <= MAX_CHUNK_CHARS) return [body]
  const pieces: string[] = []
  let current = ''
  for (const paragraph of body.split(/\n{2,}/)) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (candidate.length > MAX_CHUNK_CHARS && current) {
      pieces.push(current)
      current = paragraph
    } else {
      current = candidate
    }
  }
  if (current) pieces.push(current)
  return pieces
}

const LATIN_WORD_RE = /[\p{Script=Latin}\p{Nd}][\p{Script=Latin}\p{Nd}'’-]*/gu
const HAN_RUN_RE = /\p{Script=Han}+/gu

/**
 * Tokenize text for keyword matching: lowercased Latin/digit words plus CJK
 * bigrams (and lone Han characters), so mixed Chinese/English research notes
 * match without a segmenter.
 * @param text - Source text.
 * @returns tokens in occurrence order; may repeat.
 */
export function termsOf(text: string): string[] {
  const lower = text.toLowerCase()
  const terms: string[] = []
  for (const match of lower.matchAll(LATIN_WORD_RE)) terms.push(match[0])
  for (const match of lower.matchAll(HAN_RUN_RE)) {
    const run = match[0]
    if (run.length === 1) terms.push(run)
    for (let index = 0; index + 1 < run.length; index += 1) terms.push(run.slice(index, index + 2))
  }
  return terms
}

/**
 * Score chunks against a query with TF-IDF weighting: each query term
 * contributes its in-chunk frequency times a rarity weight, and totals are
 * dampened by chunk length so long chunks do not dominate.
 * @param chunks - Candidate chunks (typically every chunk of one notebook).
 * @param query - Natural-language query.
 * @param limit - Maximum number of results.
 * @returns the highest-scoring chunks in descending score order, excluding zero scores.
 */
export function scoreChunks(chunks: readonly Chunk[], query: string, limit: number): ScoredChunk[] {
  const queryTerms = [...new Set(termsOf(query))]
  if (queryTerms.length === 0 || chunks.length === 0) return []
  const chunkTerms = chunks.map((chunk) => {
    const counts = new Map<string, number>()
    for (const term of termsOf(chunk.text)) counts.set(term, (counts.get(term) ?? 0) + 1)
    return counts
  })
  const scored: ScoredChunk[] = []
  for (const [index, chunk] of chunks.entries()) {
    const counts = chunkTerms[index]
    if (!counts) continue
    let score = 0
    for (const term of queryTerms) {
      const frequency = counts.get(term)
      if (!frequency) continue
      const documentFrequency = chunkTerms.reduce((total, other) => total + (other.has(term) ? 1 : 0), 0)
      score += frequency * (1 + Math.log(chunks.length / (1 + documentFrequency)))
    }
    if (score > 0) scored.push({ ...chunk, score: score / Math.sqrt(1 + chunk.text.length / 100) })
  }
  return scored.sort((left, right) => right.score - left.score).slice(0, limit)
}

/**
 * Extract a document outline from converted Markdown.
 * @param markdown - Converted Markdown content.
 * @param limit - Maximum number of headings returned.
 * @returns heading texts (levels 1-3) in document order.
 */
export function outlineOf(markdown: string, limit: number): string[] {
  const headings: string[] = []
  for (const line of markdown.split(/\r?\n/)) {
    const heading = HEADING_RE.exec(line)
    const text = heading?.[2]
    if (text !== undefined) {
      headings.push(text)
      if (headings.length >= limit) break
    }
  }
  return headings
}
