# @deepseek-ai/dsh-client-ui-writing

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

The Writing surface: a `conversation.view` entry ("Writing") showing a report list (left), a LaTeX source editor with a PDF preview (right), and compile feedback with version restore (bottom). It drives the writing capability through the browser Remote contract (`ctx.remote.writing.*`), so it lists, creates, edits, compiles, and version-restores reports.

## Behavior

- **Report list** — lists reports newest first, creates one from a title, and switches the editor to the selected report.
- **Editor** — a plain LaTeX source editor; Save writes the whole source (autosave), Compile runs the engine and shows diagnostics (errors as errors, warnings as warnings) and the produced PDF in an `<iframe>`.
- **Versions** — lists the snapshots a successful compile created, and lets you restore one (replacing the editor source).

The report data is fetched through the inject face; the view holds only view-local state (selection, draft, compile output), so the plugin owns no store and no session-event listener.

## Model Experience

The view is a browser surface; it sends the report source over the wire for editing and compile, and reads back diagnostics. It adds no new model input beyond the report content the writing tools already model-visible.

#### KV Cache effect

None; the view assembles no provider request.

## Known Limitations and Deferred Work

- The editor is a plain textarea (no LaTeX syntax highlight); CodeMirror 6 and section-level edits are deferred.
- The bottom pane shows compile feedback and version list, not a full agent-chat binding; agent delegation happens in a normal Chat session via the `writer` subagent / `report_*` tools.
- Live two-way sync (an agent editing while the view is open) is not wired; the view reloads on selection.
