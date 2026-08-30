/**
 * Sidebar report panel for the Writing feature: a `sidebar.reports` contribution
 * that lists the reports, lets the user create one, and writes the active report
 * into the shared report-selection source the Writing editor view reads.
 */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WritingReportsHooks, SidebarReportsInjected } from './types.ts'
import css from './writing.module.css'

/** Draggable report-panel height bounds (px). */
const MIN_HEIGHT = 80
const MAX_HEIGHT = 480
const DEFAULT_HEIGHT = 220
const COLLAPSED_HEIGHT = 36

/** Props: the slots shell share, the hooks share, the inject face, and locale. */
export type SidebarReportsProps = Omit<SidebarReportsInjected, 'hooks'> & WritingReportsHooks & PropsLocale<'writing'> & {
  readonly wide: boolean
  readonly expandSidebar: () => void
}

/** The report picker strip mounted below the workspace list in the sidebar. */
export function SidebarReports(props: SidebarReportsProps): JSX.Element {
  const { listReports, createReport, setReports, select, t, useReportSelection } = props
  const reports = useReportSelection(state => state.reports)
  const selected = useReportSelection(state => state.selectedReportId)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const [newTitle, setNewTitle] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const heightRef = useRef(DEFAULT_HEIGHT)
  heightRef.current = height

  useEffect(() => {
    let active = true
    void (async () => {
      const listed = await listReports()
      if (!active) return
      setReports(listed)
      if (listed.length > 0 && selectedRef.current === undefined) {
        select(listed[0]!.reportId)
      }
    })()
    return () => { active = false }
  }, [listReports, setReports, select])

  const onResizeStart = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = heightRef.current
    const onMove = (move: PointerEvent): void => {
      setHeight(Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight - (move.clientY - startY)))))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onCreate = async (): Promise<void> => {
    const title = newTitle.trim()
    if (title.length === 0) return
    await createReport(title)
    setNewTitle('')
    const listed = await listReports()
    setReports(listed)
    const created = listed[0]
    if (created !== undefined) select(created.reportId)
  }

  return (
    <nav className={css.list} style={{ height: collapsed ? COLLAPSED_HEIGHT : height }}>
      <div
        className={css.dragHandle}
        title={t('resizeReports')}
        onPointerDown={onResizeStart}
        onDoubleClick={() => setHeight(DEFAULT_HEIGHT)}
      />
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
              onClick={() => select(report.reportId)}
            >
              {report.title}
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}
