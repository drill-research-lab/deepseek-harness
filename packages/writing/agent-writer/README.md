# @deepseek-ai/dsh-agent-writer

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Registers a `writer` subagent provider on `ctx.subagents` that starts each delegation as a fresh in-process child Agent with a writing persona. A general agent can then produce a compiled LaTeX PDF end-to-end by invoking `writer` as a subagent (the model-facing `subagent` tool). The child reuses the shared in-process subagent driver, so it mints its own session, stamps lineage/depth, and reports the standard `SubagentResult`.

The provider supports every start-time capability (`outputSchema`, `depthLimit`, `toolFilter`, `persona`). It always applies the writing persona; a caller-supplied persona is appended after it.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `providerName` | `writer` | Provider name on `ctx.subagents`. |
| `persona` | built-in writer persona | The writing behavior applied to every child. |

## Model Experience

The writing persona is model-facing system-prompt text the writer child sees; it instructs the child to use the `report_*` tools and loop `report_compile` until success. The report registry and compile service serve that loop.

#### KV Cache effect

None; the provider does not assemble a provider request itself.

## Known Limitations and Deferred Work

- On its own, the provider only registers the subagent entry point; the `@deepseek-ai/dsh-tool-writing` tools and `@deepseek-ai/dsh-writing-compile` service must be mounted in the same composition for a writer child to exercise the loop.
- Real end-to-end turns require a composed agent loop and model; the covered test asserts registration and provider shape, not a full LLM-driven report.
