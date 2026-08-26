/**
 * The full-page Library view rendered in `shell.overlay`: notebook column,
 * source list with upload/paste intake, and a preview/ask panel. All state is
 * view-local; durable facts arrive through the inject face per render.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AskView, LibraryViewFace, NotebookView, ResourceView } from './types.ts'
import type { NS } from './locales.ts'
import css from './library.module.css'

/** Full view props composed by the shell.overlay slot. */
export type LibraryViewProps =
  PropsRuntime<'shell.overlay'> & InjectFace<LibraryViewFace> & PropsLocale<typeof NS>

/** Render the Library page when the shared page state is open. */
export function LibraryView(props: LibraryViewProps) {
  const pageState = props.usePageState(state => state)
  if (!pageState.open) return null
  return <LibraryPage {...props} notebookId={pageState.notebookId} />
}

/** The open page body; mounted only while the page state is open. */
function LibraryPage({
  notebookId, useRevision, onClose, onSelectNotebook,
  listNotebooks, createNotebook, renameNotebook, deleteNotebook,
  listResources, deleteResource, ingestText, uploadFile, readMarkdown, ask, fileUrl, t,
}: LibraryViewProps & { notebookId: string | undefined }) {
  const revision = useRevision(value => value)
  const [notebooks, setNotebooks] = useState<readonly NotebookView[]>([])
  const [resources, setResources] = useState<readonly ResourceView[]>([])
  const [selectedResource, setSelectedResource] = useState<string | undefined>(undefined)
  const [tab, setTab] = useState<'preview' | 'ask'>('preview')
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)

  const fail = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause))
  }, [])

  useEffect(() => {
    void listNotebooks().then(setNotebooks).catch(fail)
  }, [listNotebooks, fail, revision])

  useEffect(() => {
    if (notebookId === undefined) { setResources([]); return }
    void listResources(notebookId).then((rows) => {
      setResources(rows)
      setSelectedResource(current => rows.some(row => row.resourceId === current) ? current : rows[0]?.resourceId)
    }).catch(fail)
  }, [listResources, notebookId, fail, revision])

  const fileInput = useRef<HTMLInputElement>(null)
  const intakeFiles = useCallback(async (files: readonly File[]) => {
    if (notebookId === undefined || files.length === 0) return
    setBusy(true)
    setError(undefined)
    try {
      for (const file of files) await uploadFile(notebookId, file)
    } catch (cause) {
      fail(cause)
    } finally {
      setBusy(false)
    }
  }, [notebookId, uploadFile, fail])

  const selected = resources.find(row => row.resourceId === selectedResource)

  return (
    <div className={css.overlay}>
      <div className={css.page}>
        <div className={css.pageHeader}>
          <span className={css.pageTitle}>{t('view.title')}</span>
          {error !== undefined && <span className={css.pageError}>{t('view.error', { message: error })}</span>}
          <button type="button" className={css.closeButton} aria-label={t('view.close')} onClick={onClose}>✕</button>
        </div>
        <div className={css.pageBody}>

          <div className={css.notebookColumn}>
            <div className={css.columnHeader}>
              <span>{t('view.notebooks')}</span>
              <button
                type="button"
                className={css.smallButton}
                onClick={() => {
                  const title = window.prompt(t('view.notebook.name'))
                  if (title === null || title.trim() === '') return
                  void createNotebook(title.trim()).then((notebook) => { onSelectNotebook(notebook.notebookId) }).catch(fail)
                }}
              >
                {t('view.notebook.new')}
              </button>
            </div>
            {notebooks.map(notebook => (
              <div
                key={notebook.notebookId}
                className={notebook.notebookId === notebookId ? `${css.notebookRow} ${css.notebookRowActive}` : css.notebookRow}
              >
                <button type="button" className={css.notebookOpen} onClick={() => { onSelectNotebook(notebook.notebookId) }}>
                  <span className={css.notebookTitle}>{notebook.title}</span>
                  <span className={css.notebookCount}>{notebook.resourceCount}</span>
                </button>
                <span className={css.rowActions}>
                  <button
                    type="button"
                    className={css.iconButton}
                    title={t('view.notebook.rename')}
                    onClick={() => {
                      const title = window.prompt(t('view.notebook.name'), notebook.title)
                      if (title === null || title.trim() === '') return
                      void renameNotebook(notebook.notebookId, title.trim()).catch(fail)
                    }}
                  >✎</button>
                  <button
                    type="button"
                    className={css.iconButton}
                    title={t('view.notebook.delete')}
                    onClick={() => {
                      if (!window.confirm(t('view.notebook.deleteConfirm'))) return
                      void deleteNotebook(notebook.notebookId).catch(fail)
                    }}
                  >🗑</button>
                </span>
              </div>
            ))}
          </div>

          <div className={css.resourceColumn}>
            <div className={css.columnHeader}>
              <span>{t('view.resources.title')}</span>
              <span className={css.rowActions}>
                <button
                  type="button"
                  className={css.smallButton}
                  disabled={notebookId === undefined || busy}
                  onClick={() => fileInput.current?.click()}
                >
                  {busy ? t('view.uploading') : t('view.upload')}
                </button>
                <button
                  type="button"
                  className={css.smallButton}
                  disabled={notebookId === undefined || busy}
                  onClick={() => { setPasteOpen(true) }}
                >
                  {t('view.paste')}
                </button>
              </span>
              <input
                ref={fileInput}
                type="file"
                multiple
                className={css.hiddenInput}
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])]
                  event.target.value = ''
                  void intakeFiles(files)
                }}
              />
            </div>
            {notebookId === undefined
              ? <div className={css.columnEmpty}>{t('view.resources.select')}</div>
              : resources.length === 0
                ? <div className={css.columnEmpty}>{t('view.resources.empty')}</div>
                : resources.map(resource => (
                  <div
                    key={resource.resourceId}
                    className={resource.resourceId === selectedResource ? `${css.resourceRow} ${css.resourceRowActive}` : css.resourceRow}
                  >
                    <button
                      type="button"
                      className={css.resourceOpen}
                      onClick={() => { setSelectedResource(resource.resourceId); setTab('preview') }}
                    >
                      <span className={css.resourceName}>{resource.name}</span>
                      <span className={css.resourceMeta}>
                        <span className={css.kindTag}>{kindLabel(resource.kind, t)}</span>
                        <span className={resource.status === 'error' ? css.statusError : css.statusOk}>
                          {statusLabel(resource.status, t)}
                        </span>
                      </span>
                    </button>
                    <span className={css.rowActions}>
                      <a className={css.iconButton} title={t('view.download')} href={fileUrl(resource.resourceId, 'download')}>⭳</a>
                      <button
                        type="button"
                        className={css.iconButton}
                        title={t('view.resource.delete')}
                        onClick={() => {
                          if (!window.confirm(t('view.resource.deleteConfirm'))) return
                          void deleteResource(resource.resourceId).catch(fail)
                        }}
                      >🗑</button>
                    </span>
                  </div>
                ))}
          </div>

          <div className={css.previewColumn}>
            <div className={css.columnHeader}>
              <span className={css.tabs}>
                <button
                  type="button"
                  className={tab === 'preview' ? `${css.tab} ${css.tabActive}` : css.tab}
                  onClick={() => { setTab('preview') }}
                >
                  {t('view.tab.preview')}
                </button>
                <button
                  type="button"
                  className={tab === 'ask' ? `${css.tab} ${css.tabActive}` : css.tab}
                  onClick={() => { setTab('ask') }}
                >
                  {t('view.tab.ask')}
                </button>
              </span>
            </div>
            {/* Both panes stay mounted so the ask exchange survives tab
                switches; the notebook key resets the ask thread on switch. */}
            <div className={tab === 'preview' ? css.paneActive : css.paneHidden}>
              <ResourcePreview resource={selected} readMarkdown={readMarkdown} fileUrl={fileUrl} t={t} />
            </div>
            <div className={tab === 'ask' ? css.paneActive : css.paneHidden}>
              <AskPanel key={notebookId ?? ''} notebookId={notebookId} ask={ask} t={t} />
            </div>
          </div>

        </div>
      </div>

      {pasteOpen && notebookId !== undefined && (
        <PasteDialog
          onCancel={() => { setPasteOpen(false) }}
          onSubmit={(name, content) => {
            setPasteOpen(false)
            setBusy(true)
            void ingestText(notebookId, name, content)
              .catch(fail)
              .finally(() => { setBusy(false) })
          }}
          t={t}
        />
      )}
    </div>
  )
}

