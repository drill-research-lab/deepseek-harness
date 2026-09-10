/**
 * The full-page Library view rendered in `shell.overlay`, laid out like
 * NotebookLM's notebook page: a sources column with the add-source intake, a
 * persistent ask thread as the main area, and a collapsible preview panel
 * with separate Markdown/original modes. The shown notebook and the open
 * preview resource live in the shared page state (they double as the page's
 * `#library/…` address); everything else is view-local. Durable facts arrive
 * through the inject face per render.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button,
  IconBrowseOutline16,
  IconCloseOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconGlobeOutline14,
  IconListPenOutline16,
  IconPaperclipOutline16,
  IconPlusOutline16,
  IconSendOutline16,
  IconTrashOutline16,
  IconWarningOutline16,
  MarkdownText,
  Menu,
  Modal,
  Pill,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AskLogEntryView, LibraryViewFace, NotebookView, ResourceView } from './types.ts'
import type { NS } from './locales.ts'
import css from './library.module.css'

/** Full view props composed by the shell.overlay slot. */
export type LibraryViewProps =
  PropsRuntime<'shell.overlay'> & InjectFace<LibraryViewFace> & PropsLocale<typeof NS>

/** Render the Library page when the shared page state is open. */
export function LibraryView(props: LibraryViewProps) {
  const pageState = props.usePageState(state => state)
  if (!pageState.open) return null
  return <LibraryPage {...props} notebookId={pageState.notebookId} resourceId={pageState.resourceId} />
}

