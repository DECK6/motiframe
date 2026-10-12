---
description: "Implement P2 of the unified motion SDK, external-agent toolchain, and visual editor with explicit interfaces and acceptance tests."
akmLayer: context
akmRole: operating-context
akmType: context
trustLevel: draft
sourceType: synthesis
date created: 2026-10-12
date modified: 2026-10-12
tags: [motion-graphics, implementation-plan]
---

# P2 — 모션리듬 악보·타이포·인계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax. 실행 상태는 .planning의 STATE.json을 따른다.

**Goal:** 속도·텐션·리듬을 각각 설계하고 악보 수정이 실제 움직임과 오디오에 반영된다.

**Architecture:** 공통 ProjectDocument·Motion IR·단일 evaluator를 React/HTML SDK, 로컬 CLI, 시각 편집기가 공유한다. AI 추론은 외부 코딩 에이전트가 담당한다.

**Tech Stack:** TypeScript·React·HTML/CSS/SVG·bun workspace·Node 24 계열·Chromium·FFmpeg·Vitest/Playwright. 최초 정확 버전은 T01에서 고정한다.

**Spec:** [[30-context/projects/motion-score-studio/plan]] · [[30-context/projects/motion-score-studio/implementation-plan]] · [[30-context/projects/motion-score-studio/implementation/contracts]].

## Global Constraints

전체 계획의 Global Constraints와 계약 C1–C8을 그대로 적용한다. 코드 루트는 `/Volumes/data/Dev/motiframe` 예정 경로다. 아래 Create/Modify는 이 계획을 순서대로 구현할 때의 상태이며 현재 파일이 있다는 뜻이 아니다. 파일 목록 밖의 workspace 설정 변경이 필요하면 해당 package 선언과 테스트를 같은 작업의 변경 범위에 기록한다.

## Review Focus

전체 계획의 다섯 실패 입력을 해당 담당 작업에서 검증한다. 이 단계의 완료 판단은 아래 명령·산출물로 하며 계획에 적힌 기대값은 실행 증거가 아니다. 테스트 snippet의 변수는 Setup fixture가 준비하고 production 함수를 호출해 얻은 결과다. Result의 value/error 접근은 `expectOk` 또는 ok assertion으로 먼저 타입을 좁힌다.

## T12 — 프레이즈·세 축·읽기 역할의 시간 악보

**Depends on:** T11.

**Files:**
- Create: `packages/core/src/score/schema.ts`, `packages/core/src/score/compile.ts`, `apps/editor/src/score/PhraseTrack.tsx`, `apps/editor/src/score/IntentInspector.tsx`.
- Test/fixture: `tests/unit/score-edits.test.ts`.

**Interfaces:** C7 Phrase/Event/RoleWindow/TensionIntent/compileScore. event는 project tick, 채널 key는 instance-local. compile 결과를 C6 transaction으로 적용.

- [ ] **Step 1 — 검사 작성:** `score_retime_changes_motion_and_preserves_manual_channels`.

Setup: 대표 강세를 1.2초→1.5초로 이동하면 연결 recipe key의 도착도 1.5초로 이동. manual scale은 유지. ‘해소 없음’ 긴장 종결, 읽기 창 경계를 깨뜨리는 retime, 잠긴 주체를 각각 검사.

```ts
expect(updatedAccent.tick).toBe(360000);
expect(updatedManualChannel).toEqual(originalManualChannel);
```

- [ ] **Step 2 — RED 확인:** `bun run test:unit -- tests/unit/score-edits.test.ts`. 기대 실패: 마커만 이동하거나 수동 채널 덮어쓰기·의도적 미해결을 강제 해소하면 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** 속도/텐션/리듬 panel을 구분, primary actor와 보조층 지정. onset/arrival/response/accent/rest, reading/transform/texture 창. 충돌 시 transaction 전체 거절하고 대상·구간 표시. recipe→manual 소유권 전환은 history에 기록.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. 악보 값과 render의 해당 event frame을 함께 비교. 고정 beat 개수나 에너지 점수를 완료 조건으로 삼지 않는다.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "feat: edit motion phrases and semantic timing"`. 무관한 파일은 포함하지 않는다.

## T13 — 한글 타입·Selector·읽기/변형 창

**Depends on:** T12.

**Files:**
- Create: `packages/core/src/type/segment.ts`, `packages/core/src/type/selector.ts`, `packages/authoring/src/elements/KineticType.tsx`, `packages/authoring/src/elements/kinetic-type.html`, `apps/editor/src/type/TypeInspector.tsx`.
- Test/fixture: `tests/unit/type-selection.test.ts`, `tests/integration/hangul-type.test.ts`.

**Interfaces:** `segmentText(text,unit:'grapheme'|'word'|'line'):TextUnit[]`; TextUnit={id,original,start,end}. `evaluateSelector(units,selector,tick):SelectedUnit[]`; selector={range,offset,shape,stagger}. 양쪽 작성 요소가 같은 selector 결과를 소비한다.

- [ ] **Step 1 — 검사 작성:** `hangul_graphemes_and_reading_window_survive_transform`.

Setup: NFC ‘가’와 NFD 조합 글자, 결합 accent, emoji ZWJ, 여러 어절을 포함한다. 비가독 변형 구간 뒤 읽기 창에서 원문·순서 복원. 문구 변경으로 사라진 unit의 keyframe은 orphan 표시.

```ts
expect(segmentText('가👩‍💻', 'grapheme')).toHaveLength(2);
expect(renderedReadingText).toBe(originalText);
```

- [ ] **Step 2 — RED 확인:** `bun run test:unit -- tests/unit/type-selection.test.ts && bun run test:integration -- tests/integration/hangul-type.test.ts`. 기대 실패: 코드포인트 split으로 한글/emoji가 깨지거나 의미 없는 같은 pop만 적용하거나 잘못된 unit에 keyframe이 남으면 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** Intl.Segmenter 기반 grapheme/word와 명시 newline 기반 line 단위, 지속 ID 매핑, 범위·offset·선형/완만 selector, syllable/word 그룹 transform·crop·rotate. 원문은 보존하고 자모/획 분해는 M2로 둔다. font coverage와 실제 읽기 창을 표시.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. React/HTML 버전의 같은 문구·selector 결과를 frame 비교. 자동 검사는 glyph 정확성을, 실제 독해는 T25 재생 평가를 담당.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "feat: add Hangul-aware kinetic type selectors"`. 무관한 파일은 포함하지 않는다.

