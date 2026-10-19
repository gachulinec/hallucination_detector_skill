# Changelog

## 1.0.1 — 2026-10-19

Fixes from the code review of 1.0.0; the method and its verdict rules are unchanged.

- A result that reports an error next to a valid payload is checked as usual; the error becomes a warning instead of failing the task.
- Fetching a page again for the same claim returns its stored passages: no second download and no duplicate evidence items.
- Evidence IDs must belong to a claim of the task; an ID of another claim (most likely a typo) is sent back for a retry.
- Printed commands work with paths that contain `"`, `$`, a backtick or a backslash.
- `hd fetch`, `hd search` and `hd summary` say when a run path is mistyped.
- The tests are type-checked.

## 1.0.0 — 2026-10-19

First release: standard (web) and faithfulness (source document) modes, thorough and quick profiles, and the `hd` CLI with evidence passages, quote and number checks, and rule-based verdicts. Tested with Claude Code.
