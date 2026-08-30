/**
 * Pure WorkflowJSON validation: shape, per-node-type fields, graph rules
 * (endpoints, duplicates, acyclicity, single trigger), and trigger format.
 * No I/O and no Cordis state — the load-time parser boundary for hand- or
 * LLM-authored definitions.
 * @module @deepseek-ai/dsh-pipeline/validate
 */

import { PipelineSchemaError } from './errors.ts'
import type { PipelineSchemaErrorCode } from './errors.ts'
import type { PipelineEdge, PipelineNode, PipelineTrigger, WorkflowJson } from './types.ts'

/** The `WorkflowJson` top-level field set; unknown fields reject (typo protection). */
const DEFINITION_KEYS: readonly string[] = ['version', 'id', 'name', 'description', 'template', 'trigger', 'nodes', 'edges']

/** The `trigger` field set for the v1 (`cron`) discriminant. */
const TRIGGER_KEYS: readonly string[] = ['kind', 'expression', 'timeZone', 'enabled']

/** Fields shared by every node, valid on each node type. */
const NODE_BASE_KEYS: readonly string[] = ['id', 'type', 'disabled', 'notes']

/** Every node-type discriminant this vocabulary version defines. */
const NODE_TYPES: readonly string[] = ['trigger', 'builtin', 'llm', 'agent']

/**
 * Validate one pipeline definition, or throw a {@link PipelineSchemaError}
 * naming the first defect's field path. Returns the same data with branded
 * id types (a zero-cost cast: ids are validated strings).
 * @param value - the candidate definition, as parsed JSON data.
 * @returns the validated definition.
 * @throws PipelineSchemaError with a `PIPELINE`-family error code on the first violated rule.
 */
export function validateWorkflowJson(value: unknown): WorkflowJson {
  const def = asRecord(value, 'must be a JSON object', 'DEFINITION_INVALID')
  rejectUnknownKeys(def, DEFINITION_KEYS, '', 'DEFINITION_INVALID')
  if (def.version !== 1) fail('VERSION_UNSUPPORTED', `version must be 1, got ${String(def.version)}`)
  const id = requireString(def.id, 'id', 'ID_INVALID')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    fail('ID_INVALID', 'id must be lowercase kebab-case ([a-z0-9-], no leading hyphen)')
  }
  const name = requireString(def.name, 'name', 'NAME_INVALID')
  if (name.length === 0) fail('NAME_INVALID', 'name must be a non-empty string')
  if (def.description !== undefined && typeof def.description !== 'string') {
    fail('DESCRIPTION_INVALID', 'description must be a string')
  }
  validateTemplate(def.template)
  validateTrigger(def.trigger)
  const nodes = validateNodes(def.nodes)
  const edges = validateEdges(def.edges, nodes)
  detectCycles(nodes, edges)
  return def as unknown as WorkflowJson
}

/** Validate the optional template-provenance block. */
function validateTemplate(value: unknown): void {
  if (value === undefined) return
  const template = asRecord(value, 'template must be a JSON object', 'TEMPLATE_REF_INVALID')
  rejectUnknownKeys(template, ['ref', 'inputs'], 'template', 'TEMPLATE_REF_INVALID')
  const ref = requireString(template.ref, 'template.ref', 'TEMPLATE_REF_INVALID')
  if (ref.length === 0) fail('TEMPLATE_REF_INVALID', 'template.ref must be a non-empty string')
  if (template.inputs === undefined) return
  const inputs = asRecord(template.inputs, 'template.inputs must be a JSON object', 'TEMPLATE_REF_INVALID')
  for (const [key, entry] of Object.entries(inputs)) {
    if (!isJsonValue(entry)) fail('TEMPLATE_REF_INVALID', `template.inputs.${key} must be JSON data`)
  }
}

