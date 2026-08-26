# @deepseek-ai/dsh-tool-library

Model-facing librarian tools over the Library knowledge base, shaped after the DeepWiki MCP face: `library_ask` is the primary interaction (question in, grounded answer with inline `[source]` citations out; declines when nothing relevant is stored), `library_structure` lists notebooks, resources, and leading headings for navigation, `library_read` returns one resource's converted Markdown (bounded by `maxReadChars`), and `library_ingest` files literal text or a readable file into a notebook through the same entry point the UI upload uses. Notebook parameters accept an id or an exact title; an unknown reference errors with the current notebook listing so the model can self-correct.

## Model Experience

Registers the four `library_*` tools; their schemas enter the tool assembly of every agent in the composition. `library_ask` answers cost one auxiliary model call on the librarian's configured route.

#### KV Cache effect

Tool schemas are stable across steps, so the prompt prefix stays cacheable; only tool results vary.

## Known Limitations and Deferred Work

- No URL ingestion; fetch web content with `web_fetch` first, then `library_ingest` the text.
- `library_read` truncates flat at `maxReadChars` with no offset paging.
- Tools are registered globally (every agent sees them); per-preset restriction is left to composition.
