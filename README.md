# MotiFrame

MotiFrame is a local motion authoring tool for external coding agents and people. An agent researches references, plans a motion score and writes editable React/HTML elements or scoped timeline changes. Studio provides the shared preview, timeline, comparison and export surface. The application requires no model account or API key.

This is a **local release candidate**, verified on macOS ARM64. The standalone RC requires macOS 26 or newer. Other operating systems have CI configuration but no completed native installation evidence in this release. See [release acceptance](docs/release-acceptance.md) for the exact verification boundary.

## Start

For the standalone macOS RC, extract the archive into a writable folder and open `launch.command`. Keep its terminal open and use the loopback URL it prints. In that folder, `./launch.sh --verify` checks packaged file hashes.

For a source checkout, install the pinned Bun and FFmpeg prerequisites described in [installation](docs/install.md), then:

```sh
bun install --frozen-lockfile
bun run setup
bun run build
bun run motiframe -- init projects/demo --json
bun run motiframe -- studio projects/demo/project.json --port 0
```

Export the portable agent kit and load its `motiframe/SKILL.md` in your coding agent:

```sh
bun run motiframe -- kit --output artifacts/agent-kit --json
bun run motiframe -- inspect projects/demo/project.json --json
bun run motiframe -- context projects/demo/project.json --json
```

The agent proposes a versioned ChangeSet, validates it with `patch --dry-run`, applies it, and captures/renders the result. The runner owns project writes while Studio is open, so agent edits join the same revision and undo history. Read the [agent quickstart](docs/agent-quickstart.md) and [agent setup](docs/agent-setup.md) before authoring a change.

## What is editable

React and HTML elements share one stage and a 240000-tick-per-second clock. Stable instance IDs, manifest targets and slots connect source to timeline channels. Three.js is the default for authored 3D; its scene updates use absolute frame ticks. Tone.js is the default for synthesized sound; offline synthesis produces a normal project audio asset. An explicit silent brief takes priority over that default.

Studio includes selection, timeline seeking, keyframes, score controls, source revisions, asset relinking, undo/redo, preview and rendering. Browser-only editing stores its document locally; custom source, accurate media playback and final export require the local runner. Portable bundles carry editable source and admitted assets with hashes.

The interface follows the DEXA Design System: a Paper shell, orange actions, an inset dark preview with cyan data, and locally served Space Grotesk/JetBrains Mono fonts. These interface colors do not recolor authored media.

## Render and review

```sh
bun run motiframe -- validate projects/demo/project.json --json
bun run motiframe -- capture projects/demo/project.json --tick 0 --output artifacts/frame.png --json
bun run motiframe -- render projects/demo/project.json --output artifacts/video.mp4 --wait --json
bun run motiframe -- pack projects/demo/project.json --output artifacts/demo.motionproj --json
bun run motiframe -- review projects/demo/project.json --json
```

Choose a new output path for each export; existing output files are preserved. A successful receipt proves the operation completed. Continuous playback, listening, reading and separate speed/tension/rhythm judgments remain unverified until actually observed.

## Documentation

- [Install and package](docs/install.md)
- [External-agent setup](docs/agent-setup.md) and [first authoring workflow](docs/agent-quickstart.md)
- [React, HTML, Three.js and source revision SDK](docs/authoring-sdk.md)
- [Portable motion and review instructions](skills/motiframe/SKILL.md)
- [Measured preview performance](docs/performance.md)
- [DEXA interface design](docs/dexa-design.md)
- [Recovery and troubleshooting](docs/troubleshooting.md)
- [Release acceptance and pending work](docs/release-acceptance.md)
- [Third-party notices](docs/third-party-notices.md)

Development checks are `bun run check`, `bun run test`, and `bun run build`. The smoke scripts in the installation guide produce machine-readable reports; a configured workflow or an earlier passing run is not evidence that a later change passed.
