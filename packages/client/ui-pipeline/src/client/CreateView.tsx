/**
 * Overlay create view: the template gallery (Scheduled Search card) with its
 * settings form, plus the paste-JSON import path. Submitting routes through
 * the pipelines Remote face and opens the created pipeline.
 * @module CreateView
 */

import { useCallback, useState } from 'react'
import type { WorkflowJson } from '@deepseek-ai/dsh-pipeline/types'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PipelineApi, ScheduledSearchForm } from './slots.ts'
import styles from './CreateView.module.css'

/** Component props: the wire verbs, copy, and the open callback for the created id. */
export interface CreateViewProps {
  /** The wire verbs. */
  api: PipelineApi
  /** Open the editor on the created pipeline. */
  onCreated: (id: string) => void
}

/**
 * The create view. One template card today (Scheduled Search); a valid
 * WorkflowJSON paste imports a definition of any shape through `save`.
 * @param props - api face, open callback, and copy.
 * @returns the gallery and form.
 */
export function CreateView({ api, onCreated, t }: CreateViewProps & PropsLocale<'pipeline'>): React.JSX.Element {
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [cron, setCron] = useState('0 9 * * 1')
  const [timeZone, setTimeZone] = useState('UTC')
  const [maxResults, setMaxResults] = useState(20)
  const [summary, setSummary] = useState(false)
  const [importText, setImportText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submitTemplate = useCallback(() => {
    const request: ScheduledSearchForm = {
      name,
      inputs: { query, cron, timeZone, maxResults, summary },
    }
    setBusy(true)
    void api.createFromTemplate(request).then((result) => {
      setBusy(false)
      if (result.ok) onCreated(result.value.id)
      else setError(t('error.load'))
    })
  }, [name, query, cron, timeZone, maxResults, summary, api, onCreated, t])

  const submitImport = useCallback(() => {
    let parsed: WorkflowJson
    try {
      parsed = JSON.parse(importText) as WorkflowJson
    } catch {
      setError(t('create.invalidJson'))
      return
    }
    setBusy(true)
    void api.save(parsed).then((result) => {
      setBusy(false)
      if (result.ok) onCreated(String(result.value.id))
      else setError(t('error.load'))
    })
  }, [importText, api, onCreated, t])

  return (
    <div className={styles.create}>
      <section className={styles.card}>
        <h2>{t('create.template.title')}</h2>
        <p>{t('create.template.desc')}</p>
        <label className={styles.field}>
          {t('create.name')}
          <input value={name} onChange={(e) => { setName(e.target.value) }} data-testid="create-name" />
        </label>
        <label className={styles.field}>
          {t('create.query')}
          <input value={query} onChange={(e) => { setQuery(e.target.value) }} data-testid="create-query" />
        </label>
        <label className={styles.field}>
          {t('create.cron')}
          <input value={cron} onChange={(e) => { setCron(e.target.value) }} data-testid="create-cron" />
        </label>
        <label className={styles.field}>
          {t('create.timezone')}
          <input value={timeZone} onChange={(e) => { setTimeZone(e.target.value) }} data-testid="create-timezone" />
        </label>
        <label className={styles.field}>
          {t('create.maxResults')}
          <input type="number" min={1} max={100} value={maxResults} onChange={(e) => { setMaxResults(Number(e.target.value)) }} data-testid="create-max" />
        </label>
        <label className={styles.field}>
          {t('create.summary')}
          <input type="checkbox" checked={summary} onChange={(e) => { setSummary(e.target.checked) }} data-testid="create-summary" />
        </label>
        <button type="button" className={styles.submit} disabled={busy || name === '' || query === ''} onClick={submitTemplate}>
          {t('create.submit')}
        </button>
      </section>
      <section className={styles.card}>
        <h2>{t('create.import')}</h2>
        <textarea
          className={styles.importArea}
          value={importText}
          placeholder={t('create.importPlaceholder')}
          onChange={(e) => { setImportText(e.target.value) }}
          data-testid="create-import"
        />
        <button type="button" className={styles.submit} disabled={busy || importText === ''} onClick={submitImport}>
          {t('create.import')}
        </button>
      </section>
      {error !== null && <div className={styles.error}>{error}</div>}
    </div>
  )
}
