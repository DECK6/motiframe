# MotiFrame agent quickstart

MotiFrame provides a local editor, React/HTML SDK and CLI. Your external coding agent supplies reasoning; the project needs no model provider or API key.

Work with the external agent first: it researches references through the knowledge/context CLI, plans motion and proposes changes. Use the browser to inspect preview and timing, compare changes and render. Direct editing is a secondary control; reference research is not an app workflow.

From a source checkout, install dependencies and the pinned runtime, then build:

```sh
bun install
bun run setup
bun run build
bun run motiframe -- init examples/quickstart --json
bun run motiframe -- kit --output artifacts/agent-kit --json
```

In a packaged installation, invoke its `motiframe` launcher directly. Load the exported `motiframe/SKILL.md` in your agent using its project-local skill discovery mechanism. The kit includes self-contained references, source examples, the project schema and version metadata. Do not copy private vaults or install a global skill to make it work.

Start by inspecting the current document and validating a scoped change. Use JSON files for larger requests:

```sh
motiframe inspect examples/quickstart/project.json --json
motiframe context examples/quickstart/project.json --json
motiframe validate examples/quickstart/project.json --json
motiframe patch examples/quickstart/project.json --file changeset.json --dry-run --json
motiframe patch examples/quickstart/project.json --file changeset.json --json
```

Every change carries its inspected document revision. A conflict requires fresh context. While Studio is open, its runner owns writes; CLI changes use the same transaction service.

The shipped source examples revise a fresh project's title and shape definitions. The build command checks and applies the new revision on success:

```sh
motiframe element build examples/quickstart/project.json --file artifacts/agent-kit/motiframe/examples/react-title.source.json --json
motiframe element build examples/quickstart/project.json --file artifacts/agent-kit/motiframe/examples/html-shape.source.json --json
motiframe capture examples/quickstart/project.json --tick 360000 --output artifacts/frame.png --json
motiframe render examples/quickstart/project.json --output artifacts/video.mp4 --wait --json
motiframe review examples/quickstart/project.json --json
```

The examples retain instance overrides and root motion channels. To revise existing work, inspect its stable definition ID, current revision, targets and selected instances first. See [authoring SDK](authoring-sdk.md) for the source envelope and reconciliation rules.

The SDK is also a local installable package. The source build writes `dist/sdk/motiframe-authoring-0.1.0.tgz`; the kit carries the same tarball. For standalone source editing in a separate JavaScript project:

```sh
bun add ./motiframe-authoring-0.1.0.tgz react three
bun add --dev typescript @types/react @types/three
```

It exports `defineReactElement`, `defineHtmlElement`, `MotionTarget`, `MotionSlot`, `ThreeCanvas`, `manifestSchema` and public TypeScript types. React and Three.js are peer dependencies; Zod provides schema types and runtime validation. The `@motiframe/authoring/three` subpath exposes the tick-driven Three.js canvas. The `@motiframe/authoring/tone` subpath exposes Tone score validation and offline synthesis without eagerly starting an audio context. Rebuild the local package with `node scripts/package-sdk.mjs`; no publication occurs.

Three.js and Tone.js are the default 3D and synthesized sound tools. The kit's `three-phrase.source.json` and `tone-score.json` show separate preparation, release, camera lag, caption reading and audio event timing. Use `motiframe synthesize project.json --file tone-score.json --json` to add synthesized audio through the writer, and render a selected interval with `--start 0 --end 1440000` (ticks).

Use capture and completed render receipts for technical evidence. Keep actual playback, audio listening, reading and the separate speed/tension/rhythm observations marked unverified until observed. [Agent setup](agent-setup.md) describes the evidence and host compatibility boundaries.
