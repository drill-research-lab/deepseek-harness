# dsh-path-containment

English | [简体中文](README.zh.md) | [繁體中文](README.zh-tw.md)

Shared path-containment helpers for DeepSeek Harness.

## Containment

`isPathUnder(path, root)` reports whether a canonical target is a root or lies beneath it. A lexical fast path handles ordinary canonical spellings; when the two spellings differ, the function walks the target's existing ancestors and compares filesystem identity with the root, so Windows long-name/8.3 aliases and casing are recognized without weakening containment to a textual approximation.

The `caseSensitive` argument preserves or folds case for the lexical comparison and defaults to the host filesystem convention (`true` except on Windows).

This package is intentionally small and harness-dep-free so product packages can enforce the same path containment without depending on one another.

## Known Limitations and Deferred Work

- **Callers own canonicalization** — `isPathUnder()` assumes its `path` argument is canonical (its existing ancestors already resolved through `fs.realpath`). A caller comparing an un-canonicalized spelling with a `..` segment or a symlinked ancestor must canonicalize first; the lexical fast path is only safe for canonical inputs.
- **Containment is not a security boundary** — the check is a trust check in trusted code over a model- or user-chosen path; kernel-grade isolation remains the sandbox layer's job.
