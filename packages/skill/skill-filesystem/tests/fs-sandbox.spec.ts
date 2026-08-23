import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { afterEach, describe, expect, it } from 'vitest'

const contexts: Context[] = []
const roots: string[] = []

async function tempRoot(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `dsh-skill-${name}-`))
  roots.push(root)
  return root
}

async function writeSkill(root: string, name: string, body: string): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, `${name}.md`), `---\nname: ${name}\ndescription: ${name}\n---\n\n${body}\n`)
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(async root => rm(root, { recursive: true, force: true })))
})

describe('fs-sandbox composition', () => {
  it('loads trusted home and project skills without widening ordinary reads', async () => {
    const base = await tempRoot('sandbox')
    const fallback = join(base, 'fallback')
    const home = join(base, 'home')
    const project = join(base, 'project')
    await Promise.all([
      mkdir(fallback),
      mkdir(join(project, '.git'), { recursive: true }),
      writeSkill(join(home, '.dsh/skills'), 'home-skill', 'home body'),
      writeSkill(join(project, '.agents/skills'), 'project-skill', 'project body'),
    ])

    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: fallback })
    await ctx.plugin(SandboxedFileSystem, { cwd: fallback })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: false,
    })

    expect((await ctx.skills.list({ cwd: project })).map(skill => skill.name)).toEqual([
      'home-skill',
      'project-skill',
    ])
    await expect(ctx.skills.get('project-skill', { cwd: project })).resolves.toMatchObject({
      content: 'project body',
    })
    const trustedTarget = await ctx.fs.resolve(join(home, '.dsh/skills/home-skill.md'))
    await expect(ctx.fs.readText(trustedTarget)).rejects.toMatchObject({ code: 'FS_SANDBOX_DENIED' })
  })

  it('does not load a skill whose directory symlink escapes its configured root', async () => {
    const base = await tempRoot('escape')
    const home = join(base, 'home')
    const project = join(base, 'project')
    const outside = join(base, 'outside')
    await Promise.all([
      mkdir(join(project, '.git'), { recursive: true }),
      writeSkill(join(home, '.dsh/skills'), 'home-skill', 'home body'),
      mkdir(outside),
    ])
    await writeFile(
      join(outside, 'SKILL.md'),
      '---\nname: escape-skill\ndescription: escape\n---\n\nsecret body\n',
    )
    await symlink(outside, join(home, '.dsh/skills/escape'), process.platform === 'win32' ? 'junction' : 'dir')

    const ctx = new Context()
    contexts.push(ctx)
    // The deployment default root is the whole sandbox base, so the escape
    // target sits under the fallback but outside the configured skill root.
    await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: base })
    await ctx.plugin(SandboxedFileSystem, { cwd: base })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, {
      dshHome: join(home, '.dsh'),
      agentsHome: join(home, '.agents'),
      watch: false,
    })

    const names = (await ctx.skills.list({ cwd: project })).map(skill => skill.name)
    expect(names).not.toContain('escape-skill')
    await expect(ctx.skills.get('escape-skill', { cwd: project })).resolves.toBeUndefined()
  })
})
