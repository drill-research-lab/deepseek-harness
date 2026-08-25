# Agent Note: A3 production composition closure

Status: implemented



## Problem

A1/A2 answer "whose resource is this, and can Alice see Bob's?" A3 answers a different question: in Drill's authenticated multi-user Web production, which DSH capability/provider is any model or user session allowed to reach at all, independent of whose resource it touches?

The Phase 0 audit (`/home/raylin/report/2026-08-20-a3-phase0-audit-design.md`, referenced here for its evidence trail, not duplicated) found this currently violated by the production default itself: `standard` — the default shipped preset — mounts `tool-bash`/`tool-pwsh`/`tool-fs`/`tool-fs-search` unconditionally, and DSH's same-world sandbox (`packages/sandbox/sandbox-local`, bwrap/Landlock/Seatbelt) only fences file writes outside the workspace. It does not confine command execution, network egress, process spawning, or filesystem reads (`fs-sandbox`'s own documentation: "every mode permits reading"). Preset selection itself carried no role/tenant gate — any authenticated session could switch to `cordis` (dynamic self-modification, documented by its own package as "treat like bash access") or `minimal` (a bare, unsandboxed `fs-local`) with zero additional authorization.

## Production threat boundary

A3's boundary is deliberately narrow: "is this capability approved for production," not "is DSH's sandbox itself a security boundary." The latter is Issue #5's question. A3 does not implement network isolation, filesystem read confinement, resource limits, or any change to `packages/sandbox/*`. Where a capability's safety depends on hardening Issue #5 has not yet done, A3's only lever is withholding it from the production-reachable roster — accepting a functionality gap (no Bash, no generic filesystem tools) as the honest current answer rather than a false sense of security.

## Decision

**A canonical policy source, reusing the existing preset-mount seam.** `packages/preset/agent-presets`'s `AgentPresets.list()`/`.resolve()`/`.mount()` were already the single choke point every preset-selection entry point reads (`session.create`, `agentPreset.select`, a user's own `default` setting, and cold-resume's `resolveSessionPreset()` → `composeAgent()` chain) — no new authorization framework was needed, only a new `Config.approvedIds?: readonly string[]` field. When set, `list()` narrows to exactly that set; `resolve()`/`mount()` read `list()`, so there is no "list hides it, mount still accepts it" gap. An unapproved id — shipped or user-authored — reads exactly like an id no root supplies (`UnknownPresetError`, reused verbatim, not a new "blocked" error type): the same not-found-not-403 posture this harness already applies to cross-owner resource access, so a caller cannot distinguish "exists but not approved for this deployment" from "does not exist." `includeUserRoot: false` closes user-authored preset composition entirely for v1, rather than admitting a vetted allowlist subset — see Alternatives.

**A new bundle, not a modified one.** `packages/bundle/drill-production` stacks over `dsh-base`+`dsh-web-app` in a profile's `dsh.profile.bundles`, the identical "additional overlay layer" pattern `dsh-headless` already uses. Generic `dsh-web-app` deployments (single-user, self-hosted) are untouched; Drill production opts in per profile.

**A new shipped preset, not a modified `standard`.** `apps/cli/config/agent-presets/drill-production/` is a stripped copy of `standard` without `tool-bash`, `tool-pwsh`, `tool-fs`, `tool-fs-search`, `tool-workflow`, or `tool-ralph`. The workflow provider executes model-written JavaScript in a `node:vm` worker and explicitly documents that the VM is not a security boundary. `tool-subagent`/`tool-subagent-fork` children `composeFrom()` the same standing composition, so they cannot regain removed tools; external Codex and Claude Code subprocess providers remain disabled.

