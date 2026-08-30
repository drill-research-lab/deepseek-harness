/** Writing view: report list (left), LaTeX editor + PDF preview (right), compile feedback (bottom). */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CompileResultView, ReportVersionView } from '@deepseek-ai/dsh-writing-api/types'
import { SourceEditor } from './SourceEditor.tsx'
import { buildOutline, jumpToLine } from './outline.ts'
import type { ReportSummaryView, WritingViewInjected } from './types.ts'
import css from './writing.module.css'

/** Props of the Writing view: the conversation.view runtime + the inject face + locale. */
export type WritingViewProps = ConvViewProps & WritingViewInjected & PropsLocale<'writing'>

/** Pause (ms) before an edit is auto-saved and recompiled. */
const AUTOSAVE_DELAY_MS = 1000

/** Served prefix for a compiled report's PDF; matches the writing-api route. */
const PDF_PATH_PREFIX = '/writing'

/** The Writing surface. State is view-local; the report data comes from the inject face. */
export function WritingView(props: WritingViewProps): JSX.Element {
  const { listReports, createReport, rename, getSource, updateSource, compile, versions, restore, t } = props
  const [reports, setReports] = useState<ReportSummaryView[]>([])
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [selectedTitle, setSelectedTitle] = useState('')
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
  const [modalSplit, setModalSplit] = useState(50)
  const [showOutline, setShowOutline] = useState(false)

  const editorRef = useRef<HTMLDivElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const mainTextareaRef = useRef<HTMLTextAreaElement>(null)
  const modalTextareaRef = useRef<HTMLTextAreaElement>(null)
  const sourceRef = useRef('')
  const selectedRef = useRef<string | undefined>(undefined)
  const committedTitleRef = useRef('')
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

  const outline = useMemo(() => buildOutline(source), [source])

  const compileSelected = useCallback(async (noSnapshot = false): Promise<void> => {
    const id = selectedRef.current
    if (id === undefined) return
    setCompiling(true)
    try {
      setCompileResult(noSnapshot ? await compile(id, { snapshot: false }) : await compile(id))
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
    const summary = reports.find(report => report.reportId === reportId)
    setSelectedTitle(summary?.title ?? '')
    committedTitleRef.current = summary?.title ?? ''
    const loaded = await getSource(reportId)
    sourceRef.current = loaded
    setSource(loaded)
    const listed = await versions(reportId)
    setVersionList(listed)
    setMessage('')
    // Show the latest compiled version when one exists; compile only for a
    // report that has never compiled.
    if (listed.length > 0) {
      setCompileResult({ ok: true, diagnostics: [], versionCreated: false, pdfUrl: `${PDF_PATH_PREFIX}/${reportId}/pdf` })
    } else {
      setCompileResult(undefined)
      await compileSelected()
    }
  }, [getSource, versions, reports, compileSelected])

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

  const onSave = useCallback(async (): Promise<void> => {
    if (autosaveTimer.current !== undefined) clearTimeout(autosaveTimer.current)
    const id = selectedRef.current
    if (id === undefined) return
    await updateSource(id, sourceRef.current)
    setMessage(t('saved'))
    await compileSelected()
  }, [updateSource, compileSelected, t])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void onSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onSave])

  const onDownload = useCallback((): void => {
    const name = (selectedTitle.trim() || 'report').replace(/[\\/:*?"<>|]/g, '_')
    const href = `data:text/plain;charset=utf-8,${encodeURIComponent(sourceRef.current)}`
    const link = document.createElement('a')
    link.href = href
    link.download = `${name}.tex`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }, [selectedTitle])

  const onRestore = useCallback(async (versionId: string): Promise<void> => {
    if (autosaveTimer.current !== undefined) clearTimeout(autosaveTimer.current)
    const id = selectedRef.current
    if (id === undefined) return
    const branch = window.prompt(t('branchPrompt'), `restore-${versionId.slice(0, 7)}`)
    if (branch === null || branch.trim().length === 0) return
    const restored = await restore(id, versionId, branch.trim())
    sourceRef.current = restored
    setSource(restored)
    setMessage(t('restored'))
    // Refresh the preview for the restored content without snapshotting a version.
    await compileSelected(true)
  }, [restore, compileSelected, t])

  const onTitleCommit = useCallback(async (): Promise<void> => {
    const id = selectedRef.current
    if (id === undefined) return
    const trimmed = selectedTitle.trim()
    if (trimmed.length === 0 || trimmed === committedTitleRef.current) return
    await rename(id, trimmed)
    setSelectedTitle(trimmed)
    committedTitleRef.current = trimmed
    await reload()
  }, [selectedTitle, rename, reload])

  const openPreview = useCallback((): void => {
    // Opening the window never recompiles: selection already resolved to the
    // latest compiled version, or compiled when the report had none.
    setPreviewModalOpen(true)
  }, [])

  const jumpOutline = useCallback((line: number): void => {
    const textarea = mainTextareaRef.current
    if (textarea !== null) jumpToLine(textarea, sourceRef.current, line)
  }, [])

  const beginSplitDrag = useCallback((
    event: React.PointerEvent<HTMLDivElement>,
    ref: React.RefObject<HTMLDivElement>,
    setter: (value: number) => void,
    current: number,
  ): void => {
    const container = ref.current
    if (container === null) return
    const rect = container.getBoundingClientRect()
    const startX = event.clientX
    const onMove = (move: PointerEvent): void => {
      const delta = ((move.clientX - startX) / rect.width) * 100
      setter(Math.min(80, Math.max(20, Math.round(current + delta))))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  const onDividerPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    beginSplitDrag(event, editorRef, setSplit, split)
  }, [beginSplitDrag, split])

  const onModalDividerPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>): void => {
    beginSplitDrag(event, modalRef, setModalSplit, modalSplit)
  }, [beginSplitDrag, modalSplit])

  const pdfUrl = compileResult?.pdfUrl
  const errorCount = compileResult !== undefined && !compileResult.ok
    ? compileResult.diagnostics.filter(diagnostic => diagnostic.severity === 'error').length
    : 0
  const headerStatus = compiling
    ? t('compiling')
    : compileResult?.ok === true
      ? t('compiledOk')
      : compileResult !== undefined && errorCount > 0
        ? `${errorCount} ${t('errorSummary')}`
        : t('noPreview')

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
              <div className={css.outlineSection}>
                <button className={css.outlineToggle} onClick={() => setShowOutline(visible => !visible)}>
                  {t('outline')}{outline.length > 0 ? ` (${outline.length})` : ''}
                </button>
                {showOutline && (
                  <ul className={css.outlineList}>
                    {outline.map(item => (
                      <li key={item.line} className={css.outlineRow}>
                        <button
                          className={css.outlineItem}
                          style={{ paddingLeft: `${item.depth * 12}px` }}
                          onClick={() => jumpOutline(item.line)}
                        >
                          {item.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
      </nav>
      <main ref={editorRef} className={css.editor} style={{ gridTemplateColumns: `${split}% 6px 1fr` }}>
        <SourceEditor value={source} onChange={onSourceEdit} textareaRef={mainTextareaRef} />
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
          <button className={css.button} onClick={() => { void onSave() }}>{t('save')}</button>
          <button className={css.button} onClick={() => { void onCompile() }}>{t('compile')}</button>
          <button className={css.button} onClick={openPreview}>{t('openPreview')}</button>
          <button className={css.button} onClick={onDownload}>{t('download')}</button>
        </div>
        {message.length > 0 && <span className={css.status}>{message}</span>}
        {compileResult !== undefined && !compileResult.ok && errorCount > 0 && (
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
        <div className={css.modal}>
          <div className={css.modalHeader}>
            <input
              className={css.modalTitleInput}
              value={selectedTitle}
              onChange={event => setSelectedTitle(event.target.value)}
              onBlur={() => { void onTitleCommit() }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void onTitleCommit()
                  event.currentTarget.blur()
                }
              }}
            />
            <button className={css.modalAction} onClick={() => { void onSave() }}>{t('save')}</button>
            <button className={css.modalAction} onClick={() => { void onCompile() }}>{t('compile')}</button>
            <button className={css.modalAction} onClick={onDownload}>{t('download')}</button>
            <span className={css.modalStatus}>{headerStatus}</span>
            <button className={css.modalClose} title={t('close')} onClick={() => setPreviewModalOpen(false)}>×</button>
          </div>
          <div
            ref={modalRef}
            className={css.modalEditor}
            style={{ gridTemplateColumns: `${modalSplit}% 6px 1fr` }}
          >
            <SourceEditor value={source} onChange={onSourceEdit} textareaRef={modalTextareaRef} />
            <div className={css.divider} onPointerDown={onModalDividerPointerDown} />
            <div className={css.preview}>
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
