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
import { access, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, sign, generateKeyPairSync } from 'node:crypto'
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
const modelServers = new Set<ReturnType<typeof createServer>>()

afterEach(async () => {
  await Promise.all([...children].map(async (child) => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
  }))
  children.clear()
  await Promise.all([...modelServers].map(server => new Promise<void>((resolveClose) => {
    server.close(() => { resolveClose() })
    server.closeAllConnections()
  })))
  modelServers.clear()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function temporaryRoot(parent = tmpdir()): Promise<string> {
  const root = await mkdtemp(join(parent, '.dsh-drill-production-boot-'))
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
  sandboxMaximumMode: string
  sandboxEscalationTargets: string[]
  toolEscalationTargets: Record<string, string[] | undefined>
}

interface ScriptedToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

interface ScriptedModelServer {
  baseURL: string
  requests: unknown[]
}

/** Serve one parallel tool-call step followed by a terminal assistant response. */
async function startScriptedModelServer(calls: readonly ScriptedToolCall[]): Promise<ScriptedModelServer> {
  const requests: unknown[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk as Uint8Array)))
    request.on('end', () => {
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
      if (requests.length === 1) {
        response.write('data: {"choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n')
        response.write(`data: ${JSON.stringify({
          choices: [{
            index: 0,
            delta: {
              tool_calls: calls.map((call, index) => ({
                index,
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.arguments) },
              })),
            },
            finish_reason: null,
          }],
        })}\n\n`)
        response.write('data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}\n\n')
      } else {
        response.write('data: {"choices":[{"index":0,"delta":{"content":"production tool checks completed"},"finish_reason":null}]}\n\n')
        response.write('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4}}\n\n')
      }
      response.end('data: [DONE]\n\n')
    })
  })
  modelServers.add(server)
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectListen)
      resolveListen()
    })
  })
  const address = server.address() as AddressInfo
  return { baseURL: `http://127.0.0.1:${address.port}`, requests }
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
    '  const schemas = ctx.tools.schemas(handle.agent)',
    '  const toolEscalationTargets = Object.fromEntries([\'bash\', \'pwsh\', \'write\', \'edit\'].map(name => {',
    '    const schema = schemas.find(candidate => candidate.name === name)',
    '    const field = schema?.parameters.properties.sandbox_permissions',
    '    return [name, field === undefined || !(\'enum\' in field) ? undefined : field.enum]',
    '  }))',
    '  process.send?.({',
    '    type: \'ready\',',
    '    port: webServer?.port,',
    '    presetIds: (await ctx.agentPresets.list()).map(preset => preset.id),',
    '    permissionIds: ctx.permissionPresets.names,',
    '    toolNames: schemas.map(schema => schema.name).sort(),',
    '    directoryPickerKind: ctx.directoryPicker.capability().kind,',
    '    dynamicCordisRunnerPresent: ctx.get(\'dynamicCordisRunner\') !== undefined,',
    '    sandboxMaximumMode: ctx.sandboxPolicy.maximumMode,',
    '    sandboxEscalationTargets: ctx.sandboxPolicy.escalationTargets,',
    '    toolEscalationTargets,',
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

interface HistoryEntry {
  event: {
    type: string
    data: Record<string, unknown>
  }
}

/** Poll the authenticated history endpoint until the current turn commits. */
async function waitForCompletedHistory(baseUrl: string, sessionId: string, cookie: string): Promise<HistoryEntry[]> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const history = await rpc<{ events: HistoryEntry[] }>(baseUrl, 'session.history', { sessionId }, cookie)
    if (history.events.some(entry => entry.event.type === 'turn/end')) return history.events
    await new Promise(resolveDelay => setTimeout(resolveDelay, 50))
  }
  throw new Error(`timed out waiting for session ${sessionId} to complete its tool-validation turn`)
}

