---
description: "Implement P4 of the unified motion SDK, external-agent toolchain, and visual editor with explicit interfaces and acceptance tests."
akmLayer: context
akmRole: operating-context
akmType: context
trustLevel: draft
sourceType: synthesis
date created: 2026-10-12
date modified: 2026-10-12
tags: [motion-graphics, implementation-plan]
---

# P4 — 성능·세 OS 배포·실제 제작 검증 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax. 실행 상태는 .planning의 STATE.json을 따른다.

**Goal:** 깨끗한 세 OS에서 도구를 설치하고 에이전트·사람 협업으로 세 작품을 제작·복구·출력한다.

**Architecture:** 공통 ProjectDocument·Motion IR·단일 evaluator를 React/HTML SDK, 로컬 CLI, 시각 편집기가 공유한다. AI 추론은 외부 코딩 에이전트가 담당한다.

**Tech Stack:** TypeScript·React·HTML/CSS/SVG·bun workspace·Node 24 계열·Chromium·FFmpeg·Vitest/Playwright. 최초 정확 버전은 T01에서 고정한다.

**Spec:** [[30-context/projects/motion-score-studio/plan]] · [[30-context/projects/motion-score-studio/implementation-plan]] · [[30-context/projects/motion-score-studio/implementation/contracts]].

## Global Constraints

전체 계획의 Global Constraints와 계약 C1–C8을 그대로 적용한다. 코드 루트는 `/Volumes/data/Dev/motiframe` 예정 경로다. 아래 Create/Modify는 이 계획을 순서대로 구현할 때의 상태이며 현재 파일이 있다는 뜻이 아니다. 파일 목록 밖의 workspace 설정 변경이 필요하면 해당 package 선언과 테스트를 같은 작업의 변경 범위에 기록한다.

## Review Focus

전체 계획의 다섯 실패 입력을 해당 담당 작업에서 검증한다. 이 단계의 완료 판단은 아래 명령·산출물로 하며 계획에 적힌 기대값은 실행 증거가 아니다. 테스트 snippet의 변수는 Setup fixture가 준비하고 production 함수를 호출해 얻은 결과다. Result의 value/error 접근은 `expectOk` 또는 ok assertion으로 먼저 타입을 좁힌다.

## T22 — 프록시·캐시 무효화·미리보기 성능

**Depends on:** T21.

**Files:**
- Create: `packages/stage/src/frame-cache.ts`, `packages/media/src/cache.ts`, `packages/core/src/invalidation.ts`, `scripts/benchmark-preview.ts`, `docs/performance.md`.
- Test/fixture: `tests/unit/cache-invalidation.test.ts`, `tests/fixtures/performance/project.json`.

**Interfaces:** `getFrameCacheKey(input:FrameCacheInput):string`, `invalidateChanges(before,after):InvalidationSet`; input은 document/definition revision·runtime·asset/font hash·resolution·seed·tick. `benchmarkPreview(project,environment):Promise<BenchmarkReport>`.

- [ ] **Step 1 — 검사 작성:** `definition_font_and_source_changes_invalidate_correct_frames`.

Setup: 30초·2D 30레이어·동시 영상 2개 고정 fixture. 폰트 교체·소스 revision·clip sourceIn·seed·preview scale 변경 시 영향을 받는 프레임은 miss, 무관 구간은 hit. cold/warm 분리.

```ts
expect(keyAfterFontChange).not.toBe(originalKey);
expect(unchangedRangeCacheHit).toBe(true);
```