/** Validate the trigger block against the v1 (`cron`) vocabulary. */
function validateTrigger(value: unknown): PipelineTrigger {
  const trigger = asRecord(value, 'trigger must be a JSON object', 'TRIGGER_INVALID')
  rejectUnknownKeys(trigger, TRIGGER_KEYS, 'trigger', 'TRIGGER_INVALID')
  if (trigger.kind !== 'cron') {
    fail('TRIGGER_KIND_UNKNOWN', `trigger.kind must be "cron", got ${String(trigger.kind)}`)
  }
  const expression = requireString(trigger.expression, 'trigger.expression', 'CRON_EXPRESSION_INVALID')
  if (!isWellFormedCronExpression(expression)) {
    fail('CRON_EXPRESSION_INVALID', 'trigger.expression must be a five-field cron expression (minute hour day month weekday)')
  }
  const timeZone = requireString(trigger.timeZone, 'trigger.timeZone', 'TIME_ZONE_INVALID')
  if (!isValidTimeZone(timeZone)) {
    fail('TIME_ZONE_INVALID', `trigger.timeZone must be an IANA zone name, got ${JSON.stringify(timeZone)}`)
  }
  if (typeof trigger.enabled !== 'boolean') fail('TRIGGER_INVALID', 'trigger.enabled must be a boolean')
  return trigger as unknown as PipelineTrigger
}

/**
 * Check the structural part of a cron expression: exactly five
 * whitespace-separated fields over the standard cron character set. Range and
 * step semantics are the scheduler provider's contract, checked when it
 * parses the expression.
 * @param expression - the candidate cron expression.
 * @returns true when the expression has five well-formed fields.
 */
function isWellFormedCronExpression(expression: string): boolean {
  const fields = expression.trim().split(/\s+/)
  return fields.length === 5 && fields.every(field => /^[0-9*/,-]+$/.test(field))
}

/**
 * Check an IANA time zone name against the runtime's database.
 * @param zone - the candidate zone name.
 * @returns true when `Intl` recognizes the zone.
 */
function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    // Intl throws RangeError exactly for zone names the runtime database does not know — that is the check.
    return false
  }
}

/** Validate the node list: non-empty, unique ids, known types, per-type fields, exactly one trigger. */
function validateNodes(value: unknown): Map<string, PipelineNode> {
  if (!Array.isArray(value) || value.length === 0) fail('NODES_INVALID', 'nodes must be a non-empty array')
  const nodesById = new Map<string, PipelineNode>()
  let triggerCount = 0
  for (const [index, item] of value.entries()) {
    const path = `nodes[${index}]`
    const node = asRecord(item, `${path} must be a JSON object`, 'NODE_INVALID')
    if (typeof node.type !== 'string') fail('NODE_INVALID', `${path}.type must be a string`)
    const id = requireString(node.id, `${path}.id`, 'NODE_ID_INVALID')
    if (id.length === 0) fail('NODE_ID_INVALID', `${path}.id must be a non-empty string`)
    if (nodesById.has(id)) fail('NODE_ID_DUPLICATE', `${path}.id duplicates ${JSON.stringify(id)}`)
    if (node.disabled !== undefined && typeof node.disabled !== 'boolean') {
      fail('NODE_FIELD_INVALID', `${path}.disabled must be a boolean`)
    }
    if (node.notes !== undefined && typeof node.notes !== 'string') {
      fail('NODE_FIELD_INVALID', `${path}.notes must be a string`)
    }
    if (!NODE_TYPES.includes(node.type)) {
      fail('NODE_TYPE_UNKNOWN', `${path}.type must be one of ${NODE_TYPES.map(t => JSON.stringify(t)).join('|')}, got ${JSON.stringify(node.type)}`)
    }
    switch (node.type) {
      case 'trigger':
        rejectUnknownKeys(node, NODE_BASE_KEYS, path, 'NODE_INVALID')
        triggerCount += 1
        break
      case 'builtin':
        rejectUnknownKeys(node, [...NODE_BASE_KEYS, 'ref', 'config'], path, 'NODE_INVALID')
        validateNonEmptyString(node.ref, `${path}.ref`)
        if (node.config !== undefined && !isJsonValue(node.config)) {
          fail('NODE_FIELD_INVALID', `${path}.config must be JSON data`)
        }
        break
      case 'llm':
        rejectUnknownKeys(node, [...NODE_BASE_KEYS, 'prompt', 'model'], path, 'NODE_INVALID')
        validateNonEmptyString(node.prompt, `${path}.prompt`)
        validateNonEmptyString(node.model, `${path}.model`)
        break
      case 'agent':
        rejectUnknownKeys(node, [...NODE_BASE_KEYS, 'prompt', 'skills', 'tools'], path, 'NODE_INVALID')
        validateNonEmptyString(node.prompt, `${path}.prompt`)
        validateStringList(node.skills, `${path}.skills`)
        validateStringList(node.tools, `${path}.tools`)
        break
    }
    nodesById.set(id, node as unknown as PipelineNode)
  }
  if (triggerCount !== 1) {
    fail('NODES_INVALID', `exactly one node must have type "trigger", found ${triggerCount}`)
  }
  return nodesById
}

