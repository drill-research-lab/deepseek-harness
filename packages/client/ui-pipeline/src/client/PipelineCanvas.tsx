/**
 * Read-only DAG layout and rendering for the pipeline editor: elkjs computes
 * a layered top-down layout (definitions carry no positions by design), and
 * @xyflow/react renders the positioned graph with interaction disabled.
 * @module PipelineCanvas
 */

import ELK from 'elkjs/lib/elk.bundled.js'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from '@xyflow/react'
import type { WorkflowJson } from '@deepseek-ai/dsh-pipeline/types'
import styles from './PipelineCanvas.module.css'

/** Fixed node box the layout solves against; React Flow renders to it. */
const NODE_WIDTH = 208
const NODE_HEIGHT = 56

const elk = new ELK()

/** One laid-out node: the definition node plus its computed top-left origin. */
export interface LaidOutNode {
  /** The node's definition id. */
  id: string
  /** The node's display label. */
  label: string
  /** Whether the node is the trigger. */
  isTrigger: boolean
  /** Layout-computed left offset. */
  x: number
  /** Layout-computed top offset. */
  y: number
}

/** The layout input and result share the plain wire shapes; no positions persist. */
const LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.spacing.nodeNode': '48',
  'elk.layered.spacing.nodeNodeBetweenLayers': '72',
} as const

/**
 * Compute the layered layout for one definition.
 * @param definition - the WorkflowJSON document.
 * @returns the laid-out nodes in definition order.
 */
export async function layoutDag(definition: WorkflowJson): Promise<readonly LaidOutNode[]> {
  const labelOf = (node: WorkflowJson['nodes'][number]): string => {
    switch (node.type) {
      case 'trigger': return 'trigger'
      case 'llm': return `llm · ${String(node.id)}`
      case 'agent': return `agent · ${String(node.id)}`
      case 'builtin': return `builtin · ${node.ref}`
    }
  }
  const graph = {
    id: 'root',
    children: definition.nodes.map(node => ({
      id: String(node.id),
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: definition.edges.map(edge => ({
      id: `${String(edge.from)}->${String(edge.to)}`,
      sources: [String(edge.from)],
      targets: [String(edge.to)],
    })),
  }
  const laid = await elk.layout(graph, { layoutOptions: LAYOUT_OPTIONS })
  /* v8 ignore start -- elk's contract returns every child with a solved box; the
   * fallbacks only exist so a shape change degrades to a visible grid, not a crash. */
  const positions = new Map(
    (laid.children ?? []).map(child => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }]),
  )
  /* v8 ignore end */
  return definition.nodes.map((node) => {
    /* v8 ignore next -- same elk contract: every definition node is laid out. */
    const position = positions.get(String(node.id)) ?? { x: 0, y: 0 }
    return {
      id: String(node.id),
      label: labelOf(node),
      isTrigger: node.type === 'trigger',
      x: position.x,
      y: position.y,
    }
  })
}

/** Component props: the definition to render plus the selected node callback. */
export interface PipelineCanvasProps {
  /** The definition to lay out and render. */
  definition: WorkflowJson
  /** The currently selected node id, or `null`. */
  selectedId: string | null
  /** Select (inspector) callback for a node click. */
  onSelect: (id: string | null) => void
}

/**
 * The read-only DAG canvas. Pure presentation: layout runs per definition
 * change, selection is owner state, and every interaction affordance except
 * node-click selection and zoom is disabled.
 * @param props - definition, selection, and select callback.
 * @returns the canvas.
 */
export function PipelineCanvas({ definition, selectedId, onSelect }: PipelineCanvasProps): React.JSX.Element {
  const empty: readonly LaidOutNode[] = useMemo(() => [], [])
  const [laid, setLaid] = useState(empty)
  useEffect(() => {
    let live = true
    void layoutDag(definition).then((nodes) => {
      if (live) setLaid(nodes)
    })
    return () => {
      live = false
    }
  }, [definition])

  const nodes: Node[] = useMemo(
    () => laid.map((node) => {
      // CSS-module class lookups are `string | undefined` under
      // noUncheckedIndexedAccess; React Flow's Node requires plain strings.
      const kind = node.isTrigger ? styles.triggerNode ?? '' : styles.node ?? ''
      return {
        id: node.id,
        position: { x: node.x, y: node.y },
        draggable: false,
        selectable: false,
        connectable: false,
        data: { label: node.label },
        className: node.id === selectedId ? `${kind} ${styles.selected ?? ''}` : kind,
      } satisfies Node
    }),
    [laid, selectedId, styles],
  )
  const edges: Edge[] = useMemo(
    () => definition.edges.map(edge => ({
      id: `${String(edge.from)}->${String(edge.to)}`,
      source: String(edge.from),
      target: String(edge.to),
      selectable: false,
      animated: false,
    })),
    [definition],
  )
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => { onSelect(node.id) },
    [onSelect],
  )
  const onPaneClick = useCallback(() => { onSelect(null) }, [onSelect])

  return (
    <div className={styles.canvas} data-testid="pipeline-canvas">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          fitView
        >
          <Background />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  )
}
