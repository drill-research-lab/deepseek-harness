/** The General section: one column rendering feature-owned item contributions. */
import { useEffect, useState } from 'react'
import type { CurrentUserView } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './GeneralSection.module.css'

/** Data access injected by the settings shell registration. */
export interface GeneralSectionInjected {
  loadCurrentUser(): Promise<CurrentUserView | undefined>
}

type AccountState =
  | { status: 'loading' }
  | { status: 'ready'; user: CurrentUserView }
  | { status: 'empty' }
  | { status: 'failed' }

/** Full component props: section owner share plus item render share. */
export type GeneralSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.general.item'> &
  InjectFace<GeneralSectionInjected> & PropsLocale<'settings'>

/**
 * Render the General section content column.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the section element tree.
 */
export function GeneralSection({ loadCurrentUser, renderSlot, t }: GeneralSectionComponentProps) {
  const [account, setAccount] = useState<AccountState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setAccount({ status: 'loading' })
    void loadCurrentUser().then((current) => {
      if (!active) return
      setAccount(current === undefined ? { status: 'empty' } : { status: 'ready', user: current })
    }).catch(() => {
      if (active) setAccount({ status: 'failed' })
    })
    return () => { active = false }
  }, [attempt, loadCurrentUser])

  return (
    <div className={css.section}>
      <section className={css.account} aria-label={t('account.title')}>
        <span className={css.accountLabel}>{t('account.title')}</span>
        {account.status === 'ready' ? (
          <>
            <strong>{account.user.username}</strong>
            <span className={css.userId}>{account.user.userId}</span>
          </>
        ) : account.status === 'failed' ? (
          <div className={css.accountStatus} role="alert">
            <span>{t('account.error')}</span>
            <button type="button" className={css.retry} onClick={() => { setAttempt(value => value + 1) }}>
              {t('account.retry')}
            </button>
          </div>
        ) : (
          <span className={css.accountStatus} role="status">
            {t(account.status === 'loading' ? 'account.loading' : 'account.empty')}
          </span>
        )}
      </section>
      {renderSlot('settings.general.item', {})}
    </div>
  )
}
