# @deepseek-ai/dsh-agent-librarian

Librarian subagent provider: registers `librarian` on `ctx.subagents`, starting each delegation as a fresh in-process child with a librarian persona that works the Library exclusively through the `library_*` tools — discover with `library_structure`, answer with grounded `library_ask`, read exact wording with `library_read`, and file material with `library_ingest`. A general agent (the Chat orchestrator) delegates knowledge-base work to `librarian` instead of pulling whole documents into its own context, matching the Drill spec's orchestrator/librarian split. The persona and provider name are deployment configuration.

## Model Experience

The provider itself adds no tools or prompt text to the parent; a delegated child runs with the forced librarian persona prepended to any caller persona, plus whatever tool filter the delegation requested.

#### KV Cache effect

None on the parent's prompt prefix; each child is a fresh context.

## Known Limitations and Deferred Work

- The child is a fresh context (`inheritsParentContext: false`); a `shared-project` context mode from the Drill spec is deferred to the subagent seam.
- No dedicated Web UI preset row yet; delegation happens through the standard subagent tool.
