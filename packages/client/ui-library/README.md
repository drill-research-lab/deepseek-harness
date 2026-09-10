# @deepseek-ai/dsh-client-ui-library

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Library surface, browser half: a `sidebar.section` entry listing notebooks below the session browser (rail state renders one book icon), and a `shell.overlay` entry with the full-page Library view, laid out like NotebookLM's notebook page — a sources column with the add-source intake (file upload, paste text, drag-and-drop), a persistent grounded ask thread as the main area, and a collapsible preview panel with separate **Markdown** and **original (PDF/raw)** modes. Markdown renders through the shared `MarkdownText` primitive; notebook rename/create/delete and source delete use `Modal` dialogs; answer citations are clickable pills that open the cited document in the preview panel.

The shown notebook and the open preview resource live in the shared page state, which doubles as the page's address: the plugin mirrors it into the `#library/<notebookId>[/resource/<resourceId>]` URL hash (applied at boot and on `hashchange`, rewritten with `history.replaceState`), so documents and the ask thread are linkable from outside the page. The ask thread is durable — it renders the notebook's host-side ask log, including exchanges agents asked from the chat (tagged), and survives reloads and notebook switches. Every durable fact travels through `ctx.remote.library` (JSON) or the `/library` data plane (upload `POST`, preview/download `GET` riding the same-origin identity cookie).

## Model Experience

None: this is a browser-only surface; nothing here reaches a model request. Agents use the `library_*` tools from `@deepseek-ai/dsh-tool-library` against the same librarian service.

#### KV Cache effect

None: no prompt-prefix bytes change.

## Known Limitations and Deferred Work

- Resource lists and the ask thread refetch on a shared revision counter or after own mutations; no host push (`$on`) subscription yet, so another client's uploads appear on the next refetch.
- Citations open the cited document but do not scroll to the cited heading.
- The ask composer has no model picker; asks ride the librarian's configured route.
- No URL ingestion from the add-source modal; paste the content or upload a saved file.
