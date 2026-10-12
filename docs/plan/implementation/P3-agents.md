---
description: "Implement P3 of the unified motion SDK, external-agent toolchain, and visual editor with explicit interfaces and acceptance tests."
akmLayer: context
akmRole: operating-context
akmType: context
trustLevel: draft
sourceType: synthesis
date created: 2026-10-12
date modified: 2026-10-12
tags: [motion-graphics, implementation-plan]
---

# P3 — 외부 코딩 에이전트·스킬·온톨로지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax. 실행 상태는 .planning의 STATE.json을 따른다.

**Goal:** 외부 코딩 에이전트가 SDK·CLI·스킬로 제작하고 사람과 번갈아 같은 프로젝트를 수정한다.

**Architecture:** 공통 ProjectDocument·Motion IR·단일 evaluator를 React/HTML SDK, 로컬 CLI, 시각 편집기가 공유한다. AI 추론은 외부 코딩 에이전트가 담당한다.

**Tech Stack:** TypeScript·React·HTML/CSS/SVG·bun workspace·Node 24 계열·Chromium·FFmpeg·Vitest/Playwright. 최초 정확 버전은 T01에서 고정한다.

**Spec:** [[30-context/projects/motion-score-studio/plan]] · [[30-context/projects/motion-score-studio/implementation-plan]] · [[30-context/projects/motion-score-studio/implementation/contracts]].

## Global Constraints

전체 계획의 Global Constraints와 계약 C1–C8을 그대로 적용한다. 코드 루트는 `/Volumes/data/Dev/motiframe` 예정 경로다. 아래 Create/Modify는 이 계획을 순서대로 구현할 때의 상태이며 현재 파일이 있다는 뜻이 아니다. 파일 목록 밖의 workspace 설정 변경이 필요하면 해당 package 선언과 테스트를 같은 작업의 변경 범위에 기록한다.

## Review Focus

전체 계획의 다섯 실패 입력을 해당 담당 작업에서 검증한다. 이 단계의 완료 판단은 아래 명령·산출물로 하며 계획에 적힌 기대값은 실행 증거가 아니다. 테스트 snippet의 변수는 Setup fixture가 준비하고 production 함수를 호출해 얻은 결과다. Result의 value/error 접근은 `expectOk` 또는 ok assertion으로 먼저 타입을 좁힌다.

## T16 — 온톨로지 스냅샷·자산 경로 이식

**Depends on:** T07.

**Files:**
- Create: `packages/knowledge/src/schema.ts`, `packages/knowledge/src/import.ts`, `packages/knowledge/src/assets.ts`, `scripts/import-motion-knowledge.ts`, `packages/knowledge/package.json`.
- Test/fixture: `tests/unit/knowledge-import.test.ts`.

**Interfaces:** C7 importOntology(input,assetMap):Result<KnowledgeSnapshot>. 입력 정본은 AKM motion-ontology.json, assetMap은 root mapping/ID/hash. 실행 결과는 앱용 snapshot과 import report.

- [ ] **Step 1 — 검사 작성:** `legacy_ids_survive_and_external_assets_resolve`.

Setup: 2026-10-12 스냅샷의 590 nodes/943 relations와 31개 legacy image path를 fixture로 사용. 실제 importer는 개수 증가를 허용하고 fixture hash로 회귀 범위를 고정한다. hash 불일치와 없는 이미지의 status도 검사.

```ts
expect(snapshot.nodes).toHaveLength(590);
expect(report.resolvedImages).toBe(31);
```

