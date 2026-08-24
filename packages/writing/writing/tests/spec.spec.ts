import { describe, expect, it } from 'vitest'
import {
  reportRecord,
  reportTemplateRecord,
  reportVersionRecord,
  writingDomainSpec,
} from '../src/spec.ts'

describe('writing domain spec schemas', () => {
  it('parses a report record, running the template-id transform', () => {
    const record = reportRecord.parse({
      title: 'My Paper',
      templateId: 'builtin:article',
      source: '\\documentclass{article}',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(record.templateId).toBe('builtin:article')
    expect(record.source).toContain('article')
  })

  it('parses a version record, running the report-id transform', () => {
    const version = reportVersionRecord.parse({
      reportId: 'report-1',
      label: 'successful compile #1',
      source: 'v1',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(version.reportId).toBe('report-1')
  })

  it('parses a template record and validates the domain spec identity', () => {
    const template = reportTemplateRecord.parse({
      name: 'custom',
      source: 'x',
      builtIn: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    expect(template.builtIn).toBe(false)
    expect(writingDomainSpec.name).toBe('writing')
    expect(writingDomainSpec.version).toBe(1)
  })

  it('rejects an empty template id', () => {
    expect(() => reportRecord.parse({
      title: 't',
      templateId: '',
      source: 'x',
      createdAt: 'x',
      updatedAt: 'x',
    })).toThrow()
  })
})
