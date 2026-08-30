// @vitest-environment jsdom
/**
 * ui-pipeline browser half: the plugin registers the sidebar block and the
 * overlay editor over one shared store; the nav block lists pipelines from
 * the Remote face, toggles scheduling, and opens the editor; the editor
 * loads the definition and runs, triggers a manual run, and closes. The DAG
 * layout runs real elkjs over a fixture definition.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { PipelineSummary, WorkflowJson } from '@deepseek-ai/dsh-pipeline/types'
import type { PipelineRunRecord } from '@deepseek-ai/dsh-pipeline-local/types'
import { PipelineId, PipelineNodeId } from '@deepseek-ai/dsh-pipeline'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'
import { PipelineCanvas } from '../src/client/PipelineCanvas.tsx'

// jsdom has no ResizeObserver; React Flow's measurement layer needs one.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)
import { PipelinesNav } from '../src/client/PipelinesNav.tsx'
import { PipelineEditor } from '../src/client/PipelineEditor.tsx'
import { layoutDag } from '../src/client/PipelineCanvas.tsx'
import { createPipelineUiStore, type PipelineApi } from '../src/client/slots.ts'
import { zh } from '../src/client/locales.ts'

// The framework-injected t seat, stubbed over the zh dictionaries (the default locale).
const t: Parameters<typeof PipelinesNav>[0]['t'] = makeTranslate(zh, commonZh)

afterEach(cleanup)

const sid = (id: string): PipelineSummary['id'] => PipelineId(id)
const nid = (id: string): PipelineNodeId => PipelineNodeId(id)

/** Root-scope components never read these; the aggregate props share still requires them. */
const neverHook = (): never => {
  throw new Error('unused')
}

/** Standard nav props over a fresh store share; per-test overrides spread after it. */
function navProps(api: PipelineApi, share = makeStoreShare()): PipelinesNavProps {
  return {
    wide: true,
    expandSidebar: () => {},
    ...share,
    api,
    openEditor: vi.fn(),
    useSessions: neverHook,
    useWorkspaces: neverHook,
    t,
  } as PipelinesNavProps
}

function summary(over: Partial<PipelineSummary> = {}): PipelineSummary {
  return {
    id: sid('sch-search'),
    name: 'arXiv digest',
    enabled: true,
    status: 'idle',
    failureStreak: 0,
    runCount: 2,
    skippedCount: 0,
    ...over,
  }
}

function definition(): WorkflowJson {
  return {
    version: 1,
    id: sid('sch-search'),
    name: 'arXiv digest',
    trigger: { kind: 'cron', expression: '0 9 * * 1', timeZone: 'UTC', enabled: true },
    nodes: [
      { id: nid('trigger'), type: 'trigger' },
      { id: nid('collect'), type: 'builtin', ref: 'scheduled-search/search', config: {} },
    ],
    edges: [{ from: nid('trigger'), to: nid('collect') }],
  }
}

function runRecord(ordinal: number, status: 'completed' | 'failed'): PipelineRunRecord {
  return { runId: `sch-search-run-${ordinal}`, startedAt: 1, finishedAt: 2, status, nodeCount: 2 }
}

/** Build one Remote method: records its name, answers `value` through the ok envelope. */
const okMethod = (calls: string[], name: string) =>
  <T,>(value: T): () => Promise<{ ok: true; value: T }> => () => {
    calls.push(name)
    return Promise.resolve({ ok: true, value })
  }

/** Fake pipelines Remote face; every method records its name and answers ok. */
function makeApi(over: Partial<Parameters<typeof PipelinesNav>[0]['api']> = {}) {
  const calls: string[] = []
  const ok = (name: string) => okMethod(calls, name)
  const api = {
    list: ok('list')([summary()]),
    get: ok('get')(definition()),
    setEnabled: ok('setEnabled')(true),
    remove: ok('remove')(true),
    triggerNow: ok('triggerNow')({ outcome: 'started', runId: 'sch-search-run-3', result: { status: 'completed', nodeCount: 2 } } as const),
    runs: ok('runs')([runRecord(1, 'completed'), runRecord(2, 'failed')]),
    ...over,
  }
  return { api, calls }
}

/** A live store instance plus its PropsStore share, exactly as production binds them. */
function makeStoreShare() {
  const instance = createPipelineUiStore().create()
  return { instance, useStore: bindSnapshotSelector(instance), actions: instance.actions }
}

