# SDD ledger — plan: docs/plan/implementation-plan.md

- Authorization: user requested implementation through P4 with repeated verification and fixes (2026-10-12).
- Ruling: this new repository is an isolated workspace; no second worktree is needed because there is no pre-existing repository or user branch.
- Engineering review: single stage, stable target addresses, one frame clock, document/definition ownership, revision-checked atomic commands, external AI only. These bind all phases.
- Pre-flight T01→T02: static document evolves to pure Motion IR; preserve schemaVersion=1, add versioned fields rather than split authority.
- Pre-flight T02→T03: evaluator emits target channels; stage owns wrappers and awaits commit tokens. Sources do not own wrapper motion styles.
- Pre-flight T03→T04: capture only after matching receipt; decode media by PTS, not native video seek assumptions.
- Pre-flight T04→T05: browser process lifecycle and cancellation bound rendering jobs; shell argv arrays, sandbox kept enabled.
- Pre-flight T06→T19: UI and CLI consume the same document service/transactions, no separate JSON overwrite path.
- Ruling: use native phase/task state and ledger instead of duplicate skill wrapper scripts; existing task headings and five phase plans remain canonical execution briefs.
- Ruling: global Node is v22; install the pinned Node 24 runtime locally to the repository, leaving global tools unchanged.
- Ruling: graphify is not required to discover an absent codebase; reconsider once architectural retrieval is needed.

## T01
- Start: configuration, hand-authored mixed fixture and behavioral tests first.

- T01 GREEN: actual mixed DOM and PNG pixels passed; CLI receipt records both authoring kinds. Node24/Chromium pinned locally. Build and type/lint checks pass.
- T02 RED: time/curve/compiler five expected assertions failed. GREEN: 10 unit tests passed; complete suite before T03 tests was 11/11.

- T03 RED: unsupported time, missing words definition, superseded render hang; additional nested-slot regression caught DUPLICATE_TARGET. GREEN: 15 tests, check pass. Author content uses ShadowRoot for CSS isolation inside one ownerDocument (not per-element iframe).
