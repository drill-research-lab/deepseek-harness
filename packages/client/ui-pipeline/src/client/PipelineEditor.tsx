/**
 * Full-window pipeline editor overlay: header (name, trigger, run-now) with
 * the read-only DAG canvas and the runs list. Opened through the shared UI
 * store; closed back to the conversation frame.
 * @module PipelineEditor
 */

import { useCallback, useEffect, useState } from 'react'
import type { PipelineRunRecord } from '@deepseek-ai/dsh-pipeline-local/types'
import type { WorkflowJson } from '@deepseek-ai/dsh-pipeline/types'
import type { PipelineEditorProps } from './slots.ts'
import { PipelineCanvas } from './PipelineCanvas.tsx'
import { CreateView } from './CreateView.tsx'
import styles from './PipelineEditor.module.css'

/**
 * The editor overlay entry. Renders nothing while the shared store has no
 * open pipeline; otherwise covers the frame with header, canvas, and runs.
 * @param props - runtime share, shared store, inject face, and copy.
 * @returns the overlay, or `null` when closed.
 */
export function PipelineEditor({ useStore, actions, api, t }: PipelineEditorProps): React.JSX.Element | null {
  const openId = useStore(state => state.openId)
  const view = useStore(state => state.view)
  const [definition, setDefinition] = useState<WorkflowJson | undefined>(undefined)
  const [runs, setRuns] = useState<readonly PipelineRunRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (openId === null) return
    let live = true
    void api.get(openId).then((result) => {
      if (!live) return
      if (result.ok && result.value !== undefined) setDefinition(result.value)
      else setError(t('error.load'))
    })
    return () => {
      live = false
    }
  }, [openId, api, t])

  const refreshRuns = useCallback(() => {
    if (openId === null) return
    void api.runs(openId).then((result) => {
      if (result.ok) setRuns(result.value)
    })
  }, [openId, api])

  useEffect(refreshRuns, [refreshRuns])

  const onRunNow = useCallback(() => {
    /* v8 ignore next -- the Run-now button renders only while a pipeline is open,
     * and closing is synchronous, so the callback never races an empty id. */
    if (openId === null) return
    void api.triggerNow(openId).then(refreshRuns)
  }, [openId, api, refreshRuns])

  const onClose = useCallback(() => {
    actions.close()
    setDefinition(undefined)
    setRuns([])
    setSelectedId(null)
    setError(null)
  }, [actions])

  if (openId === null && view !== 'create') return null
  if (view === 'create') {
    return (
      <div className={styles.overlay} data-testid="pipeline-create">
        <header className={styles.header}>
          <span className={styles.title}>{t('nav.new')}</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t('action.close')}>×</button>
        </header>
        <CreateView api={api} onCreated={(id) => { actions.open(id) }} t={t} />
      </div>
    )
  }
  return (
    <div className={styles.overlay} data-testid="pipeline-editor">
      <header className={styles.header}>
        <span className={styles.title}>{definition?.name ?? openId}</span>
        <button type="button" className={styles.runNow} onClick={onRunNow}>{t('action.runNow')}</button>
        <button type="button" className={styles.close} onClick={onClose} aria-label={t('action.close')}>×</button>
      </header>
      {error !== null && <div className={styles.error}>{error}</div>}
      {definition !== undefined && (
        <div className={styles.body}>
          <PipelineCanvas definition={definition} selectedId={selectedId} onSelect={setSelectedId} />
          <aside className={styles.runs}>
            <h3>{t('editor.runs')}</h3>
            {runs.length === 0 && <p className={styles.noRuns}>{t('editor.noRuns')}</p>}
            {[...runs].reverse().map(run => (
              <div key={run.runId} className={styles.run} data-status={run.status}>
                <span>{run.runId}</span>
                <span>{run.status === 'completed' ? t('run.completed') : t('run.failed')}</span>
              </div>
            ))}
          </aside>
        </div>
      )}
    </div>
  )
}
