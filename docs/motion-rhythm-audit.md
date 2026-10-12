# Motion Rhythm fidelity audit

Reviewed 2026-10-12 against the source skill's default direction, time score, three independent axes and review rules. The portable adaptation records source hashes in [the skill manifest](../skills/motiframe/manifest.json); private source paths and media are not dependencies.

The implementation supports an external agent authoring and checking Motion Rhythm choreography. Its recipe compiler is a scaffold, and passing its checks does not certify expressive rhythm. The changes below make the authored workflow concrete while retaining that distinction.

| Source principle | Implemented behavior and evidence | Remaining boundary |
|---|---|---|
| Expressive by default; an explicit quiet or informational brief takes precedence | [Portable guidance](../skills/motiframe/references/motion-rhythm.md) now states the default, brief override, rejection of uniform pops and preservation of approved form/ranges. | There is no automatic taste approval or universal timing threshold. |
| Speed, tension and rhythm are different decisions | Score records primary actors, onsets/accents/responses/rests, tension cues/releases and role windows. Quality reports and variant notes keep the three perception axes separate. | Speed intent is expressed through authored curves/source and prose; channel derivatives are not a measurement of projected 3D speed. |
| Design the primary state change before decoration | The [Three.js phrase](../skills/motiframe/examples/three-phrase.source.json) compresses/releases its actor, separates camera lag and caption onset, varies two small turns and a larger accent, then expands the same actor into a handoff. | This original example demonstrates authoring capability. It is not a measured reference or an approved aesthetic benchmark. |
| Separate information onset, travel, reading and response | Skill guidance names all four clocks. The Three phrase regression verifies that the caption remains hidden during release, becomes partially visible during response and fully visible in the reading interval. | The agent must allocate real text reading time. A caption opacity assertion does not establish comprehension. |
| Long intervals have a role; tension has a cause | Score supports reading, transform, texture, tension and closure windows; tension can retain an explicitly unresolved ending. Tests cover these constraints. | Lint sees declared metadata and channels, not what the viewer understands. The example's compression cue requires playback judgment. |
| Layer timing and variation replace repeated helper effects | ThreeCanvas accepts absolute-tick choreography with a stable scene factory. The example has different actor, camera and type timing and different event gaps. | The six built-in recipes mostly produce fixed wrapper x/opacity/clip values with linear/hold interpolation. Treat them as starting material; author the main action in source or scoped channels. |
| Preserve an anchor through a handoff | Handoff commands preserve wrapper position with explicit ownership checks. The Three example retains its actor through the expansion. | Direction, shape, meaning and transformed-parent projection are not automatically resolved. Unsupported automatic preservation returns an error. Review boundary samples and author these transitions explicitly. |
| Expressive typography retains necessary reading | Grapheme/word/line selection and reading/transform/texture roles are separate. Source text is preserved. Manual channels and target identities survive source revision changes. | Jamo art direction, real glyph legibility and reading duration still require rendered evidence. Same-actor reading windows currently reject non-rest events; use distinct actors for supporting events that continue under a stable reading anchor. |
| Three.js and Tone.js follow the same event clock | Default tools are documented. ThreeCanvas renders in the shared React stage and completes GPU work before the frame receipt. Tone synthesizes an offline, sample-aligned score into a project asset. The example audio score uses visual landing/response ticks. | No independent animation/audio loop belongs inside an element. Three scene updates are synchronous; assets must be prepared before creation. Audio existence and note timestamps are not listening evidence. |
| Seek order must not change a frame | The real WebGL test renders ticks 0, 240000, 0 and compares exact PNG bytes; moving ticks change expected pixels. The multi-layer example also repeats a prior canvas state exactly. Graph geometry/material disposal is observed once on unmount. | This is one installed Chromium/Three.js environment. Cross-GPU raster byte equality and other native platforms remain unverified. |
| Validate implementation and perception separately | Review output distinguishes technical, implementation and perception evidence. A/B variants retain the original until the guarded transaction is applied. Perception starts unverified and requires explicit observation notes. | Continuous playback quality and audio listening were not assessed by these automated checks. |
| Reference conditions and limitations travel with evidence | CLI knowledge/context returns no more than three candidates with stable IDs, scope, application conditions, counterexamples and limits. Agent-first guidance keeps research outside the browser workflow. | The 31 legacy images are hash-verified references, not bundled or newly viewed assets. Catalog entries and metadata do not establish motion or audio observation. |

## Actionable authoring loop

1. Inspect current selection, document revision, locks and manual channels. Keep approved ranges and inherited form.
2. Write a small score for the primary state change, separate onset/travel/reading/response, name every long hold and the handoff owner. Record the tension cue and release or intentional unresolved ending.
3. Use the SDK for the primary choreography. Keep frame assignments absolute. Use recipes only where their actual generated motion fits the phrase.
4. Capture the cue, intermediate transformation, accent, release and handoff boundary. Render the selected interval at final FPS, including one fast cluster and one longer reading/closing interval.
5. Compare speed, tension and rhythm separately as intent → actual interval/observation → keep/revise/unverified. Reject repeated equal pops, simultaneous layer starts/stops and unexplained settled waiting when they dominate an expressive brief.
6. Correct observable implementation defects and repeat the affected interval plus neighbors. Finish the requested complete render; a phrase prototype is not the final deliverable.

For the six-second example, `motiframe render project.json --start 0 --end 1440000 --output phrase.mp4 --wait --json` renders an actual selected interval. The tick range, synthesis score and source example share the same 240000-tick clock.

## Fresh verification

The following command passed on 2026-10-12: **9 suites, 30 tests**.

```sh
bun run test tests/integration/three-stage.test.ts tests/integration/sdk-package.test.ts tests/unit/score-edits.test.ts tests/unit/score-lint.test.ts tests/unit/phrase-recipes.test.ts tests/unit/type-selection.test.ts tests/unit/variants.test.ts tests/unit/tone-score.test.ts tests/integration/tone-synthesis.test.ts
```

SDK tests install the actual tarball into a separate consumer, check strict NodeNext types for root/three/tone exports, verify safe Node imports, and run the shipped React/HTML sources through the CLI and real pixel capture. The HTML example's initial CSS-name error was caught by an independent color assertion and corrected before the passing run.

These checks establish the stated implementation behavior. Full-sequence expressive quality, continuous playback rhythm, audio perception and second-platform native behavior remain unverified.
