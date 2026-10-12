# Motion rhythm — portable adaptation 0.1.0

Adapted from the `motion-rhythm` skill and its `default-direction`, `speed-tension-rhythm`, `motion-score` and `review` references, captured 2026-10-12. Exact source-file hashes are recorded in `../manifest.json`. These are choreography heuristics, not universal measurements or guarantees about an audience.

## Three independent axes

| Axis | Design question | Useful controls |
|---|---|---|
| Speed | What changes in screen space, by how much, over what interval? | Distance/time, rotation/deformation rate, peak, braking, settling |
| Tension | What is unresolved, what makes it perceptible, and when does it release? | Compression, imbalance, withheld information, delay, partial release |
| Rhythm | How do events form groups, accents, rests and variations? | Onset intervals, duration, strength, recurrence, syncopation |

A slow opener can stay tense. A fast sequence can remain monotonous. More cuts, higher BPM or higher render FPS do not by themselves repair either problem. Intentional unresolved endings need no forced release.

Use expressive choreography by default for motion-led work. Start with contrasts between short clusters and longer reading/expectation intervals, a recognizable primary action, delayed responses and a handoff. Calm, informational, accessible or otherwise explicit briefs override that starting intensity. Do not ask for permission to use the already requested intensity, and do not force impacts or constant motion into a quiet brief.

MotiFrame's recipe compiler provides editable scaffolds. A recipe name or successful compilation is not evidence of expressive choreography. The external agent must author the primary action and its layer timing in source or scoped channels, preserving approved ranges and manual ownership. Three.js is the default tool for authored 3D scenes; Tone.js is the default tool for synthesized sound tied to the event score. Both follow project ticks. Never start an independent visual or audio clock inside an element.

## A compact score

Record each phrase as:

`range | primary actor: initial → changed → final state | onset / accent / rest | speed concentration and brake | unresolved expectation → release or intentional hold | reading / transform / texture windows | next handoff`

Track the primary actor before adding supporting captions or effects. Give internal type, the actor, camera and background distinct time roles when that supports the action. Assign effects a cause and a start/peak/end. A smear may reveal force; a permanent decorative shake does not establish tension.

Keep four timings independent: **new information onset**, **the main action's travel/deformation duration**, **its clear reading interval**, and **the response/settle interval**. Do not let the next word wait automatically for the previous word's rebound. Mark each long hold as reading, unresolved expectation, or closure. For tension, name the visible cue, unresolved condition, release event or intentional unresolved end; a delay alone is insufficient.

A useful phrase may use short–short–long, call–response or repeat–repeat–exception. These are choices, not templates for every scene. Preserve an anchor while varying scale, interval, direction or meaning. The next scene should inherit a position, direction, shape or meaning when continuity is intended.

Name the handoff owner: which object, stroke, direction or meaning from the previous event creates the next one. The current automatic resolver preserves wrapper position only. Direction, shape, meaning and projected 3D continuity need explicit source choreography and actual boundary samples; never claim those were automatically solved.

For typography, word onset, travel duration and clear reading duration are different. Immediate replacement may be the appropriate sentence grammar; do not make every word finish preparation, impact and rebound before the next word appears. Preserve the requested text and imagery instead of filling remaining time with invented diagrams or explanatory cards.

## Hangul and type roles

Reading, transformation and texture windows have different jobs. Rotation, crop, stretching and temporary illegibility can be valid display type. Required information still needs a meaningful reading window. Do not flatten expressive type into static readable cards everywhere.

Treat grapheme segmentation, complete Hangul syllables and visual jamo decomposition as separate decisions. Compare the source string, composed syllables and intended transformed state. Broken combining sequences or replacement glyphs are implementation errors. Latin examples do not validate Hangul reading time or font axes.

`T036` has no representative observed scene in this snapshot. Use its conditions and language structure guidance without inventing a Hangul reference image. `MR-READING` provides related reading-window concepts with their own limits.

## Three correction scenarios

- **느린 긴장:** preserve slow timing if intended. Clarify the unresolved state, a perceivable cue and its release or intentional suspension. Do not globally speed up the project.
- **빠른데 단조:** vary groups, accent strength, rests and recurrence. Repair a phrase first; extra cuts or uniform acceleration are not sufficient evidence of improvement.
- **한글 타입:** preserve requested expressive rotations/decomposition while checking syllable integrity, semantic order and the required reading interval. Do not treat every transform window as a readability failure.

Reference images support static composition or sampled-state differences within their stated windows. They do not prove intervening trajectories, easing, full-work rhythm or audio synchronization. Source statements remain attributed; interpretations remain hypotheses until reviewed against the actual brief and playback.

Before extending a sequence, render the selected phrase interval and its neighboring handoff at the actual output FPS. Record three rows: speed, tension and rhythm, each with `intent → observed interval/state → keep/revise/unverified`. Reject a default expressive phrase dominated by equal-size/equal-spacing pops, simultaneous layer starts/stops, or `entrance → completed alignment → idle wait`. Repair the primary action before adding texture or more cuts. Inspect a fast cluster and a longer reading/closing interval together; a strong opening does not validate the full duration.