/** The open page body; mounted only while the page state is open. */
function LibraryPage(props: LibraryViewProps & { notebookId: string | undefined; resourceId: string | undefined }) {
  const {
    notebookId, resourceId, useRevision, useSidebarEdge, onClose, onOpenResource,
    createNotebook, renameNotebook, deleteNotebook,
    listNotebooks, listResources, deleteResource, ingestText, uploadFile, t,
  } = props
  const revision = useRevision(value => value)
  // Start beside the sidebar (measured by the section) instead of covering it.
  const sidebarEdge = useSidebarEdge(value => value)
  const [notebooks, setNotebooks] = useState<readonly NotebookView[]>([])
  const [resources, setResources] = useState<readonly ResourceView[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [notebookDialog, setNotebookDialog] = useState<'rename' | 'delete' | 'create' | undefined>(undefined)
  const [resourceToDelete, setResourceToDelete] = useState<ResourceView | undefined>(undefined)

  const fail = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : String(cause))
  }, [])

  useEffect(() => {
    void listNotebooks().then(setNotebooks).catch(fail)
  }, [listNotebooks, fail, revision])

  useEffect(() => {
    if (notebookId === undefined) { setResources([]); return }
    void listResources(notebookId).then(setResources).catch(fail)
  }, [listResources, notebookId, fail, revision])

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

  const notebook = notebooks.find(entry => entry.notebookId === notebookId)
  const selected = resources.find(entry => entry.resourceId === resourceId)

  return (
    <div className={css.overlay} style={{ left: sidebarEdge }}>
      <div className={css.page}>

        <div className={css.pageHeader}>
          {notebook !== undefined && (
            <>
              <span className={css.pageTitle}>{notebook.title}</span>
              <span className={css.pageMeta}>{t('view.notebook.count', { count: resources.length })}</span>
              <NotebookMenu t={t} onPick={(action) => { setNotebookDialog(action) }} />
            </>
          )}
          {error !== undefined && <span className={css.pageError}>{t('view.error', { message: error })}</span>}
          <button type="button" className={css.closeButton} aria-label={t('view.close')} onClick={onClose}>
            <IconCloseOutline16 size={16} />
          </button>
        </div>

        {notebook === undefined
          ? (
            <div className={css.pickHero}>
              <div className={css.askEmptyTitle}>{t('view.pick.title')}</div>
              <div className={css.columnEmpty}>{t('view.pick.hint')}</div>
              <Button variant="primary" icon={<IconPlusOutline16 size={16} />} onClick={() => { setNotebookDialog('create') }}>
                {t('view.pick.new')}
              </Button>
            </div>
          )
          : (
            <div className={css.pageBody}>
              <SourcesColumn
                t={t}
                resources={resources}
                busy={busy}
                activeResourceId={resourceId}
                onAdd={() => { setAddOpen(true) }}
                onOpen={(resource) => { onOpenResource(resource.resourceId) }}
                onDelete={(resource) => { setResourceToDelete(resource) }}
                onDropFiles={(files) => { void intakeFiles(files) }}
                fileUrl={props.fileUrl}
              />
              <AskPanel
                key={notebook.notebookId}
                notebookId={notebook.notebookId}
                ask={props.ask}
                askLog={props.askLog}
                resources={resources}
                onOpenResource={onOpenResource}
                t={t}
              />
              {resourceId !== undefined && (
                <PreviewPanel
                  resource={selected}
                  readMarkdown={props.readMarkdown}
                  fileUrl={props.fileUrl}
                  onClose={() => { onOpenResource(undefined) }}
                  t={t}
                />
              )}
            </div>
          )}
      </div>

      {addOpen && notebookId !== undefined && (
        <AddSourceModal
          t={t}
          busy={busy}
          onClose={() => { setAddOpen(false) }}
          onFiles={(files) => { setAddOpen(false); void intakeFiles(files) }}
          onPaste={(name, content) => {
            setAddOpen(false)
            setBusy(true)
            void ingestText(notebookId, name, content)
              .catch(fail)
              .finally(() => { setBusy(false) })
          }}
        />
      )}

      <NotebookNameModal
        open={notebookDialog === 'create'}
        title={t('view.pick.new')}
        initial=""
        t={t}
        onClose={() => { setNotebookDialog(undefined) }}
        onSubmit={(title) => {
          setNotebookDialog(undefined)
          void createNotebook(title).then((created) => { props.onSelectNotebook(created.notebookId) }).catch(fail)
        }}
      />
      {notebook !== undefined && (
        <>
          <NotebookNameModal
            open={notebookDialog === 'rename'}
            title={t('view.notebook.rename.title')}
            initial={notebook.title}
            t={t}
            onClose={() => { setNotebookDialog(undefined) }}
            onSubmit={(title) => {
              setNotebookDialog(undefined)
              void renameNotebook(notebook.notebookId, title).catch(fail)
            }}
          />
          <ConfirmModal
            open={notebookDialog === 'delete'}
            title={t('view.notebook.delete.title')}
            message={t('view.notebook.deleteConfirm', { title: notebook.title })}
            confirmLabel={t('view.dialog.delete')}
            t={t}
            onClose={() => { setNotebookDialog(undefined) }}
            onConfirm={() => {
              setNotebookDialog(undefined)
              void deleteNotebook(notebook.notebookId).catch(fail)
            }}
          />
        </>
      )}
      <ConfirmModal
        open={resourceToDelete !== undefined}
        title={t('view.resource.delete.title')}
        message={resourceToDelete === undefined ? '' : t('view.resource.deleteConfirm', { name: resourceToDelete.name })}
        confirmLabel={t('view.dialog.delete')}
        t={t}
        onClose={() => { setResourceToDelete(undefined) }}
        onConfirm={() => {
          const target = resourceToDelete
          setResourceToDelete(undefined)
          if (target === undefined) return
          if (target.resourceId === resourceId) onOpenResource(undefined)
          void deleteResource(target.resourceId).catch(fail)
        }}
      />
    </div>
  )
}

/** The notebook actions menu (rename/delete) behind the header ellipsis. */
function NotebookMenu({ t, onPick }: {
  t: LibraryViewProps['t']
  onPick: (action: 'rename' | 'delete') => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      anchor={(
        <button
          type="button"
          className={css.closeButton}
          aria-label={t('view.notebook.actions')}
          onClick={() => { setOpen(current => !current) }}
        >
          <IconEllipsisOutline16 size={16} />
        </button>
      )}
      items={[
        { id: 'rename', label: t('view.notebook.rename'), icon: <IconEditOutline16 size={16} /> },
        { id: 'delete', label: t('view.notebook.delete'), icon: <IconTrashOutline16 size={16} />, danger: true },
      ]}
      onSelect={(id) => {
        setOpen(false)
        if (id === 'rename' || id === 'delete') onPick(id)
      }}
      dense
    />
  )
}

