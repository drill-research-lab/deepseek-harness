// @vitest-environment jsdom
/**
 * LlmQueueIndicator: renders the admission-queue position strip while this
 * session's `llmQueue.state === 'waiting'`, follows live snapshot updates,
 * and stays hidden once admitted (`running`) or not queued (`null`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import {
  EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh, NS } from '../src/client/locales.ts'
import {
  LlmQueueIndicator, llmQueueIndicatorEntry, type LlmQueueIndicatorProps,
} from '../src/client/queue/LlmQueueIndicator.tsx'

afterEach(cleanup)

const SID = 's1' as SessionId

const t: LlmQueueIndicatorProps['t'] = makeTranslate(zh, commonZh)

function snapshotWith(llmQueue: ConversationSnapshot['llmQueue']): ConversationSnapshot {
  return {
    sessionId: SID, views: EMPTY_CONVERSATION_VIEWS, chat: EMPTY_CHAT_SNAPSHOT,
    nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
    pending: [], queue: [], llmQueue, running: false, composerPhase: 'active', removed: false,
    openState: 'open', openError: null, hasMore: false, loadingOlder: false, promptError: null,
    blank: false, subagent: null, lastAgentError: null,
  }
}

/** Minimal live source backing the useSession stub. */
function liveSession(initial: ConversationSnapshot) {
  let snapshot = initial
  const listeners = new Set<() => void>()
  const useSession: SnapshotSelectorHook<ConversationSnapshot> = selector =>
    useSyncExternalStore(
      (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      () => selector(snapshot),
    )
  return {
    useSession,
    push(next: ConversationSnapshot): void {
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
  }
}

/** Props kit: the component reads useSession/t only; the rest of the dock owner share is unused. */
function kitFor(useSession: SnapshotSelectorHook<ConversationSnapshot>): LlmQueueIndicatorProps {
  return { useSession, t } as unknown as LlmQueueIndicatorProps
}

describe('LlmQueueIndicator', () => {
  it('renders nothing while not queued', () => {
    const source = liveSession(snapshotWith(null))
    const { container } = render(<LlmQueueIndicator {...kitFor(source.useSession)} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing once admitted (running)', () => {
    const source = liveSession(snapshotWith({ position: 0, state: 'running' }))
    const { container } = render(<LlmQueueIndicator {...kitFor(source.useSession)} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the 1-based position while waiting', () => {
    const source = liveSession(snapshotWith({ position: 3, state: 'waiting' }))
    render(<LlmQueueIndicator {...kitFor(source.useSession)} />)
    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByText('您的请求排在第 3 位')).toBeTruthy()
  })

  it('follows a pushed update from waiting to running, clearing the strip', () => {
    const source = liveSession(snapshotWith({ position: 2, state: 'waiting' }))
    render(<LlmQueueIndicator {...kitFor(source.useSession)} />)
    expect(screen.getByText('您的请求排在第 2 位')).toBeTruthy()
    act(() => { source.push(snapshotWith({ position: 0, state: 'running' })) })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('registers in the input dock at order 5', () => {
    const register = vi.fn(() => () => undefined)
    const inject = vi.fn((_name: string, callback: () => () => void) => callback())
    llmQueueIndicatorEntry.apply({ slots: { inject, register } } as never)
    expect(inject).toHaveBeenCalledWith('conversation.input.dock', expect.any(Function))
    expect(register).toHaveBeenCalledWith(
      { name: 'conversation.input.dock', id: 'llm-queue', order: 5, locale: NS },
      LlmQueueIndicator,
    )
  })
})
