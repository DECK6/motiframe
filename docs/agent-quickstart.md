# MotiFrame agent quickstart

MotiFrame is an external-agent authoring toolkit with a shared visual editor. AI models and credentials belong to your coding agent, not this program.

```sh
bun install
bun run setup
bun run motiframe -- capture tests/fixtures/mixed-static/project.json --tick 0 --output artifacts/frame.png --json
```

The first slice supports React and HTML rectangle definitions, in one stage document. Project tracks define bottom-to-top order. Content props belong to the element; position and opacity belong to document channels. The fixture has a red React rectangle at (50,50), overlapped by a blue HTML rectangle at (75,75).

The SDK exposes `defineReactElement(manifest, Component)` and `defineHtmlElement(manifest, {html, css, bindings})`. Later tasks add arbitrary source registration and animation; unsupported definitions currently return an error. Setup installs a pinned local Node and Chromium without changing system tools.
