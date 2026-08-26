# Agent Note: Resource limits through systemd user scopes

Status: implemented

## Problem

Filesystem and PID isolation do not bound how much CPU, resident memory, swap, process capacity, or wall-clock time one confined process tree can consume. A memory limit is particularly easy to misstate: cgroup v2 permits memory above `memory.max` to move into swap while `memory.swap.max` remains unlimited, so configuring only the resident-memory property is not a hard memory bound.

The enforcement layer also depends on deployment state outside the process. A transient user scope requires a running user systemd manager, a reachable user D-Bus, cgroup v2, and delegated controllers. A configured defense cannot silently disappear when any of those requirements is absent.

## Decision

`@deepseek-ai/dsh-sandbox-local` owns an optional outer resource-limit rung because the limits govern the same local process tree already returned by `confine()`. A separate capability package would expose no independent service or consumer. When any limit is configured, the returned chain is:

```text
systemd-run --user --scope <properties> -- <selected sandbox runner> -- <caller argv>
```

`cpuQuotaPercent`, `maxTasks`, and `walltimeSeconds` map to `CPUQuota`, `TasksMax`, and `RuntimeMaxSec`. `timeoutStopSeconds` sets the stop grace before systemd escalates from SIGTERM to SIGKILL and defaults to two seconds when walltime is configured. `memoryMaxBytes` resolves to one inseparable memory policy: `MemoryMax` plus `MemorySwapMax`; an omitted `memorySwapMaxBytes` becomes zero, and swap without a memory maximum is invalid. Values are finite, positive, and exactly representable where systemd requires integer bytes or task counts.

The first limited `confine()` performs one bounded functional probe and caches its verdict. The probe starts a real user scope with CPU, memory, zero-swap, and task properties, then reads `cpu.max`, `memory.max`, `memory.swap.max`, and `pids.max` from the child cgroup. A failed or mismatched probe raises `SANDBOX_UNAVAILABLE`; no caller argv runs. With no configured limit the systemd rung and probe are both absent, making unrestricted resource use explicit rather than a fallback from failed enforcement.

The transient scope is outermost so every launcher and every descendant joins the same cgroup. `RuntimeMaxSec` therefore stops the complete process tree, and `TimeoutStopSec` supplies a bounded escalation even when descendants ignore SIGTERM. A started `systemd-run` refusal is also carried as runner-failure evidence for the existing consumer classifier.

`RuntimeMaxSec` coexists with the shell executors' existing foreground deadline. That deadline is request-specific, capped by executor config, classified as `timedOut` for model-visible results, and already terminates the detached process group through `ctx.subprocess`; background shell runs deliberately omit it. The systemd value is a deployment-wide ceiling that also covers background runs and the sandbox launchers. Whichever deadline expires first initiates whole-tree termination. A systemd-first exit remains an ordinary signal outcome because it did not originate from the executor's timeout signal; replacing the existing deadline would discard per-call overrides and timeout cause reporting.

## Alternatives considered

**A separate resource-limit capability package.** Rejected because it would add a package and plugin row around one argv transformation while still requiring `sandbox-local` to order it around the selected runner. The local sandbox provider already owns that process-tree composition point.

**Write cgroup v2 files directly.** Rejected because delegation, cgroup creation, process migration, cleanup, and concurrent naming would become harness-owned lifecycle code. The user systemd manager already owns those operations and was functionally verified on the deployment target.

**Treat `MemoryMax` alone as sufficient.** Rejected because unlimited swap lets allocations exceed the apparent bound without an OOM kill. Defaulting the paired swap maximum to zero makes the shortest configuration the safe one.

**Fall back to an unbounded process tree when the probe fails.** Rejected because a deployment that requested limits would report protection while providing none. Operators who intentionally want no resource bound leave every limit unset.

**Replace the shell executors' foreground deadline.** Rejected because it already terminates the complete process tree through the subprocess seam and owns per-call overrides plus `timedOut` cause reporting. The systemd ceiling instead covers the launcher chain and background runs without changing that consumer contract.

## Consequences

Resource limiting remains opt-in and Linux/systemd-specific. A limited deployment must keep the user manager and D-Bus reachable and delegate the `cpu`, `memory`, and `pids` controllers; loss of that machinery rejects work instead of weakening it. The functional probe adds one synchronous, bounded scope launch to the first limited call per provider lifetime.

Unit tests pin config resolution, the zero-swap default, invalid pairings, property order, outermost wrapping, cached probe success, and cached fail-closed behavior. Real cgroup tests measure half-CPU throttling, an exit-137 memory OOM, and walltime termination of an ignoring descendant process. The existing subprocess suites separately pin tree-scoped shell timeout termination. The probe itself verifies the controller files rather than treating a successful `systemd-run` exit as enforcement evidence.
