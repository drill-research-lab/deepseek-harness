# @deepseek-ai/dsh-agent-librarian

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Librarian subagent provider: registers `librarian` on `ctx.subagents`, starting each delegation as a fresh in-process child with a librarian persona that works the Library through the `library_*` tools — discover with `library_structure` (outlines and summaries from the ingest-time index), read exact wording with `library_read`, file material with `library_ingest`, and answer questions itself from what it reads with inline `[name]` citations (never back through `library_ask`, which is the callers' entry into it: `library_ask` delegates HERE, so the child answering by re-asking would recurse). A general agent (the Chat orchestrator) delegates knowledge-base work to `librarian` instead of pulling whole documents into its own context, matching the Drill spec's orchestrator/librarian split. The persona and provider name are deployment configuration.

## Model Experience

The provider itself adds no tools or prompt text to the parent; a delegated child runs with the forced librarian persona prepended to any caller persona, plus whatever tool filter the delegation requested.

#### KV Cache effect

None on the parent's prompt prefix; each child is a fresh context.

## Known Limitations and Deferred Work

- The child is a fresh context (`inheritsParentContext: false`); a `shared-project` context mode from the Drill spec is deferred to the subagent seam.
- No dedicated Web UI preset row yet; delegation happens through the standard subagent tool.
