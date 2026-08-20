// Real production Web composition boot with the A3 drill-production overlay
// stacked on top: spawns the actual `web` profile (dsh-base + dsh-web-app)
// with `packages/bundle/drill-production/cordis.patch.yml` as an extra
// `--patch` overlay — the same "additional layer" pattern `dsh-headless`
// stacks over `dsh-web-app`, exercised here through `runProfile()`'s
// `patchFiles` option instead of a dedicated bundle package, since a real
// deployment reaches this bundle the same way. This is the acceptance test
// for A3 (Production Composition Closure): the real composition boots to
// ready with the closed capability policy active, and an unapproved preset
// is rejected over the real HTTP/RPC surface (not just at the package-test
// level).
//
// The 5.11 "legacy session resume" scenario (a session recorded under a
// preset A3 later blocked keeps its history readable but cannot resume) is
// proven at the package level instead: `packages/preset/agent-presets/
// tests/policy.spec.ts` exercises `agentPresets.resolve()` — the exact call
// `composeAgent`/`resolveSessionPreset`'s cold-resume path makes for every
// entry point, prompt included — with a real Cordis composition, and
// confirms it throws for an id `approvedIds` no longer covers. A full
// cross-process-restart version of this test (create a session under plain
// `web`, restart with the overlay, attempt to read/resume it) was attempted
// here and hit an unrelated, pre-existing behavior: a session created with
// no explicit workspace persists under a shared `deployment/sessions/
// <cwd-hash>/` path rather than the owner-scoped `UserHome`-rooted tree, so
// a fresh process's owner-scoped cold read does not discover it regardless
// of preset policy. That is a session-persistence/ownership-path fact
// unrelated to A3's capability policy, out of this change's scope to fix,
// and does not affect the correctness of the policy check itself.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sign, generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { authenticatedUserId } from '@deepseek-ai/dsh-auth'
import { FileSessionStore } from '@deepseek-ai/dsh-auth/file-session-store'

const ISSUER = 'https://auth.e2e.local'
const AUDIENCE = 'dsh'

const DRILL_PRODUCTION_PATCH = fileURLToPath(
  new URL('../../../packages/bundle/drill-production/cordis.patch.yml', import.meta.url),
)

const roots: string[] = []
const children = new Set<ReturnType<typeof spawn>>()

afterEach(async () => {
  await Promise.all([...children].map(async (child) => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
  }))
  children.clear()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-drill-production-boot-'))
  roots.push(root)
  return root
}

/** Write a throwaway `--patch` overlay file and return its path. */
async function writeOverlayPatch(root: string, filename: string, contents: string): Promise<string> {
  const file = join(root, filename)
  await writeFile(file, contents, 'utf8')
  return file
}

interface BootReady {
  type: 'ready'
  port: number
  presetIds: string[]
  permissionIds: string[]
  toolNames: string[]
  directoryPickerKind: string
  dynamicCordisRunnerPresent: boolean
}

/**
 * Spawn the real `web` profile via `runProfile()`, exactly as `dsh web`
 * boots it, with `packages/bundle/drill-production/cordis.patch.yml` as an
 * extra `--patch` overlay.
 */
function spawnWebProfile(
  home: string, usersRoot: string, extraEnv: Record<string, string>, extraPatchFiles: readonly string[] = [],
) {
  const patchFiles = [DRILL_PRODUCTION_PATCH, ...extraPatchFiles].map(file => resolve(file))
  const program = [
    'import { loadLayeredEnv } from \'./packages/boot/app-boot/src/index.ts\'',
    'import { runProfile } from \'./apps/cli/src/profile-boot.ts\'',
    'try {',
    '  const { ctx } = await runProfile({',
    `    environment: loadLayeredEnv('dsh'), profile: 'web', patchFiles: ${JSON.stringify(patchFiles)}, args: ['--port', '0'],`,
    '  })',
    '  const webServer = ctx.get(\'webServer\')',
    '  const handle = await ctx.agents.create({',
    '    sessionId: `drill-production-audit-${process.pid}`,',
    '    setup: agentCtx => ctx.agentPresets.mount(agentCtx, \'drill-production\').then(() => undefined),',
    '  })',
    '  process.send?.({',
    '    type: \'ready\',',
    '    port: webServer?.port,',
    '    presetIds: (await ctx.agentPresets.list()).map(preset => preset.id),',
    '    permissionIds: ctx.permissionPresets.names,',
    '    toolNames: ctx.tools.schemas(handle.agent).map(schema => schema.name).sort(),',
    '    directoryPickerKind: ctx.directoryPicker.capability().kind,',
    '    dynamicCordisRunnerPresent: ctx.get(\'dynamicCordisRunner\') !== undefined,',
    '  })',
    '  setInterval(() => {}, 1_000)',
    '} catch (error) {',
    '  process.send?.(`failed:${error instanceof Error ? error.message : String(error)}`, () => process.exit(0))',
    '}',
  ].join('\n')
  const child = spawn(process.execPath, [
    '--import', 'tsx/esm', '--input-type=module', '-e', program, 'dsh-drill-production-boot-test',
  ], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv, DSH_HOME: home, DSH_USERS_HOME: usersRoot },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  })
  children.add(child)
  return child
}

