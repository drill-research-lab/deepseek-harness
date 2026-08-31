/** SparkDash-derived vLLM telemetry rendered inside DSH settings. */

import { useEffect, type ReactNode } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import type { InferenceDashboardKey } from './locales.ts'
import type {
  InferenceDashboardController,
  InferenceDashboardMetrics,
  InferenceDashboardState,
} from './store.ts'
import styles from './InferenceDashboard.module.css'

/** Dependencies supplied by the settings slot registration. */
export interface InferenceDashboardInjected {
  /** Polling lifecycle owner. */
  controller: InferenceDashboardController
  /** Snapshot hook bound to the controller. */
  useSnapshot: SnapshotSelectorHook<InferenceDashboardState>
  /** Localized dashboard copy. */
  t: (key: InferenceDashboardKey) => string
}

/** Slot props are partial until injection finishes. */
export type InferenceDashboardProps = Partial<InferenceDashboardInjected>

/** Format an optional cumulative value. */
function count(value: number | undefined, unavailable: string): string {
  return value === undefined ? unavailable : new Intl.NumberFormat().format(value)
}

/** Format an optional percentage fraction. */
function percent(value: number | undefined, unavailable: string): string {
  return value === undefined ? unavailable : `${(value * 100).toFixed(1)}%`
}

/** Format an optional seconds value. */
function seconds(value: number | undefined, unavailable: string): string {
  return value === undefined ? unavailable : `${value.toFixed(3)}s`
}

/** Small inline trend matching SparkDash's last-30-sample sparklines. */
function Sparkline({ values, accent = false }: { values: number[]; accent?: boolean }): ReactNode {
  const width = 92
  const height = 28
  if (values.length < 2) return <span className={styles.sparklinePlaceholder} aria-hidden="true" />
  const maximum = Math.max(...values, 1)
  const minimum = Math.min(...values, 0)
  const span = maximum - minimum || 1
  const padding = 2
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width
    const y = height - padding - ((value - minimum) / span) * (height - padding * 2)
    return `${String(x)},${String(y)}`
  })
  const area = `M0,${String(height)} L${points.join(' L')} L${String(width)},${String(height)} Z`
  return (
    <svg className={accent ? styles.sparklineAccent : styles.sparkline} viewBox={`0 0 ${String(width)} ${String(height)}`} aria-hidden="true">
      <path d={area} className={styles.sparklineArea} />
      <polyline points={points.join(' ')} className={styles.sparklineLine} />
    </svg>
  )
}

/** One compact SparkDash-style metric cell with its explanatory tooltip. */
function MetricTile(props: { label: string; value: string; description?: string; tone?: string }): ReactNode {
  return (
    <div className={styles.metricTile}>
      <div className={styles.metricLabel}>
        <span>{props.label}</span>
        {props.description === undefined ? null : (
          <span className={styles.info} title={props.description} aria-label={`${props.label}: ${props.description}`} />
        )}
      </div>
      <strong className={props.tone ?? styles.metricValue}>{props.value}</strong>
    </div>
  )
}

/** Render the settings dashboard. */
export function InferenceDashboard(props: InferenceDashboardProps): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  return <Loaded controller={controller} useSnapshot={useSnapshot} t={t} />
}

function Loaded({ controller, useSnapshot, t }: InferenceDashboardInjected): ReactNode {
  const state = useSnapshot(snapshot => snapshot)
  useEffect(() => {
    controller.start()
    return () => { controller.stop() }
  }, [controller])

  if (state.status === 'idle' || state.status === 'loading') {
    return <p className={styles.status} role="status">{t('loading')}</p>
  }
  if (state.status === 'error') {
    const message = state.code === 'inference-metrics-unconfigured'
      ? t('unconfigured')
      : `${t('loadFailed')}: ${state.message}`
    return (
      <div className={styles.error} role="alert">
        <p>{message}</p>
        <button type="button" className={styles.retry} onClick={() => { controller.retry() }}>
          {t('retry')}
        </button>
      </div>
    )
  }

  return <SparkDashPanel metrics={state.metrics} t={t} />
}

