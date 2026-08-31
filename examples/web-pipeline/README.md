# Scheduled Pipelines

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

This overlay opts one `dsh web` process into the Scheduled-pipeline seam without changing the shipped default Web composition:

```sh
dsh web --patch examples/web-pipeline/cordis.yml
```

The composition mounts the file-backed engine (`@deepseek-ai/dsh-pipeline-local`) with the scheduler disabled, so runs start only through the manual lane (`pipelines/triggerNow`) or a model tool call — cron firing stays off until a deployment opts in. The run-session projection vocabulary (`@deepseek-ai/dsh-session` and the JSONL persistence) materializes each run's log under `./.sessions`, one directory per run; definitions and run records live under `./.pipelines`.

The bundled Scheduled Search template (`scheduled-search/*` builtin steps) ships with the engine: creating a pipeline through the UI's template gallery or `pipelines/createFromTemplate` expands into trigger → search → normalize → dedupe → persist (+ optional summarize) nodes. The search step performs one real arXiv API request per run inside arXiv's politeness window; deployments that need deterministic or offline runs register their own builtin steps instead (the snapshot test in `tests/` shows the registration and a full manual run without any network access).

Each run projects its node lifecycle — started/settled outcomes with JSON outputs, durations, and errors — into its own background session, appended with the events' `ignorable` reader-safety mark; `pipelines/run` folds that projection back out for the editor's run detail. Deleting a pipeline keeps its run records and artifacts; the retention bound (`retainedRuns`, default 50) prunes the oldest records together with their run logs.

Known limitation: the bundled llm node aggregates text-delta output only. A reasoning model whose response arrives on the reasoning channel summarizes to an empty string; deployments choose a text-first model or wire per-node model overrides (a later slice aggregates reasoning content).
