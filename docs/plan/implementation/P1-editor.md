---
description: "Implement P1 of the unified motion SDK, external-agent toolchain, and visual editor with explicit interfaces and acceptance tests."
akmLayer: context
akmRole: operating-context
akmType: context
trustLevel: draft
sourceType: synthesis
date created: 2026-10-12
date modified: 2026-10-12
tags: [motion-graphics, implementation-plan]
---

# P1 — 사람이 쓰는 타임라인·소스 편집 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax. 실행 상태는 .planning의 STATE.json을 따른다.

**Goal:** SDK 프로젝트를 사람이 캔버스·레이어·곡선·트림으로 수정하고 저장·재열기한다.

**Architecture:** 공통 ProjectDocument·Motion IR·단일 evaluator를 React/HTML SDK, 로컬 CLI, 시각 편집기가 공유한다. AI 추론은 외부 코딩 에이전트가 담당한다.

**Tech Stack:** TypeScript·React·HTML/CSS/SVG·bun workspace·Node 24 계열·Chromium·FFmpeg·Vitest/Playwright. 최초 정확 버전은 T01에서 고정한다.

**Spec:** [[30-context/projects/motion-score-studio/plan]] · [[30-context/projects/motion-score-studio/implementation-plan]] · [[30-context/projects/motion-score-studio/implementation/contracts]].

## Global Constraints

전체 계획의 Global Constraints와 계약 C1–C8을 그대로 적용한다. 코드 루트는 `/Volumes/data/Dev/motiframe` 예정 경로다. 아래 Create/Modify는 이 계획을 순서대로 구현할 때의 상태이며 현재 파일이 있다는 뜻이 아니다. 파일 목록 밖의 workspace 설정 변경이 필요하면 해당 package 선언과 테스트를 같은 작업의 변경 범위에 기록한다.

## Review Focus

전체 계획의 다섯 실패 입력을 해당 담당 작업에서 검증한다. 이 단계의 완료 판단은 아래 명령·산출물로 하며 계획에 적힌 기대값은 실행 증거가 아니다. 테스트 snippet의 변수는 Setup fixture가 준비하고 production 함수를 호출해 얻은 결과다. Result의 value/error 접근은 `expectOk` 또는 ok assertion으로 먼저 타입을 좁힌다.

## T06 — 공통 편집 명령·트랜잭션·undo/redo

**Depends on:** T05.

**Files:**
- Create: `packages/document/src/commands.ts`, `packages/document/src/apply.ts`, `packages/document/src/history.ts`, `apps/editor/src/state/project-store.ts`, `apps/runner/src/document-service.ts`, `apps/editor/package.json`.
- Test/fixture: `tests/unit/transactions.test.ts`.

**Interfaces:** C6 EditCommand/EditTransaction/applyTransaction/undo/redo. `projectContentHash(doc):string`는 revision·audit 제외. React UI store는 reducer 결과를 구독하고 별도 문서 복사본을 정본으로 만들지 않는다. `DocumentService.submit(tx):Promise<Result<CommitReceipt>>`와 `subscribe(afterRevision):AsyncIterable<DocumentEvent>`를 정의한다. 온라인에서는 runner가 단일 writer, 오프라인 CLI는 프로젝트 lock을 획득하며 browser-only는 로컬 단독 편집 모드다.

- [ ] **Step 1 — 검사 작성:** `transaction_is_atomic_locked_and_undoable`.

Setup: 레이어 2개 이동 중 하나가 locked이면 두 레이어 모두 원래 위치. baseRevision=3 제안을 revision=4에 제출하면 conflict. 50회 drag update는 한 gesture commit으로 coalesce하여 undo 1번에 복원한다.

```ts
expect(projectContentHash(expectOk(undo(appliedHistory)).document)).toBe(originalHash);
expect(rejected.error.code).toBe('REVISION_CONFLICT');
```

