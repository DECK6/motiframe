---
description: "Execute the unified React and HTML motion editor through five phases and twenty-five independently verifiable implementation tasks."
akmLayer: context
akmRole: operating-context
akmType: context
trustLevel: draft
sourceType: synthesis
date created: 2026-10-12
date modified: 2026-10-12
tags: [motion-graphics, implementation-plan]
---

# MotiFrame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax. 사용자가 전체 구현을 승인했다. 외부 게시·배포는 별도 범위다.

**Goal:** React와 HTML로 만든 영상 요소를 하나의 모션 코어에서 구성하고, 외부 코딩 에이전트와 사람이 같은 프로젝트를 편집하는 OS 독립 SDK·CLI·스킬·타임라인 프로그램을 만든다.

**Architecture:** React/HTML의 요소 정의를 공통 Motion Element 계약에 등록한다. 프로젝트의 인스턴스·악보·키프레임을 단일 시간 평가기로 계산하고, 하나의 격리 stage에서 합성한다. 외부 코딩 에이전트는 SDK로 요소를 작성하고 CLI로 검사·수정·출력하며, 웹 편집기와 로컬 실행기는 같은 런타임·프로젝트 문서를 공유한다. 모델 실행·채팅·인증은 외부 에이전트 도구가 담당한다.

**Tech Stack:** TypeScript, React, HTML/CSS/SVG, bun workspace, Vite, Zod, esbuild, puppeteer-core, 고정 Chromium, FFmpeg/ffprobe, Vitest·Playwright. 실행기는 Node.js 24 LTS 계열을 기준으로 한다. 실제 patch 버전은 T01에서 공식 배포와 호환성을 확인해 lockfile·runtime-lock.json에 고정한다.

**Spec:** [[30-context/projects/motion-score-studio/plan]].
**Contracts:** [[30-context/projects/motion-score-studio/implementation/contracts]].
**Code root:** `/Volumes/data/Dev/motiframe` — 현재 존재하지 않으며 구현 시작 시 생성할 예정 경로.

**제품명 확정:** 모티프레임(MotiFrame). 시각 편집기는 MotiFrame Studio, 라이브러리는 MotiFrame SDK, 명령은 `motiframe`, 제작 스킬은 MotiFrame Skill(`skills/motiframe/SKILL.md`)로 표기한다. 사용자 명명 결정일: 2026-10-12.

## Global Constraints

- “React와 HTML의 통합은 첫 버전의 필수 조건이다.” React를 편집 UI에만 사용하는 것으로 통과하지 않는다.
- **사용자 확정:** AI 작업은 외부 코딩 에이전트가 수행한다. 프로그램 안에 LLM 공급자·채팅·모델 인증을 구현하지 않는다.
- 모션 작성 문법은 TypeScript SDK·HTML data attribute·JSON Schema로 제공한다. 새 언어/parser는 첫 버전에서 만들지 않는다.
- “AI 없이도 프로젝트 열기, 수동 편집, 저장, 로컬 렌더가 가능해야 한다.”
- “속도·텐션·리듬을 각각 설계”하며 하나의 에너지 점수로 합치지 않는다.
- “첫 지원 목표: Windows·macOS·Linux의 최신 안정 Chrome/Edge 데스크톱.”
- 16:9·9:16·1:1, 1080p, 24/30/60fps를 첫 출력 검증 범위로 한다.
- “Project Document가 인스턴스·타이밍·키프레임·악보의 정본”이고 소스 정의는 별도 revision으로 관리한다.
- 기본 편집은 선택 범위·전체 길이 유지. ripple·수동 소유권 반환은 명시적 동작이다.
- 프로세스 wall clock, CSS autoplay, React effect가 독립적인 애니메이션 시계를 소유하지 않는다.
- 로컬 자산과 폰트는 manifest/hash로 관리한다. 사용자 절대경로·API 자격 증명은 포터블 프로젝트에 넣지 않는다.
- AKM 원본·10-sources는 읽기 전용. 생성 자산은 코드 프로젝트 작업 폴더, 계획·개발 기록은 AKM 정본에 둔다.
- 첫 버전은 2D/2.5D. 실제 3D·입자·가변 speed ramp·.aep 전체 호환·기존 프로젝트 무손실 변환은 M2 이후다.
- 아래 테스트 명령은 **구현 시 만들고 실행할 계약**이며 현재 실행 완료 증거가 아니다.

## Review Focus

