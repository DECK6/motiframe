---
description: "Implement P0 of the unified motion SDK, external-agent toolchain, and visual editor with explicit interfaces and acceptance tests."
akmLayer: context
akmRole: operating-context
akmType: context
trustLevel: draft
sourceType: synthesis
date created: 2026-10-12
date modified: 2026-10-12
tags: [motion-graphics, implementation-plan]
---

# P0 — 통합 SDK·모션 코어·렌더 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax. 실행 상태는 .planning의 STATE.json을 따른다.

**Goal:** 외부 코딩 에이전트가 React·HTML을 작성하고 하나의 시계로 6초 영상을 출력한다.

**Architecture:** 공통 ProjectDocument·Motion IR·단일 evaluator를 React/HTML SDK, 로컬 CLI, 시각 편집기가 공유한다. AI 추론은 외부 코딩 에이전트가 담당한다.

**Tech Stack:** TypeScript·React·HTML/CSS/SVG·bun workspace·Node 24 계열·Chromium·FFmpeg·Vitest/Playwright. 최초 정확 버전은 T01에서 고정한다.

**Spec:** [[30-context/projects/motion-score-studio/plan]] · [[30-context/projects/motion-score-studio/implementation-plan]] · [[30-context/projects/motion-score-studio/implementation/contracts]].

## Global Constraints

전체 계획의 Global Constraints와 계약 C1–C8을 그대로 적용한다. 코드 루트는 `/Volumes/data/Dev/motiframe` 예정 경로다. 아래 Create/Modify는 이 계획을 순서대로 구현할 때의 상태이며 현재 파일이 있다는 뜻이 아니다. 파일 목록 밖의 workspace 설정 변경이 필요하면 해당 package 선언과 테스트를 같은 작업의 변경 범위에 기록한다.

## Review Focus

전체 계획의 다섯 실패 입력을 해당 담당 작업에서 검증한다. 이 단계의 완료 판단은 아래 명령·산출물로 하며 계획에 적힌 기대값은 실행 증거가 아니다. 테스트 snippet의 변수는 Setup fixture가 준비하고 production 함수를 호출해 얻은 결과다. Result의 value/error 접근은 `expectOk` 또는 ok assertion으로 먼저 타입을 좁힌다.

## T01 — React+HTML 한 프레임의 수직 구현

**Depends on:** 없음.

**Files:**
- Create: `package.json`, `bun.lock`, `tsconfig.json`, `runtime-lock.json`, `vite.config.ts`, `packages/document/src/schema.ts`, `packages/authoring/src/react.tsx`, `packages/authoring/src/html.ts`, `packages/stage/src/main.ts`, `apps/runner/src/cli.ts`, `docs/agent-quickstart.md`, `vitest.config.ts`, `tests/helpers/result.ts`, `packages/document/package.json`, `packages/authoring/package.json`, `packages/stage/package.json`, `apps/runner/package.json`.
- Test/fixture: `tests/fixtures/mixed-static/project.json`, `tests/integration/mixed-static.test.ts`.

**Interfaces:** C2–C4의 최소 ProjectDocument, defineReactElement, defineHtmlElement, StagePort.load/renderFrame을 만든다. CLI `motiframe capture <project> --tick 0 --output <png>`를 노출한다. T02 이전에는 정적 채널만 허용한다.

- [ ] **Step 1 — 검사 작성:** `mixed_static_shares_stage_and_respects_stack`.

Setup: 320×180 fixture: React 빨간 100×100 사각형(50,50), 그 위 HTML 파란 100×100 사각형(75,75). target ID를 달고 같은 문서인지 확인한다. pixelAt은 테스트 PNG 디코더로 읽으며 제작 코드의 색 결과를 참조하지 않는다.

```ts
expect(reactRoot.ownerDocument).toBe(htmlRoot.ownerDocument);
expect(pixelAt(frame, 100, 100)).toEqual([0, 0, 255, 255]);
```

