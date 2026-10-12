# MotiFrame authoring SDK

MotiFrame keeps editable motion in a shared project document. React/HTML source defines an element's content and structure; its manifest exposes stable targets and slots to the timeline. Both forms use the same stage, clock and renderer.

## Start a project and select a definition

```sh
motiframe init demo --json
motiframe inspect demo/project.json --json
```

The initial project contains builtin definitions. In the editor, select an existing instance, enable **Adjust** and open **Source**, and load a React or HTML example or paste your own definition source. The first custom registration revises the selected definition with the same `id` and a higher `revision`; it does not create an unrelated instance automatically. Choose instances that share a definition/revision. **Use current selection** captures the document revision and target instances while preserving your draft.

The draft is a `DefinitionSource` object:

```ts
{
  manifest: ElementManifest,
  files: Record<string, string>, // relative source paths and UTF-8 contents
  entry?: string               // defaults to index.tsx, index.ts, index.jsx or index.js
}
```

The supported vendor imports are `@motiframe/authoring`, `@motiframe/authoring/three`, `@motiframe/authoring/tone`, `three`, `react` and `react/jsx-runtime`. Relative imports resolve within `files`. Node builtins, arbitrary packages and external imports are rejected. Source is built without execution in the editor or runner process and executes in the isolated stage.

## React

The source entry exports one definition as default. A component receives `{props, frame}`; use absolute frame/tick data when source-local presentation needs time.

```tsx
import { defineReactElement, MotionTarget } from "@motiframe/authoring";

const manifest = {
  id: "title",
  revision: 2,
  kind: "react",
  moduleHash: "",
  propsSchema: { type: "object", properties: { text: { type: "string" } } },
  targets: [
    { key: "root", channels: ["x", "y", "opacity"], coordinateSpace: "local" },
    { key: "heading", channels: ["x", "y", "opacity"], coordinateSpace: "local" }
  ],
  slots: [],
  assets: []
};

export default defineReactElement(manifest, ({ props }) => (
  <MotionTarget targetKey="heading">
    <div style={{ color: "white", fontSize: 64, whiteSpace: "pre" }}>
      {String(props.text ?? "한글 모션")}
    </div>
  </MotionTarget>
));
```

Use the current manifest's stable `id`, next revision and required target keys. `moduleHash` is assigned to the built artifact. In TypeScript source, preserve literal manifest types with `satisfies`/`as const` or the installed SDK's manifest type where available; the builder checks the external source manifest against the runtime schema.

For nested instances, declare a manifest slot and place `<MotionSlot slotId="children" />`. Registered child instances are inserted through the host slot registry. Do not invent inspector control for arbitrary internal DOM.

## HTML

HTML remains a template with explicit bindings. The source entry can be TypeScript even though the element's markup is HTML.

```ts
import { defineHtmlElement } from "@motiframe/authoring";

export default defineHtmlElement(manifest, {
  html: '<div data-motion-target="heading"><span class="label"></span></div>',
  css: '.label { color: white; font-size: 64px; white-space: pre; }',
  bindings: [{ selector: ".label", prop: "text", kind: "text" }]
});
```

Use the same manifest shape with `kind: "html"`. `data-motion-target` names a declared target, and `data-motion-slot` names a declared slot. Bindings explicitly name a selector and prop; kinds are `text`, `attribute` and `style`. Attribute/style bindings specify `name` and, where needed, `unit`. Style names use CSS syntax such as `background-color`, because the stage calls `style.setProperty`. Prefer text bindings for user-visible strings.

## Ownership, time and revisions

For 3D authoring, use the bundled Three.js and `ThreeCanvas`. Supply `{frame,width,height,create}`; the stable factory returns `{scene,camera,update(frame,context),dispose?}`. The canvas renders synchronously during the stage's React commit and waits for GPU completion. Assign every animated value from the absolute tick; do not call `requestAnimationFrame`, `setAnimationLoop`, or accumulate elapsed deltas. Prepare assets before creating the scene. Asynchronous updates are rejected.

Each factory invocation owns its scene geometry, materials and textures. The canvas releases them and its WebGL renderer on unmount. Use `dispose` for additional resources outside that graph, and avoid sharing owned GPU resources across instances. Pixel ratio is fixed at one so capture and export use document dimensions. The [Three.js phrase example](../skills/motiframe/examples/three-phrase.source.json) separates object release, camera lag, caption reading and a final actor-owned handoff.

The stage owns a target's declared transform/opacity/motion channels. Element source owns internal content. Do not drive the same target/channel from both a timeline keyframe and source animation. A project uses 240000 ticks/second; 24/30/60 fps sample that clock. Deterministic output must survive seeking in any order. Wall-clock timers, network state and effect-driven animation are outside the authoring contract.

`definitionId` and `definitionRevision` identify an instance's source. Timeline commands use instance ID, target key and channel. Keep keys stable across refactoring. When a key changes, supply `targetRemap`, such as `{"old-heading":"heading"}`; unresolved orphan targets block registration. Preserve locked/manual channels and existing instances' props.

The editor's **Validate and apply revision** sends `{source, oldRef, instanceIds, baseRevision, targetRemap}` to the runner. Build, target reconciliation and an isolated stage capture precede the document transaction. A stale revision needs comparison with current state before rebasing. Source artifacts are stored as `definitions/<sha256>.js` and the corresponding `.source.json`, so portable bundles can retain editable source.

While Studio is open, external edits to a referenced `definitions/<sha256>.source.json` produce an **External source candidates** in the source panel. The watcher only reads the current project's referenced sources, debounces saves, builds through the same import allowlist, and checks reconciliation. If the edited manifest still uses the published revision, the candidate advances it by one without changing the source file. Select affected instances, load the candidate, resolve any target mapping, then explicitly apply. Broken source keeps the last published stage and document intact. Candidates become stale when the document revision changes; source changes never automatically overwrite project JSON.

The local CLI exposes the same source boundary:

```sh
motiframe element build demo/project.json --file definition-source.json --json
motiframe validate demo/project.json --json
motiframe capture demo/project.json --tick 0 --output frame.png --json
motiframe render demo/project.json --output video.mp4 --wait --json
```

The build command accepts a source directly or `{source,oldRef:{definitionId,revision},instanceIds,baseRevision,targetRemap?}`. It builds, captures the candidate and applies the revision on success; capture/render checks verify actual target registration and output. Continuous playback, reading and audio judgments remain separate from technical checks. The portable [MotiFrame skill](../skills/motiframe/SKILL.md) covers phrase design, scoped reference use and review.