function kindLabel(kind: string, t: LibraryViewProps['t']): string {
  if (kind === 'result') return t('view.kind.result')
  if (kind === 'deliverable') return t('view.kind.deliverable')
  return t('view.kind.source')
}

function statusLabel(status: string, t: LibraryViewProps['t']): string {
  if (status === 'converting') return t('view.status.converting')
  if (status === 'error') return t('view.status.error')
  return t('view.status.ready')
}

/** Inline preview: PDF originals render in an iframe, everything else shows its Markdown twin. */
function ResourcePreview({ resource, readMarkdown, fileUrl, t }: {
  resource: ResourceView | undefined
  readMarkdown: LibraryViewFace['readMarkdown']
  fileUrl: LibraryViewFace['fileUrl']
  t: LibraryViewProps['t']
}) {
  const [markdown, setMarkdown] = useState<string | undefined>(undefined)
  const resourceId = resource?.resourceId
  const usable = resource !== undefined && resource.status === 'ready'
  const isPdf = resource?.mediaType === 'application/pdf'

  useEffect(() => {
    setMarkdown(undefined)
    if (resourceId === undefined || !usable || isPdf) return
    let cancelled = false
    void readMarkdown(resourceId)
      .then((content) => { if (!cancelled) setMarkdown(content) })
      .catch(() => { if (!cancelled) setMarkdown(undefined) })
    return () => { cancelled = true }
  }, [resourceId, usable, isPdf, readMarkdown])

  if (resource === undefined) return <div className={css.columnEmpty}>{t('view.preview.none')}</div>
  if (isPdf) {
    return <iframe className={css.pdfFrame} src={fileUrl(resource.resourceId, 'raw')} title={resource.name} />
  }
  if (!usable) {
    return (
      <div className={css.columnEmpty}>
        {t('view.preview.unavailable')}
        {resource.error !== undefined && <div className={css.statusError}>{resource.error}</div>}
      </div>
    )
  }
  return <pre className={css.markdown}>{markdown ?? ''}</pre>
}