- [ ] **Step 2 — RED 확인:** `bun run test:integration -- tests/integration/mixed-static.test.ts`. 기대 실패: 두 root 미구현 또는 겹침 픽셀이 파랑이 아니어서 실패. 환경 부팅 실패는 먼저 교정한다.
- [ ] **Step 3 — 위 인터페이스 구현:** bun workspace·Vite stage·Node 24 runner·고정 Chromium을 이 기능과 함께 만든다. 버전/hash를 runtime-lock에 기록하고 루트 check/build/test 스크립트를 구성한다. 라이선스 있는 fixture 자산만 사용한다. 테스트 helper `expectOk<T>(result:Result<T>):T`는 ok를 assertion으로 좁힌 뒤 value를 반환한다. 실패 결과도 error 접근 전에 ok=false를 확인한다. 최소 React/HTML 예제와 CLI 실행법을 agent-quickstart에 함께 제공하여 외부 코딩 에이전트가 UI 완성 전부터 작성→캡처를 수행하게 한다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. PNG와 DOM target dump, 실제 명령/exit code를 보관. 화면 편집 UI가 없어도 이 slice가 작동한다.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "feat: render React and HTML in one motion stage"`. 무관한 파일은 포함하지 않는다.

## T02 — 정수 시간·곡선·공통 프레임 평가기

**Depends on:** T01.

**Files:**
- Create: `packages/core/src/time.ts`, `packages/core/src/curves.ts`, `packages/core/src/compile.ts`, `packages/core/src/evaluate.ts`, `packages/core/package.json`.
- Modify: `packages/document/src/schema.ts`.
- Test/fixture: `tests/unit/time-evaluation.test.ts`.

**Interfaces:** C1/C2의 frameToTick(frame:number,fps:FrameRate):Tick, evaluateCurve(keys,tick):Result<JsonValue>, compileProject, evaluateFrame을 구현한다. owner/target 주소는 C2 그대로 사용한다.

- [ ] **Step 1 — 검사 작성:** `frame_exactness_and_seek_order_independence`.

Setup: x=0@0, x=100@240000의 선형 채널은 120000에서 50, 360000에서 100. 0→360000→120000→360000와 fresh load의 같은 tick 결과를 비교한다. at은 frameToken을 고정한 FrameContext fixture다.

```ts
expect(frameToTick(45, {num:30, den:1})).toBe(360000);
expect(evaluateFrame(ir, at(360000))).toEqual(expectedAt1_5s);
```

- [ ] **Step 2 — RED 확인:** `bun run test:unit -- tests/unit/time-evaluation.test.ts`. 기대 실패: 부동소수 누적·seek 이전 상태 의존·끝 프레임 오프바이원 중 지정 동작으로 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** hold/linear/단조 시간 cubic Bézier, 수치 단위, discrete props hold, scene local/project/source time 구분. 음수 길이·duplicate ID·부모 cycle·NaN·unsupported FPS를 reject한다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. 6초/30fps의 frame index 0..179, frame 180 제외. 동일 tick 결과와 오류 코드 회귀 검사.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "feat: add deterministic motion time and curve evaluation"`. 무관한 파일은 포함하지 않는다.

## T03 — 작성 SDK·대상 소유권·프레임 준비 경계

**Depends on:** T02.

**Files:**
- Create: `packages/authoring/src/manifest.ts`, `packages/stage/src/targets.ts`, `packages/stage/src/frame-barrier.ts`, `packages/stage/src/compositor.ts`.
- Modify: `packages/authoring/src/react.tsx`, `packages/authoring/src/html.ts`.
- Test/fixture: `tests/integration/stage-ownership.test.ts`.

**Interfaces:** C3의 MotionTarget/MotionSlot, C4 FrameReceipt를 완성한다. compositor가 transform/opacity/order/mask/crop과 2.5D wrapper matrix를 소유한다.

- [ ] **Step 1 — 검사 작성:** `reorder_preserves_target_and_stale_commit_is_ignored`.

Setup: React ['a','b']를 ['b','a']로 바꿔도 item-b의 수동 x=120 유지. HTML group crop 뒤의 겹침을 pixel 검사. 오래된 React ACK를 일부러 지연시켜 새 frame receipt에 섞이지 않게 한다.

```ts
expect(bounds['words/item-b'].x).toBeCloseTo(120, 1);
expect(receipt.frameToken).toBe('new-frame');
```

