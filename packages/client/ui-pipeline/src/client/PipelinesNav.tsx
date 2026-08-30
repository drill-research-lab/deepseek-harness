/**
 * Sidebar Pipelines block: the feature-navigation seat under the session
 * browser. Lists every pipeline (name, status, failure badge, pause toggle),
 * opens the editor on click, and is the New-pipeline entry point.
 * @module PipelinesNav
 */

import { useCallback, useEffect, useState } from 'react'
import type { PipelineSummary } from '@deepseek-ai/dsh-pipeline/types'
import type { PipelinesNavProps } from './slots.ts'
import styles from './PipelinesNav.module.css'

/**
 * The navigation block. Loads the list on mount via the inject face, exposes
 * pause/resume per row, and drives the shared store's editor selection.
 * @param props - runtime share, shared store, inject face, and copy.
 * @returns the block (an empty-state row when no pipelines exist).
 */
export function PipelinesNav({ wide, expandSidebar, useStore, actions, api, openEditor, t }: PipelinesNavProps): React.JSX.Element {
  const openId = useStore(state => state.openId)
  const [pipelines, setPipelines] = useState<readonly PipelineSummary[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let live = true
    void api.list().then((result) => {
      if (!live) return
      if (result.ok) setPipelines(result.value)
      else setError(true)
    })
    return () => {
      live = false
    }
  }, [api])

  const onOpen = useCallback((id: string) => {
    actions.open(id)
    openEditor(id)
    expandSidebar()
  }, [actions, openEditor, expandSidebar])

  const onToggle = useCallback((summary: PipelineSummary) => {
    void api.setEnabled(summary.id, !summary.enabled).then(() => {
      void api.list().then((result) => {
        if (result.ok) setPipelines(result.value)
      })
    })
  }, [api])

  return (
    <div className={styles.block} data-wide={wide}>
      <div className={styles.header}>{t('nav.title')}</div>
      {error && <div className={styles.row}>{t('error.load')}</div>}
      {!error && pipelines !== null && pipelines.length === 0 && (
        <div className={styles.row}>{t('nav.empty')}</div>
      )}
      {!error && pipelines?.map(summary => (
        <div
          key={summary.id}
          className={openId === summary.id ? `${styles.row} ${styles.open}` : styles.row}
        >
          <button
            type="button"
            className={styles.name}
            data-testid={`pipeline-${summary.id}`}
            onClick={() => { onOpen(summary.id) }}
          >
            <span data-status={summary.status} className={styles.dot} />
            {summary.name}
            {summary.failureStreak > 0 && (
              <span className={styles.badge}>{t('nav.failureStreak')} ×{summary.failureStreak}</span>
            )}
          </button>
          <button
            type="button"
            className={styles.toggle}
            aria-label={summary.enabled ? t('action.pause') : t('action.resume')}
            onClick={() => { onToggle(summary) }}
          >
            {summary.enabled ? '⏸' : '▶'}
          </button>
        </div>
      ))}
    </div>
  )
}
