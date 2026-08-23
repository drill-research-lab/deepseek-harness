# writing/ — agent-authored LaTeX reports (Overleaf-style)

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

The writing family gives the harness an Overleaf-like report workflow: durable report projects, immutable version snapshots, a template library, LaTeX compilation with error feedback, and a writer agent that a general agent can invoke as a subagent to produce a compiled PDF end-to-end.

| Package | Role | ctx key |
|---|---|---|
| `writing/` | Report project registry: durable reports, version snapshots, templates | `reports` |

Each child reference owns its contract and detailed behavior.