/** Leading type glyph of one source row, keyed off the sniffed media type. */
function resourceIcon(mediaType: string): ReactNode {
  if (mediaType === 'application/pdf') return <IconBrowseOutline16 size={16} />
  if (mediaType === 'text/html') return <IconGlobeOutline14 size={14} />
  if (mediaType.startsWith('image/')) return <IconPaperclipOutline16 size={16} />
  return <IconListPenOutline16 size={16} />
}

/** Compact byte size for the source row meta line. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** The sources column: add intake, drag-drop upload, and the source rows. */
function SourcesColumn({ t, resources, busy, activeResourceId, onAdd, onOpen, onDelete, onDropFiles, fileUrl }: {
  t: LibraryViewProps['t']
  resources: readonly ResourceView[]
  busy: boolean
  activeResourceId: string | undefined
  onAdd: () => void
  onOpen: (resource: ResourceView) => void
  onDelete: (resource: ResourceView) => void
  onDropFiles: (files: readonly File[]) => void
  fileUrl: LibraryViewFace['fileUrl']
}) {
  const [dragging, setDragging] = useState(false)
  return (
    <div
      className={dragging ? `${css.sourcesColumn} ${css.sourcesDragging}` : css.sourcesColumn}
      onDragOver={(event) => {
        if (![...event.dataTransfer.types].includes('Files')) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => { setDragging(false) }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        onDropFiles([...event.dataTransfer.files])
      }}
    >
      <div className={css.columnHeader}>
        <span>{t('view.sources.title')}</span>
        <Button size="sm" variant="outline" icon={<IconPlusOutline16 size={16} />} disabled={busy} onClick={onAdd}>
          {t('view.sources.add')}
        </Button>
      </div>
      {busy && <div className={css.columnEmpty}>{t('view.uploading')}</div>}
      {dragging && <div className={css.dropHint}>{t('view.sources.drop')}</div>}
      {resources.length === 0 && !busy && !dragging
        ? <div className={css.columnEmpty}>{t('view.sources.empty')}</div>
        : resources.map(resource => (
          <div
            key={resource.resourceId}
            className={resource.resourceId === activeResourceId ? `${css.resourceRow} ${css.resourceRowActive}` : css.resourceRow}
          >
            <button type="button" className={css.resourceOpen} onClick={() => { onOpen(resource) }}>
              <span className={css.resourceIcon}>{resourceIcon(resource.mediaType)}</span>
              <span className={css.resourceText}>
                <span className={css.resourceName}>{resource.name}</span>
                <span className={css.resourceMeta}>
                  {resource.status === 'converting'
                    ? <span className={css.statusOk}>{t('view.status.converting')}</span>
                    : resource.status === 'error'
                      ? (
                        <Tooltip label={resource.error ?? t('view.status.error')}>
                          <span className={css.statusError}>
                            <IconWarningOutline16 size={12} /> {t('view.status.error')}
                          </span>
                        </Tooltip>
                      )
                      : <span className={css.statusOk}>{formatBytes(resource.bytes)} · {resource.createdAt.slice(0, 10)}</span>}
                  {resource.kind !== 'source' && (
                    <span className={css.kindTag}>
                      {resource.kind === 'result' ? t('view.kind.result') : t('view.kind.deliverable')}
                    </span>
                  )}
                </span>
              </span>
            </button>
            <span className={css.rowActions}>
              <a
                className={css.iconButton}
                title={t('view.download')}
                aria-label={t('view.download')}
                href={fileUrl(resource.resourceId, 'download')}
              >
                <IconDownloadOutline16 size={14} />
              </a>
              <button
                type="button"
                className={css.iconButton}
                title={t('view.resource.delete')}
                aria-label={t('view.resource.delete')}
                onClick={() => { onDelete(resource) }}
              >
                <IconTrashOutline16 size={14} />
              </button>
            </span>
          </div>
        ))}
    </div>
  )
}

