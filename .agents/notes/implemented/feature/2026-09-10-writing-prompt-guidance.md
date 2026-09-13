# Agent Note: Writing tools steer the main agent through system-prompt guidance

Status: implemented

## Problem

The [writing capability](2026-08-24-writing-capability.md) mounts its `report_*` tools for every agent, but nothing told the main agent when to use them. Only the `writer` subagent carried a persona naming the tools. A request to "create a blank LaTeX file" therefore produced a bare `.tex` at the workspace root through the generic `write` tool, bypassing the report registry, the per-report git repository, the timestamp-named source directory, and the compile/version loop.

Tool descriptions are consulted after the model has already chosen a tool class, so they did not redirect an obvious file-creation request toward the report tools.

## Decision

`tool-writing` registers a `tool:writing` system-prompt section (order 118) instructing the model to route LaTeX document and report requests through `report_create` and the other `report_*` tools instead of the generic `write`/`edit` tools, and naming the timestamp-named source directory `writing/<yyyymmddhhmmss>/main.tex`. The plugin injects `systemPrompt` to register it.

The section text is a fixed module constant, like the other `tool:*` sections, because it is model guidance rather than a deployment-varying tunable.

## Verification

- A `tool-writing` test asserts the assembled system prompt contains a `tool:writing` section naming `report_create` and the timestamp-named directory.
- The existing tool tests still pass; the guidance is not model-visible transcript content, so no keyless snapshot changes.

## Alternatives considered

| Rejected | Reason |
|---|---|
| Rely on the tool descriptions alone | The agent chose `write` before consulting them; a description cannot redirect a request that already matched a familiar tool |
| Put the guidance only in the writer persona | That persona reaches the `writer` subagent, not the main agent the user talks to |
| Make `write` refuse `.tex` paths | Over-broad — LaTeX documents legitimately include non-report `.tex`, `.bib`, and `.sty` files — and it hides the capability instead of teaching it |
| Add a `report_create`-only tool and drop `write` for reports | The main agent still needs the general file tools, and the steering is a preference, not a hard restriction |
| Make the section text a `Config` field | It is fixed model guidance, not a deployment choice; the other `tool:*` sections are constants too |

## Consequences

- LaTeX authoring requests now land in the report registry with a timestamp-named repository and the compile/version loop, instead of a loose workspace file.
- The guidance applies to every agent in a composition that mounts `tool-writing`; a deployment wanting different wording changes the plugin or shadows the `tool:writing` section.
- The request body, session log, and token accounting are unchanged; the section is ordinary system-prompt content.