- [ ] **Step 2 — RED 확인:** `bun run test:unit -- tests/unit/knowledge-import.test.ts`. 기대 실패: ID 재발급·관계 방향 변경·경로만 존재하고 다른 hash인 파일 수용·없는 이미지의 관찰 완료 표기로 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** T/C/S와 MR 개념 보존, 네 evidence class·scope·applyWhen·counterexample 유지. legacy 경로→외부 자산 매핑→hash 확인. 앱용 상대 asset ID로 정규화하고 원본 AKM은 쓰지 않는다. 출처에 남은 구 Jev 안내는 실행 지시로 가져오지 않는다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. snapshot hash·출처 버전·31개 경로 매핑·권리 상태 manifest. 실제 이미지 hash 불일치가 있으면 그 항목만 unavailable로 기록.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "feat: import evidence-scoped motion ontology"`. 무관한 파일은 포함하지 않는다.

## T17 — 개념 검색·참고 장면 카드·적용 기록

**Depends on:** T16, T12.

**Files:**
- Create: `packages/knowledge/src/query.ts`, `apps/editor/src/reference/ReferencePanel.tsx`, `apps/editor/src/reference/EvidenceCard.tsx`, `packages/document/src/reference-commands.ts`.
- Test/fixture: `tests/unit/knowledge-query.test.ts`, `tests/e2e/reference-panel.spec.ts`.

**Interfaces:** C7 queryKnowledge→EvidencePacket, C6 SetReference. queries는 concept ID·한국어 키워드·역할로 좁히고 대표 결과 limit≤3.

- [ ] **Step 1 — 검사 작성:** `slow_tension_query_preserves_evidence_limits`.

Setup: 느린 긴장(MR-TENSION), 빠르지만 단조(Rhythm), 한글 타입(T036/MR-READING) query fixture. 대표 이미지 없는 MR-SPEED/T036에도 빈 근거를 만들어내지 않음. packet 표준 limits enum으로 source 문구를 매핑.

```ts
expect(packet.candidates.length).toBeLessThanOrEqual(3);
expect(packet.candidates[0].limits).toContain('audio_unverified');
```

- [ ] **Step 2 — RED 확인:** `bun run test:unit -- tests/unit/knowledge-query.test.ts && bun run test:e2e -- tests/e2e/reference-panel.spec.ts`. 기대 실패: 카탈로그 목록을 직접 관찰로 표시하거나 대표장면이 없는 항목에 이미지를 붙이면 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** 정확 ID→lexical index→정의/적용 조건 순위의 로컬 조회. 카드에는 실제 장면·조건·반례·근거 종류·관찰 범위와 적용 버튼. 클릭하면 선택 phrase의 reference binding만 저장하고 원문 텍스트/형태를 바꾸지 않는다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. offline 조회, 이미지 누락 상태, 적용 구간 재열기, exported project의 근거 ID 보존.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "feat: browse and apply motion reference evidence"`. 무관한 파일은 포함하지 않는다.

## T18 — 외부 에이전트용 CLI·컨텍스트·명령 규격

**Depends on:** T17, T15.

**Files:**
- Create: `packages/automation/src/context.ts`, `packages/automation/src/protocol.ts`, `packages/automation/src/client.ts`, `apps/runner/src/commands/inspect.ts`, `apps/runner/src/commands/context.ts`, `apps/runner/src/commands/patch.ts`, `apps/runner/src/commands/knowledge.ts`, `apps/runner/src/commands/init.ts`, `apps/runner/src/commands/validate.ts`, `docs/cli.md`, `packages/automation/package.json`.
- Test/fixture: `tests/integration/automation-cli.test.ts`.

**Interfaces:** C8 AutomationContext/ChangeSet/CommandResponse. CLI `motiframe inspect/context/validate/patch/capture/render/knowledge --json`과 `getContext(doc,selection,evidence):AutomationContext`, `validateChangeSet(doc,change):Result<EditTransaction>`를 노출한다. 입력은 --file 또는 stdin JSON이며 문서 본문을 shell 문자열에 삽입하지 않는다.

- [ ] **Step 1 — 검사 작성:** `external_agent_reads_scoped_context_and_submits_atomic_patch`.

Setup: 60초 문서에서 1–3초 선택과 인접 handoff, manual/locked 채널·안정 target ID·references만 context 출력. patch --dry-run은 무변경; 같은 파일의 patch는 revision을 정확히 1회 증가. malformed JSON/unknown protocol/repeated requestId 검사.

```ts
expect(context.scope.range).toEqual({start:240000,end:720000});
expect(dryRun.documentRevision).toBe(beforeRevision);
expect(applied.documentRevision).toBe(beforeRevision + 1);
```