| 입력/실패 | 기대 동작 | 담당 작업 |
|---|---|---|
| React 배열 reorder와 HTML 가림의 중첩 | 안정 ID·레이어 순서·키프레임 대상 유지 | T03, T11 |
| VFR·회전 metadata·지연 디코드·폰트 누락 | 잘못된 프레임을 출력하지 않고 정규화/대기/오류 표시 | T04, T07 |
| 한글 NFD·NFC·emoji·문장 교체 | grapheme 보존, 바뀐 글자에 이전 키프레임을 오배정하지 않음 | T13 |
| AI 응답 중 수동 편집·잠금·취소 | 오래된 제안 거절, 단일 undo, 잠금 보존 | T06, T19 |
| 디스크 부족·실행기 충돌·경로 이동·archive traversal | 이전 저장 보존, 재연결·복구, 승인 폴더 밖 쓰기 거절 | T07, T24 |

## 단계와 산출물

| 단계 | 작업 | 끝나면 실제로 가능한 것 | 완료 게이트 |
|---|---|---|---|
| [P0 통합 코어](implementation/P0-core.md) | T01–T05 | React 키워드 → HTML/SVG 가림 → 영상의 6초 프레이즈를 seek·저장·출력 | 180프레임·6초·오디오, 역순 seek, 격리 종료/복구, 3 OS smoke |
| [P1 편집기](implementation/P1-editor.md) | T06–T11 | 혼합 요소·영상·오디오를 직접 배치·트림·곡선 편집하고 프로젝트 재열기 | 수동 15초 제작, undo/redo, 자산 이동·소스 revision 보존 |
| [P2 모션리듬](implementation/P2-motion.md) | T12–T15 | 프레이즈·세 축·한글 타입·인계·사운드 강세를 함께 편집 | 악보 변화가 렌더에 반영되고 읽기·수동 채널 유지 |
| [P3 에이전트·온톨로지](implementation/P3-agents.md) | T16–T21 | 근거 장면을 보고 생성→수동 수정→부분 AI 수정→비교 | 외부 에이전트 실제 완주, CLI↔UI 충돌/undo, evidence 범위 유지 |
| [P4 배포·검증](implementation/P4-release.md) | T22–T25 | 세 OS에서 설치·작업·복구·최종 출력 | 성능 fixture, 설치·이동·재생 검수, 릴리스 후보 |

P0→P1→P2→P3→P4 순서를 기본으로 한다. 온톨로지 수입 T16은 T07 이후, 장면 적용 T17은 T12 이후에 진행할 수 있으며 에이전트의 악보 편집은 P2의 명령·소유권 계약이 필요하다. T01부터 최소 SDK·CLI 예제를 제공하며 P3는 그 공개 계약·스킬·반복 편집을 완성하는 단계다. 실제 위임 여부와 무관하게 의존성을 따른다.

## 외부 코딩 에이전트와 프로그램의 작업 흐름

```text
사용자 → 외부 코딩 에이전트 + motiframe/motion-rhythm 스킬
       → TypeScript·React 또는 HTML·CSS·SVG 요소 작성
       → motiframe context / knowledge / validate / patch / capture / render
       → 공통 프로젝트 문서·모션 런타임
       ↔ 사람이 쓰는 캔버스·타임라인·곡선 편집기
```

외부 에이전트는 추론과 코드를 만들고 프로그램은 상태·편집·렌더를 담당한다. 에이전트가 GUI 클릭을 흉내 내거나 완성 영상을 보내는 방식으로 통합을 대신하지 않는다. 사람과 에이전트가 같은 안정 ID·revision·잠금·undo 이력을 사용한다. CLI의 JSON 출력은 어떤 모델 공급자에도 의존하지 않는다. MCP는 이 CLI에 얇게 연결할 수 있는 후속 어댑터로 남긴다.

## 구현 폴더 구조

```text
apps/
  editor/src/          화면·타임라인·속성·변경 이력·참고·비교 패널
  runner/src/          로컬 API·작업·캡처·인코딩·실행기
packages/
  document/src/        스키마·명령·undo·저장·프로젝트 묶음
  core/src/            시간·곡선·컴파일·평가·악보·인계
  authoring/src/       React/HTML SDK·manifest·소스 build·revision
  stage/src/           단일 DOM 합성·frame barrier·자산 준비
  media/src/           probe·proxy·프레임·오디오·파형
  knowledge/src/       온톨로지 import·검색·근거 패킷
  automation/src/      CLI 계약·컨텍스트·변경 검증·동기화
skills/motiframe/   코딩 에이전트용 제작·모션리듬·검수 안내
examples/              편집 가능한 React·HTML 작성 예제
tests/
  fixtures/           P0·한글·VFR·오류 입력, 라이선스 있는 폰트
  unit/                순수 함수·문서·명령·스키마
  integration/         stage·미디어·저장·실행기
  e2e/                 사용자 제작 흐름
scripts/               fixture 생성·품질/성능·배포 검사
docs/                  SDK·설치·문제 해결·ADR
.planning/M1/P0..P4/    단계 PLAN과 단일 STATE.json
```

