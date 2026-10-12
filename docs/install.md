# Install and run MotiFrame

MotiFrame runs a local editor and a separate Chromium stage. Project files and exports stay in the folder you choose. No cloud account or API key is required.

## macOS ARM64 standalone release candidate

Extract `motiframe-<version>-darwin-arm64-rc-<hash>.tar.gz` into a writable folder and open `launch.command`. The launcher creates `projects/untitled/project.json` on first use and starts the local editor. Keep its terminal open while editing. Use the loopback address printed in the terminal.

This RC requires macOS 26.0 or newer on ARM64, as recorded by its bundled native libraries. It includes pinned Node and Chromium, FFmpeg/ffprobe with relocated native libraries, application dependencies, fonts, skills, and built application files. It needs no global Node, Bun, or FFmpeg and performs no installation or runtime download. Native libraries are ad-hoc signed for this local RC; it is not a notarized public macOS installer. Linux and Windows standalone binaries remain pending native packaging and verification. The default launcher selects an available loopback port.

From a terminal inside the extracted folder:

```sh
./launch.sh --verify
./launch.sh help
./launch.sh doctor
./launch.sh init projects/example
./launch.sh studio projects/example/project.json
```

The launcher forwards CLI arguments to bundled Node and supplies only bundled FFmpeg/Node plus macOS system directories in `PATH`. `--verify` checks the standalone manifest's file hashes and relative dependency links. Native license texts and build configuration are under `.runtime/ffmpeg/licenses/`; Node and Chromium license texts accompany their binaries. Preserve this folder structure when moving the application.

## Source release prerequisites

Install the versions in `runtime-lock.json`: Bun 1.4.2 and FFmpeg/ffprobe 8.1.2. `ffmpeg` and `ffprobe` must be available in the terminal's `PATH`. Use a normal user account with Chromium sandbox support. The installer downloads pinned Node 24.21.0 and Chrome for Testing into this project's `.runtime` directory; it does not replace your system Node or install a global command.

The release archive contains source, built editor/stage/runner files, Bun and runtime locks, the external-agent skill, bundled ontology evidence, and synthetic example media with an OFL font. Runtime binaries and dependencies are downloaded for the current OS during installation.

## From a source release

1. Extract `motiframe-<version>-<hash>.tar.gz` into a writable folder.
2. Open a terminal in the extracted `motiframe-<version>` folder.
3. Run:

```sh
bun install.mjs
bun run motiframe -- help
```

`install.mjs` checks every file against `release-manifest.json`, runs `bun install --frozen-lockfile`, then `bun run setup`. The adjacent `.sha256` file checks archive integrity; neither hash file is a publisher signature.

## From source

```sh
bun install --frozen-lockfile
bun run setup
bun run build
bun run check
bun run test
```

Run the editor against a project file:

```sh
bun run motiframe -- studio tests/fixtures/mixed-phrase/project.json
```

Use the loopback address printed in the terminal. Keep the terminal open while editing. Use a copy of the synthetic fixture for your own work. For SDK and external-agent usage, read [Agent setup](agent-setup.md) and [Agent quickstart](agent-quickstart.md).

## Verify this machine

```sh
bun scripts/core-smoke.ts
bun scripts/performance-smoke.ts
bun scripts/showcase-smoke.ts
```

These scripts use the pinned local Node runtime. Core smoke generates CFR video and a WAV pulse, captures mixed React/HTML/video frames, exports 180 frames, checks the exact pulse sample, and decodes the output. It writes OS, architecture, runtime hashes, command exits, and artifact hashes under `artifacts/core-smoke/`.

Performance smoke measures actual `PreviewEngine.frame` operations on a 30-second, 1280×720 composition with 30 graphics layers and two simultaneous videos. Its first pass includes preparation; the second repeats the same ticks and permits cache hits. Reports contain p50/p95, failed-frame counts, machine/runtime metadata, and observed orchestrator memory/CPU use under `artifacts/performance/`. Child-process memory and editor input latency are explicitly unmeasured. Set `MOTIFRAME_POWER_MODE` to a descriptive value when you know the machine's power state; otherwise reports say `unknown`.

Showcase smoke renders all three projects in `examples/showcase/` at full length, nine short aspect/FPS combinations, and a PNG sequence. It verifies output frame counts, H.264/AAC streams, 48 kHz audio length and signal, PNG dimensions, content hashes, and complete decoding. Evidence and sampled frames are written under `artifacts/showcase-smoke/`. The examples include their synthetic media, compiled custom elements, source definitions, fonts, and font license.

The workflow in `.github/workflows/core-smoke.yml` configures Linux, Intel macOS, and Windows runs. Configuration is not a test result: an OS is verified only after its report passes. The [GitHub runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) identifies the selected labels; [setup-ffmpeg](https://github.com/federicocarboni/setup-ffmpeg) documents its platform/version availability. A missing pinned FFmpeg build fails setup instead of silently changing versions.

## Create a release

```sh
bun run build
bun scripts/package-release.mjs
bun scripts/package-release.mjs --standalone
```

The packager creates a tar.gz archive, archive hash, and inspectable staging folder under `artifacts/releases/`. The source archive admits a fixed set of application, source, dependency-lock, skill, documentation, and public fixture paths. It refuses symlinks and private absolute paths, excludes local runtime/dependency/cache/output folders and planning context, and records each admitted file's SHA-256. Re-running preserves prior staging folders.

`--standalone` additionally creates the current macOS ARM64 RC. It verifies pinned runtime hashes, copies only the selected Node/Chromium distributions and current dependency tree, relocates every non-system FFmpeg dylib, ad-hoc signs local copies, checks their load commands, and records file modes, hashes, and internal symlink targets. Packaging does not change installed Homebrew libraries. Runtime bundling on another OS fails explicitly until that platform's packaging path is implemented and tested.

## Recovery and limits

Save and reopen the same project JSON to continue editing. Portable `.motionproj` bundles include content hashes and validate paths on import. In Assets, choose **Relink original file** to restore a missing or changed file. Relinking keeps its registered ID and SHA-256; a different file is rejected before any file change. Changed files are retained under `assets/relink-backups/` when their original bytes are restored. Retain your originals. Render cancellation stops the active stage/FFmpeg operation and a later render starts from a fresh job snapshot.

The initial media lane supports H.264/AAC, PNG/JPEG/WebP, WAV, and MP3. Audio playback rates other than 1 return an explicit unsupported-rate error. Large decoded-frame caches or audio mixes return a budget error rather than allocating without a limit. Browser sandbox failures remain failures; disabling the Chromium sandbox is not an installation step.