- [ ] **Step 2 — RED 확인:** `bun run test:integration -- tests/integration/automation-cli.test.ts`. 기대 실패: 설명 로그가 JSON stdout을 오염시키거나 scope 밖 쓰기·dry-run mutation·API 키 요구·불명확한 exit code로 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** protocolVersion=1, stdout JSON·stderr 진단·명시 exit code. 선택·고정 조건은 UI에서 저장한 selection context 또는 CLI 인자로 받는다. 에이전트의 모델·인증·추론은 외부 도구 소관이며 프로그램에 LLM client를 넣지 않는다. 기존 render/capture에 machine response를 추가하고 ontology 질의도 같은 CLI에 노출한다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. 외부 프로세스에서 context→validate→dry-run→patch→capture→render를 호출한 transcript. 프로그램 모델 설정이나 API 자격 증명 없이 전체 실행.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "feat: expose motion automation through a versioned CLI"`. 무관한 파일은 포함하지 않는다.

## T19 — 코딩 에이전트↔타임라인 동기화·충돌·되돌리기

**Depends on:** T18.

**Files:**
- Create: `packages/automation/src/apply.ts`, `packages/automation/src/variants.ts`, `apps/editor/src/changes/ChangesPanel.tsx`.
- Modify: `apps/runner/src/document-service.ts`, `apps/editor/src/state/project-store.ts`.
- Test/fixture: `tests/unit/automation-guards.test.ts`, `tests/e2e/external-edit-cycle.spec.ts`.

**Interfaces:** C8 applyChangeSet→C6 DocumentService.submit, createVariant(doc,tx):Result<Variant>. UI는 변경 diff·선택·잠금·이력·비교를 보여주며 에이전트 채팅이나 모델을 실행하지 않는다.

- [ ] **Step 1 — 검사 작성:** `external_generate_manual_edit_partial_agent_edit_undo`.

Setup: 외부 CLI가 10초 초안 생성→사용자 0–2초 잠금·색 변경→에이전트가 최신 context 재조회→4–6초 리듬 수정→UI undo. 동시에 오래된 revision 제출, 접속 끊김/재전송, CLI/UI 동시 저장을 재현.

```ts
expect(stale.error.code).toBe('REVISION_CONFLICT');
expect(projectContentHash(afterUndo)).toBe(beforeAgentHash);
```

- [ ] **Step 2 — RED 확인:** `bun run test:unit -- tests/unit/automation-guards.test.ts && bun run test:e2e -- tests/e2e/external-edit-cycle.spec.ts`. 기대 실패: 타임라인의 수동 변경 소실·오래된 patch 적용·중복 commit·두 writer 경쟁·한 번 undo로 복원되지 않으면 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** tx id idempotency·baseRevision·scope·locks·channel ownership 전수 검사. 적용이 허용된 patch는 추가 AI 승인 없이 공통 명령을 사용한다. 충돌은 최신 revision과 diff로 반환해 외부 에이전트가 재계획하게 한다. 소스 파일 watcher는 definition candidate만 생성하고 실행 중인 문서를 직접 덮지 않는다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. 두 별도 프로세스의 이벤트 순서·revision·before/after hash·UI 갱신·undo 증거. 앱을 닫은 상태의 CLI 작업 후 재열기도 검증.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "feat: synchronize external agent edits with the timeline"`. 무관한 파일은 포함하지 않는다.

## T20 — SDK·모션리듬 스킬·예제의 에이전트 배포 묶음

**Depends on:** T19, T11.

**Files:**
- Create: `skills/motiframe/SKILL.md`, `skills/motiframe/references/authoring.md`, `skills/motiframe/references/motion-rhythm.md`, `skills/motiframe/references/review.md`, `packages/automation/src/definition-change.ts`, `apps/runner/src/commands/element.ts`, `apps/runner/src/commands/kit.ts`, `examples/react-keywords/src.tsx`, `examples/html-reveal/template.html`, `scripts/check-agent-kit.ts`, `docs/agent-setup.md`.
- Test/fixture: `tests/integration/agent-kit.test.ts`.

**Interfaces:** C3 SDK + C8 CLI. `motiframe element build/register --file <manifest> --json`은 DefinitionChange={source,baseDefinitionRevision,testCases}를 검증한다. `validateDefinitionChange(change):Result<DefinitionSource>`; `motiframe kit export --output <dir>`는 문서·스킬·schema·예제를 버전 manifest와 함께 묶는다.

- [ ] **Step 1 — 검사 작성:** `agent_kit_builds_editable_react_and_html_without_embedded_ai`.

Setup: 스킬을 읽은 외부 코딩 에이전트가 React 키워드 요소와 HTML 가림 요소를 각각 작성→등록→수동 타임라인 변경→CLI 부분 수정→출력. 자동 suite는 예제 소스와 잘못된 import/target/schema/loop fixtures를 검증하며 실제 에이전트 작업과 구분.

```ts
expect(reactArtifact.manifest.targets.length).toBeGreaterThan(0);
expect(rejectedImport.error.code).toBe('UNSUPPORTED_IMPORT');
expect(kit.requiredModelProviders).toEqual([]);
```

