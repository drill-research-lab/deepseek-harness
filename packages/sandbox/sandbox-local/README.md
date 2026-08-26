# @deepseek-ai/dsh-sandbox-local

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Local implementation of the [`dsh-sandbox`](../sandbox/) seam. It selects and caches one platform runner: Linux prefers a working `bwrap`, then a compound PID-isolation-plus-Landlock runner; macOS uses Seatbelt; Windows uses the ACL restricted-token runner. Multiple candidates are probed in order, while a sole candidate is selected directly.

The package root exports the default and named `LocalSandboxProvider` plugin and `Config`; platform profile builders stay internal.

Unsupported platforms and unusable runners fail closed with `SANDBOX_UNAVAILABLE`; execution never silently falls through unconfined. Each wrap carries structured runner-failure rules so consumers can distinguish a broken sandbox from a command failure. The [sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md) owns selection rationale and profile differences.

Policy is per call; the provider stores only the mechanism and cached runner verdict. Each wrap reports enforcement completeness plus backend-specific denial signatures and runner-failure rules. Landlock requires exit 125 and a `landlock-run:` fatal line after excluding only the exact partial-enforcement notice; a notice with child exit 1, 2, or 125 remains a child outcome. Bubblewrap and Seatbelt remain signature-only because neither public contract reserves a launcher-failure status. Consumers spawn the returned argv directly, so a missing or unexecutable runner is an out-of-band spawn failure while a successfully launched child exit 126 or 127 remains ordinary. `runnerCommand` skips probes and requires one or more non-empty, single-line, case-insensitive `runnerFailureSignatures` entries for the custom runner's own fatal dialect. Because its mechanism is unknown, it carries both Linux denial dialects. `probeTimeoutMs` bounds functional probes. The [sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md) owns selection and failure semantics.

The Seatbelt profile is allow-default with `(deny file-write*)` plus write allow-lists, so exactly the mode's promised file effects are governed: `read-only` grants the `/dev/null` literal alone; `workspace-write` adds the workspace root, `/tmp`, and the per-user darwin temp dir (`os.tmpdir()` — the platform's real temp area for mkstemp-family tools), every root canonicalized because Seatbelt matches resolved paths (`/tmp` IS `/private/tmp`). Apple marks the `sandbox-exec` CLI deprecated but ships it on every macOS; the functional probe is what fails closed if that ever changes.

The Windows rung keeps one deterministic write SID and standing ACE per workspace, but gives every live session/workspace pair a random private temp directory with a distinct SID and revocable ACE. Sessions sharing a workspace therefore share its intended write authority without inheriting one another's temp authority. A fresh provider always chooses a new temp path and SID, so crash residue cannot block or authorize a resumed session; agentless calls receive the same per-invocation isolation from the runner. A workspace equal to or containing the platform temp root fails before any ACL mutation because its inheritable workspace ACE would otherwise reach every private temp child.

[`@deepseek-ai/node-addon-landlock-run`](https://www.npmjs.com/package/@deepseek-ai/node-addon-landlock-run) supplies the platform launcher, functional probe, and CLI argument vocabulary. This provider owns only mode-to-grant mapping and runner selection. Keeping path resolution and probe parsing with the versioned binary prevents contract drift.

The Linux runners bind the canonical host workspace root to `/workspace` and enter that path before executing the command. Each bwrap process constructs the alias itself; the Landlock rung asks [`@deepseek-ai/node-addon-pid-isolate-run`](../../../native/pid-isolate-run/) to create it after mount propagation becomes private and before setup capabilities are removed. The Landlock deployment must provide an existing `/workspace` directory as the bind destination, apply `setcap cap_sys_admin,cap_setpcap+ep` to the installed launcher, and verify `--probe`; otherwise the compound rung fails closed. The alias does not replace the canonical host root or add authority: both names refer to the same hierarchy, and owner isolation remains rooted in the per-call source path.

The Linux Landlock profile permits reads from `/workspace` plus `/usr`, `/etc/ld.so.cache`, and `/etc/alternatives`; writes remain mode-specific. An absolute outer executable supplied by a trusted consumer receives a read grant for that exact file, allowing packaged static tools such as ripgrep to reach `execve` without granting their parent runtime tree. The system roots support ordinary executables and merged-usr loader symlinks. Bubblewrap does not use the privileged helper. macOS Seatbelt and Windows ACL execution retain their canonical host working paths because those platforms have no mount-namespace alias.

Optional Linux resource limits add `systemd-run --user --scope` outside the selected runner chain. `cpuQuotaPercent` maps to `CPUQuota`; `maxTasks` maps to `TasksMax`; `walltimeSeconds` maps to `RuntimeMaxSec`, with `timeoutStopSeconds` controlling the SIGTERM-to-SIGKILL grace and defaulting to 2 seconds. `memoryMaxBytes` always carries `MemorySwapMax`: omitting `memorySwapMaxBytes` safely resolves it to zero, while configuring swap without memory is rejected. The first limited call functionally proves that the user manager can create a scope and that cgroup v2 records the expected CPU, memory, zero-swap, and task limits. Missing user systemd or D-Bus support fails closed with `SANDBOX_UNAVAILABLE`; leaving every limit unset explicitly omits this rung.

`walltimeSeconds` is a deployment-wide ceiling, not a replacement for the bash and PowerShell executors' request-specific foreground timeout. The executor deadline retains per-call overrides and model-visible `timedOut` classification while already terminating its detached process tree; background shell runs omit that deadline. The systemd ceiling additionally covers background runs and the launcher chain. Whichever expires first stops the tree; a systemd-first termination is reported as a signal outcome rather than an executor timeout.

```yaml
- id: sandbox
  name: '@deepseek-ai/dsh-sandbox-local'
  config:
    cpuQuotaPercent: 50
    memoryMaxBytes: 1073741824
    maxTasks: 256
    walltimeSeconds: 300
```

Consumers: [`@deepseek-ai/dsh-bash-sandbox`](../../shell/bash-sandbox/); see [the acp-agent example](../../../examples/acp-agent/) for the runnable default composition.

## Model Experience

Indirectly, through [`dsh-bash-sandbox`](../../shell/bash-sandbox/README.md) and [`dsh-tool-bash`](../../shell/tool-bash/README.md), which render this provider's enforcement and denial facts while the [`dsh-sandbox`](../sandbox/README.md) seam owns the `SANDBOX_UNAVAILABLE` text and runner selection and profiles stay outside context.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Windows ACL enforcement is partial** — the restricted token must retain Everyone for process initialization, so external objects granting Everyone write access remain writable; NTFS hard links also alias one file object across workspace and external paths. The provider reports `enforcement: 'partial'` rather than overstating that boundary as full.
- **Landlock may be partial** — older supported kernel ABIs confine only the access classes they expose, reported as `enforcement: 'partial'` rather than overstated as full.
- **Seatbelt depends on deprecated `sandbox-exec`** — macOS still ships it, but this provider cannot replace or probe that private policy engine if Apple removes it.
- **Runner selection is cached for the provider lifetime** — installing, removing, or repairing a runner requires reloading the plugin before selection changes.
- **`runnerCommand` is an operator assertion** — a configured custom runner skips functional probes and is assumed to implement the bwrap-compatible profile honestly; if it is itself a Bash script, its interpreter startup runs before that script applies confinement.
- **Resource limits require a user systemd manager and delegated cgroup v2 controllers** — configured limits fail closed when the functional probe cannot reach the user D-Bus or observe the required `cpu`, `memory`, and `pids` controller values.
