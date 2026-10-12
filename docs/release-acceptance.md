# Local RC acceptance record

Status: **local release candidate; P4 is not fully complete**. This record separates executed technical checks from pending platform, agent-host and human perception checks.

The final integrated run on 2026-10-12 passed `check`, build and all 53 test files / 188 tests (exit 0; suite duration 47.44 seconds). It includes the DEXA frontend, writer reclamation, agent curve scope and final output-preservation/download fixes. This is local evidence, not an additional operating-system run.

The native Studio preview loaded its local fonts and showed the DEXA Paper shell (`rgb(245, 241, 230)`) without horizontal page overflow at a viewport width of 1843 pixels. Other viewport widths and a complete accessibility audit are not established by that observation. See [DEXA design](dexa-design.md).

## Recorded output evidence

The successful report `artifacts/showcase-smoke/1791786956529/report.json` records 13 renders, 1767 frames and 120 checks on Darwin 25.5.0 / ARM64 with Node 24.21.0. Runtime and output SHA-256 values are in the report.

| Output | Duration / frames |
| --- | --- |
| Hangul typography | 15 seconds / 450 frames |
| Slow tension | 10 seconds / 300 frames |
| Mixed media and graphics | 30 seconds / 900 frames |
| Aspect/FPS matrix | Nine short 16:9, 9:16 and 1:1 outputs at 24, 30 and 60 fps |
| PNG sequence | Three frames |

Checks cover frame counts, PNG dimensions, 48 kHz audio sample length and finite signal, H.264/AAC metadata, output hashes and full audio/video decoding. Passing these checks establishes playable technical artifacts, not audience response or successful choreography.

The companion `artifacts/showcase-smoke/1791786956529/portable-1791787057158/report.json` records three bundle round trips, reopened custom elements/fonts/media and nine-frame contact sheets. Hangul and slow-tension sampled comparisons were exact. The mixed sequential-export versus direct-capture sample differed at 12 glyph-edge pixels with maximum channel delta 3. The portable direct capture matches its original direct capture; this is not a claim of byte-identical sequential rendering or cross-OS raster output.

The example projects, custom source and synthetic media live under `examples/showcase/`. Local evidence under `artifacts/` is retained separately from the application package; report paths identify reproducible local records rather than promising those large artifacts are shipped in every archive.

## Platform and performance boundary

The standalone native RC targets macOS ARM64 and requires macOS 26 or newer. Its Node, Chromium and relocated FFmpeg libraries are packaged locally. It is ad-hoc signed for local use and is not a notarized public installer. Windows, Linux and Intel macOS smoke workflows are configured; their native installation/output runs remain unverified.

The [performance record](performance.md) measured first-pass p95 85.944 ms and repeated-tick warm p95 0.717 ms on an Apple M4 Pro at 720p. The first seek was 1788.547 ms. UI input latency and child-process memory remain unmeasured.

## Agent and motion review

The portable skill preserves three independent axes: speed, tension and rhythm. Its reviewed instructions preserve a slow brief while identifying an unresolved cue; address fast monotony through grouping, accents and rests; and let a no-audio brief override synthesized-sound defaults. Type guidance separates new-word onset, travel, reading and settle time while preserving Hangul syllable integrity and intentional transformation.

These are instruction and implementation checks. A fresh external-agent-host transcript, end-to-end discovery on a second host, continuous playback and audio listening are separate evidence. Static captures and audio-stream presence cannot validate perception. Keep human judgments of speed, tension, rhythm, reading and handoffs marked `unverified` until observed at normal playback speed.

## Remaining acceptance work

- Native clean-install, rendering and reopen evidence on each additional OS/architecture.
- Human normal-speed playback with and without sound, including the full three works and neighboring handoffs.
- Actual external-agent host round trip and second-host portable-kit discovery evidence.
- Editor input-latency and total process-tree resource measurements.
- Public signing/notarization, external distribution and a complete redistribution audit before any public release.

Configured CI, generated archives and local technical checks do not close these pending gates.
