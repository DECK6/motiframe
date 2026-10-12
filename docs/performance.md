# Preview performance

The recorded local run measures `PreviewEngine.frame`: Chromium layout, video decode, PNG capture and the frame cache. It does not measure editor input latency or a sustained playback frame rate.

Evidence: `artifacts/performance/darwin-arm64-1791789259827/report.json`. The report has `ok: true` and zero failed frames in both passes. This run follows the macOS in-process GPU compatibility fix; GPU work shares the browser host while the author renderer keeps its sandbox.

| Environment | Recorded value |
| --- | --- |
| Hardware | Apple M4 Pro, 24 GiB memory |
| OS / architecture | Darwin 25.5.0 / ARM64 |
| Runtime | Node 24.21.0; Node and Chromium hashes recorded in the report |
| Composition | 30 seconds, 1280 × 720, 30 fps |
| Load | 30 graphics layers, two simultaneous videos |
| Samples | 60 seeks per pass |
| Power state | Unknown |

| Pass | p50 | p95 | Failed frames |
| --- | ---: | ---: | ---: |
| First sequence, including initial preparation | 65.920 ms | 84.333 ms | 0 |
| Same ticks on the same engine, cache hits allowed | 0.601 ms | 0.925 ms | 0 |

The first individual seek took 2236.481 ms. The p95 does not describe that startup delay. The warm result is predominantly a cache result and must not be presented as the time to render an uncached frame. The measured warm p95 is below the 200 ms seek target for this fixture and machine only.

The orchestrator's observed peak RSS was 330481664 bytes (about 315.2 MiB). Chromium and FFmpeg child-process memory was not sampled. UI response p95, sustained playback misses, other machines and operating systems remain unmeasured.

## Reproduce

After the pinned runtime and FFmpeg setup:

```sh
bun scripts/performance-smoke.ts
```

Set `MOTIFRAME_POWER_MODE` when the power state is known. Each run writes a fresh report under `artifacts/performance/`, including all seek durations, runtime hashes, command exits and measurement limits. Compare the same fixture, dimensions, tick sequence and cache conditions; retain cold and warm results separately.

Frame identity includes document content/revision, definition revisions and hashes, assets/fonts, runtime, dimensions, seed and tick. This protects correctness after edits; it does not promise identical raster bytes across operating systems. Final export uses document resolution.
