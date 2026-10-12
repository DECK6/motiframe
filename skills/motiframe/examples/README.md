# Executable SDK examples

Both source envelopes are complete, use only the public SDK, and revise the definitions created by `motiframe init`. They preserve existing props and root target channels.

```sh
motiframe init demo --json
motiframe element build demo/project.json --file motiframe/examples/react-title.source.json --json
motiframe element build demo/project.json --file motiframe/examples/html-shape.source.json --json
motiframe validate demo/project.json --json
motiframe capture demo/project.json --tick 360000 --output demo/frame.png --json
```

Run from the exported kit directory. In a source checkout, replace `motiframe/examples/` with `skills/motiframe/examples/`.

`element build` builds, reconciles targets, captures the candidate in the isolated stage, and commits the new definition revision through the writer. It changes the document on success. These fixed revision-2 examples are intended for a fresh project; inspect the current definition before reusing them in an existing one.

The React example adds a stable `heading` target while retaining the root motion channels. The HTML example binds its color and dimensions to existing instance props. Existing manual motion and instance overrides remain in the project.

## Absolute-time Three.js phrase

`three-phrase.source.json` is an alternative revision-2 title source for a fresh project. Apply it instead of the React title example. It gives the primary 3D actor, camera and caption different clocks, while the existing outer timeline channels remain untouched.

| Seconds | Main action | Camera / caption | Intended role |
|---|---|---|---|
| 0–0.28 | Compression and small backward travel | Still | Visible preparation |
| 0.28–0.48 | Concentrated release | Camera begins later at 0.54 | Primary action |
| 0.48–0.90 | Rotation settles | Caption arrives 0.62–0.84; camera settles 0.90 | Delayed response |
| 0.90–1.55 | Hold | Caption remains legible | Reading |
| 1.55–2.60 | Two smaller turns, then a larger turn with a longer gap | Camera follows the third turn at 2.48 | Cluster, variation, accent |
| 2.60–3.80 | Settled state | Reading continues | Release and reading |
| 3.80–4.40 | The same actor expands across its canvas | Caption clears, then returns over the expanded form | Actor-owned handoff |
| 4.40–6.00 | Final state | Caption reads | Closure |

Every pose is assigned from `frame.tick / 240000`; seeking backward does not integrate old state. The factory is stable, uses the shared stage's `ThreeCanvas`, and owns its disposable scene resources. This is an original SDK choreography example, not a measured reference or an aesthetic approval. Compare its actual selected interval, including the long reading sections, before adapting it to a brief.

## Tone.js score for the same events

`tone-score.json` places notes at the visual landings and a quieter response. Synthesis is offline at 48 kHz; importing the result adds a hashed audio asset and timeline clip. Event alignment is implementation evidence. Listening and perceived musical fit still require observation.

```sh
motiframe synthesize demo/project.json --file motiframe/examples/tone-score.json --json
motiframe render demo/project.json --start 0 --end 1440000 --output demo/phrase.mp4 --wait --json
```

Render start/end values are ticks (240000 per second), so this selects the six-second phrase. The source's existing parent channels and text changes remain active. Record speed, tension and rhythm observations separately after viewing the actual interval.
