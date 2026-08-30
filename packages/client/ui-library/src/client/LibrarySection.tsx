/**
 * Sidebar section: the notebook list under the session browser. Wide renders
 * the header row (+ create) and the notebook rows; the rail renders one icon
 * that expands the sidebar and opens the Library page.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-sidebar SlotMap merge (the sidebar.section entry).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { LibrarySectionFace, NotebookView } from './types.ts'
import type { NS } from './locales.ts'
import css from './library.module.css'

/** Full section props composed by the sidebar.section slot. */
export type LibrarySectionProps =
  PropsRuntime<'sidebar.section'> & InjectFace<LibrarySectionFace> & PropsLocale<typeof NS>

/** Book glyph reused by the rail button and the section header. */
function BookIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 3.2c0-.66.54-1.2 1.2-1.2h4.05c.42 0 .8.22 1.02.57.21-.35.6-.57 1.02-.57h4.01c.66 0 1.2.54 1.2 1.2v9.1c0 .66-.54 1.2-1.2 1.2H9.9c-.5 0-.94.3-1.13.74a.83.83 0 0 0-1.54 0c-.19-.45-.63-.74-1.13-.74H3.7c-.66 0-1.2-.54-1.2-1.2V3.2Z"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path d="M8 3v9.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

/** Render the Library sidebar section. */
export function LibrarySection({
  wide, expandSidebar, usePageState, useRevision, onOpen, onMeasure, listNotebooks, createNotebook, t,
}: LibrarySectionProps) {
  const [notebooks, setNotebooks] = useState<readonly NotebookView[]>([])
  const revision = useRevision(value => value)
  const pageState = usePageState(state => state)
  const container = useRef<HTMLDivElement>(null)

  const refresh = useCallback(() => {
    void listNotebooks().then(setNotebooks).catch(() => { setNotebooks([]) })
  }, [listNotebooks])
  useEffect(() => { refresh() }, [refresh, revision])

  // The section spans the sidebar column, so its own right edge tracks the
  // column width through rail/wide flips and drag resizes; the page view
  // reads it to start beside the sidebar instead of covering it.
  useEffect(() => {
    const element = container.current
    if (!element) return
    const report = () => { onMeasure(Math.ceil(element.getBoundingClientRect().right) + 12) }
    report()
    const observer = new ResizeObserver(report)
    observer.observe(element)
    window.addEventListener('resize', report)
    return () => { observer.disconnect(); window.removeEventListener('resize', report) }
  }, [onMeasure, wide])

  if (!wide) {
    return (
      <div ref={container} className={css.railWrap}>
        <button
          type="button"
          className={css.railButton}
          aria-label={t('section.open')}
          onClick={() => { expandSidebar(); onOpen() }}
        >
          <BookIcon size={18} />
        </button>
      </div>
    )
  }

  return (
    <div ref={container} className={css.section}>
      <div className={css.sectionHeader}>
        <span className={css.sectionTitle}>
          <BookIcon size={14} />
          {t('section.title')}
        </span>
        <button
          type="button"
          className={css.sectionAdd}
          aria-label={t('section.new')}
          title={t('section.new')}
          onClick={() => { void createNotebook(t('section.title')) }}
        >
          +
        </button>
      </div>
      {notebooks.length === 0
        ? <div className={css.sectionEmpty}>{t('section.empty')}</div>
        : notebooks.map(notebook => (
          <button
            key={notebook.notebookId}
            type="button"
            className={
              pageState.open && pageState.notebookId === notebook.notebookId
                ? `${css.sectionRow} ${css.sectionRowActive}`
                : css.sectionRow
            }
            onClick={() => { onOpen(notebook.notebookId) }}
          >
            <span className={css.sectionRowTitle}>{notebook.title}</span>
            <span className={css.sectionRowCount}>{notebook.resourceCount}</span>
          </button>
        ))}
    </div>
  )
}
