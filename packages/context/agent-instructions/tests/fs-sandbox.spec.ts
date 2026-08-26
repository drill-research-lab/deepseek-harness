import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { loadBaselineInstructions } from '@deepseek-ai/dsh-agent-instructions'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import { afterEach, describe, expect, it } from 'vitest'

let ctx: Context | undefined
let base: string | undefined

afterEach(async () => {
  await ctx?.fiber.dispose()
  if (base !== undefined) await rm(base, { recursive: true, force: true })
})

describe('fs-sandbox composition', () => {
  it('loads trusted home and project instructions without widening ordinary reads', async () => {
    base = await mkdtemp(join(tmpdir(), 'dsh-instructions-sandbox-'))
    const fallback = join(base, 'fallback')
    const home = join(base, 'home')
    const project = join(base, 'project')
    await Promise.all([
      mkdir(fallback),
      mkdir(join(project, '.git'), { recursive: true }),
      mkdir(home),
    ])
    await Promise.all([
      writeFile(join(home, 'AGENTS.md'), 'home instruction'),
      writeFile(join(project, 'AGENTS.md'), 'project instruction'),
    ])

    ctx = new Context()
    await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: fallback })
    await ctx.plugin(SandboxedFileSystem, { cwd: fallback })

    const rendered = await loadBaselineInstructions({
      cwd: project,
      dshHome: home,
      maxBytes: 65_536,
    }, ctx.fs)
    expect(rendered?.text).toContain('home instruction')
    expect(rendered?.text).toContain('project instruction')

    const trustedTarget = await ctx.fs.resolve(join(project, 'AGENTS.md'))
    await expect(ctx.fs.streamText(trustedTarget)).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
  })
})