- [ ] **Step 2 — RED 확인:** `bun run test:unit -- tests/unit/cache-invalidation.test.ts`. 기대 실패: 이전 폰트/소스 frame을 재사용하거나 범위 바깥 전체를 불필요 재컴파일하면 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** definition bundle·frame·decoded media 캐시를 분리하고 메모리 한도를 둔다. 720p proxy30fps, warm seek p95≤200ms, 일반 UI응답 p95≤100ms를 측정 목표로 삼는다. 라이브 편집의 낮은 해상도와 최종 render 품질을 명시하며 최종 프레임 모드도 유지한다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. benchmark 명령·장비/OS/전원·runtime·해상도·샘플 수·p50/p95·누락 프레임을 저장. shared CI 성능 수치를 실제 사용자 장비 성능 보장으로 쓰지 않으며 미달은 pending/조정 근거로 기록.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "perf: cache motion frames with precise invalidation"`. 무관한 파일은 포함하지 않는다.

## T23 — SDK·CLI·로컬 실행기의 세 OS 설치 묶음

**Depends on:** T22.

**Files:**
- Create: `scripts/package-runner.ts`, `scripts/install-smoke.ts`, `apps/runner/src/launcher.ts`, `apps/runner/src/runtime-manifest.ts`, `docs/install.md`, `docs/third-party-notices.md`, `.github/workflows/install-smoke.yml`.
- Modify: `packages/authoring/package.json`, `packages/automation/package.json`.
- Test/fixture: `tests/integration/packaged-runner.test.ts`.

**Interfaces:** `resolveRuntime(manifest,platform):Result<RuntimePaths>`, `startLauncher(options):Promise<Result<SessionInfo>>`; `motiframe doctor --json`은 OS/arch·버전·자산/폰트/codec capability를 확인한다. SDK는 local tarball, CLI는 자가 포함 실행 묶음으로 검증한다.

- [ ] **Step 1 — 검사 작성:** `fresh_install_runs_mixed_project_without_global_node`.

Setup: 깨끗한 Windows11 x64, macOS arm64/x64, Ubuntu24.04 x64에서 전역 Node/bun 없는 환경. 한글·공백 install path, 동시 실행 포트 충돌, 오프라인 기본 프로젝트, 다른 위치로 프로젝트 이동.

```ts
expect(doctor.ok).toBe(true);
expect(render.frames).toBe(180);
```

- [ ] **Step 2 — RED 확인:** `bun run test:integration -- tests/integration/packaged-runner.test.ts`. 기대 실패: 개발자 절대경로·전역 도구·네트워크·특정 모델 로그인에 의존하거나 번들 runtime hash가 맞지 않으면 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** 버전 고정 Node/Chromium/FFmpeg와 필요한 폰트·license notices를 배포 manifest로 묶는다. CPU arch별 artifact가 없으면 명시 unsupported. editor는 loopback으로 열고 새 설치/구버전 프로젝트를 구별한다. npm registry 게시·앱스토어·서명/공증 계정 설정은 현재 로컬 RC 생성 범위와 구분한다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. OS/arch별 설치→doctor→6초 렌더→재열기 로그와 artifact hash. 테스트한 matrix만 지원 완료. SDK tarball과 agent kit의 설치 경로 독립성도 확인.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "build: package portable motion tools for desktop platforms"`. 무관한 파일은 포함하지 않는다.

## T24 — 충돌·저장 실패·실행 중단 복구

**Depends on:** T23.

**Files:**
- Create: `packages/document/src/recovery.ts`, `apps/runner/src/job-journal.ts`, `apps/runner/src/diagnostics.ts`, `apps/editor/src/recovery/RecoveryDialog.tsx`, `docs/troubleshooting.md`.
- Test/fixture: `tests/integration/recovery.test.ts`.

**Interfaces:** `recoverProject(store):Promise<Result<RecoveryReport>>`, `recoverJobs(journal):Promise<Result<JobRecoveryReport>>`, `exportDiagnostics(options):Promise<Result<Artifact>>`; report는 마지막 확인 revision·중단 작업·복구 후보를 구분한다.

- [ ] **Step 1 — 검사 작성:** `disk_full_crash_and_cli_retry_preserve_last_commit`.

Setup: save 중 디스크 부족·runner 강제 중단·인코딩 중 취소·CLI 응답 유실 후 같은 request 재전송·archive 손상. 원본 미디어/이전 정상 저장본 hash 유지. 복구 시 오래된 잠금의 PID 재사용도 검사.