- [ ] **Step 2 — RED 확인:** `bun run test:unit -- tests/unit/transactions.test.ts`. 기대 실패: 부분 적용·원본 mutation·redo 유실·오래된 revision overwrite로 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** 사전검사→명령 적용→inverse 생성→revision 증가 순서, scope/부모 cycle/길이/locked 검증. 검증 실패는 history에 남기지 않는다. 새 편집 후 redo branch를 정리하되 과거 저장본은 보존한다. UI와 CLI는 같은 document service의 revision 이벤트를 받는다. 잠금 보유 프로세스가 살아 있으면 다른 writer는 덮어쓰지 않고 연결하거나 거절한다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. 사용자/recipe/agent author 모두 같은 경로를 사용하도록 public command entry만 export.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "feat: add atomic motion edits and undo history"`. 무관한 파일은 포함하지 않는다.

## T07 — 자산 import·프록시·포터블 저장·복구

**Depends on:** T06.

**Files:**
- Create: `packages/media/src/prepare.ts`, `packages/media/src/proxy.ts`, `packages/media/src/waveform.ts`, `packages/document/src/persistence.ts`, `packages/document/src/bundle.ts`, `apps/runner/src/project-storage.ts`.
- Test/fixture: `tests/integration/project-portability.test.ts`.

**Interfaces:** C5 prepareAsset/saveProject/loadProject/packProject/unpackProject. asset path는 로컬 registry에만, 문서에는 ID/hash/logicalPath. save는 temp→fsync/검증→atomic replace와 이전 스냅샷 보존.

- [ ] **Step 1 — 검사 작성:** `portable_bundle_reopens_after_move_and_rejects_bad_archives`.

Setup: 한글·공백 파일명, 대소문자 충돌, missing font, VFR·rotation=90° 영상, file relocation, ../../ 경로·symlink·hash mismatch를 포함한다. save 도중 프로세스를 중단해 이전 정상 프로젝트가 열린다.

```ts
expect(projectContentHash(reopened)).toBe(originalHash);
expect(traversal.error.code).toBe('INVALID_BUNDLE_PATH');
```

- [ ] **Step 2 — RED 확인:** `bun run test:integration -- tests/integration/project-portability.test.ts`. 기대 실패: absolute path 누출·다른 OS 경로 실패·회전 이중 적용·VFR 소스 frame mismatch·손상 save로 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** mp4 H.264/AAC, PNG/JPEG/WebP, WAV/MP3 기본 입력을 probe하고 지원되지 않으면 오류 표시. VFR source PTS map을 보존한 CFR preview proxy·파형·썸네일 생성. 4GiB 기본 archive 확장 예산과 manifest 경계·hash를 검사한다. Browser-only JSON/bundle import·export와 IndexedDB 복구 snapshot을 제공한다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. 소스와 proxy의 선택 timestamp correspondence, 누락 자산 relink 후 동일 content hash, archive의 비밀/절대경로 부재를 검사.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "feat: import media and save portable motion projects"`. 무관한 파일은 포함하지 않는다.

## T08 — 작업 화면·선택·변환·속성 패널

**Depends on:** T07.

**Files:**
- Create: `apps/editor/src/App.tsx`, `apps/editor/src/canvas/StageViewport.tsx`, `apps/editor/src/canvas/SelectionOverlay.tsx`, `apps/editor/src/inspector/PropertiesPanel.tsx`, `apps/editor/src/assets/AssetPanel.tsx`, `apps/editor/index.html`, `apps/editor/vite.config.ts`, `apps/editor/src/main.tsx`, `playwright.config.ts`.
- Test/fixture: `tests/e2e/canvas-edit.spec.ts`.

**Interfaces:** StageViewport는 C4 receipt.targetBounds와 viewport matrix를 소비한다. pointer를 project 좌표로 바꿔 모션 채널에는 C6 SetKeyframe을 제출한다. 콘텐츠 props는 inspector의 SetProps로 수정한다. inspector는 C3 props schema만 읽는다.

- [ ] **Step 1 — 검사 작성:** `scaled_viewport_drag_changes_one_native_target`.

