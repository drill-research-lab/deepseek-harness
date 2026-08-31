/** Inference telemetry rendered inside DSH settings. */

import { useEffect, useState, type ReactNode } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-web-react'
import type { InferenceMetricFamilyView, InferenceMetricSeriesView } from '@deepseek-ai/dsh-api-remotes/client'
import type { InferenceDashboardKey } from './locales.ts'
import type { InferenceDashboardController, InferenceDashboardState } from './store.ts'
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

/** Format a finite cumulative metric for compact cards. */
function count(value: number | undefined, unavailable: string): string {
  return value === undefined ? unavailable : new Intl.NumberFormat().format(value)
}

/** Render one label set in Prometheus notation with unambiguous escaping. */
function labels(series: InferenceMetricSeriesView, none: string): string {
  if (series.labels.length === 0) return none
  return `{${series.labels.map(label => `${label.name}=${JSON.stringify(label.value)}`).join(', ')}}`
}

/** Keep family metadata and only the matching series when a search is active. */
function matchingFamilies(families: InferenceMetricFamilyView[], query: string): InferenceMetricFamilyView[] {
  const needle = query.trim().toLocaleLowerCase()
  if (needle.length === 0) return families
  return families.flatMap((family) => {
    const familyText = [family.name, family.help, family.type].filter(Boolean).join(' ').toLocaleLowerCase()
    if (familyText.includes(needle)) return [family]
    const series = family.series.filter((item) => {
      const seriesText = [
        item.metric,
        item.value,
        ...item.labels.flatMap(label => [label.name, label.value]),
      ].join(' ').toLocaleLowerCase()
      return seriesText.includes(needle)
    })
    return series.length === 0 ? [] : [{ ...family, series }]
  })
}

/** Render the settings dashboard. */
export function InferenceDashboard(props: InferenceDashboardProps): ReactNode {
  const { controller, useSnapshot, t } = props
  if (controller === undefined || useSnapshot === undefined || t === undefined) return null
  return <Loaded controller={controller} useSnapshot={useSnapshot} t={t} />
}

function Loaded({ controller, useSnapshot, t }: InferenceDashboardInjected): ReactNode {
  const state = useSnapshot(snapshot => snapshot)
  const [query, setQuery] = useState('')
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

  const { metrics } = state
  const percent = metrics.kvCacheUsage === undefined
    ? undefined
    : Math.round(metrics.kvCacheUsage * 100)
  const filteredFamilies = matchingFamilies(metrics.metricFamilies, query)
  const seriesCount = metrics.metricFamilies.reduce((total, family) => total + family.series.length, 0)
  const filteredSeriesCount = filteredFamilies.reduce((total, family) => total + family.series.length, 0)
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

      <div className={styles.grid}>
        <article className={styles.card} aria-label={t('backend')}>
          <span className={styles.cardLabel}>{t('backend')}</span>
          <strong className={styles.backend}>{metrics.backend}</strong>
        </article>

        <article className={styles.card} aria-label={t('requests')}>
          <span className={styles.cardLabel}>{t('requests')}</span>
          <dl className={styles.splitMetrics}>
            <div><dt>{t('running')}</dt><dd>{metrics.requestsRunning}</dd></div>
            <div><dt>{t('waiting')}</dt><dd>{metrics.requestsWaiting}</dd></div>
          </dl>
          <p className={styles.note}>{t('queueNote')}</p>
        </article>

        <article className={styles.card} aria-label={t('kvCache')}>
          <span className={styles.cardLabel}>{t('kvCache')}</span>
          <strong className={styles.metric}>{percent === undefined ? t('unavailable') : `${String(percent)}%`}</strong>
          {percent === undefined ? null : (
            <div
              className={styles.progress}
              role="progressbar"
              aria-label={t('kvCache')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <span style={{ width: `${String(percent)}%` }} />
            </div>
          )}
        </article>

        <article className={styles.card} aria-label={t('tokens')}>
          <span className={styles.cardLabel}>{t('tokens')}</span>
          <dl className={styles.tokenMetrics}>
            <div><dt>{t('promptTokens')}</dt><dd>{count(metrics.promptTokensTotal, t('unavailable'))}</dd></div>
            <div><dt>{t('generationTokens')}</dt><dd>{count(metrics.generationTokensTotal, t('unavailable'))}</dd></div>
            <div><dt>{t('preemptions')}</dt><dd>{count(metrics.preemptionsTotal, t('unavailable'))}</dd></div>
          </dl>
        </article>
      </div>

      <section className={styles.explorer} aria-labelledby="inference-all-metrics-title">
        <header className={styles.explorerHeader}>
          <div>
            <h3 id="inference-all-metrics-title" className={styles.explorerTitle}>{t('allMetrics')}</h3>
            <p className={styles.explorerDescription}>{t('allMetricsDescription')}</p>
          </div>
          <label className={styles.search}>
            <span>{t('search')}</span>
            <input
              type="search"
              value={query}
              placeholder={t('searchPlaceholder')}
              onChange={(event) => { setQuery(event.currentTarget.value) }}
            />
          </label>
        </header>
        <p className={styles.resultCount} role="status">
          {query.trim().length === 0
            ? `${String(metrics.metricFamilies.length)} ${t('families')} · ${String(seriesCount)} ${t('series')}`
            : `${String(filteredFamilies.length)} ${t('families')} · ${String(filteredSeriesCount)} ${t('matchingSeries')}`}
        </p>
        {filteredFamilies.length === 0 ? (
          <p className={styles.noResults}>{t('noResults')}</p>
        ) : (
          <div className={styles.familyList}>
            {filteredFamilies.map(family => (
              <article className={styles.family} key={family.name}>
                <header className={styles.familyHeader}>
                  <code>{family.name}</code>
                  {family.type === undefined ? null : <span className={styles.type}>{family.type}</span>}
                </header>
                {family.help === undefined ? null : <p className={styles.help}>{family.help}</p>}
                <div className={styles.tableScroll}>
                  <table className={styles.metricTable}>
                    <thead>
                      <tr>
                        <th scope="col">{t('metric')}</th>
                        <th scope="col">{t('labels')}</th>
                        <th scope="col">{t('value')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {family.series.map((item, index) => (
                        <tr key={`${item.metric}:${String(index)}`}>
                          <td><code>{item.metric}</code></td>
                          <td><code>{labels(item, t('noLabels'))}</code></td>
                          <td><code>{item.value}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  )
}