**`danger-full-access` closure via the permission-preset table, not a new gate.** `packages/interaction/permission-presets`'s `PermissionPresetService` is the *only* caller of `packages/sandbox/sandbox-policy`'s `setSandboxMode` in the whole repository (confirmed by exhaustive grep during the Phase 0 audit and re-confirmed here). Replacing its configured table (`read-only`/`workspace-write` only, `danger-full-access` absent) closes the `/permission` command, the `permission` settings namespace (built from the table's own keys), and the projection UI catalog together — there is no fourth path to re-derive. A session with a *persisted* `danger-full-access` selection from before this policy applied is not separately re-guarded: that mode only has an effect through `bash-sandbox`/`fs-sandbox`'s own escalation path, and neither tool is in `drill-production`'s roster, so the persisted value is inert.

**Directory picker: the browse interaction is confined to the authenticated owner's canonical root.** Production disables the adaptive picker because it may select the unconstrained native dialog, then pins the Host browse backend and matching Client surface. `BrowseDirectoryPicker` reads `currentPrincipal()` and `resolveOwnerRoot()` inside every RPC request rather than capturing a deployment-global config value. It canonicalizes list targets and create parents before `isPathUnder()` checks them, delegates creation with the canonical parent, omits escaping symlinks from listings, and exposes no breadcrumb above the owner root. `directory-outside-owner-root` reports the rejected path choice without treating it as cross-owner resource lookup.

**`cordis-host-runner`: disabled outright, belt-and-suspenders, and now checked at startup.** Its only model-facing surface (`tool-cordis`) already cannot appear in any approved preset, and the host-plane service is additionally disabled so "cordis-host-runner absent" holds unconditionally rather than "unreachable through every preset this deployment currently ships." `validateDrillProductionPolicy()` reads `ctx.get('dynamicCordisRunner')` after every patch layer and throws if it is mounted — an operator or overlay patch re-enabling the row (e.g. flipping `disabled: false` on the `cordis-host-runner` entry) now fails boot with a named diagnostic instead of silently reopening `dynamicCordisRunner`'s `@Remote`-decorated RPC surface (`inventory`, `runHostHalf`, and the rest, dispatched by `TypertGatewayService` independent of any preset or tool schema).

**`session-persistence-sqlite`/`session-query-sqlite`: restated and now checked at startup.** Both were already closed before this change (the former never mounted at all, the latter dormant under `openAt: never` with no reachable override — confirmed via the same exhaustive trace as the Phase 0 audit, not re-derived). This bundle restates `session-query-sqlite`'s `openAt: never` as a self-documenting invariant, and `validateDrillProductionPolicy()` additionally narrows `ctx.get('sessionQuery')` to `SqliteSessionQueryEngine` and asserts `config.openAt === 'never'` after every patch layer, so a later override (an operator's `$DSH_HOME/cordis.patch.yml` or a `--patch` overlay setting `openAt` to `'startup'`/`'first-search'`) fails boot rather than silently reopening `_observeStable()`'s unfiltered live-session merge (`packages/session-query/session-query-sqlite/src/index.ts`).

**A startup FAIL LOUD assertion, not silent trust in the config.** `validateDrillProductionPolicy()` is shared by startup and unit tests. After every patch layer it requires the exact approved set `{drill-production}`, default `drill-production`, `includeUserRoot: false`, the exact permission ids and mappings for `read-only` and `workspace-write`, an unmounted `dynamicCordisRunner`, and (when a sqlite session-query engine is mounted at all) `openAt: 'never'`. It throws a named diagnostic rather than clamping.

## Assessed inactive paths

`packages/core/agent-loop/src/index.ts` does not propagate owner context when configured `resumeSessionId` or `restoreOrCreateConfigured` startup work reaches `resumeWith()` without a principal. The base bundle configures `agent-loop.config.agents: []`, while web-app and drill-production do not override it, so this path is unreachable in the shipped Drill production composition; any patch layer or new bundle that supplies configured agents with `sessionId` or `resumeSessionId` must reassess owner propagation before deployment. Evidence: `2026-08-21-startup-resume-and-import-sideeffect-assessment.md` (2026-08-21).

Finding 2's `instanceof SqliteSessionQueryEngine` narrowing uses a value import from `@deepseek-ai/dsh-session-query-sqlite`. The module tops of `index.ts`, `schema.ts`, and `query.ts` perform only pure schema, constant, type, and declaration initialization: registration, file/database opening, connections, and timers do not run at import time; `openSearchDatabase()` opens the database during engine service initialization under `config.openAt`, which the value import does not bypass. Evidence: `2026-08-21-startup-resume-and-import-sideeffect-assessment.md` (2026-08-21).

## Blocked capability roster

`cordis` (dynamic self-modification), `minimal` (bare `fs-local`), any user-authored preset, `tool-bash`/`tool-pwsh`/`tool-fs`/`tool-fs-search`, `tool-workflow`/`tool-ralph`, external-process subagents, `danger-full-access`, the native directory picker, and `cordis-host-runner`.

## Why current sandbox execution remains pending #5

`bash-sandbox`/`pwsh-sandbox`/`fs-sandbox` extend their `-local` counterparts and only add a file-write containment check (`isPathUnder`); they do not exist in `drill-production`'s approved roster because Issue #5 has not yet hardened read/network/process isolation. See the Issue #5 handoff matrix below.

## Why arbitrary custom provider composition is disabled v1

Extending `approvedIds` to cover a user-authored preset id would still leave that preset free to name *any* plugin, including `cordis-host-runner`/`fs-local`/`subprocess-local` — a denylist-shaped gap the original Phase 0 audit specifically flagged as needing an allowlist model, not incremental denylist entries. Building that allowlist is out of A3's scope; `includeUserRoot: false` is the simpler, stricter v1 answer.

## Legacy preset session resume decision

A session recorded under a preset A3 later blocks keeps its history readable, but cold-resuming it is rejected and never silently rebound to `drill-production`. The restart test creates and flushes a `minimal` session through JSONL persistence, disposes the complete Cordis tree, recreates it with the production policy, reads the durable preset identity, and confirms `agents.resume()` fails with `UnknownPresetError` during setup.