Setup: 0.5배 viewport에서 화면 50px drag가 stage 100px 변화. React title과 HTML background 중 title만 선택. zoom/pan·다중 선택·locked·undo·세로/정사각 비율을 검사한다.

```ts
expect(titleX).toBe(100); // x 채널을 현재 tick에 평가한 값
expect(document.instances['background'].props).toEqual(beforeBackground);
```

- [ ] **Step 2 — RED 확인:** `bun run test:e2e -- tests/e2e/canvas-edit.spec.ts`. 기대 실패: CSS pixel/project pixel 혼동·숨겨진 target 선택·UI 별도 state만 변경되어 저장에 반영 안 되면 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** 자산→stage drop, selection bounds, translate/scale/rotate, transform origin, group 선택, locked 표시, schema 기반 props editing. timeline UI 전에 이 경로로 실제 문서 수정 가능하게 만든다. stage가 remote process여도 overlay와 hit-test는 같은 receipt를 사용한다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. 수정 전/후 saved document와 실제 output frame을 대조. UI가 예쁘다는 이유만으로 통과하지 않는다.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "feat: add canvas selection and property editing"`. 무관한 파일은 포함하지 않는다.

## T09 — 다중 트랙 타임라인·trim·split·재배열

**Depends on:** T08.

**Files:**
- Create: `apps/editor/src/timeline/Timeline.tsx`, `apps/editor/src/timeline/ClipRow.tsx`, `apps/editor/src/timeline/time-scale.ts`, `packages/document/src/clip-commands.ts`.
- Test/fixture: `tests/unit/clip-edits.test.ts`, `tests/e2e/timeline-edit.spec.ts`.

**Interfaces:** C6 MoveInstance/TrimClip/SplitClip/DuplicateInstance/ReorderTrack을 추가한다. 키프레임 at은 instance-local tick, score event는 project tick. `timelineToLocal(instance,tick):Tick`를 core/time.ts에 둔다.

- [ ] **Step 1 — 검사 작성:** `split_preserves_source_time_and_local_animation`.

Setup: sourceIn=2초의 clip을 timeline=3초에서 나눈다. split 경계와 전후 frame의 원본 PTS·transform 유지. move는 sourceIn·local curve를 바꾸지 않음, trim은 start/end만 조정, 기본 뒤 clip 이동 없음.

```ts
expect(expectOk(getSourceTick(rightClip, splitTick))).toBe(expectedSourceTick);
expect(frameAfterSplit).toEqual(frameBeforeSplit);
```

- [ ] **Step 2 — RED 확인:** `bun run test:unit -- tests/unit/clip-edits.test.ts && bun run test:e2e -- tests/e2e/timeline-edit.spec.ts`. 기대 실패: split 때 source offset 초기화·curve jump·자동 ripple·end-inclusive 중복 frame으로 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** frame snap·zoom·scroll·playhead·multi-select·trim/split/duplicate/order/lock/mute. split은 경계 값을 삽입하고 오른쪽 local keys를 재기준화하며 새 ID를 만든다. ripple을 사용자가 선택한 경우에만 후속 범위를 명시적으로 이동한다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. 15초 혼합 프로젝트를 수동 배치하고 저장/재열기/출력. 비디오·오디오·타입을 같은 시간 ruler에 표시.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "feat: add timeline editing with source time preservation"`. 무관한 파일은 포함하지 않는다.

## T10 — 키프레임·값 그래프·속도 그래프

**Depends on:** T09.

**Files:**
- Create: `apps/editor/src/curves/CurveEditor.tsx`, `apps/editor/src/curves/VelocityEditor.tsx`, `packages/core/src/curve-handles.ts`, `packages/document/src/keyframe-commands.ts`.
- Test/fixture: `tests/unit/curve-editing.test.ts`, `tests/e2e/curve-editor.spec.ts`.

