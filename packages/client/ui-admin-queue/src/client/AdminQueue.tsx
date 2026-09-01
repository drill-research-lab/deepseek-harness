/** Admin-only LLM admission-queue view with drag-to-reorder of the waiting line. */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { QueueEntryView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import type { AdminQueueKey } from './locales.ts'
import type { AdminQueueController, AdminQueueState } from './store.ts'
import styles from './AdminQueue.module.css'

/** Dependencies supplied by the settings slot registration. */
export interface AdminQueueInjected {
  /** Polling lifecycle owner. */
  controller: AdminQueueController
  /** Snapshot hook bound to the controller. */
  useSnapshot: SnapshotSelectorHook<AdminQueueState>
  /** Localized page copy. */
  t: (key: AdminQueueKey) => string
}

/** Slot props are partial until injection finishes. */
export type AdminQueueProps = Partial<AdminQueueInjected>

/** Render the admin queue page. */
export function AdminQueue(props: AdminQueueProps): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  return <Loaded controller={controller} useSnapshot={useSnapshot} t={t} />
}

function Loaded({ controller, useSnapshot, t }: AdminQueueInjected): ReactNode {
  const state = useSnapshot(snapshot => snapshot)
  useEffect(() => {
    controller.start()
    return () => { controller.stop() }
  }, [controller])

  return (
    <section className={styles.page} aria-labelledby="admin-queue-title">
      <header className={styles.header}>
        <h2 id="admin-queue-title" className={styles.title}>{t('title')}</h2>
        <p className={styles.description}>{t('description')}</p>
      </header>
      <Body state={state} controller={controller} t={t} />
    </section>
  )
}

function Body(props: { state: AdminQueueState; controller: AdminQueueController; t: AdminQueueInjected['t'] }): ReactNode {
  const { state, controller, t } = props
  if (state.status === 'checking-permission' || state.status === 'loading') {
    return <p className={styles.status} role="status">{state.status === 'checking-permission' ? t('checking') : t('loading')}</p>
  }
  if (state.status === 'forbidden') {
    return <p className={styles.status} data-admin-queue-forbidden="">{t('forbidden')}</p>
  }
  if (state.status === 'error') {
    return (
      <div className={styles.error} role="alert">
        <p>{`${t('loadFailed')}: ${state.message}`}</p>
        <button type="button" className={styles.retry} onClick={() => { controller.retry() }}>{t('retry')}</button>
      </div>
    )
  }
  if (state.entries.length === 0) return <p className={styles.status}>{t('empty')}</p>
  return <QueueTable entries={state.entries} controller={controller} t={t} />
}

/** One draggable waiting row. */
function SortableRow(props: { entry: QueueEntryView; position: number; label: string; hint: string }): ReactNode {
  const { entry, position, label, hint } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.queueId })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    ...transition === undefined ? {} : { transition },
  }
  return (
    <tr
      ref={setNodeRef}
      style={style}
      data-state="waiting"
      data-dragging={isDragging ? '' : undefined}
      className={styles.draggable}
      {...attributes}
      {...listeners}
      aria-roledescription={hint}
    >
      <td className={styles.colPos}>{position}</td>
      <td>{entry.ownerUsername ?? '—'}</td>
      <td><span className={styles.badgeWaiting}>{label}</span></td>
    </tr>
  )
}

function QueueTable(props: {
  entries: readonly QueueEntryView[]
  controller: AdminQueueController
  t: AdminQueueInjected['t']
}): ReactNode {
  const { entries, controller, t } = props
  const running = entries.filter(entry => entry.state === 'running')
  const waiting = entries.filter(entry => entry.state === 'waiting')
  const waitingKey = waiting.map(entry => entry.queueId).join(' ')

  // Local waiting order: the render source of truth, reconciled with the server
  // snapshot whenever the set of waiting ids changes, except mid-drag.
  const [order, setOrder] = useState<string[]>(() => waiting.map(entry => entry.queueId))
  const draggingRef = useRef(false)
  useEffect(() => {
    if (draggingRef.current) return
    setOrder(waitingKey.length === 0 ? [] : waitingKey.split(' '))
  }, [waitingKey])

  const byId = new Map(waiting.map(entry => [entry.queueId, entry]))
  const orderedWaiting = order.map(id => byId.get(id)).filter((entry): entry is QueueEntryView => entry !== undefined)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragEnd = (event: DragEndEvent): void => {
    draggingRef.current = false
    const { active, over } = event
    if (over !== null && active.id !== over.id) {
      const next = arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id)))
      setOrder(next)
      void controller.reorder(next)
    }
    controller.resume()
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th className={styles.colPos}>{t('colPosition')}</th>
          <th>{t('colUser')}</th>
          <th>{t('colState')}</th>
        </tr>
      </thead>
      <tbody>
        {running.map(entry => (
          <tr key={entry.queueId} data-state="running">
            <td className={styles.colPos}>—</td>
            <td>{entry.ownerUsername ?? '—'}</td>
            <td><span className={styles.badgeRunning}>{t('stateRunning')}</span></td>
          </tr>
        ))}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={() => { draggingRef.current = true; controller.suspend() }}
          onDragCancel={() => { draggingRef.current = false; controller.resume() }}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            {orderedWaiting.map((entry, index) => (
              <SortableRow
                key={entry.queueId}
                entry={entry}
                position={index + 1}
                label={t('stateWaiting')}
                hint={t('rowDragHint')}
              />
            ))}
          </SortableContext>
        </DndContext>
      </tbody>
    </table>
  )
}
