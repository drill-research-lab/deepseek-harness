import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url))
const basePatch = resolve(repositoryRoot, 'packages/bundle/base/cordis.patch.yml')
const webPatch = resolve(repositoryRoot, 'packages/bundle/web-app/cordis.patch.yml')

const ownerAwareDeploymentWriters = [
  'settings',
  'session-persistence-jsonl',
  'attachment-local',
  'session-telemetry-otel',
  'spill-local',
  'storage-json',
  'storage-domain',
  'message-feedback',
  'workspace',
  'session-projection-cache',
  'api-gateway',
  'agent-presets',
] as const

describe('web deployment writer startup ordering', () => {
  it('keeps owner-aware deployment entries pending without blocking authentication bootstrap', () => {
    const entries = composeEntries([
      loadOverlayPatches('writer-ordering-test', basePatch),
      loadOverlayPatches('writer-ordering-test', webPatch),
    ])
    expect(entries.find(entry => entry.id === 'credentials')?.inject).toEqual(undefined)
    expect(entries.find(entry => entry.id === 'authentication')?.inject).toEqual(undefined)
    expect(entries.find(entry => entry.id === 'ownership')?.inject).toEqual(undefined)
    for (const id of ownerAwareDeploymentWriters) {
      expect(entries.find(entry => entry.id === id)?.inject, id).toContain('ownership')
    }
  })
})