/** Index durable tool results by the model call id embedded in their message source. */
function toolResultsByCallId(events: readonly HistoryEntry[]): Map<string, Record<string, unknown>> {
  const results = new Map<string, Record<string, unknown>>()
  for (const entry of events) {
    if (entry.event.type !== 'tool/result') continue
    const message = entry.event.data.message as { source?: { callId?: string } } | undefined
    const callId = message?.source?.callId
    if (callId !== undefined) results.set(callId, entry.event.data)
  }
  return results
}

function toolResultSummary(result: Record<string, unknown> | undefined): { isError: boolean; text: string } {
  if (result === undefined) throw new Error('expected durable tool result')
  const message = result.message as { content: Array<{ isError?: boolean; content?: unknown }> }
  const block = message.content[0]
  return { isError: block?.isError === true, text: JSON.stringify(block?.content ?? []) }
}

describe.runIf(process.platform === 'linux')('A3: Drill production capability closure boot', () => {
  it(
    'boots the real base+web-app+drill-production tree to ready and rejects unapproved presets over the real HTTP/RPC surface',
    async () => {
      // Landlock intentionally grants the host temp tree for workspace-write.
      // Put owner roots elsewhere so cross-owner assertions cannot pass or
      // fail because both owners happen to share that explicit temp grant.
      const root = await temporaryRoot(process.cwd())
      const home = join(root, 'deployment')
      const usersRoot = join(root, 'users')
      const authSessionDirectory = join(root, 'auth-sessions')
      const keys = generateKeyPairSync('ed25519')
      const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()

      const ownerRoots = join(home, 'owner-roots')
      const ownerKey = (id: string): string => createHash('sha256').update(id, 'utf8').digest('hex')
      const aliceOwnerRoot = join(ownerRoots, ownerKey('e2e-test:alice'))
      const bobOwnerRoot = join(ownerRoots, ownerKey('e2e-test:bob'))
      const aliceWorkspace = join(aliceOwnerRoot, 'workspace')
      const bobWorkspace = join(bobOwnerRoot, 'workspace')
      const aliceInside = join(aliceWorkspace, 'inside.txt')
      const bobSecret = join(bobWorkspace, 'secret.txt')
      const outsideFile = join(aliceOwnerRoot, 'outside.txt')
      const escapeLink = join(aliceWorkspace, 'escape-link')
      await Promise.all([
        mkdir(aliceWorkspace, { recursive: true }),
        mkdir(bobWorkspace, { recursive: true }),
      ])
      await Promise.all([
        writeFile(aliceInside, 'ALICE_INSIDE\n', 'utf8'),
        writeFile(bobSecret, 'BOB_SECRET\n', 'utf8'),
        writeFile(outsideFile, 'OUTSIDE_SECRET\n', 'utf8'),
      ])
      await symlink(outsideFile, escapeLink)

      const hostVictim = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1_000)'], {
        stdio: 'ignore',
      })
      children.add(hostVictim)
      if (hostVictim.pid === undefined) throw new Error('host victim process did not expose a pid')

      const model = await startScriptedModelServer([
        {
          id: 'prod-bash-success',
          name: 'bash',
          arguments: { command: `cat ${JSON.stringify(aliceInside)}`, description: 'read a workspace file through bash' },
        },
        {
          id: 'prod-fs-success',
          name: 'read',
          arguments: { file_path: aliceInside },
        },
        {
          id: 'prod-grep-success',
          name: 'grep',
          arguments: { pattern: 'ALICE_INSIDE', path: aliceWorkspace },
        },
        {
          id: 'prod-cross-owner',
          name: 'bash',
          arguments: { command: `cat ${JSON.stringify(bobSecret)}`, description: 'attempt to read Bob\'s workspace' },
        },
        {
          id: 'prod-symlink-escape',
          name: 'bash',
          arguments: { command: `cat ${JSON.stringify(escapeLink)}`, description: 'attempt a workspace symlink escape' },
        },
        {
          id: 'prod-etc-passwd',
          name: 'bash',
          arguments: { command: 'cat /etc/passwd', description: 'attempt to read a host account file' },
        },
        {
          id: 'prod-traversal',
          name: 'bash',
          arguments: { command: 'cat ../outside.txt', description: 'attempt parent-directory traversal' },
        },
        {
          id: 'prod-host-signal',
          name: 'bash',
          arguments: { command: `kill -TERM ${hostVictim.pid}`, description: 'attempt to signal a host process' },
        },
        {
          id: 'prod-grep-cross-owner',
          name: 'grep',
          arguments: { pattern: 'BOB_SECRET', path: bobWorkspace },
        },
        {
          id: 'prod-forged-danger',
          name: 'bash',
          arguments: {
            command: `printf should-not-run > ${JSON.stringify(join(aliceWorkspace, 'forged-ran.txt'))}`,
            description: 'attempt a forbidden production escalation',
            sandbox_permissions: 'danger-full-access',
            justification: 'exercise the production policy ceiling',
          },
        },
      ])

      const child = spawnWebProfile(home, usersRoot, {
        AUTH_COOKIE_PUBLIC_KEY: publicKeyPem,
        AUTH_COOKIE_ISSUER: ISSUER,
        AUTH_COOKIE_AUDIENCE: AUDIENCE,
        DSH_AUTH_SESSION_DIRECTORY: authSessionDirectory,
        DEEPSEEK_API_KEY: 'sk-e2e-drill-production-boot-fake-key-000000000000000000',
        DEEPSEEK_BASE_URL: model.baseURL,
      })
      const ready = await nextMessage(child)
      if (typeof ready === 'string') throw new Error(`drill-production profile failed to reach ready: ${ready}`)
      const boot = ready as BootReady
      expect(typeof boot.port).toBe('number')
      expect(boot.presetIds).toEqual(['drill-production'])
      expect(boot.permissionIds).toEqual(['read-only', 'workspace-write'])
      expect(boot.directoryPickerKind).toBe('disabled')
      expect(boot.dynamicCordisRunnerPresent).toBe(false)
      expect(boot.sandboxMaximumMode).toBe('workspace-write')
      expect(boot.sandboxEscalationTargets).toEqual(['workspace-write'])
      expect(boot.toolEscalationTargets).toMatchObject({
        bash: ['workspace-write'],
        write: ['workspace-write'],
        edit: ['workspace-write'],
      })
      expect(boot.toolNames).toEqual(expect.arrayContaining(['subagent', 'subagent_fork']))
      expect(boot.toolNames).toEqual(expect.arrayContaining([
        'bash', 'read', 'read_image', 'write', 'edit', 'grep', 'glob',
      ]))
      expect(boot.toolNames).not.toEqual(expect.arrayContaining([
        'pwsh',
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
      const bobCookie = await login('e2e-test:bob', 'bob')

      // Both owners receive the approved preset, while each session's cwd
      // supplies its owner-specific workspace root.
      const defaultSession = await rpc<{ sessionId: string }>(
        baseUrl, 'session.create', { cwd: aliceWorkspace }, aliceCookie,
      )
      const bobSession = await rpc<{ sessionId: string }>(
        baseUrl, 'session.create', { cwd: bobWorkspace }, bobCookie,
      )
      expect(typeof defaultSession.sessionId).toBe('string')
      expect(typeof bobSession.sessionId).toBe('string')

      await rpc(baseUrl, 'session.prompt', {
        sessionId: defaultSession.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: 'Run the scripted production tool acceptance checks.' }],
      }, aliceCookie)
      const events = await waitForCompletedHistory(baseUrl, defaultSession.sessionId, aliceCookie)
      const results = toolResultsByCallId(events)

      expect(toolResultSummary(results.get('prod-bash-success'))).toMatchObject({ isError: false })
      expect(toolResultSummary(results.get('prod-bash-success')).text).toContain('ALICE_INSIDE')
      expect(toolResultSummary(results.get('prod-fs-success'))).toMatchObject({ isError: false })
      expect(toolResultSummary(results.get('prod-fs-success')).text).toContain('ALICE_INSIDE')
      const grepSuccess = toolResultSummary(results.get('prod-grep-success'))
      expect(grepSuccess.isError, grepSuccess.text).toBe(false)
      expect(grepSuccess.text).toContain('ALICE_INSIDE')

      for (const callId of [
        'prod-cross-owner',
        'prod-symlink-escape',
        'prod-etc-passwd',
        'prod-traversal',
      ]) {
        const outcome = toolResultSummary(results.get(callId))
        expect(outcome.isError, callId).toBe(false)
        expect(outcome.text, callId).toContain('[sandbox: file access denied under workspace-write mode]')
      }
      expect(toolResultSummary(results.get('prod-grep-cross-owner')).isError).toBe(true)
      expect(toolResultSummary(results.get('prod-forged-danger')).isError).toBe(true)
      expect(toolResultSummary(results.get('prod-forged-danger')).text).toContain('workspace-write')
      await expect(access(join(aliceWorkspace, 'forged-ran.txt'))).rejects.toThrow()
      expect(toolResultSummary(results.get('prod-cross-owner')).text).not.toContain('BOB_SECRET')
      expect(toolResultSummary(results.get('prod-symlink-escape')).text).not.toContain('OUTSIDE_SECRET')
      expect(toolResultSummary(results.get('prod-etc-passwd')).text).not.toContain('root:')
      expect(toolResultSummary(results.get('prod-traversal')).text).not.toContain('OUTSIDE_SECRET')
      expect(toolResultSummary(results.get('prod-grep-cross-owner')).text).not.toContain('BOB_SECRET')
      expect(toolResultSummary(results.get('prod-host-signal')).isError).toBe(false)
      expect(hostVictim.exitCode).toBeNull()
      expect(hostVictim.kill(0)).toBe(true)
      expect(model.requests.length).toBeGreaterThanOrEqual(2)
      const toolRequest = model.requests.find((request) => {
        const record = request as { tools?: unknown[] }
        return Array.isArray(record.tools) && record.tools.length > 0
      })
      expect(toolRequest).toBeDefined()
      expect(JSON.stringify(toolRequest)).not.toContain('danger-full-access')

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

  it(
    'fails loud, before serving, when a later patch layer restores danger-full-access',
    async () => {
      const root = await temporaryRoot()
      const home = join(root, 'deployment')
      const usersRoot = join(root, 'users')
      const authSessionDirectory = join(root, 'auth-sessions')
      const keys = generateKeyPairSync('ed25519')
      const publicKeyPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()

      const widenPatch = await writeOverlayPatch(root, 'widen-sandbox-policy.patch.yml', [
        '- id: sandbox-policy',
        '  config:',
        '    mode: workspace-write',
        '    maximumMode: danger-full-access',
        '    workspaceRoot: !!js process.cwd()',
        '',
      ].join('\n'))

      const child = spawnWebProfile(home, usersRoot, {
        AUTH_COOKIE_PUBLIC_KEY: publicKeyPem,
        AUTH_COOKIE_ISSUER: ISSUER,
        AUTH_COOKIE_AUDIENCE: AUDIENCE,
        DSH_AUTH_SESSION_DIRECTORY: authSessionDirectory,
        DEEPSEEK_API_KEY: 'sk-e2e-drill-production-boot-fake-key-000000000000000000',
      }, [widenPatch])
      const outcome = await nextMessage(child)
      expect(typeof outcome).toBe('string')
      expect(outcome as string).toMatch(/^failed:/)
      expect(outcome as string).toMatch(/sandbox-policy\.maximumMode must be "workspace-write"/)
    },
    90_000,
  )
})
