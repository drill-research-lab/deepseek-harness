/**
 * Sidebar report panel for the Writing feature: a `sidebar.reports` contribution
 * that lists the reports, lets the user create one, and writes the active report
 * into the shared report-selection source the Writing editor view reads.
 */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WritingReportsHooks, SidebarReportsInjected } from './types.ts'
import css from './writing.module.css'

/** Draggable report-panel height bounds (px). */
const MIN_HEIGHT = 80
const MAX_HEIGHT = 480
const DEFAULT_HEIGHT = 220
const COLLAPSED_HEIGHT = 36

/** Props: the runtime share (owner + global hooks), the hooks share, the inject face, and locale. */
export type SidebarReportsProps = PropsRuntime<'sidebar.reports'> & Omit<SidebarReportsInjected, 'hooks'> & WritingReportsHooks & PropsLocale<'writing'>

/** The report picker strip mounted below the workspace list in the sidebar. */
export function SidebarReports(props: SidebarReportsProps): JSX.Element {
  const { listReports, createReport, setReports, select, openWriting, t, useReportSelection, useSessions } = props
  const reports = useReportSelection(state => state.reports)
  const selected = useReportSelection(state => state.selectedReportId)
  const currentSessionId = useSessions(state => state.current)
  const cwd = useSessions(state => state.current === undefined ? undefined : state.byId[state.current]?.cwd)
  const [newTitle, setNewTitle] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const heightRef = useRef(DEFAULT_HEIGHT)
  heightRef.current = height

  const prevCwd = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (cwd === undefined) return
    if (cwd !== prevCwd.current) {
      prevCwd.current = cwd
      // A workspace change must not keep the previous workspace's loaded report.
      select(undefined)
      setReports([])
    }
    let active = true
    void (async () => {
      const listed = await listReports(cwd)
      if (!active) return
      setReports(listed)
    })()
    return () => { active = false }
  }, [listReports, setReports, select, cwd])

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
    await createReport(title, cwd ?? '')
    setNewTitle('')
    const listed = await listReports(cwd ?? '')
    setReports(listed)
    const created = listed[0]
    if (created !== undefined) {
      select(created.reportId)
      if (currentSessionId !== undefined) openWriting(currentSessionId)
    }
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
              onClick={() => {
                select(report.reportId)
                if (currentSessionId !== undefined) openWriting(currentSessionId)
              }}
            >
              {report.title}
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}
