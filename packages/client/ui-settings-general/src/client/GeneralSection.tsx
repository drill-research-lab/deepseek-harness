/** The General section: one column rendering feature-owned item contributions. */
import { useEffect, useState } from 'react'
import type { CurrentUserView } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './GeneralSection.module.css'

/** Data access injected by the settings shell registration. */
export interface GeneralSectionInjected {
  loadCurrentUser(): Promise<CurrentUserView>
}

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
  const [user, setUser] = useState<CurrentUserView>()

  useEffect(() => {
    let active = true
    void loadCurrentUser().then((current) => {
      if (active) setUser(current)
    }).catch(() => undefined)
    return () => { active = false }
  }, [loadCurrentUser])

  return (
    <div className={css.section}>
      {user === undefined ? null : (
        <section className={css.account} aria-label={t('account.title')}>
          <span className={css.accountLabel}>{t('account.title')}</span>
          <strong>{user.username}</strong>
          <span className={css.userId}>{user.userId}</span>
        </section>
      )}
      {renderSlot('settings.general.item', {})}
    </div>
  )
}
