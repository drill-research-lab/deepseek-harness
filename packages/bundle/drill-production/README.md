# @deepseek-ai/dsh-drill-production

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Drill multi-user production capability closure (A3: Production Composition Closure). A bundle patch layer stacked over `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` — the same "additional overlay layer" pattern `@deepseek-ai/dsh-headless` already uses over `dsh-web-app` — that narrows the model/user-reachable capability graph to an explicitly approved subset.

## Usage

Add this package to a profile's `dsh.profile.bundles`, after `@deepseek-ai/dsh-web-app`:

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@deepseek-ai/dsh-drill-production"]
    }
  }
}
```

A generic `dsh-web-app` deployment (single-user, self-hosted, upstream-compatible) is unaffected — this bundle is opt-in per profile, not a modification of `dsh-web-app` itself.

## What this closes

- **Preset roster** — `dsh-agent-presets` gains a new `approvedIds` config field (added to that package for A3); this bundle sets it to `[drill-production]` and `includeUserRoot: false`, so `cordis`, `minimal`, and any user-authored preset are unreachable through session creation, `agentPreset.select`, or a user's own `default` setting — all three read through the same `list()`-filtered roster.
- **`drill-production` agent preset** (`apps/cli/config/agent-presets/drill-production/`) — exposes Bash or PowerShell, generic filesystem, and filesystem-search tools under the shared per-session sandbox policy. Filesystem reads are fenced to the workspace; Linux subprocesses receive Landlock file confinement and a private PID namespace through `pid-isolate-run`. Workflow and Ralph remain absent because the workflow worker executes model-written JavaScript in `node:vm`, which its owning package explicitly does not treat as a security boundary.
- **`danger-full-access`** — the `permission` preset table is replaced with `read-only`/`workspace-write` only, and `sandbox-policy.maximumMode` is pinned to `workspace-write`. The policy owner filters every tool schema from that ceiling and rejects wider explicit or persisted modes during resolution, so both advertised and forged one-call escalation paths are closed.
- **Directory picker** — `dsh-host-directory-picker-auto` is disabled and the browse backend plus its Client surface are pinned directly. The backend resolves the authenticated principal's canonical owner root on every `list` and `createDirectory` call; paths outside it, `..` traversal, cross-owner roots, and escaping symlinks fail with `directory-outside-owner-root`.
- **`cordis-host-runner`** — disabled outright, belt-and-suspenders on top of the preset closure (its only model-facing surface, `tool-cordis`, already cannot appear in any approved preset). The startup check also asserts `ctx.get('dynamicCordisRunner')` is unmounted, so a later patch layer re-enabling this row fails boot instead of silently reopening the service's authenticated RPC surface.
- **`session-query-sqlite`** — `openAt: never` restated explicitly (already the value in the layers below); the startup check additionally re-verifies it, narrowing the mounted `ctx.sessionQuery` to `SqliteSessionQueryEngine` and asserting `config.openAt === 'never'`.

## Startup policy check

`src/index.ts`'s `apply()` uses the same pure validator as its unit tests. After every patch layer has applied, it requires the exact approved preset set `{drill-production}`, the exact default `drill-production`, `includeUserRoot: false`, the exact permission table `{read-only, workspace-write}` with their expected sandbox and approval values, sandbox maximum `workspace-write` with the exact escalation target set `{workspace-write}`, an unmounted `dynamicCordisRunner`, and — when a sqlite session-query engine is mounted at all — `openAt: 'never'`. It throws instead of silently clamping, so later deployment patches cannot widen the policy unnoticed.

## Model Experience

### Production tool roster

#### What the model sees

The bundle adds no prompt text. The `drill-production` preset exposes the confined shell, generic filesystem, and filesystem-search tools together with the retained tools. It omits workflow, Ralph, external-process subagent, and dynamic Cordis tools. Shell and mutating filesystem schemas advertise `workspace-write` as their only escalation target.

#### Token effect

Only schemas for retained tools enter the request; the bundle adds no text tokens itself.

#### KV Cache effect

The tool roster is stable for the mounted production preset, so this bundle causes no turn-to-turn invalidation.

## Known Limitations and Deferred Work

- **Network and resource isolation remain outside this policy.** The file and Linux process boundaries do not restrict outbound network access or provide CPU, memory, or disk quotas.
- **No allowlist model for user-authored presets.** `includeUserRoot: false` disables custom preset composition entirely rather than admitting a vetted subset; if a future deployment needs user-authored presets, the policy model must become an explicit allowlist of permitted plugin names, not merely extending `approvedIds` to cover a preset id.
- **The startup check does not independently re-verify `session-persistence-sqlite`.** That backend is never mounted at all in this composition and carries no `openAt`-style config to drift; only `session-query-sqlite` (a distinct read/FTS index package) is re-verified.
