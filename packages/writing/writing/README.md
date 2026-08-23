# @deepseek-ai/dsh-writing

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Durable report projects over the storage-domain form (`ctx.reports`). A report is a stable id, a display title, the template it was seeded from, and the current LaTeX source. The registry also owns immutable version snapshots and the template library (shipped built-ins plus user-added custom templates).

The service is a `TypertRemoteService`, so its methods are also callable from the browser Host Remote contract as `reports.list`, `reports.create`, `reports.get`, `reports.rename`, `reports.updateContent`, `reports.delete`, `reports.snapshot`, `reports.listVersions`, `reports.restoreVersion`, `reports.listTemplates`, `reports.template`, `reports.addTemplate`, and `reports.deleteTemplate`.

## Semantics

- Store the current source with `updateContent` (autosave); it never snapshots. Capture an immutable snapshot explicitly with `snapshot`, and restore any version with `restoreVersion`.
- `create` seeds the source from a named template (or a provided `source`, which wins). An unknown explicit `templateId` rejects; an omitted one sets the default built-in `article` template.
- Built-in templates are written once on first open and are not deletable. Custom templates are deletable and must have a unique display name.
- Every response is a frozen snapshot; the durable record is only ever replaced, never mutated in place.

## Model Experience

None. The report registry is a data service — report projects, versions, and templates never enter model input on their own. Model-facing content is derived by the writing tools, which write the report source and feed compilation diagnostics back to the agent.

#### KV Cache effect

None; the registry assembles no provider requests.

## Known Limitations and Deferred Work

- Compilation, version snapshots on successful compile, and the writer subagent seam are separate packages that consume this registry; they are not part of this package.
- The `delete`+version-prune pair and `create`+seed order are two separate durable writes; a crash between them is recoverable on the next open but is not transactionally atomic.
- Templates use `%%TITLE%%`-style placeholder markers; substitution is the writer's responsibility, not the registry's.
