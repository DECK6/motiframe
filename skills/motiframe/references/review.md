# Review contract — 0.1.0

Review the final rendered artifact at the same revision, tick, scale and audio mode used for comparison. Keep the existing approved form while correcting the named timing or implementation issue.

| Report axis | Evidence | Limits |
|---|---|---|
| `technical` | Validation, deterministic seeks, target ownership, bounds, fonts, export receipt | Passing tests does not establish aesthetic quality |
| `implementation` | Rendered state changes, event timing, reading/transform/texture windows, handoffs | Source code intent alone is insufficient |
| `perception` | Actual continuous playback and, where applicable, listening | Stills, contact sheets and audio-stream presence cannot verify this axis |

Each report item contains `range`, `observation`, `status` (`keep`, `revise`, `unverified`) and `source`. Keep speed, tension, rhythm, handoff and reading observations distinct. Do not combine them into an automatic taste score. If playback or listening is unavailable, record the relevant uncertainty and finish the checks that are possible.

For the changed phrase, compare `intention → actual interval/observation → keep/revise/unverified`. Verify an adjacent handoff and one longer reading or closing interval as well as the fast cluster. A transformation brief needs an initial, intermediate and resulting state; a cut between final states does not demonstrate the requested transformation.

Useful failure questions:

- Did the supposedly hidden result already appear with the same clarity before the reveal?
- Do accents differ in screen-space effect, or are all titles using the same motion with different directions?
- Does a hold support reading, expectation or closure? Decorative float does not cure an unexplained wait.
- Does the next event inherit the actor/anchor, or does every scene restart from an unrelated title entrance?
- Did a type edit preserve required reading while retaining intentional expressive motion?

Use `motiframe capture project.json --tick 0 --output frame.png --json` for selected-state checks and `motiframe render project.json --output video.mp4 --wait --json` for the deliverable. Inspect the shared report with `motiframe review project.json --json`. A receipt confirms an operation; it does not claim that an observer watched or heard the result.

After a partial revision, recheck the same phrase and its neighbors. Continue only while a concrete requested defect remains. Store reference IDs and feedback as project-local candidates. Updating the original knowledge corpus, publishing or contacting anyone requires separate task scope.