- [ ] **Step 2 — RED 확인:** `bun run test:integration -- tests/integration/stage-ownership.test.ts`. 기대 실패: 대상이 index로 바뀌거나 React commit이 transform을 초기화하거나 old ACK가 수용되어 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** 정의 manifest→target registry→host slot 경계를 만든다. React layout commit token 확인 후 공통 채널 적용. 폰트·image decode·media 준비와 target 존재를 확인하고 receipt 발행. 모듈별 CSS를 scope하고 전역 CSS 덮어쓰기 검사.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. 역순 seek, 지연 폰트, root reorder, 혼합 parent/child, group 2.5D projection을 검증. 모듈 rebuild는 frame마다 발생하지 않는다.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "feat: unify authoring targets and frame readiness"`. 무관한 파일은 포함하지 않는다.

## T04 — 6초 혼합 프레이즈의 영상·오디오 출력

**Depends on:** T03.

**Files:**
- Create: `packages/media/src/probe.ts`, `packages/media/src/time-map.ts`, `packages/media/src/decode-frame.ts`, `packages/media/src/audio-mix.ts`, `apps/runner/src/render-job.ts`, `apps/runner/src/capture.ts`, `apps/runner/src/encode.ts`, `scripts/create-fixtures.ts`, `packages/media/package.json`.
- Test/fixture: `tests/fixtures/mixed-phrase/project.json`, `tests/integration/mixed-export.test.ts`.

**Interfaces:** C5 probeAsset/getSourceTick/decodeFrame/mixAudio, C4 startRender/cancelRender/RenderManifest. 현재 slice는 CFR fixture를 지원하며 미지원 입력은 명확히 reject한다.

- [ ] **Step 1 — 검사 작성:** `mixed_phrase_exports_180_frames_and_synced_audio`.

Setup: 6초 30fps: React 키워드 점→HTML/SVG 가림→CFR 영상. 1.5초 강세에 48kHz pulse를 배치하므로 WAV pulse는 sample 72000. 인코딩된 MP4에서 별도 decode로 sync 오차 1 video frame 이내를 검사한다.

```ts
expect(manifest.frames).toBe(180);
expect(audioPulseSample).toBe(72000);
```

- [ ] **Step 2 — RED 확인:** `bun run test:integration -- tests/integration/mixed-export.test.ts`. 기대 실패: frame 누락·source in 오류·오디오 시작 offset·미준비 frame 캡처로 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** native video seek 완료만 믿지 않고 PTS 확인 가능한 디코드 경로를 둔다. 준비 receipt 후 PNG 캡처, PCM audio mix 후 FFmpeg encode. MP4 H.264/AAC·PNG sequence, sRGB/SDR 작업과 출력 색 metadata, 명시한 range export를 구현한다. 기존 output 덮어쓰기는 새 파일 생성 후 완료 시 교체한다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. ffprobe frame count/fps/duration, 전체 A/V decode exit 0, 전환 전·중·후 PNG와 WAV pulse 측정. MP4 바이트 hash 동일성은 요구하지 않는다.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "feat: export a mixed motion phrase with synchronized media"`. 무관한 파일은 포함하지 않는다.

## T05 — 실행 격리·취소·세 OS 코어 smoke

**Depends on:** T04.

**Files:**
- Create: `packages/authoring/src/build.ts`, `apps/runner/src/server.ts`, `apps/runner/src/session.ts`, `apps/runner/src/stage-process.ts`, `apps/runner/src/asset-broker.ts`, `.github/workflows/core-smoke.yml`, `scripts/core-smoke.ts`.
- Test/fixture: `tests/integration/isolation.test.ts`.

**Interfaces:** C3 buildDefinition, C4 session/job protocol을 구현한다. `runCoreSmoke():Promise<SmokeReport>`를 scripts에 정의하고 report에 OS/arch/runtime hashes/command exits를 넣는다.

- [ ] **Step 1 — 검사 작성:** `hostile_source_cannot_escape_and_cancel_releases_runner`.

Setup: 무한 loop, fetch, file URL, ../../asset, 잘못된 session/origin, process crash를 각각 fixture로 만든다. cancel 요청 후 1초 안에 자식 종료, 2초 내 다음 정상 job 시작을 확인한다.

```ts
expect(networkAttempt.error.code).toBe('CAPABILITY_DENIED');
expect(cancelledJob.state).toBe('cancelled');
```

- [ ] **Step 2 — RED 확인:** `bun run test:integration -- tests/integration/isolation.test.ts`. 기대 실패: stage가 runner/editor와 함께 멈추거나 unauthorized path/network가 성공하거나 자식이 남아 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** 코드 build는 allowlist vendor와 browser target만, 실행은 별도 sandboxed Chromium process. loopback·session·origin·one-time asset capability, job deadline·process-tree cleanup 구현. Windows/macOS/Linux CI smoke는 같은 mixed fixture를 사용한다. 임의 코드 미리보기는 분리 프로세스 프레임+hit-test metadata로 editor에 전달한다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. 로컬 OS 실제 결과와 CI 설정을 구별. 3 OS 결과가 없으면 P0 platform gate는 pending으로 기록하되 다른 통과한 core 작업을 지우지 않는다.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "feat: isolate motion execution and add cross-platform smoke"`. 무관한 파일은 포함하지 않는다.

## 단계 완료 게이트

T01–T05 통과. React 키워드→HTML/SVG 가림→영상 인계, 역순 seek 일치, 180프레임·오디오 동기, 격리 취소/복구, 세 OS smoke 증거. 미검증 OS는 pending으로 남긴다.

STATE.json에 각 task 상태·실제 명령·exit code·artifact hash·미확인을 기록한다. 테스트 실패나 측정 미실시는 성공으로 바꾸지 않는다. 다음 단계는 의존 작업의 통과 증거를 소비한다.