처음부터 모든 폴더를 빈 패키지로 만들지 않는다. 각 작업이 실제 필요한 패키지·설정·문서를 함께 추가한다. 아래 단계 문서의 Files가 실제 변경 범위다.

## 테스트와 실행 명령 계약

T01에서 root scripts를 정의한다. `bun run test:unit -- <path>`는 Vitest run, `test:integration`은 실제 런타임/미디어 통합, `test:e2e`는 저장소 Playwright suite다. `bun run check`는 typecheck·lint, `bun run build`는 editor·stage·runner 산출물을 만든다. 예제 제작/렌더는 `bun run motiframe -- render <project> --output <path>`로 노출한다. 스크립트 인자 전달은 Windows에서도 같은 형태로 작동해야 한다.

모든 작업은 ① 지정 회귀 검사를 작성 ② 의도한 이유로 RED 확인 ③ 명시한 인터페이스 구현 ④ 동일 검사 GREEN·check·영향 통합 검사 ⑤ 변경 범위를 검토하고 국소 commit의 순서다. 현재 계획 작성 중에는 commit이나 구현을 하지 않는다. 테스트 하네스/fixture 자체 실패는 제품의 올바른 RED로 세지 않는다.

브라우저 직접 검수는 T3 preview가 있으면 이를 우선 사용한다. 저장소 자동 회귀 검사에 사용하는 Playwright와 제품 렌더러의 Chromium은 각각 별도 책임이다.

## 실행 상태·검증 기록

계획은 AKM에 보존한다. 구현 저장소를 만들 때 설계·계약·단계 문서의 필요한 실행용 사본을 `docs/superpowers/`와 `.planning/`에 옮긴다. **기계 상태의 정본은 한 곳만 유지**한다. 전환 시 AKM run의 기존 STATE.json을 상태 정본으로 계속 갱신하지 않고 저장소 STATE 경로를 가리키는 이전 완료 포인터로 남긴다.

각 단계 STATE에는 schema_version, milestone, phase, gate, status, owner_runtime, acceptance_criteria, evidence, updated_at을 둔다. evidence는 명령·exit code·artifact/hash·측정 환경이며 작업자의 주장으로 대신하지 않는다. 각 완료 단계에 검증 기록과 AKM devlog를 연결한다.

마지막 품질 단계에서만 릴리스 후보를 만들며 외부 게시·유료 서비스 연결은 그때의 사용자 지시 범위를 따른다. 미검증 OS/미감/오디오를 완료로 표시하지 않는다.

## 구체화한 기술 결정

- **첫 렌더 구현:** 자체 stage → puppeteer-core/고정 Chromium 프레임 캡처 → FFmpeg. 기존 HyperFrames 내부 hook 적합성을 초기 작업의 의존성으로 두지 않는다. HyperFrames의 HTML·seek 설계 장점은 공통 코어에 반영하며, 하부 코드 재사용은 같은 출력 계약을 통과하는 후속 최적화로 평가한다.
- React frame 반영은 layout commit token의 ACK를 기다린다. 무조건 매 프레임 flushSync를 호출하는 방식으로 시작하지 않는다. [React 문서](https://react.dev/reference/react-dom/flushSync)는 그 호출의 성능 비용과 제약을 설명한다.
- Chromium screenshot은 프레임 준비 완료 뒤 호출한다. screenshot 자체가 폰트·미디어·React 준비를 보장한다고 가정하지 않는다. [Puppeteer API](https://pptr.dev/api/puppeteer.page.screenshot).
- 로컬 실행기는 [Node.js LTS](https://nodejs.org/en/about/previous-releases) 기준으로 고정한다. 사용자가 bun/Node를 별도 설치해야 하는 배포를 최종 설치 경험으로 삼지 않는다.

이 구현 결정은 설계의 열린 선택을 채운 제안이며, 사용자 요구를 새로 추가한 것으로 기록하지 않는다.