- [ ] **Step 2 — RED 확인:** `bun run test:integration -- tests/integration/agent-kit.test.ts`. 기대 실패: 스킬이 설치된 특정 절대경로에 의존·허위 편집 target·소스를 editor/Node에서 실행·React/HTML 중 한쪽만 작성 가능한 경우 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** 전용 새 프로그래밍 언어/parser 없이 TypeScript SDK·HTML data attribute·JSON Schema를 모션 작성 문법으로 제공한다. 스킬은 brief→근거 최대3개→악보→작성→validate/capture→재생 검수→부분수정으로 안내한다. motion-rhythm의 속도·텐션·리듬·주행동·읽기/인계 규칙을 버전·출처가 있는 자체 참조로 제공하여 원본 스킬이 없어도 사용 가능하게 한다. 설치된 motion-rhythm을 함께 쓰는 연결 규칙도 명시한다. 자동 전역 설치·외부 전달·임의 의존성 설치는 하지 않는다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. 최소 한 실제 코딩 에이전트의 처음부터 완주한 작업, 두 번째 호스트의 스킬 발견/CLI 호환 확인은 별도 기록. 미검증 호스트 호환성을 주장하지 않는다. 단위 테스트만으로 에이전트 사용성 완료 처리하지 않는다.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "feat: ship an agent authoring kit for motion projects"`. 무관한 파일은 포함하지 않는다.

## T21 — 공통 A/B 비교·축별 검수·에이전트용 리포트

**Depends on:** T20.

**Files:**
- Create: `apps/editor/src/review/CompareView.tsx`, `apps/editor/src/review/QualityPanel.tsx`, `packages/core/src/review/report.ts`, `packages/document/src/review-storage.ts`, `apps/runner/src/commands/review.ts`.
- Test/fixture: `tests/e2e/motion-review.spec.ts`.

**Interfaces:** C8 Variant/QualityReport. variant는 immutable base revision을 참조하고 같은 tick/scale/audio mode로 재생한다. 평가 저장은 프로젝트 내부 candidate이며 AKM 정본 자동 변경 없음.

- [ ] **Step 1 — 검사 작성:** `comparison_syncs_time_without_claiming_unobserved_quality`.

Setup: 수정 전후 같은 1.5초 frame과 같은 phrase 재생; 무음/유음 모드. 프레임 자동 검사만 끝난 경우 perception은 unverified. 사용자 확인 후에만 그 관찰 범위를 저장.

```ts
expect(leftReceipt.tick).toBe(rightReceipt.tick);
expect(report.perception.status).toBe('unverified');
```

- [ ] **Step 2 — RED 확인:** `bun run test:e2e -- tests/e2e/motion-review.spec.ts`. 기대 실패: 다른 revision/시점으로 비교하거나 renderer pass를 리듬 통과로 표시하면 실패.
- [ ] **Step 3 — 위 인터페이스 구현:** 의도→실제 구간→유지/수정/미검증, 기술/안무/체감 세 구획. reading/transform/texture 역할을 고려한 issue 링크. 사용자 피드백·적용 recipe·reference ID를 candidate로 저장하고 명시 export만 제공. `motiframe review --json`은 동일 리포트를 외부 에이전트에 반환한다. capture/contact-sheet 결과와 실제 연속 재생·청취 확인은 다른 증거로 유지한다.
- [ ] **Step 4 — GREEN 확인:** 같은 검사 명령과 `bun run check`가 exit 0. 빠른데 단조롭다/느린 긴장/과감한 한글의 세 비교 케이스로 잘못된 전역 배속·강제 정착 추천을 검수.
- [ ] **Step 5 — 변경 검토·commit:** 위 Files의 변경과 검증 증거를 검토하고 정확한 변경 파일만 stage하여 `git commit -m "feat: compare motion variants and preserve review evidence"`. 무관한 파일은 포함하지 않는다.

## 단계 완료 게이트

T16–T21 통과. ontology ID·scope 보존, CLI→UI→CLI 실제 왕복·충돌·undo, React/HTML 코드 작성·A/B 검수. 프로그램 내부 모델/API 키 없이 실제 에이전트 1종이 스킬로 완주한다.

STATE.json에 각 task 상태·실제 명령·exit code·artifact hash·미확인을 기록한다. 테스트 실패나 측정 미실시는 성공으로 바꾸지 않는다. 다음 단계는 의존 작업의 통과 증거를 소비한다.
