/** SparkDash-derived vLLM telemetry rendered inside DSH settings. */

import { useEffect, type ReactNode } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import type { InferenceDashboardKey } from './locales.ts'
import type {
  InferenceDashboardController,
  InferenceDashboardMetrics,
  InferenceDashboardResources,
  InferenceDashboardState,
  InferenceResourcesState,
} from './store.ts'
import styles from './InferenceDashboard.module.css'

/** Dependencies supplied by the settings slot registration. */
export interface InferenceDashboardInjected {
  /** Polling lifecycle owner. */
  controller: InferenceDashboardController
  /** Snapshot hook bound to the controller. */
  useSnapshot: SnapshotSelectorHook<InferenceDashboardState>
  /** Snapshot hook bound to the independent resource poller. */
  useResourcesSnapshot: SnapshotSelectorHook<InferenceResourcesState>
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
  const { controller, useSnapshot, useResourcesSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || useResourcesSnapshot === undefined || t === undefined) return null
  return <Loaded controller={controller} useSnapshot={useSnapshot} useResourcesSnapshot={useResourcesSnapshot} t={t} />
}

function Loaded({ controller, useSnapshot, useResourcesSnapshot, t }: InferenceDashboardInjected): ReactNode {
  const state = useSnapshot(snapshot => snapshot)
  const resourcesState = useResourcesSnapshot(snapshot => snapshot)
  useEffect(() => {
    controller.start()
    return () => { controller.stop() }
  }, [controller])

  return (
    <div className={styles.dashboard}>
      <InferenceSection state={state} controller={controller} t={t} />
      <ResourcesSection state={resourcesState} controller={controller} t={t} />
    </div>
  )
}

