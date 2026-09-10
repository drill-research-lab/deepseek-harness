# @deepseek-ai/dsh-tool-library

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Model-facing librarian tools over the Library knowledge base, shaped after the DeepWiki MCP face: `library_ask` is the primary interaction (question in, grounded answer with inline `[source]` citations out; declines when nothing relevant is stored), `library_structure` lists notebooks, resources, leading headings, and a leading excerpt per resource for navigation — served from the ingest-time index, `library_read` returns one resource's converted Markdown (bounded by `maxReadChars`), and `library_ingest` files literal text or a readable file into a notebook through the same entry point the UI upload uses. Notebook parameters accept an id or an exact title (Simplified/Traditional-insensitive); an unknown reference errors with the current notebook listing so the model can self-correct.

`library_ask` implements the issue-#23 delegation workflow: when a `librarian` subagent provider is mounted and the caller is an agent, the question is delegated to a fresh librarian child that navigates the notebook with `library_structure`/`library_read` (this tool and `library_ingest` are tool-filtered out of the child, so it can never recurse) and answers with inline `[name]` citations; cited sources are recovered against the notebook's resource names. Without a subagent runtime — or for a non-agent caller — the librarian service's direct retrieval-and-answer route answers instead. Both routes append the exchange to the notebook's durable ask log as an `agent` entry, so questions asked from the chat surface in the Library page's thread.

## Model Experience

Registers the four `library_*` tools; their schemas enter the tool assembly of every agent in the composition. A delegated `library_ask` costs one subagent run (its own agent loop over structure/read); the direct fallback costs one auxiliary model call on the librarian's configured route.

#### KV Cache effect

Tool schemas are stable across steps, so the prompt prefix stays cacheable; only tool results vary.

## Known Limitations and Deferred Work

- No URL ingestion; fetch web content with `web_fetch` first, then `library_ingest` the text.
- `library_read` truncates flat at `maxReadChars` with no offset paging.
- Tools are registered globally (every agent sees them); per-preset restriction is left to composition.
- Delegated answers recover citations by exact `[name]` match; a child that paraphrases a resource name loses that citation (the answer text keeps it inline).
