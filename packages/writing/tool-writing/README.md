# @deepseek-ai/dsh-tool-writing

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Model-facing writing tools that close the write → compile → fix loop for a writer agent, backed by `@deepseek-ai/dsh-writing` (`ctx.reports`) and `@deepseek-ai/dsh-writing-compile` (`ctx.latexCompile`).

Tools registered on `ctx.tools`:

- `report_create` — create a report from a title, template, and optional source.
- `report_write` — replace the ENTIRE current source (autosave; no snapshot).
- `report_read` — read the current source, truncated to `maxReadChars`.
- `report_compile` — compile the current source, return diagnostics, and auto-snapshot a version on success.
- `report_versions` — list version snapshots, newest first.
- `report_restore` — restore a report to an earlier snapshot.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `maxReadChars` | `20000` | Cap on report source returned by `report_read`. |
| `maxDiagnostics` | `50` | Cap on diagnostics returned by `report_compile`. |

## Model Experience

The tools are the model-visible surface of the writing capability. Each call is logged by the tool registry, and the report content and compilation diagnostics are what a writer agent sees. The report registry itself (report projects, snapshots, templates) is not model input.

#### KV Cache effect

None; the tools assemble no provider requests.

## Known Limitations and Deferred Work

- `report_write` is whole-source replacement only; section-level edits and diff-aware partial updates are deferred.
- Compilation diagnostics come from the compile service's log parser; texlab LSP diagnostics are a separate, deferred seam.
- Keyless snapshot transcript coverage for these tools is not yet wired; pin model-visible text via snapshot when the assembly is added.