/**
 * The grounded ask thread, shaped like the native chat and persistent: the
 * durable ask log renders top-down (agent-asked exchanges included, tagged),
 * the composer sits at the bottom, and citations open the preview panel. The
 * mount key resets in-flight state when the notebook changes.
 */
function AskPanel({ notebookId, ask, askLog, resources, onOpenResource, t }: {
  notebookId: string
  ask: LibraryViewFace['ask']
  askLog: LibraryViewFace['askLog']
  resources: readonly ResourceView[]
  onOpenResource: (resourceId: string) => void
  t: LibraryViewProps['t']
}) {
  const [question, setQuestion] = useState('')
  const [pending, setPending] = useState<string | undefined>(undefined)
  const [entries, setEntries] = useState<readonly AskLogEntryView[]>([])
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const thread = useRef<HTMLDivElement>(null)

  const refresh = useCallback(() => {
    void askLog(notebookId).then(setEntries).catch(() => { setEntries([]) })
  }, [askLog, notebookId])
  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    const element = thread.current
    if (element) element.scrollTop = element.scrollHeight
  }, [entries.length, pending])

  const submitQuestion = (asked: string) => {
    if (asked === '' || pending !== undefined) return
    setPending(asked)
    setFailure(undefined)
    void ask(notebookId, asked)
      .then(() => { setQuestion(''); refresh() })
      .catch((cause: unknown) => { setFailure(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { setPending(undefined) })
  }
  const submit = () => { submitQuestion(question.trim()) }

  return (
    <div className={css.askColumn}>
      <div className={css.askPanel}>
        <div ref={thread} className={css.askThread}>
          {entries.length === 0 && pending === undefined && failure === undefined && (
            <div className={css.askEmpty}>
              <div className={css.askEmptyTitle}>{t('view.ask.emptyTitle')}</div>
              <div className={css.columnEmpty}>{t('view.ask.empty')}</div>
              <div className={css.askExamples}>
                {(['view.ask.example1', 'view.ask.example2', 'view.ask.example3'] as const).map(key => (
                  <button key={key} type="button" className={css.askExample} onClick={() => { submitQuestion(t(key)) }}>
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {entries.map(entry => (
            <div key={entry.id} className={css.askEntry}>
              <div className={css.askQuestionRow}>
                {entry.origin === 'agent' && <span className={css.kindTag}>{t('view.ask.agent')}</span>}
                <span className={css.askQuestion}>{entry.question}</span>
              </div>
              <div className={css.askAnswer}>
                <MarkdownText text={entry.answer} />
              </div>
              {entry.sources.length > 0 && (
                <div className={css.askSources}>
                  <span className={css.askSourcesTitle}>{t('view.ask.sources')}</span>
                  {dedupeSources(entry.sources).map(source => (
                    <Pill
                      key={source.resourceId}
                      disabled={!resources.some(resource => resource.resourceId === source.resourceId)}
                      onClick={() => { onOpenResource(source.resourceId) }}
                    >
                      {source.name}
                    </Pill>
                  ))}
                </div>
              )}
            </div>
          ))}
          {pending !== undefined && (
            <div className={css.askEntry}>
              <div className={css.askQuestionRow}><span className={css.askQuestion}>{pending}</span></div>
              <div className={css.columnEmpty}>{t('view.ask.thinking')}</div>
            </div>
          )}
          {failure !== undefined && <div className={css.statusError}>{failure}</div>}
        </div>
        <div className={css.askComposer}>
          <textarea
            className={css.askInput}
            placeholder={t('view.ask.placeholder')}
            value={question}
            rows={1}
            onChange={(event) => { setQuestion(event.target.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() }
            }}
          />
          <button
            type="button"
            className={css.askSend}
            aria-label={t('view.ask.submit')}
            disabled={pending !== undefined || question.trim() === ''}
            onClick={submit}
          >
            <IconSendOutline16 size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

/** Collapse one exchange's excerpt-level sources to one pill per resource. */
function dedupeSources(sources: AskLogEntryView['sources']): AskLogEntryView['sources'] {
  const seen = new Set<string>()
  return sources.filter((source) => {
    if (seen.has(source.resourceId)) return false
    seen.add(source.resourceId)
    return true
  })
}

/** Media types the browser can render inline from the raw original. */
function originalPreviewable(mediaType: string): boolean {
  return mediaType === 'application/pdf'
    || mediaType.startsWith('text/')
    || mediaType.startsWith('image/')
}

/**
 * The preview panel: one resource with separate Markdown and original modes.
 * A PDF opens on its original (the PDF viewer); everything else opens on its
 * converted Markdown, rendered rather than dumped as plain text.
 */
function PreviewPanel({ resource, readMarkdown, fileUrl, onClose, t }: {
  resource: ResourceView | undefined
  readMarkdown: LibraryViewFace['readMarkdown']
  fileUrl: LibraryViewFace['fileUrl']
  onClose: () => void
  t: LibraryViewProps['t']
}) {
  const resourceId = resource?.resourceId
  const isPdf = resource?.mediaType === 'application/pdf'
  const markdownReady = resource !== undefined && resource.status === 'ready'
  const [mode, setMode] = useState<'markdown' | 'original'>(isPdf || !markdownReady ? 'original' : 'markdown')
  const [markdown, setMarkdown] = useState<string | undefined>(undefined)

  useEffect(() => {
    setMode(isPdf || !markdownReady ? 'original' : 'markdown')
  }, [resourceId, isPdf, markdownReady])

  useEffect(() => {
    setMarkdown(undefined)
    if (resourceId === undefined || !markdownReady || mode !== 'markdown') return
    let cancelled = false
    void readMarkdown(resourceId)
      .then((content) => { if (!cancelled) setMarkdown(content) })
      .catch(() => { if (!cancelled) setMarkdown(undefined) })
    return () => { cancelled = true }
  }, [resourceId, markdownReady, mode, readMarkdown])

  if (resource === undefined) {
    return (
      <div className={css.previewPanel}>
        <div className={css.columnHeader}>
          <span />
          <button type="button" className={css.iconButton} aria-label={t('view.preview.close')} onClick={onClose}>
            <IconCloseOutline16 size={14} />
          </button>
        </div>
        <div className={css.columnEmpty}>{t('view.preview.unavailable')}</div>
      </div>
    )
  }

  const canOriginal = originalPreviewable(resource.mediaType)
  return (
    <div className={css.previewPanel}>
      <div className={css.columnHeader}>
        <span className={css.previewName}>{resource.name}</span>
        <span className={css.rowActions}>
          {/* The separate preview modes: converted Markdown vs the stored original. */}
          {markdownReady && (
            <Pill active={mode === 'markdown'} onClick={() => { setMode('markdown') }}>
              {t('view.preview.markdown')}
            </Pill>
          )}
          {canOriginal && (
            <Pill active={mode === 'original'} onClick={() => { setMode('original') }}>
              {isPdf ? t('view.preview.pdf') : t('view.preview.original')}
            </Pill>
          )}
          <a
            className={css.iconButton}
            title={t('view.download')}
            aria-label={t('view.download')}
            href={fileUrl(resource.resourceId, 'download')}
          >
            <IconDownloadOutline16 size={14} />
          </a>
          <button type="button" className={css.iconButton} aria-label={t('view.preview.close')} onClick={onClose}>
            <IconCloseOutline16 size={14} />
          </button>
        </span>
      </div>
      {mode === 'original' && canOriginal
        ? <iframe className={css.pdfFrame} src={fileUrl(resource.resourceId, 'raw')} title={resource.name} />
        : markdownReady
          ? (
            <div className={css.markdownPane}>
              <MarkdownText text={markdown ?? ''} />
            </div>
          )
          : (
            <div className={css.columnEmpty}>
              {t('view.preview.unavailable')}
              {resource.error !== undefined && <div className={css.statusError}>{resource.error}</div>}
            </div>
          )}
    </div>
  )
}

/** The add-source intake: upload files or paste text, in one modal. */
function AddSourceModal({ t, busy, onClose, onFiles, onPaste }: {
  t: LibraryViewProps['t']
  busy: boolean
  onClose: () => void
  onFiles: (files: readonly File[]) => void
  onPaste: (name: string, content: string) => void
}) {
  const [tab, setTab] = useState<'upload' | 'paste'>('upload')
  const [name, setName] = useState('pasted-text.md')
  const [content, setContent] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  return (
    <Modal
      open
      onClose={onClose}
      closeLabel={t('view.dialog.cancel')}
      title={t('view.add.title')}
      footer={tab === 'paste'
        ? (
          <>
            <Button variant="outline" onClick={onClose}>{t('view.dialog.cancel')}</Button>
            <Button
              variant="primary"
              disabled={name.trim() === '' || content.trim() === '' || busy}
              onClick={() => { onPaste(name.trim(), content) }}
            >
              {t('view.add.paste.submit')}
            </Button>
          </>
        )
        : undefined}
    >
      <div className={css.addTabs}>
        <Pill active={tab === 'upload'} onClick={() => { setTab('upload') }}>{t('view.add.upload')}</Pill>
        <Pill active={tab === 'paste'} onClick={() => { setTab('paste') }}>{t('view.add.paste')}</Pill>
      </div>
      {tab === 'upload'
        ? (
          <div
            className={dragging ? `${css.dropZone} ${css.dropZoneActive}` : css.dropZone}
            onDragOver={(event) => {
              if (![...event.dataTransfer.types].includes('Files')) return
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => { setDragging(false) }}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              onFiles([...event.dataTransfer.files])
            }}
          >
            <div className={css.columnEmpty}>{t('view.add.upload.hint')}</div>
            <Button variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}>
              {t('view.add.upload.pick')}
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              className={css.hiddenInput}
              onChange={(event) => {
                const files = [...(event.target.files ?? [])]
                event.target.value = ''
                onFiles(files)
              }}
            />
          </div>
        )
        : (
          <div className={css.pasteForm}>
            <input
              className={css.dialogName}
              value={name}
              placeholder={t('view.add.paste.name')}
              aria-label={t('view.add.paste.name')}
              onChange={(event) => { setName(event.target.value) }}
            />
            <textarea
              className={css.dialogContent}
              value={content}
              placeholder={t('view.add.paste.content')}
              aria-label={t('view.add.paste.content')}
              onChange={(event) => { setContent(event.target.value) }}
            />
          </div>
        )}
    </Modal>
  )
}

/** Name prompt used by both notebook create and rename. */
function NotebookNameModal({ open, title, initial, t, onClose, onSubmit }: {
  open: boolean
  title: string
  initial: string
  t: LibraryViewProps['t']
  onClose: () => void
  onSubmit: (title: string) => void
}) {
  const [draft, setDraft] = useState(initial)
  useEffect(() => { if (open) setDraft(initial) }, [open, initial])
  const blocked = draft.trim() === ''
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t('view.dialog.cancel')}
      title={title}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('view.dialog.cancel')}</Button>
          <Button variant="primary" disabled={blocked} onClick={() => { onSubmit(draft.trim()) }}>
            {t('view.dialog.confirm')}
          </Button>
        </>
      )}
    >
      <input
        className={css.dialogName}
        value={draft}
        aria-label={t('view.notebook.name')}
        autoFocus
        onFocus={(event) => { event.target.select() }}
        onChange={(event) => { setDraft(event.target.value) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !blocked) { event.preventDefault(); onSubmit(draft.trim()) }
        }}
      />
    </Modal>
  )
}

/** Destructive confirmation dialog shared by notebook and resource deletion. */
function ConfirmModal({ open, title, message, confirmLabel, t, onClose, onConfirm }: {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  t: LibraryViewProps['t']
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      closeLabel={t('view.dialog.cancel')}
      title={title}
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>{t('view.dialog.cancel')}</Button>
          <Button variant="primary" onClick={onConfirm}>{confirmLabel}</Button>
        </>
      )}
    >
      <div className={css.confirmMessage}>{message}</div>
    </Modal>
  )
}
