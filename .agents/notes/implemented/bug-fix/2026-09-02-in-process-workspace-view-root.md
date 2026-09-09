# Agent Note: in-process filesystem tools honor `workspaceViewRoot`

Status: implemented



> Scope: closes the gap left by [mounting workspaces at a short path](../feature/2026-07-30-current-sandbox-policy-context.md) — the `/workspace` alias reached the mount-namespace runners and the `sandbox:policy` prompt line, but not the in-process filesystem tools, so `read` / `write` / `edit` / `str_replace_editor` / `glob` / `grep` rejected every absolute path the model formed from that prompt.

## Problem

The local Linux composition sets `workspaceViewRoot: /workspace`. Two consumers were taught the alias: the `bwrap` / `landlock-pid` runners bind `policy.workspaceRoot` to `/workspace` and `--chdir` there, and `renderPolicyContext` tells the model its workspace is `/workspace`. Nothing else was.

`dsh-fs-sandbox`, `dsh-fs-local`, and `readableRoots` / `writableRoots` all operate in real-path space — `policy.workspaceRoot` is the owner-scoped `~/.dsh/owner-roots/<hash>/<project>` directory, and the containment check is a lexical `isPathUnder` against it. The model, following the prompt, calls `read /workspace/foo.c`; `ctx.fs.resolve` keeps the absolute path; `isPathUnder("/workspace/foo.c", "<real root>")` is false; the tool returns `FS_SANDBOX_DENIED` / not-found. `str_replace_editor` is worst hit — it *requires* an absolute path, so every call failed. Relative paths still worked (they resolve against the real `header.cwd`), which made the failure look arbitrary. Search's `checkSearchRoot` rejected an explicit `/workspace/...` root the same way.

The runner alias is real only inside a subprocess mount namespace. The in-process tools run in the host mount namespace, where `/workspace` is an unrelated empty directory, so they cannot use the alias as-is and cannot be "fixed" by pointing enforcement at `/workspace`.

## Decision

**The alias is a Consumer-side path translation; enforcement stays real-path.** `SandboxExecutionPolicy` gains an optional `workspaceViewRoot`, and `sandboxPolicy.resolve()` carries it on every policy when the deployment configures one. Two pure prefix maps live in `dsh-sandbox/roots.ts` beside `readableRoots` / `writableRoots`:

- `fromWorkspaceView(path, policy)` — an absolute `path` under `workspaceViewRoot` is rewritten onto `workspaceRoot`; a relative path, an absolute path outside the view root, and a sibling-prefix near-match (`/workspace-other`) are returned unchanged; identity when the policy sets no view root.
- `toWorkspaceView(path, policy)` — the inverse, for a real resolved path a Consumer echoes to the model.

`dsh-tool-fs` (`read`, `read_image`, `write`, `edit`) and `dsh-tool-str-replace-editor` (`view`, `create`, `str_replace`, `insert`) call `fromWorkspaceView` on the model-supplied path before `ctx.fs.resolve`, and `toWorkspaceView` on the resolved `displayPath` for every path they return — result envelopes, the `path` output field, directory-listing rows, and the not-found / not-a-file / edit-failure messages. `dsh-fs-sandbox`, `dsh-fs-local`, and the root helpers are untouched: enforcement still keys on the real `workspaceRoot`, so the alias never widens access.

`dsh-tool-fs-search` keeps the model's path in the ripgrep argv — the confined child's mount namespace exposes exactly `/workspace` — and only its in-process `checkSearchRoot` maps the path with `fromWorkspaceView` before the lexical containment check. `toWorkdirRelative` already leaves relative rg output and out-of-workdir absolute output unchanged, so search result paths needed no change.

## Alternatives considered

- **Drop `workspaceViewRoot` and let the model see the real owner-scoped path.** Reverts the "short path" feature's purpose: the real path is long and leaks the owner hash into every model turn, polluting context. Rejected — the point of the bind is a stable, short, non-identifying cwd.
- **Bind the workspace onto its own real path in the namespace (no rename) and keep only the tmpfs mask.** Makes every consumer real-path-consistent with no translation code, but the model still sees the long path. Same rejection reason; recorded here as the fallback if the alias is ever removed.
- **Translate inside `dsh-fs-sandbox` by swapping `FsTarget.displayPath`.** `fs-sandbox.checkedTarget` re-`resolve`s from `displayPath` to re-canonicalize against a swapped symlink ancestor; a view path there would re-resolve `/workspace/...` on the host. `FsTarget.displayPath` is contractually a real resolved path at that same-process boundary. Translation belongs in the Consumer that formats model output, per [the capability-seam split](../architecture/2026-06-13-capability-seams.md).
- **Make the whole agent process run in the mount namespace.** The Web process serves many sessions under different owner roots; a single namespace cannot represent them.
- **Fully wire search output through the view root too.** Not needed — rg runs with `--chdir /workspace` and emits relative or `/workspace/...` paths, both already correct for the model. Only the containment pre-check was translating against the wrong root.

## Consequences

`read` / `write` / `edit` / `str_replace_editor` accept `/workspace/...` and echo it back; `glob` / `grep` accept an explicit `/workspace/...` search root. A path outside the workspace is still denied, now by the same real-path fence as before. `workspaceViewRoot` unset (macOS, Windows, bwrap-less hosts, agentless calls) is exact identity — every existing test passed unchanged. Focused unit tests pin both prefix maps (bare root, sibling near-match, relative pass-through, round-trip), `resolve()` carrying the field, and each tool's in/out translation over a fake provider; the assembled-composition behavior rides the existing sandbox snapshot coverage.