/** Curated vLLM panel adapted from SparkDash's LLM surface. */
function SparkDashPanel(props: { metrics: InferenceDashboardMetrics; t: InferenceDashboardInjected['t'] }): ReactNode {
  const { metrics, t } = props
  const cacheTone = metrics.kvCacheUsage === undefined
    ? styles.metricValue
    : metrics.kvCacheUsage >= 0.8 ? styles.danger : metrics.kvCacheUsage >= 0.5 ? styles.warning : styles.success
  const engine = metrics.engineState === undefined
    ? t('unavailable')
    : metrics.engineState === 'active'
      ? t('engineActive')
      : metrics.engineState === 'weights-offloaded' ? t('engineOffloaded') : t('engineDiscarded')
  const slots = metrics.requestsRunning > 0
    ? `${String(metrics.requestsRunning)} ${t('slotsRunning')}`
    : t('unavailable')

  return (
    <section className={styles.section} aria-labelledby="inference-dashboard-title">
      <header className={styles.header}>
        <div>
          <h2 id="inference-dashboard-title" className={styles.title}>{t('title')}</h2>
          <p className={styles.description}>{t('description')}</p>
        </div>
        <div className={styles.updated}>
          <span className={styles.onlineDot} aria-hidden="true" />
          <span>{`${t('online')} · ${t('updated')} ${new Date(metrics.sampledAt).toLocaleTimeString()}`}</span>
        </div>
      </header>

      <article className={styles.panel} aria-label={t('llmPanel')}>
        <header className={styles.panelHeader}>
          <div className={styles.identity}>
            <span className={styles.badge}><span aria-hidden="true" />vLLM</span>
            <strong>{metrics.modelId ?? t('modelUnknown')}</strong>
          </div>
        </header>

        <div className={styles.throughput}>
          <div className={styles.rateRow}>
            <span>{t('generationRate')}</span>
            <Sparkline values={metrics.generationHistory} accent />
            <strong>{metrics.generationTokensPerSecond.toFixed(1)}</strong>
          </div>
          <div className={styles.rateRow}>
            <span>{t('prefillRate')}</span>
            <Sparkline values={metrics.prefillHistory} />
            <strong>{metrics.prefillTokensPerSecond.toFixed(1)}</strong>
          </div>
        </div>

        <div className={styles.metricGrid}>
          <MetricTile label={t('slots')} value={slots} />
          <MetricTile label={t('context')} value={count(metrics.contextLength, t('unavailable'))} />
          <MetricTile label={t('engine')} value={engine} description={t('engineInfo')} />
          <MetricTile label={t('totalGenerated')} value={count(metrics.generationTokensTotal, t('unavailable'))} />
        </div>

        <div className={styles.metricGrid}>
          <MetricTile
            label={t('kvCache')}
            value={percent(metrics.kvCacheUsage, t('unavailable'))}
            description={t('kvCacheInfo')}
            {...cacheTone === undefined ? {} : { tone: cacheTone }}
          />
          <MetricTile label={t('requests')} value={`${String(metrics.requestsRunning)} ${t('run')} / ${String(metrics.requestsWaiting)} ${t('wait')}`} description={t('requestsInfo')} />
          <MetricTile label={t('ttftP95')} value={seconds(metrics.ttftP95Seconds, t('unavailable'))} description={t('ttftP95Info')} />
          <MetricTile label={t('preemptions')} value={count(metrics.preemptionsTotal, t('unavailable'))} description={t('preemptionsInfo')} />
        </div>

        <div className={styles.metricGrid}>
          <MetricTile label={t('prefixCache')} value={percent(metrics.prefixCacheHitRate, t('unavailable'))} description={t('prefixCacheInfo')} />
          <MetricTile label={t('e2eP95')} value={seconds(metrics.e2eP95Seconds, t('unavailable'))} description={t('e2eP95Info')} />
          <MetricTile label={t('itlP95')} value={seconds(metrics.itlP95Seconds, t('unavailable'))} description={t('itlP95Info')} />
          <MetricTile label={t('mtpAccept')} value={percent(metrics.mtpAcceptanceRate, t('unavailable'))} description={t('mtpAcceptInfo')} />
        </div>

        <p className={styles.note}>{t('queueNote')}</p>
      </article>
    </section>
  )
}
