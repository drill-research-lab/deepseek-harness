# @deepseek-ai/dsh-writing-compile

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

LaTeX compilation for the writing capability (`ctx.latexCompile`). The service writes a report's source into a per-report artifact directory, runs a configurable engine through the `ctx.subprocess` seam, parses the compiler `.log` into ordered diagnostics, and reports the produced PDF path. It is the compile step of the write → compile → fix loop.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `command` | `pdflatex -interaction=nonstopmode -halt-on-error` | Engine command run in the artifact directory; `main.tex` is appended. |
| `timeoutMs` | `120000` | Foreground compiler timeout. |
| `artifactRoot` | `<tmp>/dsh-writing` (pin to an absolute path in production) | Root holding one `main.tex`/`main.log`/`main.pdf` set per report. |

Report ids become directory segments, so only a safe segment (alphanumeric, no separators or traversal) is accepted.

## Model Experience

None. The compile service is an engine seam — it never enters model input. The writing tool derives diagnostics into a model-facing result, and does the model-visible work.

#### KV Cache effect

None; the compile service assembles no provider requests.

## Delivery interface

A compiled report is programmatically deliverable: `latexCompile.pdfPath(reportId)` resolves the artifact `main.pdf` for a report (or `undefined` when it has not compiled), and `ctx.reports.get(reportId)` yields its source. Together these are the export seam a knowledge-base/Library integration consumes; the writing tools live on top of the same seam.

## Known Limitations and Deferred Work

- The parser targets the classic pdflatex log vocabulary; a different engine (e.g. xelatex/latexmk) may need parser extension.
- Each compile writes to the artifact directory; multi-pass engines like latexmk need a separate command string that runs more than once.
- LSP diagnostics (texlab) are a separate seam; this package does not query a language server.
