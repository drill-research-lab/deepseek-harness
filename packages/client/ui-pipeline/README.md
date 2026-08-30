# @deepseek-ai/dsh-client-ui-pipeline

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Pipelines surface plugin, browser half: the sidebar `sidebar.pipelines` block (the feature-navigation seat below the session browser, owned by ui-sidebar's shell contract) and one full-window editor overlay in `shell.overlay` (order 20). Both entries share one root-scoped store — the open pipeline id — created at apply time so identity follows the plugin fiber, and one inject face over the generated `pipelines` Remote namespace (`list`, `get`, `save`, `delete`, `setEnabled`, `triggerNow`, `runs`, `run`). The navigation block lists every pipeline with live status, the failure-streak badge, and a per-row pause/resume toggle that re-reads the list after `setEnabled`; clicking a pipeline writes the store, opens the overlay, and requests sidebar expansion. The overlay renders nothing while no pipeline is open; when one is open it shows a header (name, run-now, close), a read-only DAG canvas — elkjs computes the layered layout because definitions carry no positions — and the runs list. Run-now awaits `triggerNow` and refreshes the runs.

The `/client` exports are the plugin body (`apply`/`inject`), the shared store factory (`createPipelineUiStore`), the pure `layoutDag` helper with its `LaidOutNode` shape, and the inject/prop type vocabulary. The canvas is a presentation component over `@xyflow/react` in read-only mode (no dragging, no connecting, no positions persisted).

## Model Experience

None. The surface reads pipeline definitions and run records through the host's `pipelines` Remote namespace and adds no prompt content, session event, or projection.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- **No template gallery or JSON import yet** — the Scheduled Search template form and the paste-JSON import path land with the next slices; `save` already accepts a full WorkflowJSON document.
- **Inspector is selection-only** — clicking a canvas node highlights it, but the inspector panes (config / input / output per node) and provenance views land with the inspector slice.
- **LLM nodes need engine config** — the editor cannot pick a model per node; llm nodes rely on the engine's `llmProvider`/`llmModel` defaults and fail loud with `LLM_NODE_UNCONFIGURED` otherwise.
