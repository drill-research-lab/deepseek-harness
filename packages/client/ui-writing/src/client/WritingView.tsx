/** Writing view: report list (left), LaTeX editor + PDF preview (right), compile feedback (bottom). */

import { useCallback, useEffect, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { CompileResultView, ReportVersionView } from '@deepseek-ai/dsh-writing-api/types'
import type { ReportSummaryView, WritingViewInjected } from './types.ts'
import css from './writing.module.css'

/** Props of the Writing view: the conversation.view runtime + the inject face + locale. */
export type WritingViewProps = ConvViewProps & WritingViewInjected & PropsLocale<'writing'>

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

  const select = useCallback(async (reportId: string): Promise<void> => {
    setSelected(reportId)
    setSource(await getSource(reportId))
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

  const onSave = useCallback(async (): Promise<void> => {
    if (selected === undefined) return
    await updateSource(selected, source)
    setMessage(t('saved'))
  }, [selected, source, updateSource, t])

  const onCompile = useCallback(async (): Promise<void> => {
    if (selected === undefined) return
    setCompileResult(await compile(selected))
    setVersionList(await versions(selected))
    setMessage('')
  }, [selected, compile, versions])

  const onRestore = useCallback(async (versionId: string): Promise<void> => {
    if (selected === undefined) return
    setSource(await restore(selected, versionId))
    setMessage(t('restored'))
  }, [selected, restore, t])

  const pdfUrl = compileResult?.pdfUrl

  return (
    <div className={css.writing}>
      <nav className={css.list}>
        <h2 className={css.heading}>{t('title')}</h2>
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
      </nav>
      <main className={css.editor}>
        <textarea
          className={css.source}
          value={source}
          onChange={event => setSource(event.target.value)}
          spellCheck={false}
        />
        <div className={css.preview}>
          {pdfUrl === undefined
            ? <div className={css.none}>{t('noPreview')}</div>
            : <iframe className={css.frame} src={pdfUrl} title={t('preview')} />}
        </div>
      </main>
      <footer className={css.footer}>
        <button className={css.button} onClick={() => { void onSave() }}>{t('save')}</button>
        <button className={css.button} onClick={() => { void onCompile() }}>{t('compile')}</button>
        {message.length > 0 && <span className={css.status}>{message}</span>}
        {compileResult !== undefined && (
          <div className={css.diagnostics}>
            {compileResult.ok
              ? <p className={css.ok}>{t('compiledOk')}</p>
              : compileResult.diagnostics.map((diagnostic, index) => (
                // eslint-disable-next-line react/no-array-index-key -- stable position in one compile result
                <p key={index} className={diagnostic.severity === 'error' ? css.error : css.warning}>
                  {diagnostic.severity}{diagnostic.line === undefined ? '' : ` @ ${diagnostic.line}`}: {diagnostic.message}
                </p>
              ))}
          </div>
        )}
        {versionList.length > 0 && (
          <div className={css.versions}>
            <span className={css.heading}>{t('versions')}</span>
            <ul className={css.versionList}>
              {versionList.map(version => (
                <li key={version.versionId}>
                  <button className={css.versionButton} onClick={() => { void onRestore(version.versionId) }}>
                    {version.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </footer>
    </div>
  )
}