**Interfaces:** `setEndpointVelocity(keys,keyId,side:'in'|'out',velocity:number,influence:number):Result<Keyframe[]>`; velocity 단위는 채널 value/second, influence∈(0,1]. C2 evaluateCurve와 같은 parametric cubic time/value curve를 사용한다.

- [ ] **Step 1 — 검사 작성:** `velocity_handle_changes_curve_without_moving_endpoints`.

Setup: 0→100px/1초 채널에서 outgoing velocity=200px/s로 바꾸고 analytic/numerical derivative를 허용오차 내 비교. equal endpoints+nonzero tangent, negative rotation, zero duration·NaN rejection, undo를 검사한다.

```ts
expect(expectOk(evaluateCurve(updated, start))).toBe(0);
expect(expectOk(evaluateCurve(updated, end))).toBe(100);
```

- [ ] **Step 2 — RED 확인:** `bun run test:unit -- tests/unit/curve-editing.test.ts && bun run test:e2e -- tests/e2e/curve-editor.spec.ts`. 기대 실패: 속도 편집이 값을 깨뜨리거나 그래프와 실제 evaluator가 다른 곡선을 사용하면 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** hold/linear/cubic 전환, key 이동·추가·삭제·다중 선택, value/velocity view. time/value control points로 endpoint velocity를 변환해 equal-value 구간도 처리한다. 화면상 속도 overlay는 투영 bounds의 별도 진단이며 graph velocity와 구분한다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. 같은 프레이즈를 그래프에서 제동 변경한 후 임의 seek와 export가 동일 timing을 반영.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "feat: edit motion values and velocities"`. 무관한 파일은 포함하지 않는다.

## T11 — React·HTML 소스 작성과 definition 버전 교체

**Depends on:** T10.

**Files:**
- Create: `apps/editor/src/authoring/SourceEditor.tsx`, `packages/authoring/src/revisions.ts`, `packages/authoring/src/reconcile.ts`, `packages/document/src/definition-commands.ts`, `docs/authoring-sdk.md`.
- Test/fixture: `tests/integration/definition-revision.test.ts`.

**Interfaces:** C3 buildDefinition/reconcileDefinition, C2 definitionRevision. UI는 html/css/tsx/manifest 파일 수정→build diagnostics→stage preview→등록 흐름. 변경 적용은 선택 인스턴스에 새 revision을 연결.

- [ ] **Step 1 — 검사 작성:** `source_revision_preserves_overrides_or_reports_orphans`.

Setup: source 기본색 변경에도 instance override 빨강 유지. item-b 제거 시 기존 item-b keyframe을 item-c로 넘기지 않음. 같은 definition의 다른 instance는 이전 revision 유지. syntax error 후 마지막 정상 stage 유지.

```ts
expect(next.instances['title'].props.color).toBe('#ff0000');
expect(removedTarget.error.code).toBe('TARGET_MIGRATION_REQUIRED');
```

- [ ] **Step 2 — RED 확인:** `bun run test:integration -- tests/integration/definition-revision.test.ts`. 기대 실패: source hot update가 props/keys를 초기화하거나 broken artifact를 저장하면 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** hash-addressed artifact와 revision, props schema 호환 검사, stable target remap 명시 UI, module source·vendor lock을 bundle에 포함. HTML→JSX 강제 변환과 임의 npm 설치를 하지 않는다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. 문서 없이도 SDK 예제 1개씩 등록→혼합 편집→portable bundle→재열기 가능한 사용 가이드.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "feat: author and version React and HTML motion elements"`. 무관한 파일은 포함하지 않는다.

## 단계 완료 게이트

T06–T11 통과. AI 없이 15초 혼합 프로젝트 수동 제작·undo/redo·portable 재열기. 소스 revision 교체가 수동 채널을 보존한다.

STATE.json에 각 task 상태·실제 명령·exit code·artifact hash·미확인을 기록한다. 테스트 실패나 측정 미실시는 성공으로 바꾸지 않는다. 다음 단계는 의존 작업의 통과 증거를 소비한다.