/** A recording fake for the host's `remote.pipelines` namespace. */
function makeRemoteFake() {
  const calls: string[] = []
  const ok = (name: string) => okMethod(calls, name)
  return {
    calls,
    remote: {
      list: ok('list')([summary()]),
      get: ok('get')(definition()),
      setEnabled: ok('setEnabled')(true),
      delete: ok('delete')(true),
      triggerNow: ok('triggerNow')({ outcome: 'started', runId: 'sch-search-run-3', result: { status: 'completed', nodeCount: 2 } } as const),
      runs: ok('runs')([runRecord(1, 'completed'), runRecord(2, 'failed')]),
    },
  }
}

describe('ui-pipeline browser plugin', () => {
  it('registers both entries whose inject faces ride ctx.remote.pipelines and the shared store', async () => {
    const { calls, remote } = makeRemoteFake()
    const ctx = new Context()
    class RemoteService extends Service {
      constructor(serviceCtx: Context) {
        super(serviceCtx, 'remote')
      }
    }
    new RemoteService(ctx)
    ctx.provide('remote.pipelines', remote)
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({
      name: 'root', children: {
        'sidebar.pipelines': { kind: 'single', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
    } as never, (() => null) as never)
    ctx.provide('locale', new LocaleRuntime(ctx))
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    const nav = ctx.slots.entries('sidebar.pipelines')[0]
    const editor = ctx.slots.entries('shell.overlay')[0]
    expect(nav?.locale).toBe('pipeline')
    expect(nav?.store).toBeDefined()
    expect(editor?.options).toMatchObject({ id: 'pipeline-editor', order: 20 })

    // The real inject faces route through ctx.remote.pipelines — drive every
    // verb through the nav face and exercise openEditor's store write.
    let openedId: string | null = null
    const navInject = nav?.inject?.({ open: (id: unknown) => { openedId = id as string | null } } as never) as unknown as {
      api: PipelineApi
      openEditor: (id: string) => void
    }
    await navInject.api.list()
    await navInject.api.get('sch-search')
    await navInject.api.setEnabled('sch-search', false)
    await navInject.api.remove('sch-search')
    await navInject.api.triggerNow('sch-search')
    await navInject.api.runs('sch-search')
    expect(calls).toEqual(['list', 'get', 'setEnabled', 'delete', 'triggerNow', 'runs'])
    navInject.openEditor('sch-search')
    expect(openedId).toBe('sch-search')

    // The editor face rides the same remote namespace.
    const editorInject = editor?.inject?.() as unknown as { api: PipelineApi }
    await editorInject.api.list()
    expect(calls[calls.length - 1]).toBe('list')

    // The node half is a pure marker plugin.
    expect(nodeApply).not.toThrow()
    nodeApply()
  })
})

describe('PipelinesNav', () => {
  it('lists pipelines with the failure badge and opens the editor on click', async () => {
    const { api, calls } = makeApi()
    const openEditor = vi.fn()
    const share = makeStoreShare()
    render(<PipelinesNav {...navProps(api, share)} openEditor={openEditor} />)
    await screen.findByText('arXiv digest')
    expect(screen.queryByText('连续失败 ×2')).toBeNull()
    fireEvent.click(screen.getByTestId('pipeline-sch-search'))
    expect(openEditor).toHaveBeenCalledWith('sch-search')
    expect(share.instance.getSnapshot().openId).toBe('sch-search')
    expect(calls).toEqual(['list'])
  })

  it('shows the failure badge for a failing streak', async () => {
    const { api } = makeApi({ list: () => Promise.resolve({ ok: true, value: [summary({ failureStreak: 2 })] }) })
    render(<PipelinesNav {...navProps(api)} />)
    await screen.findByText('连续失败 ×2')
  })

  it('renders a paused pipeline with its resume toggle', async () => {
    const { api } = makeApi({ list: () => Promise.resolve({ ok: true, value: [summary({ enabled: false })] }) })
    render(<PipelinesNav {...navProps(api)} />)
    await screen.findByText('arXiv digest')
    expect(screen.getByRole('button', { name: '恢复' })).toBeTruthy()
  })

  it('keeps the list when the post-toggle refresh fails', async () => {
    const { api, calls } = makeApi()
    const failingList = (): Promise<{ ok: false; error: { code: string; message: string; details: object; retryable: boolean } }> => {
      calls.push('list')
      return Promise.resolve({ ok: false, error: { code: 'x', message: 'boom', details: {}, retryable: false } })
    }
    // The component reads `api.list` per call; the indirection lets the test
    // swap the list answer after setEnabled.
    let listAnswer = api.list
    const apiWithFailingRefresh = {
      ...api,
      list: (): ReturnType<typeof api.list> => listAnswer(),
      setEnabled: (): Promise<{ ok: true; value: boolean }> => {
        calls.push('setEnabled')
        listAnswer = failingList
        return Promise.resolve({ ok: true, value: true })
      },
    }
    render(<PipelinesNav {...navProps(apiWithFailingRefresh)} />)
    await screen.findByText('arXiv digest')
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    await waitFor(() => { expect(calls).toEqual(['list', 'setEnabled', 'list']) })
  })

  it('shows the empty state when no pipelines exist', async () => {
    const { api } = makeApi({ list: () => Promise.resolve({ ok: true, value: [] }) })
    render(<PipelinesNav {...navProps(api)} />)
    await screen.findByText('还没有流水线')
  })

  it('shows the load-error row when the Remote face fails', async () => {
    const { api } = makeApi({ list: () => Promise.resolve({ ok: false, error: { code: 'x', message: 'boom', details: {}, retryable: false } }) })
    render(<PipelinesNav {...navProps(api)} />)
    await screen.findByText('加载流水线失败')
  })

  it('ignores a stale list answer after unmount', async () => {
    let resolveList: ((value: { ok: true; value: readonly PipelineSummary[] }) => void) | undefined
    const { api } = makeApi({ list: () => new Promise((resolve) => { resolveList = resolve }) })
    const view = render(<PipelinesNav {...navProps(api)} />)
    view.unmount()
    await act(async () => {
      resolveList?.({ ok: true, value: [summary()] })
    })
  })

  it('toggles scheduling through setEnabled and refreshes the list', async () => {
    const { api, calls } = makeApi()
    const props = { wide: true, expandSidebar: () => {}, ...makeStoreShare(), api, openEditor: vi.fn(), t,
      useSessions: neverHook, useWorkspaces: neverHook } as const
    render(<PipelinesNav {...props} />)
    await screen.findByText('arXiv digest')
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    await waitFor(() => {
      expect(calls).toEqual(['list', 'setEnabled', 'list'])
    })
  })
})

describe('PipelineEditor', () => {
  it('renders nothing while no pipeline is open', () => {
    const { api } = makeApi()
    const share = makeStoreShare()
    const view = render(<PipelineEditor useSessions={neverHook} useWorkspaces={neverHook} {...share} api={api} t={t} />)
    expect(view.container.firstChild).toBeNull()
  })

  it('loads the open definition, renders the canvas and runs, and closes', async () => {
    const { api, calls } = makeApi()
    const share = makeStoreShare()
    share.actions.open('sch-search')
    const view = render(<PipelineEditor useSessions={neverHook} useWorkspaces={neverHook} {...share} api={api} t={t} />)
    await screen.findByText('arXiv digest')
    await screen.findByTestId('pipeline-canvas')
    expect(screen.getByText('运行历史')).toBeTruthy()
    expect(screen.getByText('sch-search-run-2')).toBeTruthy()
    expect(screen.getByText('失败')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    await waitFor(() => { expect(view.container.firstChild).toBeNull() })
    expect(calls).toEqual(['get', 'runs'])
    expect(share.instance.getSnapshot().openId).toBeNull()
  })

  it('runs the pipeline now and refreshes the runs list', async () => {
    const { api, calls } = makeApi()
    const share = makeStoreShare()
    share.actions.open('sch-search')
    render(<PipelineEditor useSessions={neverHook} useWorkspaces={neverHook} {...share} api={api} t={t} />)
    await screen.findByTestId('pipeline-canvas')
    fireEvent.click(screen.getByRole('button', { name: '立即运行' }))
    await waitFor(() => {
      expect(calls).toEqual(['get', 'runs', 'triggerNow', 'runs'])
    })
  })

  it('shows the load-error row when the definition fails to load', async () => {
    const { api } = makeApi({ get: () => Promise.resolve({ ok: false, error: { code: 'x', message: 'boom', details: {}, retryable: false } }) })
    const share = makeStoreShare()
    share.actions.open('sch-search')
    render(<PipelineEditor useSessions={neverHook} useWorkspaces={neverHook} {...share} api={api} t={t} />)
    await screen.findByText('加载流水线失败')
  })

  it('shows the empty runs list when no run has settled', async () => {
    const { api } = makeApi({ runs: () => Promise.resolve({ ok: true, value: [] }) })
    const share = makeStoreShare()
    share.actions.open('sch-search')
    render(<PipelineEditor useSessions={neverHook} useWorkspaces={neverHook} {...share} api={api} t={t} />)
    await screen.findByTestId('pipeline-canvas')
    await screen.findByText('还没有运行记录')
  })

  it('keeps the runs panel empty when the runs fetch fails', async () => {
    const { api } = makeApi({ runs: () => Promise.resolve({ ok: false, error: { code: 'x', message: 'boom', details: {}, retryable: false } }) })
    const share = makeStoreShare()
    share.actions.open('sch-search')
    render(<PipelineEditor useSessions={neverHook} useWorkspaces={neverHook} {...share} api={api} t={t} />)
    await screen.findByTestId('pipeline-canvas')
    await screen.findByText('还没有运行记录')
  })

  it('falls back to the raw id for the title while the definition is in flight and ignores stale answers after close', async () => {
    let resolveGet: ((value: Awaited<ReturnType<PipelineApi['get']>>) => void) | undefined
    const { api } = makeApi({ get: () => new Promise((resolve) => { resolveGet = resolve }) })
    const share = makeStoreShare()
    share.actions.open('sch-search')
    const view = render(<PipelineEditor useSessions={neverHook} useWorkspaces={neverHook} {...share} api={api} t={t} />)
    // Title falls back to the id; the runs guard returns early on the same render.
    await screen.findByText('sch-search')
    expect(screen.queryByTestId('pipeline-canvas')).toBeNull()
    // Closing unmounts the waiters: the late get answer must not land.
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    await act(async () => {
      resolveGet?.({ ok: true, value: definition() })
    })
    expect(view.container.firstChild).toBeNull()
  })
})

describe('PipelineCanvas', () => {
  it('renders the read-only canvas with one node card per definition node and reports selection', async () => {
    let selected: string | null = 'sentinel'
    render(
      <PipelineCanvas
        definition={definition()}
        selectedId={null}
        onSelect={(id) => { selected = id }}
      />,
    )
    await screen.findByTestId('pipeline-canvas')
    // Layout settles: every definition node card renders with its label.
    await waitFor(() => { expect(screen.getByTestId('rf__node-collect').textContent).toContain('builtin · scheduled-search/search') })
    expect(screen.getByTestId('rf__node-trigger').textContent).toContain('trigger')
    // Node clicks report the node; pane clicks clear the selection.
    fireEvent.click(screen.getByTestId('rf__node-collect'))
    await waitFor(() => { expect(selected).toBe('collect') })
    fireEvent.click(screen.getByTestId('pipeline-canvas').querySelector('.react-flow__pane') as Element)
    await waitFor(() => { expect(selected).toBeNull() })
  })

  it('highlights the selected node and labels every node type', async () => {
    const withKinds = {
      ...definition(),
      nodes: [
        { id: nid('trigger'), type: 'trigger' },
        { id: nid('collect'), type: 'builtin', ref: 'scheduled-search/search', config: {} },
        { id: nid('ask'), type: 'llm', prompt: 'Summarize.' },
        { id: nid('verify'), type: 'agent', prompt: 'Check.' },
      ],
      edges: [
        { from: nid('trigger'), to: nid('collect') },
        { from: nid('collect'), to: nid('ask') },
        { from: nid('ask'), to: nid('verify') },
      ],
    }
    render(<PipelineCanvas definition={withKinds} selectedId="collect" onSelect={() => {}} />)
    await screen.findByTestId('pipeline-canvas')
    await waitFor(() => { expect(screen.getByTestId('rf__node-ask').textContent).toContain('llm · ask') })
    expect(screen.getByTestId('rf__node-verify').textContent).toContain('agent · verify')
    expect(screen.getByTestId('rf__node-collect').className).toContain('selected')
  })
})

describe('layoutDag', () => {
  it('computes layered positions with the trigger above its child', async () => {
    const laid = await layoutDag(definition())
    expect(laid.map(node => node.id)).toEqual(['trigger', 'collect'])
    const trigger = laid.find(node => node.id === 'trigger') as { y: number; isTrigger: boolean }
    const collect = laid.find(node => node.id === 'collect') as { y: number }
    expect(trigger.isTrigger).toBe(true)
    expect(collect.y).toBeGreaterThan(trigger.y)
  })
})