## Issue #5 handoff

| Capability | Current provider | Why blocked in A3 | Issue #5 required hardening | Expected post-#5 production state |
|---|---|---|---|---|
| `tool-bash`/`tool-pwsh` | `bash-sandbox`/`pwsh-sandbox` over `sandbox-local` | File-write-only confinement; exec, network, process spawn, and reads are unconfined | Read isolation, network egress policy, process/PID isolation, resource limits | Re-add to `drill-production`'s approved preset (or a successor) once qualified |
| `tool-fs`/`tool-fs-search` | `fs-sandbox` (reads always pass through by design); `grep`/`glob` bypass `ctx.fs` entirely and spawn `rg` as a raw subprocess | No read confinement at all; `tool-fs-search` is also an undeclared subprocess-execution path | Canonical read isolation; route `tool-fs-search` through a confined execution path | Re-add once read confinement and the search tool's subprocess path are both qualified |
| `cordis-host-runner`/`tool-cordis` | `node:vm` sandbox, host-vm isolation only | Package's own documentation: "not a security boundary... treat like bash access"; additionally has an approval-flow gap (host-only definitions skip the approval step) for non-A3 reasons | A real code-execution sandbox (the same hardening `tool-bash` needs), plus the approval-flow fix (independent of A3) | Re-add only if a hardened execution path is judged to cover dynamic-code risk equivalently to Bash |
| `danger-full-access` | N/A — removed from the permission-preset table | Depends entirely on `bash-sandbox`/`fs-sandbox`'s own hardening, which is Issue #5's scope | Same hardening as `tool-bash`/`tool-fs` | Re-add only alongside re-adding the tools it would otherwise be inert without |

## Verification

Package tests exercise roster filtering, exact startup-policy rejection (including a mounted `dynamicCordisRunner` and a non-`'never'` `session-query-sqlite` `openAt`), real mounting, and JSONL-backed restart denial. The real production boot spawns `base`+`web-app`+`drill-production`, mounts the resolved preset, inspects its runtime tool schemas, confirms both permission ids and the absent dynamic Cordis runner, rejects `cordis`/`minimal`/`standard` over HTTP, rejects a Full Access settings mutation, proves two authenticated owners receive distinct picker roots, and rejects absolute, traversal, symlink, and cross-owner picker escapes. Two further real boots apply a `cordis-host-runner: disabled: false` overlay patch and a `session-query-sqlite` `openAt: 'startup'` overlay patch, confirming each fails boot with the corresponding named diagnostic instead of reaching ready.

## Alternatives considered

**Extend `SandboxPolicy`'s vocabulary to express network/process limits directly.** Rejected: that is Issue #5's real-sandbox work, and the Phase 0 audit's own network-policy investigation (`/home/raylin/report/2026-08-20-sandbox-infra-denylist-feasibility.md`) found the mechanism design itself (netns vs cgroup-matching) unresolved without a real target Linux host to spike on — well outside A3's "which capability may run" scope.

**Confine the directory picker to `UserHome` instead of disabling it.** Rejected per §5.5's own explicit instruction and the Phase 0 audit's evidence: `UserHome` holds sessions, credentials, and settings internals, not a user-facing workspace root — confining to it would be a containment-in-name-only boundary, not a real one.

**Build an allowlist model for user-authored presets now, rather than disabling them.** Rejected for v1: the allowlist would need to name every permitted plugin, not just preset ids, which is a materially larger design (closer to a real capability policy language) than A3's "small, centralized, testable closure" mandate. `includeUserRoot: false` is deliberately the simpler, stricter interim answer.

**Add a generic RBAC/permission framework for capability approval.** Rejected: `approvedIds` reuses the exact seam every preset-selection path already read: no plugin anywhere needed a new `if (production) ...` branch, and the two-line addition to `AgentPresets.Config` plus a `list()` filter is the entire mechanism.

## Consequences

Drill multi-user production, with this bundle composed, has no Bash, PowerShell, or generic-filesystem model tool, no dynamic self-modification, no directory browsing outside the current owner's canonical root, and no `danger-full-access` selection surface. A generic `dsh-web-app`/single-user deployment uses the same owner-scoped browse backend whenever its adaptive picker selects browse. The startup check turns a future accidental widening (an operator's patch layer re-adding `danger-full-access` to the table, or clearing `approvedIds`) into a boot failure with a named diagnostic rather than a silent regression.

This closure does not provide filesystem read isolation, protected network egress, Unix-socket isolation, PID/process isolation, CPU/RAM/PID limits, or a secure arbitrary-process sandbox. Issue #5 owns those mechanisms and the qualification required before re-enabling filesystem, shell, workflow, or other subprocess-backed tools.
