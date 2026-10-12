# Authoring contract — 0.1.0

The project owns persistent timing, properties, IDs, assets and references. Element source owns internal structure; declared targets expose the channels that the editor may control. React and HTML share one stage and evaluator.

## Start from current state

```sh
motiframe inspect project.json --json
motiframe context project.json --file context-request.json --json
motiframe knowledge query --file knowledge-query.json --json
```

A context request supplies `scope` and optional `conceptIds`/`text`. Use the bundled schema for scope shape. A knowledge query is `{"text":"느린 긴장","limit":3}` or `{"conceptIds":["T036","MR-READING"],"limit":2}`. An empty image list is valid evidence; do not fill it with nearby concepts' imagery.

## React and HTML

Use the bundled examples and installed SDK exports as the executable starting point.

- React: `defineReactElement(manifest, Component)`. The component receives `{props, frame}`. Declare a target with `<MotionTarget targetKey="word-main">…</MotionTarget>` and a child slot with `<MotionSlot slotId="children" />`.
- HTML: `defineHtmlElement(manifest, {html, css, bindings})`. Use `data-motion-target="word-main"` and `data-motion-slot="children"`. A binding names `selector`, `prop`, `kind` (`text`, `attribute` or `style`) and the applicable `name`/`unit`. HTML stays HTML.
- The manifest declares `id`, `revision`, `kind`, `moduleHash`, `propsSchema`, `targets`, `slots` and `assets`. A target has a stable `key`, allowed `channels` and `coordinateSpace:"local"`. Inspect current schema instead of inventing channels.
- Target IDs identify semantic roles across edits. Avoid array-position IDs when insertion or reordering would attach old motion to a new word. Removed or renamed targets require explicit reconciliation before a new revision becomes active.
- Stage wrappers own declared motion channels. Do not animate the same target/channel again inside source CSS or component state. Use local children for internal presentation.
- Render from `FrameContext` and props. The clock is 240000 ticks/second; 24/30/60 fps are sampling choices. Avoid wall-clock timers, fetches, mutable global state and effect-driven animation. Resolve assets through the host before rendering. Seek order must not change the frame.

A definition source is `{manifest, files: Record<relativePath,string>}`. The element build command builds, validates targets, captures the candidate in the isolated stage, and applies the new revision through the document writer. For explicit scoping, wrap the source as `{source,oldRef:{definitionId,revision},instanceIds,baseRevision,targetRemap?}`. It changes the document on success. A module revision, document schema version and runtime version are distinct.

```sh
motiframe element build project.json --file definition-source.json --json
```

## Transactions

A ChangeSet is `{protocolVersion:1, requestId, baseRevision, transaction, explanation, evidenceRefs}`. Construct the transaction from the shipped schema and latest context. Use selection-bounded commands; preserve manual ownership and locked tracks, instances and channels. Save reference bindings with stable IDs and the applied interval; IDs are provenance, not proof of implementation quality.

```sh
motiframe validate project.json --json
motiframe patch project.json --file changeset.json --dry-run --json
motiframe patch project.json --file changeset.json --json
motiframe capture project.json --tick 0 --output frame.png --json
motiframe render project.json --output video.mp4 --wait --json
motiframe review project.json --json
```

Send JSON through a file or stdin; do not interpolate a whole project into a shell string. Each automation command emits one `CommandResponse` JSON object (`protocolVersion`, `requestId`, `ok`, `value` or `error`) on stdout; diagnostics use stderr. Rendering succeeds only when the final job receipt says so.

Exit codes: 0 success, 2 input/schema, 3 revision/lock/ownership conflict, 4 runtime/IO, 130 canceled. On a conflict, inspect fresh context and recalculate the authorized change. Do not clear locks, force a revision or fall back to another writer. The runner owns the writer while the editor is connected; offline operations use the same service and file lock.
