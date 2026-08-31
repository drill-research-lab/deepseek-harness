/**
 * Unity-style inspector for the selected canvas node: a 設定 pane with
 * per-type editable config, a 下游 (edges) pane, and input/output panes that
 * stay empty until run sessions project per-node data. Edits hold a local
 * draft of the definition; commit replaces the whole definition via `save`.
 * @module Inspector
 */

import { useEffect, useState } from 'react'
import type { PipelineNode, PipelineNodeId, WorkflowJson } from '@deepseek-ai/dsh-pipeline/types'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import styles from './Inspector.module.css'

/** Component props: the working definition draft, the selection, and the commit callback. */
export interface InspectorProps {
  /** The working draft; edits are proposed through `onChange`. */
  definition: WorkflowJson
  /** The selected node id, or `null` when nothing is selected. */
  selectedId: string | null
  /** Propose a new definition draft. */
  onChange: (definition: WorkflowJson) => void
  /** Commit the draft through the Remote face. */
  onCommit: () => void
  /** Whether a commit is in flight. */
  busy: boolean
}

type InspectorAllProps = InspectorProps & PropsLocale<'pipeline'>

/**
 * Replaces one node in the draft's node list.
 * @param definition - the draft.
 * @param nodeId - the node to replace.
 * @param node - the replacement.
 * @returns the updated draft (same identity when the id is unknown).
 */
function withNode(definition: WorkflowJson, nodeId: string, node: PipelineNode): WorkflowJson {
  return {
    ...definition,
    nodes: definition.nodes.map(existing => (String(existing.id) === nodeId ? node : existing)),
  }
}

/**
 * The inspector panel. Renders nothing without a selection; for the selected
 * node it shows the type-appropriate config editor plus the downstream-edges
 * list, and a commit button whenever the draft differs from the definition.
 * @param props - draft, selection, change/commit callbacks, and copy.
 * @returns the panel, or `null` without a selection.
 */
export function Inspector({ definition, selectedId, onChange, onCommit, busy, t }: InspectorAllProps): React.JSX.Element | null {
  const selected = definition.nodes.find(node => String(node.id) === selectedId)
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')

  useEffect(() => {
    if (selected?.type === 'llm') {
      setPrompt(selected.prompt)
      setModel(selected.model ?? '')
    }
  }, [selected])

  if (selected === undefined) return null

  const downstream = definition.edges.filter(edge => String(edge.from) === String(selected.id))

  const setEdgeTarget = (index: number, to: PipelineNodeId): void => {
    const edges = definition.edges.map((edge, i) => (i === index ? { ...edge, to } : edge))
    onChange({ ...definition, edges })
  }

  return (
    <div className={styles.panel} data-testid="pipeline-inspector">
      <div className={styles.kind}>{selected.type}</div>

      {selected.type === 'trigger' && (
        <label className={styles.field}>
          {t('create.cron')}
          <input
            value={definition.trigger.expression}
            onChange={(e) => {
              onChange({ ...definition, trigger: { ...definition.trigger, expression: e.target.value } })
            }}
            data-testid="inspector-cron"
          />
        </label>
      )}

      {selected.type === 'llm' && (
        <>
          <label className={styles.field}>
            {t('inspector.prompt')}
            <textarea
              value={prompt}
              onChange={(e) => { setPrompt(e.target.value) }}
              onBlur={() => { onChange(withNode(definition, String(selected.id), { ...selected, prompt })) }}
              data-testid="inspector-prompt"
            />
          </label>
          <label className={styles.field}>
            {t('inspector.model')}
            <input
              value={model}
              onChange={(e) => { setModel(e.target.value) }}
              onBlur={() => {
                const next = model === '' ? (({ model: _m, ...rest }) => rest)(selected) : { ...selected, model }
                onChange(withNode(definition, String(selected.id), next))
              }}
              data-testid="inspector-model"
            />
          </label>
        </>
      )}

      {selected.type === 'builtin' && (
        <div className={styles.readonly} data-testid="inspector-builtin">
          {selected.ref}
        </div>
      )}

      <h4>{t('inspector.downstream')}</h4>
      {downstream.length === 0 && <p className={styles.empty}>{t('inspector.noDownstream')}</p>}
      {downstream.map((edge, index) => (
        <label key={`${String(edge.from)}->${String(edge.to)}-${index}`} className={styles.field}>
          <select
            value={String(edge.to)}
            onChange={(e) => { setEdgeTarget(index, e.target.value as PipelineNodeId) }}
            data-testid={`inspector-edge-${index}`}
          >
            {definition.nodes.filter(node => String(node.id) !== String(selected.id)).map(node => (
              <option key={String(node.id)} value={String(node.id)}>{String(node.id)}</option>
            ))}
          </select>
        </label>
      ))}

      <button type="button" className={styles.commit} disabled={busy} onClick={onCommit}>
        {t('inspector.commit')}
      </button>
    </div>
  )
}
