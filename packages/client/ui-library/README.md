# @deepseek-ai/dsh-client-ui-library

Library surface, browser half: a `sidebar.section` entry listing notebooks below the session browser (rail state renders one book icon), and a `shell.overlay` entry with the full-page Library view — notebook column, source list with file upload and paste-text intake, Markdown/PDF preview, and a grounded ask panel with citations. The two entries share one closure-scoped page-state observable; every durable fact travels through `ctx.remote.library` (JSON) or the `/library` data plane (upload `POST`, preview/download `GET` riding the same-origin identity cookie).

## Model Experience

None: this is a browser-only surface; nothing here reaches a model request. Agents use the `library_*` tools from `@deepseek-ai/dsh-tool-library` against the same librarian service.

#### KV Cache effect

None: no prompt-prefix bytes change.

## Known Limitations and Deferred Work

- Markdown preview renders as plain preformatted text; the shared rich Markdown renderer is a follow-up.
- Rename/create/delete confirmations use `window.prompt`/`window.confirm`; dialog-kit replacements are deferred.
- Resource lists refetch on a shared revision counter; no host push (`$on`) subscription yet.
- No drag-and-drop upload; intake is the file picker and paste-text dialog.
