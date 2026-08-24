# @deepseek-ai/dsh-writing-api

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

The browser-facing writing gateway (`ctx.writing`). It projects the report registry (`ctx.reports`) and compile service (`ctx.latexCompile`) into a plain JSON wire contract, and serves a compiled report's PDF on `GET /writing/<reportId>/pdf`.

Methods (via the Host Remote contract, `ctx.remote.writing.*`):

- `list` / `get` / `create` / `updateContent` / `rename` / `deleteReport`
- `compile` — returns diagnostics and, on success, a `pdfUrl`; auto-snapshots a version
- `versions` / `restore`
- `templates` / `addTemplate`

`compile` reads the report's current source, runs the engine, returns ordered diagnostics to the caller, and snapshots a version on success — the same behavior the `report_compile` tool performs for the agent. The `pdfUrl` points at the served PDF end point above.

The PDF route is registered only when a `webServer` service is composed (an agent-only process mounts the gateway without serving files). The route returns `401` when an `auth` service is present and the request is unauthenticated; without an `auth` service it serves to anyone (loopback-only composition expected).

## Model Experience

None. The gateway is a wire projection; it feeds the report/compile data to the browser and adds no model input. Model-facing work happens in the report/compile services and the writing tools.

#### KV Cache effect

None; the gateway assembles no provider request.

## Known Limitations and Deferred Work

- Reports are global in this single-tenant gateway; per-user ownership/isolation is deferred to the ownership layer.
- The PDF route is a stateless read of the last compiled artifact; it does not recompile on demand.
- The gateway surfaces whole-source reads and writes; section-level edits are deferred.
