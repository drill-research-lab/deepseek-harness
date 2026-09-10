# @deepseek-ai/dsh-library

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Librarian service (`ctx.librarian`): a durable multi-notebook knowledge base in the NotebookLM shape. Each notebook stores uploaded documents twice — the original file for human preview and download, and a converted Markdown twin for agent reading and retrieval — under `<DSH_HOME>/library/v1/<notebookId>/{original,markdown}`. Records live in the `library` storage domain (`notebooks` and `resources` tables).

Conversion runs on a provider seam: `registerConverter()` accepts `{ id, priority, accepts, convert }` providers, tried in descending priority. Two ship built in — a markitdown Python subprocess (`python -m markitdown`, Office/PDF/EPUB/HTML, toggleable via `markitdown: false`) and a dependency-free text fallback (Markdown/plain text/CSV/JSON/HTML). A conversion failure keeps the original file and lands the resource on `error` with the failure summary.

Every content mutation regenerates the notebook's **ingest-time index** (`index.json` beside the documents): per resource its outline, a leading plain-text summary, and its heading-scoped chunks with precomputed term counts. `structure()` and `search()` are served from that index — one file read plus scoring, no document reads or re-tokenizing at query time — and a missing, unreadable, or stale index (a notebook predating the feature, a hand-edited file) self-heals by rebuilding on first read. `search()` scores chunks by TF-IDF-weighted keywords (CJK bigrams plus Latin words, so mixed Chinese/English notes match without a segmenter). `ask()` grounds an answer: it retrieves the best chunks, sends them with the question to the configured model (`provider`/`model` config first, then the agent default selection), and returns the answer with per-excerpt provenance; a question no keyword matches (an overview ask) falls back to each document's leading content, and only a notebook with no readable content declines (`grounded: false`) without a model call. `ingest()` is the shared programmatic entry point (UI upload, model tools, future pipeline destinations) and settles conversion — index included — before resolving.

Each settled ask is appended to the notebook's durable **ask log** (`ask-log.json`, capped at its newest 200 entries): `askLog()` reads the history oldest-first, and `recordAsk()` lets tool callers land subagent-answered exchanges in the same history, tagged by origin (`ui`/`agent`), so the Library page's thread shows what agents asked too.

## Model Experience

This package registers no tools, prompt sections, or session events itself; models reach it through `@deepseek-ai/dsh-tool-library` (the `library_*` tools) and the `librarian` subagent.

#### KV Cache effect

None: nothing here enters the model request, so no prompt-prefix bytes change across steps.

## Known Limitations and Deferred Work

- Retrieval is keyword scoring over the ingest-time index; no embeddings or FTS5 backend yet (the seam anticipates one), and the index rebuilds whole-notebook per mutation rather than incrementally.
- `ingest()` settles conversion inline, so a large PDF holds its caller for the conversion's duration; background conversion with a `converting` status the UI polls is deferred.
- The markitdown converter needs a Python with the `markitdown` package on the host; availability is probed only by running it, and the text fallback owns the failure path.
- llm-wiki-style concept pages, backlinks, and scheduled-search import are out of scope here (spec open questions tracked in drill-docs).
- Notebooks are per-install, not per-user; the file root anticipates an ownership rebase via the `dshHome` config.