## T14 — 모션 레시피·전환·동작 인계

**Depends on:** T13.

**Files:**
- Create: `packages/core/src/score/recipes.ts`, `packages/core/src/score/handoff.ts`, `apps/editor/src/library/MotionLibrary.tsx`, `apps/editor/src/score/HandoffInspector.tsx`.
- Test/fixture: `tests/unit/phrase-recipes.test.ts`, `tests/integration/handoff-render.test.ts`.

**Interfaces:** C7 planPhrase와 Handoff. recipe IDs: phrase-exchange, anticipation-release, stagger-response, anchor-wipe, match-cut, hold-variation. `resolveHandoff(doc,handoff):Result<EditTransaction>`는 wrapper 대상만 연결한다.

- [ ] **Step 1 — 검사 작성:** `react_anchor_hands_off_to_html_reveal`.

Setup: React 점→HTML 원형 가림→영상 reveal의 전후 위치 연속, preparation/peak/response 시차 확인. match-cut은 중간 형태를 만들지 않음, continuous에서 중간 상태 없는 즉시 교체는 거절. 이미 드러난 결과를 reveal로 기록한 모순도 표시.

```ts
expect(distance(beforeAnchor, afterAnchor)).toBeLessThanOrEqual(0.5);
expect(revealVisibleBeforeCue).toBe(false);
```

- [ ] **Step 2 — RED 확인:** `bun run test:unit -- tests/unit/phrase-recipes.test.ts && bun run test:integration -- tests/integration/handoff-render.test.ts`. 기대 실패: 장면 경계에서 시선/위치 jump·전 층 동시 종료·주체보다 효과가 강세를 가로채는 fixture로 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** 레시피마다 props·타이밍 역할·지원 채널·조건·반례 선언. 사용자 문구·형태를 보존하며 recipe 소유 key만 생성. 순환 인계와 서로 같은 채널을 쓰는 중복 recipe를 reject. 전체 화면 효과를 모든 이벤트에 강제하지 않는다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. 6초 핵심 phrase와 15초 한글 예제에서 주행동·긴 읽기·다음 인계를 함께 확인.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "feat: add phrase recipes and cross-authoring handoffs"`. 무관한 파일은 포함하지 않는다.

## T15 — 재생 transport·오디오 강세·역할 검수

**Depends on:** T14.

**Files:**
- Create: `apps/editor/src/transport/transport.ts`, `apps/editor/src/audio/WaveformTrack.tsx`, `apps/editor/src/audio/GainEditor.tsx`, `packages/core/src/score/lint.ts`.
- Test/fixture: `tests/integration/transport-audio.test.ts`, `tests/unit/score-lint.test.ts`.

**Interfaces:** `createTransport(port,audio):Transport`; Transport={play,pause,seek,getTick,dispose}. `lintScore(doc):ScoreIssue[]`; issue={id,range,code,severity:'info'|'warning',message}. C5 mixAudio가 preview/export gain/fade를 공유한다.

- [ ] **Step 1 — 검사 작성:** `seek_reschedules_audio_and_intentional_hold_is_allowed`.

Setup: 30fps에서 audio/visual drift 최대 1frame=8000tick. pause→seek→play 후 중복 source 없음. 2초 종결 hold에는 경고 없음, 역할 없는 저변화는 warning만. 음원 없는 프로젝트도 play 가능.

```ts
expect(Math.abs(audioTick - transportTick)).toBeLessThanOrEqual(8000);
expect(issues.some(i => i.code === 'HOLD_WITHOUT_ROLE')).toBe(false);
```

- [ ] **Step 2 — RED 확인:** `bun run test:integration -- tests/integration/transport-audio.test.ts && bun run test:unit -- tests/unit/score-lint.test.ts`. 기대 실패: 음원 position과 timeline이 갈라지거나 seek 후 이전 소리가 재생되거나 정지를 자동 오류로 판정하면 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** 오디오 재생 clock과 무음 clock을 transport 내부에서 교체, frame tick 주입. 파형·수동 accent/rest marker·gain/fade 편집, mute/solo. 읽기/변형 창의 구조적 충돌과 주체/보조층 타이밍을 경고하되 미감 자동 점수는 만들지 않는다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. 1.5초 cue fixture의 preview/export 오차, 10초 느린 긴장 opener의 intentional hold, dispose 후 source leak 검증.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "feat: synchronize transport audio and motion score checks"`. 무관한 파일은 포함하지 않는다.

## 단계 완료 게이트

T12–T15 통과. 한글·읽기 창·대표 강세·여섯 레시피·교차 인계, manual 채널 보존. 빠르지만 단조로운 경우와 느린 긴장을 별도로 비교한다.

STATE.json에 각 task 상태·실제 명령·exit code·artifact hash·미확인을 기록한다. 테스트 실패나 측정 미실시는 성공으로 바꾸지 않는다. 다음 단계는 의존 작업의 통과 증거를 소비한다.
