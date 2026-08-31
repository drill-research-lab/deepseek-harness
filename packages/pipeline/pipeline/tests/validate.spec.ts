import { describe, expect, it } from 'vitest'
import { PipelineSchemaError, validateWorkflowJson } from '@deepseek-ai/dsh-pipeline'

/** One minimal valid definition; each rejection test mutates exactly one field. */
function validDefinition(): Record<string, unknown> {
  return {
    version: 1,
    id: 'sch-search-arxiv',
    name: 'arXiv weekly scan',
    description: 'Collect and summarize arXiv papers',
    template: { ref: 'scheduled-search', inputs: { query: 'LLM agents', maxResults: 20 } },
    trigger: { kind: 'cron', expression: '0 9 * * 1', timeZone: 'Asia/Taipei', enabled: true },
    nodes: [
      { id: 'trigger', type: 'trigger' },
      { id: 'collect', type: 'builtin', ref: 'scheduled-search/search', config: { source: 'arxiv' } },
      { id: 'summarize', type: 'llm', prompt: 'Summarize the new records.', model: 'deepseek-chat' },
      { id: 'report', type: 'agent', prompt: 'Write the report.', skills: ['research'], tools: ['web_search'] },
    ],
    edges: [
      { from: 'trigger', to: 'collect' },
      { from: 'collect', to: 'summarize' },
      { from: 'summarize', to: 'report' },
    ],
  }
}

/** Expect the validator to reject the mutated definition with one code. */
function expectRejection(definition: unknown, code: string, messageFragment?: string): PipelineSchemaError {
  let thrown: unknown
  try {
    validateWorkflowJson(definition)
  } catch (error: unknown) {
    thrown = error
  }
  expect(thrown, `expected a PipelineSchemaError with code ${code}`).toBeInstanceOf(PipelineSchemaError)
  const error = thrown as PipelineSchemaError
  expect(error.code).toBe(code)
  if (messageFragment !== undefined) expect(error.message).toContain(messageFragment)
  return error
}

