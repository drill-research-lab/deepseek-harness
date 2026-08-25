/** Writing view: report list (left), LaTeX editor + PDF preview (right), compile feedback (bottom). */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CompileResultView, ReportVersionView } from '@deepseek-ai/dsh-writing-api/types'
import type { ReportSummaryView, WritingViewInjected } from './types.ts'
import css from './writing.module.css'

/** Props of the Writing view: the conversation.view runtime + the inject face + locale. */
export type WritingViewProps = ConvViewProps & WritingViewInjected & PropsLocale<'writing'>

/** Pause (ms) before an edit is auto-saved and recompiled. */
const AUTOSAVE_DELAY_MS = 1000

/** The Writing surface. State is view-local; the report data comes from the inject face. */
export function WritingView(props: WritingViewProps): JSX.Element {
  const { listReports, createReport, getSource, updateSource, compile, versions, restore, t } = props
  const [reports, setReports] = useState<ReportSummaryView[]>([])
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [source, setSource] = useState('')
  const [compileResult, setCompileResult] = useState<CompileResultView | undefined>(undefined)
  const [versionList, setVersionList] = useState<ReportVersionView[]>([])
  const [message, setMessage] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [compiling, setCompiling] = useState(false)
  const [split, setSplit] = useState(50)
  const [showAllVersions, setShowAllVersions] = useState(false)
  const [listCollapsed, setListCollapsed] = useState(false)
  const [previewModalOpen, setPreviewModalOpen] = useState(false)

  const editorRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef('')
  const selectedRef = useRef<string | undefined>(undefined)
  const autosaveRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const reload = useCallback(async (): Promise<void> => {
    setReports(await listReports())
  }, [listReports])

  useEffect(() => {
    let active = true
    void (async () => {
      const listed = await listReports()
      if (active) setReports(listed)
    })()
    return () => { active = false }
  }, [listReports])

  const compileSelected = useCallback(async (): Promise<void> => {
    const id = selectedRef.current
    if (id === undefined) return
    setCompiling(true)
    try {
      setCompileResult(await compile(id))
      setVersionList(await versions(id))
    } finally {
      setCompiling(false)
    }
  }, [compile, versions])

  autosaveRef.current = async (): Promise<void> => {
    const id = selectedRef.current
    if (id === undefined) return
    await updateSource(id, sourceRef.current)
    setMessage(t('saved'))
    await compileSelected()
  }

  const scheduleAutosave = useCallback((): void => {
    if (autosaveTimer.current !== undefined) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(() => { void autosaveRef.current() }, AUTOSAVE_DELAY_MS)
  }, [])

  useEffect(() => () => {
    if (autosaveTimer.current !== undefined) clearTimeout(autosaveTimer.current)
  }, [])

  const select = useCallback(async (reportId: string): Promise<void> => {
    if (autosaveTimer.current !== undefined) clearTimeout(autosaveTimer.current)
    selectedRef.current = reportId
    setSelected(reportId)
    const loaded = await getSource(reportId)
    sourceRef.current = loaded
    setSource(loaded)
    setVersionList(await versions(reportId))
    setCompileResult(undefined)
    setMessage('')
  }, [getSource, versions])

  const onCreate = useCallback(async (): Promise<void> => {
    const title = newTitle.trim()
    if (title.length === 0) return
    await createReport(title)
    setNewTitle('')
    await reload()
    const listed = await listReports()
    const created = listed[0]
    if (created !== undefined) await select(created.reportId)
  }, [newTitle, createReport, reload, listReports, select])

  const onSourceEdit = useCallback((value: string): void => {
    sourceRef.current = value
    setSource(value)
    scheduleAutosave()
  }, [scheduleAutosave])

  const onCompile = useCallback((): void => {
    void compileSelected()
  }, [compileSelected])

  const onRestore = useCallback(async (versionId: string): Promise<void> => {
    if (autosaveTimer.current !== undefined) clearTimeout(autosaveTimer.current)
    const id = selectedRef.current
    if (id === undefined) return
    const restored = await restore(id, versionId)
    sourceRef.current = restored
    setSource(restored)
    setMessage(t('restored'))
    await compileSelected()
  }, [restore, compileSelected, t])

  const onDividerPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    const container = editorRef.current
    if (container === null) return
    const rect = container.getBoundingClientRect()
    const startX = event.clientX
    const startSplit = split
    const onMove = (move: PointerEvent): void => {
      const delta = ((move.clientX - startX) / rect.width) * 100
      setSplit(Math.min(80, Math.max(20, Math.round(startSplit + delta))))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [split])

  const pdfUrl = compileResult?.pdfUrl

  return (
    <div className={css.writing} style={{ gridTemplateColumns: `${listCollapsed ? '34px' : '220px'} 1fr` }}>
      <nav className={css.list}>
        {listCollapsed
          ? <button className={css.listExpander} title={t('listExpand')} onClick={() => setListCollapsed(false)}>{t('title')}</button>
          : (
            <>
              <div className={css.listHeader}>
                <h2 className={css.heading}>{t('title')}</h2>
                <button className={css.listToggle} title={t('listCollapse')} onClick={() => setListCollapsed(true)}>−</button>
              </div>
              <div className={css.newRow}>
                <input
                  className={css.newInput}
                  value={newTitle}
                  onChange={event => setNewTitle(event.target.value)}
                  placeholder={t('newPlaceholder')}
                />
                <button className={css.button} onClick={() => { void onCreate() }}>{t('create')}</button>
              </div>
              <ul className={css.reports}>
                {reports.map(report => (
                  <li
                    key={report.reportId}
                    className={report.reportId === selected ? css.rowActive : css.row}
                    onClick={() => { void select(report.reportId) }}
                  >
                    {report.title}
                  </li>
                ))}
              </ul>
            </>
          )}
      </nav>
      <main ref={editorRef} className={css.editor} style={{ gridTemplateColumns: `${split}% 6px 1fr` }}>
        <textarea
          className={css.source}
          value={source}
          onChange={event => onSourceEdit(event.target.value)}
          spellCheck={false}
        />
        <div className={css.divider} onPointerDown={onDividerPointerDown} />
        <div className={css.preview}>
          {compiling
            ? <div className={css.none}>{t('compiling')}</div>
            : pdfUrl === undefined
              ? <div className={css.none}>{t('noPreview')}</div>
              : <iframe className={css.frame} src={pdfUrl} title={t('preview')} />}
        </div>
      </main>
      <footer className={css.footer}>
        <div className={css.actions}>
          <button className={css.button} onClick={() => { void onCompile() }}>{t('compile')}</button>
          <button className={css.button} onClick={() => setPreviewModalOpen(true)}>{t('openPreview')}</button>
        </div>
        {message.length > 0 && <span className={css.status}>{message}</span>}
        {compileResult !== undefined && !compileResult.ok && compileResult.diagnostics.some(d => d.severity === 'error') && (
          <div className={css.diagnostics}>
            {compileResult.diagnostics
              .filter(diagnostic => diagnostic.severity === 'error')
              .map((diagnostic, index) => (
                // eslint-disable-next-line react/no-array-index-key -- stable position in one compile result
                <p key={index} className={css.error}>
                  {diagnostic.line === undefined ? '' : `@ ${diagnostic.line} `}: {diagnostic.message}
                </p>
              ))}
          </div>
        )}
        {compileResult !== undefined && compileResult.ok && <p className={css.ok}>{t('compiledOk')}</p>}
        {versionList.length > 0 && (
          <div className={css.versions}>
            <button
              className={css.versionLatest}
              onClick={() => setShowAllVersions(visible => !visible)}
            >
              {t('versions')}: {versionList[0]?.label ?? ''}
              {versionList.length > 1 ? ` (${t('more')} ${versionList.length - 1})` : ''}
            </button>
            {showAllVersions && (
              <ul className={css.versionList}>
                {versionList.map(version => (
                  <li key={version.versionId}>
                    <button className={css.versionButton} onClick={() => { void onRestore(version.versionId) }}>
                      {version.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </footer>
      {previewModalOpen && (
        <div className={css.modalBackdrop} onClick={() => setPreviewModalOpen(false)}>
          <div className={css.modal} onClick={event => event.stopPropagation()}>
            <div className={css.modalHeader}>
              <h3 className={css.modalTitle}>{t('previewWindowTitle')}</h3>
              <button className={css.modalClose} title={t('close')} onClick={() => setPreviewModalOpen(false)}>×</button>
            </div>
            <div className={css.modalBody}>
              {compiling
                ? <div className={css.none}>{t('compiling')}</div>
                : pdfUrl === undefined
                  ? <div className={css.none}>{t('noPreview')}</div>
                  : <iframe className={css.frame} src={pdfUrl} title={t('preview')} />}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
