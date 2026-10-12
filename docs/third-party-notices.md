# Third-party components

This local RC uses the components below. Versions come from the project locks and installed package metadata. Preserve the upstream copyright and license files supplied with each dependency; this overview does not replace those texts.

| Component | Pinned version | Declared package license |
| --- | --- | --- |
| React / React DOM | 19.3.0 | MIT |
| Three.js | 0.186.1 | MIT |
| Tone.js | 15.1.22 | MIT |
| Zod | 4.6.6 | MIT |
| esbuild | 0.28.2 | MIT |
| Vite | 8.3.4 | MIT |
| Puppeteer Core | 25.13.0 | Apache-2.0 |
| Puppeteer Browsers | 3.2.4 | Apache-2.0 |

The complete JavaScript dependency graph is pinned in `bun.lock`. Source installations obtain dependency license files with their packages. The native RC retains the selected dependency tree and its accompanying notices.

## Runtime and native libraries

`runtime-lock.json` pins Node 24.21.0, Chrome for Testing 155.0.8059.39, Bun 1.4.2 and FFmpeg 8.1.2. Node and Chromium carry their upstream license material alongside the packaged binaries. Bun is a source-development prerequisite, not the standalone application's execution engine.

FFmpeg licensing depends on the exact build and enabled libraries. The standalone packager records the FFmpeg configuration and inventories the relocated non-system native dependencies in `.runtime/ffmpeg/licenses/components.json`; individual component notices are stored in that directory tree. H.264 output uses the packaged `libx264` encoder. Inspect that actual build inventory when evaluating redistribution obligations; a local RC archive is not a completed public-distribution compliance review.

## Fonts and example media

Noto Sans KR is accompanied by its SIL Open Font License text in `assets/fonts/OFL.txt` and the relevant example/fixture folders. The DEXA interface uses locally served Space Grotesk and JetBrains Mono WOFF2 files. Their SIL Open Font License texts, obtained from the official Google Fonts repository, are included as `apps/editor/src/fonts/SpaceGrotesk-OFL.txt` and `apps/editor/src/fonts/JetBrainsMono-OFL.txt`. Font loading does not require an external font CDN.

The showcase video and audio fixtures are generated for technical testing. The imported motion-knowledge snapshot includes reference metadata and hashes, not the referenced image binaries. An identified or hash-matched reference does not establish viewing, licensing permission or a right to redistribute its source media.

The portable motion-rhythm adaptation records source snapshot hashes in `skills/motiframe/manifest.json`. It contains self-contained guidance and has no dependency on a personal vault. DEXA visual identity describes this application's interface; no third-party product affiliation is claimed.
