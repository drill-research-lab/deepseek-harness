/** LaTeX section outline extraction for the Writing editor. */

/** One document-outline entry: a 1-based source line plus its heading. */
export interface OutlineItem {
  readonly line: number
  readonly title: string
  readonly depth: number
}

const SECTION_RE = /^\s*\\(part|chapter|section|subsection|subsubsection)\*?\{([^}]*)\}/
const DEPTH: Record<string, number> = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4 }

/**
 * Extract a heading outline from LaTeX source. A heading is any line whose
 * leading command is a sectioning command (with or without a star), so an
 * outline item maps to a 1-based line number the editor can jump to.
 * @param source - the report LaTeX source.
 * @returns the ordered outline, empty when no sectioning command is present.
 */
export function buildOutline(source: string): OutlineItem[] {
  const items: OutlineItem[] = []
  source.split('\n').forEach((line, index) => {
    const match = SECTION_RE.exec(line)
    if (match !== null && match[1] !== undefined && match[2] !== undefined) {
      items.push({ line: index + 1, title: match[2], depth: DEPTH[match[1]] ?? 2 })
    }
  })
  return items
}

/**
 * Jump the editor's caret to a 1-based source line, scrolling it into view.
 * @param textarea - the editor textarea.
 * @param source - the current report source (used to compute the caret offset).
 * @param line - the 1-based line to focus.
 */
export function jumpToLine(textarea: HTMLTextAreaElement, source: string, line: number): void {
  const offset = source.split('\n').slice(0, line - 1).reduce((acc, part) => acc + part.length + 1, 0)
  textarea.focus()
  textarea.setSelectionRange(offset, offset)
}