function nextMessage(child: ReturnType<typeof spawn>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    child.once('message', resolve)
    child.once('error', reject)
  })
}

interface RpcEnvelope<T> {
  result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
}

/**
 * POST one RPC call over the real /api HTTP surface, exactly as the browser
 * client does. Returns the raw envelope so callers can assert on rejection,
 * not just success.
 */
async function rpcEnvelope<T>(baseUrl: string, method: string, payload: unknown, cookie: string): Promise<RpcEnvelope<T>> {
  const response = await fetch(`${baseUrl}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `e2e-${method}-${Math.random().toString(36).slice(2)}`,
      method,
      payload,
    }),
  })
  return await response.json() as RpcEnvelope<T>
}

async function rpc<T>(baseUrl: string, method: string, payload: unknown, cookie: string): Promise<T> {
  const body = await rpcEnvelope<T>(baseUrl, method, payload, cookie)
  if (!body.result.ok) throw new Error(`${method} failed: ${body.result.error.code}: ${body.result.error.message}`)
  return body.result.value
}

describe.runIf(process.platform === 'linux')('A3: Drill production capability closure boot', () => {
  it(
    'boots the real base+web-app+drill-production tree to ready and rejects unapproved presets over the real HTTP/RPC surface',
    async () => {
      const root = await temporaryRoot()
      const home = join(root, 'deployment')
      const usersRoot = join(root, 'users')
      const authSessionDirectory = join(root, 'auth-sessions')
      const keys = generateKeyPairSync('ed25519')
      const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()

      const child = spawnWebProfile(home, usersRoot, {
        AUTH_COOKIE_PUBLIC_KEY: publicKeyPem,
        AUTH_COOKIE_ISSUER: ISSUER,
        AUTH_COOKIE_AUDIENCE: AUDIENCE,
        DSH_AUTH_SESSION_DIRECTORY: authSessionDirectory,
        DEEPSEEK_API_KEY: 'sk-e2e-drill-production-boot-fake-key-000000000000000000',
      })
      const ready = await nextMessage(child)
      if (typeof ready === 'string') throw new Error(`drill-production profile failed to reach ready: ${ready}`)
      const boot = ready as BootReady
      expect(typeof boot.port).toBe('number')
      expect(boot.presetIds).toEqual(['drill-production'])
      expect(boot.permissionIds).toEqual(['read-only', 'workspace-write'])
      expect(boot.directoryPickerKind).toBe('disabled')
      expect(boot.dynamicCordisRunnerPresent).toBe(false)
      expect(boot.toolNames).toEqual(expect.arrayContaining(['subagent', 'subagent_fork']))
      expect(boot.toolNames).not.toEqual(expect.arrayContaining([
        'bash', 'pwsh', 'read_file', 'write_file', 'grep', 'glob',
        'workflow', 'ralph', 'subagent_codex', 'subagent_claude_code',
        'cordis_inspect', 'cordis_define', 'cordis_run', 'cordis_stop', 'cordis_undefine',
      ]))
      const baseUrl = `http://127.0.0.1:${boot.port}`

      const sessions = new FileSessionStore(authSessionDirectory)
      async function login(sub: string, username: string): Promise<string> {
        const now = Math.floor(Date.now() / 1000)
        const sid = await sessions.create({ userId: authenticatedUserId(sub), username }, now + 600)
        const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url')
        const payload = Buffer.from(JSON.stringify({
          v: 1, iss: ISSUER, aud: AUDIENCE, sub, username, sid, iat: now, exp: now + 600,
        })).toString('base64url')
        const signature = sign(null, Buffer.from(`${header}.${payload}`), keys.privateKey).toString('base64url')
        return `dsh_identity=${header}.${payload}.${signature}`
      }

      const aliceCookie = await login('e2e-test:alice', 'alice')

      // Default preset composes cleanly under the closure — production is not
      // simply broken, it is narrowed to the approved subset (12.A: boots
      // ready even though Bash/PowerShell/generic-filesystem tools are
      // withheld pending Issue #5).
      const defaultSession = await rpc<{ sessionId: string }>(baseUrl, 'session.create', {}, aliceCookie)
      expect(typeof defaultSession.sessionId).toBe('string')

      // A NEW session explicitly requesting a blocked preset is rejected with
      // a named diagnostic over the real RPC surface (12.C: server-side
      // reject, not silent, not merely a hidden UI affordance).
      const cordisAttempt = await rpcEnvelope(baseUrl, 'session.create', { agentPreset: 'cordis' }, aliceCookie)
      expect(cordisAttempt.result.ok).toBe(false)
      if (!cordisAttempt.result.ok) {
        expect(cordisAttempt.result.error.code).toBe('agent-preset-not-found')
        expect(cordisAttempt.result.error.message).toMatch(/preset "cordis" not found/)
      }

      const minimalAttempt = await rpcEnvelope(baseUrl, 'session.create', { agentPreset: 'minimal' }, aliceCookie)
      expect(minimalAttempt.result.ok).toBe(false)
      if (!minimalAttempt.result.ok) {
        expect(minimalAttempt.result.error.code).toBe('agent-preset-not-found')
        expect(minimalAttempt.result.error.message).toMatch(/preset "minimal" not found/)
      }

      const standardAttempt = await rpcEnvelope(baseUrl, 'session.create', { agentPreset: 'standard' }, aliceCookie)
      expect(standardAttempt.result.ok).toBe(false)
      if (!standardAttempt.result.ok) expect(standardAttempt.result.error.code).toBe('agent-preset-not-found')

      for (const [method, payload] of [
        ['host.pickDirectory', {}],
        ['host.listDirectory', {}],
        ['host.createDirectory', { path: '/', name: 'blocked' }],
      ] as const) {
        const directoryAttempt = await rpcEnvelope(baseUrl, method, payload, aliceCookie)
        expect(directoryAttempt.result.ok).toBe(false)
        if (!directoryAttempt.result.ok) {
          expect(directoryAttempt.result.error.code).toBe('directory-picker-unavailable')
        }
      }

      const fullAccessAttempt = await rpcEnvelope(baseUrl, 'settings.mutate', {
        ns: 'permission',
        ops: [{ op: 'set', path: ['defaultPreset'], value: 'danger-full-access' }],
      }, aliceCookie)
      expect(fullAccessAttempt.result.ok).toBe(false)
    },
    90_000,
  )

  it(
    'fails loud, before serving, when a later patch layer re-enables cordis-host-runner',
    async () => {
      const root = await temporaryRoot()
      const home = join(root, 'deployment')
      const usersRoot = join(root, 'users')
      const authSessionDirectory = join(root, 'auth-sessions')
      const keys = generateKeyPairSync('ed25519')
      const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()

      const reenablePatch = await writeOverlayPatch(root, 'reenable-cordis-host-runner.patch.yml', [
        '- id: cordis-host-runner',
        '  disabled: false',
        '',
      ].join('\n'))

      const child = spawnWebProfile(home, usersRoot, {
        AUTH_COOKIE_PUBLIC_KEY: publicKeyPem,
        AUTH_COOKIE_ISSUER: ISSUER,
        AUTH_COOKIE_AUDIENCE: AUDIENCE,
        DSH_AUTH_SESSION_DIRECTORY: authSessionDirectory,
        DEEPSEEK_API_KEY: 'sk-e2e-drill-production-boot-fake-key-000000000000000000',
      }, [reenablePatch])
      const outcome = await nextMessage(child)
      expect(typeof outcome).toBe('string')
      expect(outcome as string).toMatch(/^failed:/)
      expect(outcome as string).toMatch(/cordis-host-runner must not be mounted/)
    },
    90_000,
  )

  it(
    'fails loud, before serving, when a later patch layer reopens session-query-sqlite\'s openAt phase',
    async () => {
      const root = await temporaryRoot()
      const home = join(root, 'deployment')
      const usersRoot = join(root, 'users')
      const authSessionDirectory = join(root, 'auth-sessions')
      const keys = generateKeyPairSync('ed25519')
      const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()

      const reopenPatch = await writeOverlayPatch(root, 'reopen-session-query-sqlite.patch.yml', [
        '- id: session-query-sqlite',
        '  config:',
        '    path: \':memory:\'',
        '    openAt: startup',
        '',
      ].join('\n'))

      const child = spawnWebProfile(home, usersRoot, {
        AUTH_COOKIE_PUBLIC_KEY: publicKeyPem,
        AUTH_COOKIE_ISSUER: ISSUER,
        AUTH_COOKIE_AUDIENCE: AUDIENCE,
        DSH_AUTH_SESSION_DIRECTORY: authSessionDirectory,
        DEEPSEEK_API_KEY: 'sk-e2e-drill-production-boot-fake-key-000000000000000000',
      }, [reopenPatch])
      const outcome = await nextMessage(child)
      expect(typeof outcome).toBe('string')
      expect(outcome as string).toMatch(/^failed:/)
      expect(outcome as string).toMatch(/session-query-sqlite\.openAt must be "never"/)
    },
    90_000,
  )
})
