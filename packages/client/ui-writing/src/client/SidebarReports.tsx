/**
 * Sidebar report panel for the Writing feature: a `sidebar.reports` contribution
 * that lists the reports, lets the user create one, and selects the active
 * report into the shared store that the Writing editor view reads.
 */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { WritingReportsStore } from './reportStore.ts'
import type { SidebarReportsInjected } from './types.ts'
import css from './writing.module.css'

/** Props: the slots shell share, the store share, the inject face, and locale. */
export type SidebarReportsProps = PropsStore<WritingReportsStore> & SidebarReportsInjected & PropsLocale<'writing'> & {
  readonly wide: boolean
  readonly expandSidebar: () => void
}

/** The report picker strip mounted below the workspace list in the sidebar. */
export function SidebarReports(props: SidebarReportsProps): JSX.Element {
  const { listReports, createReport, t, useStore, actions } = props
  const reports = useStore(state => state.reports)
  const selected = useStore(state => state.selectedReportId)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const [newTitle, setNewTitle] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      const listed = await listReports()
      if (!active) return
      actions.setReports(listed)
      if (listed.length > 0 && selectedRef.current === undefined) {
        actions.select(listed[0]!.reportId)
      }
    })()
    return () => { active = false }
  }, [listReports, actions])

  const onCreate = async (): Promise<void> => {
    const title = newTitle.trim()
    if (title.length === 0) return
    await createReport(title)
    setNewTitle('')
    const listed = await listReports()
    actions.setReports(listed)
    const created = listed[0]
    if (created !== undefined) actions.select(created.reportId)
  }

  return (
    <nav className={css.list}>
      <div className={css.listHeader}>
        <h2 className={css.heading}>{t('title')}</h2>
        <button
          className={css.listToggle}
          title={collapsed ? t('listExpand') : t('listCollapse')}
          onClick={() => setCollapsed(visible => !visible)}
        >
          {collapsed ? '+' : '−'}
        </button>
        {!collapsed && (
          <div className={css.newRow}>
            <input
              className={css.newInput}
              value={newTitle}
              onChange={event => setNewTitle(event.target.value)}
              placeholder={t('newPlaceholder')}
            />
            <button className={css.button} onClick={() => { void onCreate() }}>{t('create')}</button>
          </div>
        )}
      </div>
      {!collapsed && (
        <ul className={css.reports}>
          {reports.map(report => (
            <li
              key={report.reportId}
              className={report.reportId === selected ? css.rowActive : css.row}
              onClick={() => actions.select(report.reportId)}
            >
              {report.title}
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}