/** Validate the edge list: object shape, known endpoints, no duplicates, never into the trigger. */
function validateEdges(value: unknown, nodesById: ReadonlyMap<string, PipelineNode>): readonly PipelineEdge[] {
  if (!Array.isArray(value)) fail('EDGES_INVALID', 'edges must be an array')
  const seen = new Set<string>()
  for (const [index, item] of value.entries()) {
    const path = `edges[${index}]`
    const edge = asRecord(item, `${path} must be a JSON object`, 'EDGES_INVALID')
    rejectUnknownKeys(edge, ['from', 'to'], path, 'EDGES_INVALID')
    const from = requireString(edge.from, `${path}.from`, 'EDGES_INVALID')
    const to = requireString(edge.to, `${path}.to`, 'EDGES_INVALID')
    if (!nodesById.has(from)) fail('EDGE_ENDPOINT_UNKNOWN', `${path}.from references unknown node ${JSON.stringify(from)}`)
    if (!nodesById.has(to)) fail('EDGE_ENDPOINT_UNKNOWN', `${path}.to references unknown node ${JSON.stringify(to)}`)
    const key = `${JSON.stringify(from)}\u0000${JSON.stringify(to)}`
    if (seen.has(key)) fail('EDGE_DUPLICATE', `${path} duplicates the edge ${JSON.stringify(from)} -> ${JSON.stringify(to)}`)
    seen.add(key)
    if (nodesById.get(to)?.type === 'trigger') {
      fail('EDGE_TARGET_TRIGGER', `${path} targets the trigger node ${JSON.stringify(to)}`)
    }
  }
  return value as readonly PipelineEdge[]
}

/** Reject a cyclic graph (a self-edge included) by depth-first coloring. */
function detectCycles(nodesById: ReadonlyMap<string, PipelineNode>, edges: readonly PipelineEdge[]): void {
  const bySource = new Map<string, PipelineEdge[]>()
  for (const edge of edges) {
    const group = bySource.get(edge.from)
    if (group === undefined) bySource.set(edge.from, [edge])
    else group.push(edge)
  }
  // 0 = unvisited, 1 = on the current path, 2 = fully explored.
  const state = new Map<string, number>()
  const visit = (id: string): void => {
    const current = state.get(id)
    if (current === 1) fail('CYCLE_DETECTED', `nodes form a cycle through ${JSON.stringify(id)}`)
    if (current === 2) return
    state.set(id, 1)
    for (const edge of bySource.get(id) ?? []) visit(edge.to)
    state.set(id, 2)
  }
  for (const id of nodesById.keys()) visit(id)
}

/** Validate one optional non-empty string field. */
function validateNonEmptyString(value: unknown, path: string): void {
  if (value === undefined) return
  if (typeof value !== 'string' || value.length === 0) {
    fail('NODE_FIELD_INVALID', `${path} must be a non-empty string`)
  }
}

/** Validate one optional array-of-non-empty-strings field. */
function validateStringList(value: unknown, path: string): void {
  if (value === undefined) return
  if (!Array.isArray(value)) fail('NODE_FIELD_INVALID', `${path} must be an array of strings`)
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== 'string' || entry.length === 0) {
      fail('NODE_FIELD_INVALID', `${path}[${index}] must be a non-empty string`)
    }
  }
}

/** Throw the load-time rejection for one violated rule. */
function fail(code: PipelineSchemaErrorCode, message: string): never {
  throw new PipelineSchemaError(`pipeline definition: ${message}`, code)
}

/** Require a plain JSON object (arrays are not objects here). */
function asRecord(value: unknown, message: string, code: PipelineSchemaErrorCode): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(code, message)
  return value as Record<string, unknown>
}

/** Require a string field. */
function requireString(value: unknown, path: string, code: PipelineSchemaErrorCode): string {
  if (typeof value !== 'string') fail(code, `${path} must be a string`)
  return value
}

/** Reject field names outside the shape's allowed set. */
function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[], path: string, code: PipelineSchemaErrorCode): void {
  const prefix = path.length > 0 ? `${path}.` : ''
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) fail(code, `${prefix}${key}: unknown field`)
  }
}

/** Check one recursively JSON-representable value (finite numbers only). */
function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(entry => isJsonValue(entry))
  if (typeof value === 'object') return Object.values(value).every(entry => isJsonValue(entry))
  return false
}
