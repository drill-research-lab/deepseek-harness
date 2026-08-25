# Agent Note: Writing view compiles only on edit, previews the latest version otherwise

Status: implemented

## Scope

The Writing view (`packages/client/ui-writing`) decides when to run the LaTeX compiler. Previously it recompiled (and snapshotted a version) on every report open and on every preview-window open — a wasteful recompile that also produced an extra version each time. This note records the new trigger policy on the `feat/writing-plugin` branch.

## Decision

- Opening a report **never** recompiles. The view loads the source, then:
  - if the report already has a version snapshot, it shows the latest compiled PDF (`/writing/<reportId>/pdf`) and does **not** compile;
  - only when the report has **no** version snapshot does it compile, producing the first version + PDF.
- Opening the preview window **never** recompiles; selection already resolved the compiled output.
- Compiling still runs on an actual LaTeX edit (1s debounced autosave → `updateSource` + compile), and on the manual **編譯** button and a version restore. Each of those snapshots a version on success, so edit auto-compiles keep creating versions.

## Why

The compiled PDF at `/writing/<reportId>/pdf` is always the live last output of the report's compile service; version snapshots are the durable record of successful compiles. Recompiling on open/preview did not change that PDF but did create a redundant version and an unnecessary pdflatex run, so the open/preview paths now reuse the existing compiled output instead.

## Implementation

A client-only change in `WritingView.tsx`: `select(reportId)` branches on `versions(reportId)` length to either synthesise a `CompileResultView` with the served `pdfUrl` or call `compileSelected()`; `openPreview()` lost its compile-on-missing-pdf branch. No server, compile-service, or versioning change.

## Deferred

- Bidirectional source⇄PDF sync (rejected: it would require replacing the native iframe PDF viewer with a pdf.js-rendered one).