```ts
expect(reopened.contentHash).toBe(lastConfirmedHash);
expect(journal.countCommitted(requestId)).toBe(1);
```

- [ ] **Step 2 — RED 확인:** `bun run test:integration -- tests/integration/recovery.test.ts`. 기대 실패: 이전 정상 문서가 손상·완료 안 된 파일을 최종 출력 취급·request 중복 적용·원본 정리 삭제면 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** journal에 commit 상태·출력 temp를 남기고 재시작 시 확정/미확정 복구를 분리한다. 중단된 렌더는 원본 보존 후 명시 재시작하며 frame cache 유효성 확인. 에이전트와 UI가 같은 복구 revision을 조회한다. 진단은 키·개인 절대경로를 제외하고 앱이 소유한 임시파일 정리는 휴지통 정책을 따른다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. fault injection별 before/after hashes·복구 화면·정확히 한 commit 증거. 저절로 되살린 작업·파일 영구 삭제 없음.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "fix: recover project and render jobs without losing edits"`. 무관한 파일은 포함하지 않는다.

## T25 — 실제 세 작품 제작·에이전트 왕복·릴리스 후보

**Depends on:** T24.

**Files:**
- Create: `examples/korean-kinetic/project.json`, `examples/slow-tension/project.json`, `examples/mixed-edit/project.json`, `scripts/acceptance-report.ts`, `docs/release-acceptance.md`.
- Test/fixture: `tests/e2e/production-workflows.spec.ts`.

**Interfaces:** `runAcceptance(manifest):Promise<AcceptanceReport>`; report={runtime,platform,artifacts,technical,choreography,perception,pending}. 출력과 프로젝트·스크립트·사용 스킬/schema version을 연결한다.

- [ ] **Step 1 — 검사 작성:** `external_agent_to_timeline_to_agent_produces_reopenable_films`.

Setup: 15초 한글 타입(3600000tick),10초 느린 긴장,30초 영상+그래픽. 각각 React+HTML 요소 포함. 외부 에이전트 초안→사람의 타임라인 수정→선택 context→에이전트 부분 patch→undo/redo→다른 OS에서 열기→export.

```ts
expect(koreanFilm.durationTicks).toBe(3600000);
expect(mixedFilm.framesAt30fps).toBe(900);
expect(afterUndo.contentHash).toBe(beforePartialEditHash);
```

- [ ] **Step 2 — RED 확인:** `bun run test:e2e -- tests/e2e/production-workflows.spec.ts`. 기대 실패: 소스/프로젝트만 있고 재생 가능한 결과가 없거나 수동 수정 소실·소리 미검증을 pass·한쪽 authoring을 비디오로 굽고 편집 가능이라고 하면 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** 16:9/9:16/1:1 및24/30/60fps 조합을 짧은 혼합 fixture 전체 matrix로 검증하고 세 작품은 각각 정한 주 출력으로 제작한다. MP4 full decode·frame count·A/V timestamp·PNG sequence·휴대 bundle 재열기를 확인한다. Contact sheet와 1배속 무음/유음 검수를 분리한다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. 세 완성 영상·원본 편집 프로젝트·명령/exit code·hash·기술/안무 검수·실제 에이전트 transcript. 체감 최종 판단은 마스터 관찰 후 표시하며 미확인 항목을 남긴 로컬 RC는 완전 완료와 구분. 외부 게시 없음.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "test: validate motion production workflows and release artifacts"`. 무관한 파일은 포함하지 않는다.

## 단계 완료 게이트

T22–T25 통과. 성능 실측·OS/arch별 설치/출력 증거·장애 복구·세 완성 작품과 편집 프로젝트. 실제 관찰 전 체감 검수는 unverified, 외부 배포는 별도 범위다.

STATE.json에 각 task 상태·실제 명령·exit code·artifact hash·미확인을 기록한다. 테스트 실패나 측정 미실시는 성공으로 바꾸지 않는다. 다음 단계는 의존 작업의 통과 증거를 소비한다.