/** One asked-and-answered exchange kept in the panel's thread. */
interface AskExchange {
  readonly question: string
  readonly result: AskView
}

/**
 * The grounded question panel. Exchanges accumulate newest-first for the
 * session of one notebook; the mount key on the panel resets the thread when
 * the notebook changes, and the always-mounted pane keeps it across tabs.
 */
function AskPanel({ notebookId, ask, t }: {
  notebookId: string | undefined
  ask: LibraryViewFace['ask']
  t: LibraryViewProps['t']
}) {
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [entries, setEntries] = useState<readonly AskExchange[]>([])
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const submit = () => {
    const asked = question.trim()
    if (notebookId === undefined || asked === '' || busy) return
    setBusy(true)
    setFailure(undefined)
    void ask(notebookId, asked)
      .then((result) => {
        setEntries(current => [{ question: asked, result }, ...current])
        setQuestion('')
      })
      .catch((cause: unknown) => { setFailure(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { setBusy(false) })
  }

  return (
    <div className={css.askPanel}>
      <div className={css.askInputRow}>
        <textarea
          className={css.askInput}
          placeholder={t('view.ask.placeholder')}
          value={question}
          rows={2}
          onChange={(event) => { setQuestion(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() }
          }}
        />
        <button type="button" className={css.smallButton} disabled={busy || notebookId === undefined} onClick={submit}>
          {busy ? t('view.ask.thinking') : t('view.ask.submit')}
        </button>
      </div>
      <div className={css.askAnswer}>
        {failure !== undefined && <div className={css.statusError}>{failure}</div>}
        {busy && <div className={css.columnEmpty}>{t('view.ask.thinking')}</div>}
        {entries.length === 0 && failure === undefined && !busy && (
          <div className={css.columnEmpty}>{t('view.ask.empty')}</div>
        )}
        {entries.map((entry, entryIndex) => (
          <div key={`${String(entries.length - entryIndex)}-${entry.question}`} className={css.askEntry}>
            <div className={css.askQuestion}>{entry.question}</div>
            <pre className={css.markdown}>{entry.result.answer}</pre>
            {entry.result.sources.length > 0 && (
              <div className={css.askSources}>
                <span className={css.askSourcesTitle}>{t('view.ask.sources')}</span>
                {entry.result.sources.map((source, index) => (
                  <span key={`${source.resourceId}-${String(index)}`} className={css.kindTag}>
                    {source.name}{source.heading === '' ? '' : ` · ${source.heading}`}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Paste-text intake dialog (the NotebookLM paste-source flow). */
function PasteDialog({ onCancel, onSubmit, t }: {
  onCancel: () => void
  onSubmit: (name: string, content: string) => void
  t: LibraryViewProps['t']
}) {
  const [name, setName] = useState('pasted-text.md')
  const [content, setContent] = useState('')
  return (
    <div className={css.dialogBackdrop}>
      <div className={css.dialog}>
        <input
          className={css.dialogName}
          value={name}
          placeholder={t('view.paste.name')}
          onChange={(event) => { setName(event.target.value) }}
        />
        <textarea
          className={css.dialogContent}
          value={content}
          placeholder={t('view.paste.content')}
          onChange={(event) => { setContent(event.target.value) }}
        />
        <div className={css.dialogActions}>
          <button type="button" className={css.smallButton} onClick={onCancel}>{t('view.paste.cancel')}</button>
          <button
            type="button"
            className={css.smallButton}
            disabled={name.trim() === '' || content.trim() === ''}
            onClick={() => { onSubmit(name.trim(), content) }}
          >
            {t('view.paste.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}