/** vLLM metrics load independently from the SparkDash resource snapshot. */
function InferenceSection(props: {
  state: InferenceDashboardState
  controller: InferenceDashboardController
  t: InferenceDashboardInjected['t']
}): ReactNode {
  const { state, controller, t } = props
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

/** Format a MiB value using SparkDash's binary unit thresholds. */
function formatMb(value: number): string {
  return value >= 1024 ? `${(value / 1024).toFixed(1)} GB` : `${Math.round(value).toLocaleString()} MB`
}

/** Format a bytes-per-second value using SparkDash's binary unit thresholds. */
function formatSpeed(value: number): string {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB/s`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB/s`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB/s`
  return `${Math.round(value).toLocaleString()} B/s`
}

/** Bounded visual meter shared by GPU and storage rows. */
function Meter(props: { value: number; max: number; danger?: boolean }): ReactNode {
  const ratio = props.max > 0 ? Math.max(0, Math.min(100, (props.value / props.max) * 100)) : 0
  return (
    <div className={styles.meter} aria-hidden="true">
      <span className={props.danger ? styles.meterDanger : styles.meterFill} style={{ width: `${String(ratio)}%` }} />
    </div>
  )
}

/** SparkDash-compatible GPU, storage, and network resource group. */
function ResourcesSection(props: {
  state: InferenceResourcesState
  controller: InferenceDashboardController
  t: InferenceDashboardInjected['t']
}): ReactNode {
  const { state, controller, t } = props
  if (state.status === 'idle' || state.status === 'loading') {
    return <section className={styles.resources}><h2>{t('resources')}</h2><p className={styles.status}>{t('resourcesLoading')}</p></section>
  }
  if (state.status === 'error') {
    const message = state.code === 'inference-metrics-unconfigured'
      ? t('resourcesUnconfigured')
      : `${t('resourcesFailed')}: ${state.message}`
    return (
      <section className={styles.resources}>
        <h2>{t('resources')}</h2>
        <div className={styles.error} role="alert">
          <p>{message}</p>
          <button type="button" className={styles.retry} onClick={() => { controller.retryResources() }}>{t('retry')}</button>
        </div>
      </section>
    )
  }
  return <ResourcePanels resources={state.resources} t={t} />
}

function ResourcePanels(props: {
  resources: InferenceDashboardResources
  t: InferenceDashboardInjected['t']
}): ReactNode {
  const { resources, t } = props
  return (
    <section className={styles.resources} aria-labelledby="resources-title">
      <div className={styles.resourceHeading}>
        <h2 id="resources-title">{t('resources')}</h2>
        <span>{`${t('updated')} ${new Date(resources.sampledAt).toLocaleTimeString()}`}</span>
      </div>
      <div className={styles.resourceGrid}>
        <GpuPanel resources={resources} t={t} />
        <div className={styles.resourceStack}>
          <StoragePanel resources={resources} t={t} />
          <NetworkPanel resources={resources} t={t} />
        </div>
      </div>
    </section>
  )
}

function GpuPanel(props: { resources: InferenceDashboardResources; t: InferenceDashboardInjected['t'] }): ReactNode {
  const { resources, t } = props
  const gpu = resources.gpu
  if (gpu === undefined) return <article className={styles.resourcePanel}><h3>⌁ GPU</h3><p>{t('unavailable')}</p></article>
  const clock = gpu.smClockMhz === undefined || gpu.smClockMaxMhz === undefined
    ? t('unavailable') : `${gpu.smClockMhz.toLocaleString()} / ${gpu.smClockMaxMhz.toLocaleString()} MHz`
  return (
    <article className={styles.resourcePanel} aria-label={t('gpuPanel')}>
      <h3>⌁ GPU</h3>
      <div className={styles.resourceMetric}><span>{t('usage')}</span><Sparkline values={resources.gpuUsageHistory} accent /><strong>{`${gpu.usagePercent.toFixed(0)}%`}</strong></div>
      <div className={styles.resourceMetric}><span>{t('temperature')}</span><Sparkline values={resources.gpuTemperatureHistory} /><strong>{`${gpu.temperatureC.toFixed(0)}°C`}</strong></div>
      <div className={styles.resourcePair}><span>{t('gpuPower')}</span><strong>{`${gpu.powerDrawWatts.toFixed(2)}W / ${gpu.powerLimitWatts.toFixed(0)}W`}</strong></div>
      <div className={styles.resourcePair}><span>{t('throttle')}</span><strong className={gpu.throttled ? styles.warningPill : styles.okPill}>{gpu.throttleReason.toUpperCase()}</strong></div>
      <div className={styles.resourcePair}><span>{t('smClock')}</span><strong>{clock}</strong></div>
      <Meter value={gpu.smClockMhz ?? 0} max={gpu.smClockMaxMhz ?? 0} />
      <div className={styles.divider} />
      <div className={styles.resourcePair}><span>VRAM</span><strong>{`${formatMb(gpu.vramUsedMb).replace(/ (GB|MB)$/, '')} / ${formatMb(gpu.vramTotalMb)}`}</strong></div>
      <Meter value={gpu.vramUsedMb} max={gpu.vramTotalMb} danger={gpu.vramTotalMb > 0 && gpu.vramUsedMb / gpu.vramTotalMb > 0.85} />
      <div className={styles.resourcePair}><span>{t('available')}</span><strong>{formatMb(gpu.vramAvailableMb)}</strong></div>
      {gpu.processes.length === 0 ? null : (
        <div className={styles.processes}>
          <span className={styles.resourceCaption}>{t('processes')}</span>
          {gpu.processes.map(process => (
            <div className={styles.resourcePair} key={process.pid}>
              <span>{process.name} <small>{process.pid}</small></span><strong>{formatMb(process.vramMb)}</strong>
            </div>
          ))}
        </div>
      )}
    </article>
  )
}

function StoragePanel(props: { resources: InferenceDashboardResources; t: InferenceDashboardInjected['t'] }): ReactNode {
  const { resources, t } = props
  return (
    <article className={styles.resourcePanel} aria-label={t('storagePanel')}>
      <h3>▣ {t('storage')}</h3>
      {resources.storage.length === 0 ? <p>{t('unavailable')}</p> : resources.storage.map(disk => (
        <div className={styles.disk} key={`${disk.device}:${disk.label}`}>
          <div className={styles.resourcePair}><span><strong>{disk.label}</strong> <small>{disk.device}</small></span><strong>{`${disk.totalMb > 0 ? ((disk.usedMb / disk.totalMb) * 100).toFixed(0) : '0'}%`}</strong></div>
          <Meter value={disk.usedMb} max={disk.totalMb} />
          <div className={styles.resourcePair}><span>{`${formatMb(disk.usedMb)} / ${formatMb(disk.totalMb)}`}</span><span>{`${formatMb(disk.availableMb)} ${t('free')}`}</span></div>
          <div className={styles.io}>
            <span>↑ {formatSpeed(disk.writeBytesPerSecond)}</span>
            <span>↓ {formatSpeed(disk.readBytesPerSecond)}</span>
          </div>
        </div>
      ))}
    </article>
  )
}

function NetworkPanel(props: { resources: InferenceDashboardResources; t: InferenceDashboardInjected['t'] }): ReactNode {
  const { resources, t } = props
  return (
    <article className={styles.resourcePanel} aria-label={t('networkPanel')}>
      <h3>⌁ {t('network')}</h3>
      <div className={styles.networkSummary}>
        <span>{t('primary')} <strong>{resources.primaryNetworkInterface ?? t('unavailable')}</strong></span>
        {resources.networkLinkSpeedMbps === undefined ? null : <strong className={styles.linkPill}>{`${resources.networkLinkSpeedMbps.toLocaleString()} Mbps`}</strong>}
      </div>
      {resources.networkInterfaces.length === 0 ? <p>{t('unavailable')}</p> : resources.networkInterfaces.map(item => (
        <div className={item.primary ? styles.networkPrimary : styles.networkRow} key={item.name}>
          <span><strong>{item.ip}</strong><small>{item.name}</small></span>
          <span>↑ {formatSpeed(item.txBytesPerSecond)}　↓ {formatSpeed(item.rxBytesPerSecond)}</span>
        </div>
      ))}
    </article>
  )
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
