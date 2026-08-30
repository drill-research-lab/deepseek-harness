# Pipeline

[English](pipeline.md) | [简体中文](pipeline.zh.md) | 繁體中文

Pipeline 接縫持久化 `WorkflowJSON` 定義——以 cron 觸發、節點為單次 LLM 詢問、多步驟 subagent 或 provider 註冊 builtin 步驟的 DAG——啟動其 run，並透過僅供觀察的 `pipeline/*` 事件回報生命週期。產品脈絡（Drill Pipelines 與 Scheduled Search tracer bullet）：[spec](https://github.com/drill-research-lab/drill-docs/blob/main/docs/features/pipeline/spec.md) · [dsh#24](https://github.com/drill-research-lab/deepseek-harness/issues/24)。

Service Definition：[`dsh-pipeline`](../../packages/pipeline/pipeline)（`ctx.pipelineEngine` 與下方詞彙）。引擎 provider——檔案型 registry、cron 排程器、跑在 run session 上的 DAG 評估器——以及 model 面與 UI consumer 在同項工作的後續切片落地。`save` 是持久化 parser 邊界：每一份被保存的定義，無論來自何處，都先通過 `validateWorkflowJson`。`startRun` 套用重疊政策（每條 pipeline 同時只有一個執行中的 run；後續觸發被跳過並以資料回報，不進佇列），且每個變更只在 registry 提交後才發出 `pipeline/definition-changed`。run 資料本身存放在各 run 自己的 session log；`pipeline/*` 事件刻意不攜帶任何節點輸入或輸出值，觀察生命週期的 listener 因此永遠拿不到 run 資料的可變別名。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxpipelineengine--pipelineengine-abstract-seam"></a>

### `ctx.pipelineEngine` — `PipelineEngine` (abstract seam)

Pipeline Service Definition contract. `save` validates at the durable parser boundary and fails loud; every mutation emits `pipeline/definition-changed` only after it commits; `startRun` applies the overlap policy and reports skips as data, never as a thrown error. Lifecycle listener failures are contained, and `pipeline/run-end` fires exactly once per accepted run.

```ts cordis-catalog
/**
 * List every persisted pipeline's registry projection, in registry order.
 * @returns the summaries; empty when nothing is persisted.
 */
abstract list(): readonly PipelineSummary[]

/**
 * Read one persisted definition.
 * @param id - the pipeline's id.
 * @returns the validated definition, or undefined when the id is unknown.
 */
abstract get(id: PipelineId): WorkflowJson | undefined

/**
 * Validate and persist a definition (create or replace by its id).
 * @param request - the candidate definition as raw JSON data; validated
 *   here on every path.
 * @returns the validated definition that was persisted.
 * @throws PipelineSchemaError when the definition fails validation.
 */
abstract save(request: PipelineSaveRequest): Promise<WorkflowJson>

/**
 * Delete a definition and its registry entry. Run sessions and output
 * artifacts are kept (deletion never destroys recorded data).
 * @param id - the pipeline's id.
 * @returns true when the definition existed and was deleted; false when unknown.
 */
abstract delete(id: PipelineId): Promise<boolean>

/**
 * Pause or resume a pipeline's trigger.
 * @param id - the pipeline's id.
 * @param enabled - true resumes the trigger; false pauses it.
 * @returns true when the definition existed; false when unknown.
 */
abstract setEnabled(id: PipelineId, enabled: boolean): Promise<boolean>

/**
 * Start a run of one pipeline, applying the overlap policy: when the
 * pipeline already has a run executing, the trigger is skipped and
 * reported as data.
 * @param request - the pipeline id and the triggering lane.
 * @returns the started run's handle, or the recorded skip.
 * @throws PipelineError with code `'PIPELINE_UNKNOWN'` when the id is unknown.
 */
abstract startRun(request: PipelineRunRequest): PipelineRunStart
```

Source: [`packages/pipeline/pipeline/src/index.ts:125`](../../packages/pipeline/pipeline/src/index.ts)

<a id="pipeline-events"></a>

### `pipeline/*` events

<a id="pipelinedefinition-changed--emit"></a>

#### `pipeline/definition-changed` — emit

A persisted definition changed — saved, deleted, paused, or resumed. Fired after the registry mutation commits.

```ts cordis-catalog
/**
 * A persisted definition changed — saved, deleted, paused, or resumed.
 * Fired after the registry mutation commits.
 * @param change - the definition's id and what changed.
 * @mode emit
 */
'pipeline/definition-changed'(change: PipelineDefinitionChange): void
```

Source: [`packages/pipeline/pipeline/src/index.ts:72`](../../packages/pipeline/pipeline/src/index.ts)

<a id="pipelinenode-end--emit"></a>

#### `pipeline/node-end` — emit

One node settled (completed, failed, or skipped). Paired with Events['pipeline/node-start'] by `node.nodeId`.

```ts cordis-catalog
/**
 * One node settled (completed, failed, or skipped). Paired with
 * {@link Events['pipeline/node-start']} by `node.nodeId`.
 * @param info - the run's identity snapshot.
 * @param node - the node's settlement (outcome plus failure message).
 * @mode emit
 */
'pipeline/node-end'(info: PipelineRunInfo, node: PipelineNodeEndInfo): void
```

Source: [`packages/pipeline/pipeline/src/index.ts:96`](../../packages/pipeline/pipeline/src/index.ts)

<a id="pipelinenode-start--emit"></a>

#### `pipeline/node-start` — emit

One node started executing. Paired with Events['pipeline/node-end'] by `node.nodeId` on every stop path; a node the run never reaches emits neither event.

```ts cordis-catalog
/**
 * One node started executing. Paired with
 * {@link Events['pipeline/node-end']} by `node.nodeId` on every stop
 * path; a node the run never reaches emits neither event.
 * @param info - the run's identity snapshot.
 * @param node - the node's id and type.
 * @mode emit
 */
'pipeline/node-start'(info: PipelineRunInfo, node: PipelineNodeInfo): void
```

Source: [`packages/pipeline/pipeline/src/index.ts:88`](../../packages/pipeline/pipeline/src/index.ts)

<a id="pipelinerun-end--emit"></a>

#### `pipeline/run-end` — emit

A run settled (completed or failed). Fired when the started run's `result` resolves. Paired with Events['pipeline/run-start'].

```ts cordis-catalog
/**
 * A run settled (completed or failed). Fired when the started run's
 * `result` resolves. Paired with {@link Events['pipeline/run-start']}.
 * @param info - the run's identity snapshot.
 * @param result - the outcome data (status, error, node count) —
 *   deliberately WITHOUT node output values.
 * @mode emit
 */
'pipeline/run-end'(info: PipelineRunInfo, result: PipelineRunResultInfo): void
```

Source: [`packages/pipeline/pipeline/src/index.ts:105`](../../packages/pipeline/pipeline/src/index.ts)

<a id="pipelinerun-start--emit"></a>

#### `pipeline/run-start` — emit

A run started — the definition validated and accepted past the overlap policy. Paired with Events['pipeline/run-end'].

```ts cordis-catalog
/**
 * A run started — the definition validated and accepted past the overlap
 * policy. Paired with {@link Events['pipeline/run-end']}.
 * @param info - the run's identity snapshot.
 * @mode emit
 */
'pipeline/run-start'(info: PipelineRunInfo): void
```

Source: [`packages/pipeline/pipeline/src/index.ts:79`](../../packages/pipeline/pipeline/src/index.ts)
<!-- END GENERATED cordis-surface -->
