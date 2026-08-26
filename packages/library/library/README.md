# @deepseek-ai/dsh-library

Librarian service (`ctx.librarian`): a durable multi-notebook knowledge base in the NotebookLM shape. Each notebook stores uploaded documents twice — the original file for human preview and download, and a converted Markdown twin for agent reading and retrieval — under `<DSH_HOME>/library/v1/<notebookId>/{original,markdown}`. Records live in the `library` storage domain (`notebooks` and `resources` tables).

Conversion runs on a provider seam: `registerConverter()` accepts `{ id, priority, accepts, convert }` providers, tried in descending priority. Two ship built in — a markitdown Python subprocess (`python -m markitdown`, Office/PDF/EPUB/HTML, toggleable via `markitdown: false`) and a dependency-free text fallback (Markdown/plain text/CSV/JSON/HTML). A conversion failure keeps the original file and lands the resource on `error` with the failure summary.

`search()` retrieves heading-scoped chunks by TF-IDF-weighted keyword score (CJK bigrams plus Latin words, so mixed Chinese/English notes match without a segmenter). `ask()` grounds an answer: it retrieves the best chunks, sends them with the question to the configured model (`provider`/`model` config first, then the agent default selection), and returns the answer with per-excerpt provenance; with no matching excerpt it declines (`grounded: false`) without a model call. `structure()` lists notebooks, resources, and leading Markdown headings; `ingest()` is the shared programmatic entry point (UI upload, model tools, future pipeline destinations) and settles conversion before resolving.

## Model Experience

This package registers no tools, prompt sections, or session events itself; models reach it through `@deepseek-ai/dsh-tool-library` (the `library_*` tools) and the `librarian` subagent.

#### KV Cache effect

None: nothing here enters the model request, so no prompt-prefix bytes change across steps.

## Known Limitations and Deferred Work

- Retrieval is query-time keyword scoring over full file reads; no persistent index, embeddings, or FTS5 backend yet (the seam anticipates one).
- `ingest()` settles conversion inline, so a large PDF holds its caller for the conversion's duration; background conversion with a `converting` status the UI polls is deferred.
- The markitdown converter needs a Python with the `markitdown` package on the host; availability is probed only by running it, and the text fallback owns the failure path.
- llm-wiki-style concept pages, backlinks, and scheduled-search import are out of scope here (spec open questions tracked in drill-docs).
- Notebooks are per-install, not per-user; the file root anticipates an ownership rebase via the `dshHome` config.
