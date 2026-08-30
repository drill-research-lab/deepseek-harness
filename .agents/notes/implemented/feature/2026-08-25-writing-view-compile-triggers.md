# Agent Note: Writing view compile triggers and git-backed version history

Status: implemented

## Scope

The Writing capability (`packages/writing/*` + `packages/client/ui-writing`) decides when to run the LaTeX compiler and how to record versions. This note records the current policy: compilation is agent-driven (auto-compiled once after the agent writes) or user-driven (explicit save / Ctrl+S), and versions are recorded as git commits rather than storage snapshots.

## Decision

- Opening a report **never** recompiles. The view loads the source, then:
  - if the report already has a git version, it shows the latest compiled PDF (`/writing/<reportId>/pdf`) and does **not** compile;
  - only when the report has **no** version does it compile, producing the first version + PDF.
- Opening the preview window **never** recompiles; selection already resolved the compiled output.
- **Agent path**: `report_write` persists the source and then compiles once automatically; a successful compile records a version. This is the "AI modified the file" trigger.
- **User path**: typing only autosaves (`updateSource`); compiling requires the **儲存/save** button or **Ctrl+S** (save + compile), or the **編譯** button.
- **Versioning**: each report's artifact directory (`artifactRoot/<reportId>/`) is a git repository; `main.tex` is the tracked file and the compile command is attached to each commit's body. `report_compile` records one commit per successful compile (`successful compile #N`, with the engine command in the message).
- **Restore** is branch-based: `report_restore`/`restore` create a new branch (user-named) from the target commit, switch the report to it, and keep the original branch/history intact; it does **not** snapshot a new version.
- The full-screen preview header carries **儲存/編譯/下載** buttons to the right of the title field; a long title ellipsizes.

## Why

The compiled PDF at `/writing/<reportId>/pdf` is always the live last output of the report's compile service. Recompiling on open/preview was wasteful and created redundant versions, so those paths now reuse the compiled output. Treating an agent write as the auto-compile trigger (and a user edit as manual) keeps the loop model-driven while giving the user explicit control. git commits make each successful compile an immutable, branchable history entry.

## Implementation

- `writing-compile` (`ctx.latexCompile`): `commitVersion(reportId, label)` (git init on first use, commit `main.tex` with `command: <engine>` in the body), `listVersions(reportId)` (git log, `-z`-separated), `restoreVersion(reportId, versionId, branchName)` (branch from the commit, checkout, return source).
- `tool-writing`: `report_write` auto-compiles on success; `report_compile` records a git version; `report_versions`/`report_read.versionCount` read git history; `report_restore` takes a `branch` and restores by branching.
- `writing-api`: `compile` records a git version on success (skipped when `snapshot: false`), `versions` reads git history, `restore` takes `branch` and switches to it + updates the report source. The typert `/remote` artifacts were regenerated for the new `RestoreRequest.branch`, `ReportVersionView.command`, and the `snapshot` field.
- `WritingView.tsx`: `select` branches on `versions(...)` length (show latest vs compile); typing autosaves only (a new `onSave` + global Ctrl+S handler persists and compiles); `onRestore` prompts for a branch name.

## Deferred

- Bidirectional source⇄PDF sync (rejected: it would require replacing the native iframe PDF viewer with a pdf.js-rendered one).
