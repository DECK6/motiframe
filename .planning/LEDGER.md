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
- Ruling: the user's full P0–P4 authorization now permits independent implementation domains. Applied dispatching-parallel-agents: media, editing commands, and knowledge use disjoint file ownership and fixed interfaces; the primary agent integrates and verifies them. No task is complete merely because its library landed.

## T01
- Start: configuration, hand-authored mixed fixture and behavioral tests first.

- T01 GREEN: actual mixed DOM and PNG pixels passed; CLI receipt records both authoring kinds. Node24/Chromium pinned locally. Build and type/lint checks pass.
- T02 RED: time/curve/compiler five expected assertions failed. GREEN: 10 unit tests passed; complete suite before T03 tests was 11/11.

- T03 RED: unsupported time, missing words definition, superseded render hang; additional nested-slot regression caught DUPLICATE_TARGET. GREEN: 15 tests, check pass. Author content uses ShadowRoot for CSS isolation inside one ownerDocument (not per-element iframe).

## Final local integration — 2026-10-12
- P0–P4 implementation integrated. Fresh check/build and 53 suites / 188 tests pass on darwin-arm64. P0/P4 retain native-platform, performance-measurement and perception gates; do not infer all-OS release completion.
- User amendments: external agent owns AI/research; browser defaults to review/preview/timeline/export with optional Adjust. All browser UI English. DEXA Design System is mandatory, using the canonical cross-project Paper/orange and Ink/cyan theme with offline fonts.
- CTI text-selection regression fixed with pointer capture and prevented browser selection; tested actual dragging across labels/outside ruler/release.
- Independent review found curve-scope escape and stale-writer race; original repros now reject/outcome single writer. Added isolated project history, source artifact guards, Host/method checks and preserved output/sidecar collisions. PNG sequences stay local with explicit typed download guidance.
- Distribution: portable source + SDK tarball + skill kit and native macOS ARM64 RC; final extracted artifact check follows. No public push/publication or signing account use.
- Retrieval gate: canonical DEXA path came from an explicit source pointer; direct reads and deterministic token mapping need no competing-action decision. Private AKM run storage follows fixed devlog workflow and is not sent externally.
