# Agent Note: Writing capability — Overleaf-style agent-authored LaTeX reports

Status: implemented

## Scope

This note documents the authoring-side vertical slice of the Drill **Writing** feature on the `feat/writing-plugin` branch: durable report projects, LaTeX compilation with diagnostics, the model-facing write→compile→fix loop, and a writer subagent entry point. The web UI (report list + LaTeX/PDF split editor) and the knowledge-base delivery wiring are separate, later increments.

## Package layout

The `packages/writing/` group holds four packages:

- `writing/` (`ctx.reports`) — durable report projects over `storage-domain`: a stable `ReportId`, title, seeded template, current LaTeX source, immutable version snapshots (`ReportVersion`), and a template library (built-in `article`/`academic-proposal`/`report` plus user-added custom templates). A `TypertRemoteService`, so its `list/create/get/rename/updateContent/delete/snapshot/listVersions/restoreVersion/listTemplates/template/addTemplate/deleteTemplate` methods are also reachable through the Host Remote contract.
- `writing-compile/` (`ctx.latexCompile`) — writes the source into a per-report artifact dir under `artifactRoot`, runs a configurable engine through `ctx.shell`, parses the pdflatex `.log` into ordered error/warning diagnostics, and reports the produced PDF. `pdfPath(reportId)` is the programmatic delivery seam (a knowledge-base/Library integration consumes it).
- `tool-writing/` — model-facing `report_create`, `report_write`, `report_read`, `report_compile`, `report_versions`, `report_restore`. `report_compile` returns diagnostics to the agent and auto-snapshots a version on success, closing the loop without a core-loop change.
- `agent-writer/` (`writer` provider) — registers a `SubagentProvider` on `ctx.subagents` that starts each delegation as a fresh in-process child with a writing persona, so a general agent can invoke `writer` as a subagent to produce a compiling PDF end-to-end.

## Loop mechanics

Compilation is model-driven and version-backed: the writer child (or any agent) calls `report_create`, writes whole-source via `report_write`, and calls `report_compile`. `report_compile` runs the engine, sends diagnostics back as text, and on success snapshots a version labelled `successful compile #N`. The loop terminates when the tool reports `ok`. This avoids modifying `agent-loop`; the tool is the extension point.

## Notes on non-details

- The report registry validates on reopen through the storage-domain schema; responses are frozen snapshots.
- The compile service validates report ids as safe path segments (`[\\/]`, `..`, NUL rejected) because they become directory names.
- Report ids are branded strings; the browser side would call the Remote namespace.
- Templates carry `%%TITLE%%`-style placeholders; substitution is the writer's responsibility.

## Deferred

- Web UI (report list panel, LaTeX/PDF split editor, chat pane), Host Remote assembly (`api/remotes`) mounting, and bundle composition.
- texlab LSP diagnostics and section-level (non-whole-source) edits.
- Keyless snapshot transcript coverage and full gate verification (coverage/doc-sync/module-graph regeneration) for the new group.
