# @deepseek-ai/dsh-library-api

Browser-facing library gateway (`ctx.library`): the `library` Remote namespace (`ctx.remote.library.*` in the client) projecting the librarian service into a plain JSON wire contract — notebook CRUD, resource listing and deletion, pasted-text ingest, Markdown preview payloads, and grounded `ask` — plus the `/library` binary data plane the JSON-only `/api` gateway cannot carry: `POST /library/upload?notebook=&name=&kind=` admits one raw request body (byte-capped by `maxUploadBytes`), `GET /library/<resourceId>/raw` streams the stored original inline (the PDF/text preview `iframe` source), and `GET /library/<resourceId>/download` streams it as an attachment. Every data-plane request re-authenticates through `ctx.auth` when an auth service is mounted; the route registers only when a `webServer` is composed.

## Model Experience

This package registers no tools, prompt sections, or session events; it is browser-facing only. Models reach the same librarian capability through `@deepseek-ai/dsh-tool-library`.

#### KV Cache effect

None: nothing here enters the model request, so no prompt-prefix bytes change across steps.

## Known Limitations and Deferred Work

- Uploads buffer fully in memory before ingest (mirroring the `/api` bridge); streaming to a staging file is deferred.
- No `Range` support on served files; Chromium's PDF viewer works without partial fetch.
- The data plane trusts the same-origin cookie only; it does not re-check the `/api` browser-trust fence, matching the writing PDF route it mirrors.
- Wire views carry no pagination; a notebook with very many resources returns one full listing.