describe('validateWorkflowJson', () => {
  it('accepts a full valid definition and brands its ids', () => {
    const definition = validateWorkflowJson(validDefinition())
    expect(definition.id).toBe('sch-search-arxiv')
    expect(definition.trigger).toEqual({ kind: 'cron', expression: '0 9 * * 1', timeZone: 'Asia/Taipei', enabled: true })
    expect(definition.nodes).toHaveLength(4)
    expect(definition.edges).toHaveLength(3)
  })

  it('accepts a minimal definition without optional blocks', () => {
    const minimal = validDefinition()
    delete minimal.description
    delete minimal.template
    minimal.nodes = [
      { id: 'trigger', type: 'trigger' },
      { id: 'ask', type: 'llm', prompt: 'Say hello.' },
    ]
    minimal.edges = [{ from: 'trigger', to: 'ask' }]
    expect(() => validateWorkflowJson(minimal)).not.toThrow()
  })

  it('rejects non-object definitions', () => {
    for (const value of [null, 42, 'definition', [], true, undefined]) {
      expectRejection(value, 'DEFINITION_INVALID', 'must be a JSON object')
    }
  })

  it('rejects unknown top-level fields', () => {
    const definition = validDefinition()
    definition.triggers = definition.trigger
    expectRejection(definition, 'DEFINITION_INVALID', 'triggers: unknown field')
  })

  it('rejects unsupported versions', () => {
    for (const version of [0, 2, '1', null]) {
      const definition = validDefinition()
      definition.version = version
      expectRejection(definition, 'VERSION_UNSUPPORTED', 'version must be 1')
    }
    const missing = validDefinition()
    delete missing.version
    expectRejection(missing, 'VERSION_UNSUPPORTED', 'version must be 1, got undefined')
  })

  it('rejects an invalid pipeline id', () => {
    for (const id of ['', 7, null]) {
      const definition = validDefinition()
      definition.id = id
      expectRejection(definition, 'ID_INVALID', 'id must be')
    }
    for (const id of ['Upscaled', 'with.dot', 'with_underscore', 'with/slash', '-leading-hyphen', 'unclé']) {
      const definition = validDefinition()
      definition.id = id
      expectRejection(definition, 'ID_INVALID', 'kebab-case')
    }
  })

  it('rejects an invalid pipeline name', () => {
    for (const name of ['', 7, null]) {
      const definition = validDefinition()
      definition.name = name
      expectRejection(definition, 'NAME_INVALID')
    }
  })

  it('rejects a non-string description', () => {
    const definition = validDefinition()
    definition.description = 9
    expectRejection(definition, 'DESCRIPTION_INVALID')
  })

  describe('template block', () => {
    it('accepts a template without inputs', () => {
      const definition = validDefinition()
      definition.template = { ref: 'scheduled-search' }
      expect(() => validateWorkflowJson(definition)).not.toThrow()
    })

    it('rejects an empty ref', () => {
      const definition = validDefinition()
      definition.template = { ref: '' }
      expectRejection(definition, 'TEMPLATE_REF_INVALID', 'template.ref')
    })

    it('rejects unknown template fields', () => {
      const definition = validDefinition()
      definition.template = { ref: 'scheduled-search', version: 3 }
      expectRejection(definition, 'TEMPLATE_REF_INVALID', 'template.version: unknown field')
    })

    it('rejects non-JSON template inputs', () => {
      const definition = validDefinition()
      definition.template = { ref: 'scheduled-search', inputs: { query: undefined } }
      expectRejection(definition, 'TEMPLATE_REF_INVALID', 'template.inputs.query')
    })

    it('rejects non-finite numbers inside template inputs', () => {
      const definition = validDefinition()
      definition.template = { ref: 'scheduled-search', inputs: { query: Number.NaN } }
      expectRejection(definition, 'TEMPLATE_REF_INVALID', 'template.inputs.query')
    })
  })

  describe('trigger', () => {
    it('rejects a non-object trigger', () => {
      const definition = validDefinition()
      definition.trigger = '0 9 * * 1'
      expectRejection(definition, 'TRIGGER_INVALID', 'trigger must be a JSON object')
    })

    it('rejects unknown trigger fields', () => {
      const definition = validDefinition()
      definition.trigger = { ...validDefinition().trigger as Record<string, unknown>, webhook: 'https://example.test' }
      expectRejection(definition, 'TRIGGER_INVALID', 'trigger.webhook: unknown field')
    })

    it('rejects unknown trigger kinds', () => {
      const definition = validDefinition()
      definition.trigger = { ...validDefinition().trigger as Record<string, unknown>, kind: 'webhook' }
      expectRejection(definition, 'TRIGGER_KIND_UNKNOWN', 'must be "cron"')
      const missingKind = validDefinition()
      missingKind.trigger = { expression: '0 9 * * 1', timeZone: 'UTC', enabled: true }
      expectRejection(missingKind, 'TRIGGER_KIND_UNKNOWN', 'got undefined')
    })

    it('rejects a non-boolean enabled flag', () => {
      const definition = validDefinition()
      definition.trigger = { ...validDefinition().trigger as Record<string, unknown>, enabled: 'yes' }
      expectRejection(definition, 'TRIGGER_INVALID', 'trigger.enabled must be a boolean')
    })

    it('rejects cron expressions without five fields', () => {
      for (const expression of ['', '0 9 * *', '0 9 * * 1 5', '0 9 * * 1 extra']) {
        const definition = validDefinition()
        definition.trigger = { ...validDefinition().trigger as Record<string, unknown>, expression }
        expectRejection(definition, 'CRON_EXPRESSION_INVALID')
      }
    })

    it('rejects cron expressions with disallowed characters', () => {
      const definition = validDefinition()
      definition.trigger = { ...validDefinition().trigger as Record<string, unknown>, expression: '0 9 * * mon' }
      expectRejection(definition, 'CRON_EXPRESSION_INVALID')
    })

    it('rejects cron expressions the scheduler cannot compute', () => {
      const definition = validDefinition()
      definition.trigger = { ...validDefinition().trigger as Record<string, unknown>, expression: '99 99 * * *' }
      expectRejection(definition, 'CRON_EXPRESSION_INVALID', 'Invalid value for minute')
    })

    it('rejects unknown time zones', () => {
      const definition = validDefinition()
      definition.trigger = { ...validDefinition().trigger as Record<string, unknown>, timeZone: 'Mars/Olympus' }
      expectRejection(definition, 'TIME_ZONE_INVALID')
    })
  })

  describe('nodes', () => {
    it('rejects a non-array or empty node list', () => {
      for (const nodes of [undefined, 'nodes', [], null]) {
        const definition = validDefinition()
        definition.nodes = nodes
        expectRejection(definition, 'NODES_INVALID', 'nodes must be a non-empty array')
      }
    })

    it('rejects a node that is not an object', () => {
      const definition = validDefinition()
      definition.nodes = ['trigger']
      expectRejection(definition, 'NODE_INVALID', 'nodes[0] must be a JSON object')
    })

    it('rejects a node without a string type', () => {
      const definition = validDefinition()
      definition.nodes = [{ id: 'trigger' }]
      expectRejection(definition, 'NODE_INVALID', 'nodes[0].type must be a string')
    })

    it('rejects an unknown node type', () => {
      const definition = validDefinition()
      definition.nodes = [{ id: 'trigger', type: 'trigger' }, { id: 'x', type: 'code', source: 'console.log(1)' }]
      expectRejection(definition, 'NODE_TYPE_UNKNOWN', 'nodes[1].type')
    })

    it('rejects an empty or non-string node id', () => {
      for (const id of ['', 5, null]) {
        const definition = validDefinition()
        definition.nodes = [{ id, type: 'trigger' }]
        expectRejection(definition, 'NODE_ID_INVALID')
      }
    })

    it('rejects duplicate node ids', () => {
      const definition = validDefinition()
      definition.nodes = [{ id: 'trigger', type: 'trigger' }, { id: 'trigger', type: 'llm', prompt: 'Again.' }]
      expectRejection(definition, 'NODE_ID_DUPLICATE', 'nodes[1].id duplicates "trigger"')
    })

    it('rejects a non-boolean disabled flag', () => {
      const definition = validDefinition()
      definition.nodes = [{ id: 'trigger', type: 'trigger', disabled: 'no' }]
      expectRejection(definition, 'NODE_FIELD_INVALID', 'nodes[0].disabled must be a boolean')
    })

    it('rejects non-string notes', () => {
      const definition = validDefinition()
      definition.nodes = [{ id: 'trigger', type: 'trigger', notes: 1 }]
      expectRejection(definition, 'NODE_FIELD_INVALID', 'nodes[0].notes must be a string')
    })

    it('rejects unknown fields on a trigger node', () => {
      const definition = validDefinition()
      definition.nodes = [{ id: 'trigger', type: 'trigger', prompt: 'unexpected' }]
      expectRejection(definition, 'NODE_INVALID', 'nodes[0].prompt: unknown field')
    })

    it('rejects a builtin node with an empty ref or non-JSON config', () => {
      const definition = validDefinition()
      definition.nodes = [
        { id: 'trigger', type: 'trigger' },
        { id: 'step', type: 'builtin', ref: '' },
      ]
      expectRejection(definition, 'NODE_FIELD_INVALID', 'nodes[1].ref must be a non-empty string')
      definition.nodes = [
        { id: 'trigger', type: 'trigger' },
        { id: 'step', type: 'builtin', ref: 'scheduled-search/search', config: { at: () => null } },
      ]
      expectRejection(definition, 'NODE_FIELD_INVALID', 'nodes[1].config must be JSON data')
    })

    it('accepts JSON arrays and nested objects inside builtin config', () => {
      const definition = validDefinition()
      definition.nodes = [
        { id: 'trigger', type: 'trigger' },
        { id: 'step', type: 'builtin', ref: 'scheduled-search/search', config: { tags: ['cs.AI'], depth: { max: 2 }, keep: null } },
      ]
      definition.edges = [{ from: 'trigger', to: 'step' }]
      expect(() => validateWorkflowJson(definition)).not.toThrow()
    })

    it('rejects llm and agent nodes with an empty prompt', () => {
      const definition = validDefinition()
      definition.nodes = [
        { id: 'trigger', type: 'trigger' },
        { id: 'ask', type: 'llm', prompt: '' },
      ]
      expectRejection(definition, 'NODE_FIELD_INVALID', 'nodes[1].prompt must be a non-empty string')
      definition.nodes = [
        { id: 'trigger', type: 'trigger' },
        { id: 'worker', type: 'agent', prompt: '' },
      ]
      expectRejection(definition, 'NODE_FIELD_INVALID', 'nodes[1].prompt must be a non-empty string')
    })

    it('rejects an llm node with an empty model override', () => {
      const definition = validDefinition()
      definition.nodes = [
        { id: 'trigger', type: 'trigger' },
        { id: 'ask', type: 'llm', prompt: 'Ask.', model: '' },
      ]
      expectRejection(definition, 'NODE_FIELD_INVALID', 'nodes[1].model must be a non-empty string')
    })

    it('rejects agent nodes with malformed skills or tools', () => {
      const definition = validDefinition()
      definition.nodes = [
        { id: 'trigger', type: 'trigger' },
        { id: 'worker', type: 'agent', prompt: 'Work.', skills: 'research' },
      ]
      expectRejection(definition, 'NODE_FIELD_INVALID', 'nodes[1].skills must be an array of strings')
      definition.nodes = [
        { id: 'trigger', type: 'trigger' },
        { id: 'worker', type: 'agent', prompt: 'Work.', tools: ['web_search', ''] },
      ]
      expectRejection(definition, 'NODE_FIELD_INVALID', 'nodes[1].tools[1] must be a non-empty string')
    })

    it('rejects a node list without exactly one trigger node', () => {
      const definition = validDefinition()
      definition.nodes = [{ id: 'ask', type: 'llm', prompt: 'Ask.' }]
      expectRejection(definition, 'NODES_INVALID', 'exactly one node must have type "trigger"')
      definition.nodes = [
        { id: 'one', type: 'trigger' },
        { id: 'two', type: 'trigger' },
      ]
      expectRejection(definition, 'NODES_INVALID', 'found 2')
    })
  })

  describe('edges', () => {
    it('rejects a non-array edge list', () => {
      const definition = validDefinition()
      definition.edges = 'linear'
      expectRejection(definition, 'EDGES_INVALID', 'edges must be an array')
    })

    it('rejects an edge that is not an object or carries unknown fields', () => {
      const definition = validDefinition()
      definition.edges = ['trigger->collect']
      expectRejection(definition, 'EDGES_INVALID', 'edges[0] must be a JSON object')
      definition.edges = [{ from: 'trigger', to: 'collect', when: 'always' }]
      expectRejection(definition, 'EDGES_INVALID', 'edges[0].when: unknown field')
    })

    it('rejects edges referencing unknown nodes', () => {
      const definition = validDefinition()
      definition.edges = [{ from: 'nowhere', to: 'collect' }]
      expectRejection(definition, 'EDGE_ENDPOINT_UNKNOWN', 'edges[0].from references unknown node "nowhere"')
      definition.edges = [{ from: 'trigger', to: 'nowhere' }]
      expectRejection(definition, 'EDGE_ENDPOINT_UNKNOWN', 'edges[0].to references unknown node "nowhere"')
    })

    it('rejects duplicate edges', () => {
      const definition = validDefinition()
      definition.edges = [
        { from: 'trigger', to: 'collect' },
        { from: 'trigger', to: 'collect' },
      ]
      expectRejection(definition, 'EDGE_DUPLICATE', 'edges[1] duplicates')
    })

    it('rejects edges into the trigger node', () => {
      const definition = validDefinition()
      definition.edges = [{ from: 'collect', to: 'trigger' }]
      expectRejection(definition, 'EDGE_TARGET_TRIGGER', 'targets the trigger node')
    })

    it('rejects cyclic graphs including self-edges', () => {
      const definition = validDefinition()
      definition.nodes = [
        { id: 'trigger', type: 'trigger' },
        { id: 'a', type: 'llm', prompt: 'A.' },
        { id: 'b', type: 'llm', prompt: 'B.' },
        { id: 'c', type: 'llm', prompt: 'C.' },
      ]
      definition.edges = [
        { from: 'trigger', to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a' },
      ]
      expectRejection(definition, 'CYCLE_DETECTED', 'cycle through')
      definition.edges = [
        { from: 'trigger', to: 'a' },
        { from: 'a', to: 'a' },
      ]
      expectRejection(definition, 'CYCLE_DETECTED', 'cycle through "a"')
    })

    it('accepts a diamond graph (shared downstream node)', () => {
      const definition = validDefinition()
      definition.nodes = [
        { id: 'trigger', type: 'trigger' },
        { id: 'a', type: 'llm', prompt: 'A.' },
        { id: 'b', type: 'llm', prompt: 'B.' },
        { id: 'c', type: 'llm', prompt: 'C.' },
      ]
      definition.edges = [
        { from: 'trigger', to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'a', to: 'c' },
        { from: 'b', to: 'c' },
      ]
      expect(() => validateWorkflowJson(definition)).not.toThrow()
    })
  })
})
