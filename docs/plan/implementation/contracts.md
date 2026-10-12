---
description: "Define the shared time, project, authoring, stage, media, transaction, ontology, and AI contracts used by every implementation phase."
akmLayer: context
akmRole: operating-context
akmType: context
trustLevel: draft
sourceType: synthesis
date created: 2026-10-12
date modified: 2026-10-12
tags: [motion-graphics, implementation-plan]
---

# 구현 공통 계약

이 문서는 [[30-context/projects/motion-score-studio/implementation-plan]]의 공통 타입·소유권·단위 정의다. 아래 API는 앞으로 만들 자체 인터페이스이며 기존 제품의 API가 아니다.

## C1 — 시간과 결과

- `Tick`은 음이 아닌 safe integer, `TICKS_PER_SECOND = 240000`. 출력 FPS는 `{num:24|30|60, den:1}`. 원본 미디어 timebase는 별도 유리수다.
- 30fps의 frame 45는 360000 tick=1.5초. 48kHz audio sample 1은 5tick. 시작은 inclusive, 끝은 exclusive이며 duration 6초/30fps는 정확히 180프레임이다.
- 임의 FPS 분모·소수 tick을 무단 반올림하지 않는다. 문서 출력 FPS의 지원 범위를 검증한다.
- `Result<T> = {ok:true,value:T} | {ok:false,error:{code:string,message:string,ids:string[]}}`. 예외성 IO 실패도 public API 경계에서 이 결과로 정규화한다. Abort는 `CANCELLED`.
- `FrameContext = {tick:Tick, frame:number, fps:FrameRate, seed:number, frameToken:string, documentRevision:number}`.
- `TickRange = {start:Tick,end:Tick}`, `JsonValue`는 표준 JSON 값. 모든 아래 테스트 fixture는 명시적인 ID·seed·폰트·시간을 갖는다.

## C2 — 문서와 Motion IR

`packages/document/src/schema.ts`에서 Zod runtime schema와 TS 타입을 함께 정의한다. `ProjectDocument`의 필수 필드:

| 필드 | 내용 |
|---|---|
| schemaVersion, id, revision | 최초 schemaVersion=1, 안정 project ID, 단조 증가 revision |
| settings | width/height, fps, duration:Tick, ticksPerSecond=240000, seed, colorSpace='srgb', sampleRate=48000 |
| definitions | definitionId→{revision,kind:'react'|'html',moduleHash,propsSchema,targets,slots,assets} |
| scenes | sceneId→{start,duration,rootIds}; 첫 버전 scene은 같은 project FPS를 사용 |
| instances | instanceId→{definitionId,definitionRevision,parentId,slotId,trackId,start,duration,props,locked} |
| tracks | 배열 순서가 합성 순서; track에는 id/kind/instanceIds/locked/muted |
| channels | target 주소→{owner:'manual'|'recipe',recipeId?,locked,keys}; 키는 {id,at,value,interpolation} |
| assets | assetId→{sha256,kind,logicalPath,mediaMetadata,fontMetadata?}; 절대경로 별도 로컬 매핑 |
| mediaClips | instanceId→{assetId,sourceIn:Tick,sourceOut:Tick,rate:{num,den},gain}; 원본 timestamp와 proxy map 별도 |
| score | phrases/events/windows/tensions/handoffs, 초기 빈 집합 |
| references | snapshotHash, concept/case/scene IDs와 appliedRange |
| provenance | 사용한 runtime·SDK 버전과 definition 소스 목록, 비밀값 없음 |

`TargetAddress={instanceId,targetKey,channel}`. targetKey는 사용자 데이터의 안정 key에서 생성하며 배열 index를 안정 ID로 쓰지 않는다. 여러 instance가 같은 definition을 사용해도 주소는 분리된다. 키프레임 at은 instance-local tick, score event는 project-global tick이며 timelineToLocal을 통해 변환한다.

수치 채널: x/y/z(px), rotateX/Y/Z(deg), scaleX/Y, opacity(0..1), perspective(px), clip progress(0..1), text selector(0..1), audio gain(선형). 문자열·enum props의 시간 변경은 hold만 허용한다. 보간은 hold/linear 또는 시간·값 좌표의 parametric cubic control points를 사용한다. 시간 축 x는 단조여야 하며 값 control points는 overshoot와 동일 endpoint의 움직임을 표현할 수 있다. 값 곡선의 derivative와 최종 투영에서 측정한 화면 속도는 UI에서 다른 값으로 표시한다.

`compileProject(doc, registry):Result<MotionIR>`; MotionIR={documentRevision,duration,instances,channels,assets,score}. 모듈 소스는 포함하지 않고 hash/revision 참조를 갖는다. `evaluateFrame(ir,ctx):Result<FramePlan>`; FramePlan={frameToken,documentRevision,tick,instances,channelValues,mediaRequests}. DOM에 의존하지 않는 순수 함수다.

## C3 — React/HTML 작성·합성

`ElementManifest={id,revision,kind,propsSchema,targets:TargetSpec[],slots:SlotSpec[],assets:string[]}`. `TargetSpec={key,channels:string[],coordinateSpace:'local'}`; `SlotSpec={id}`. propsSchema는 JSON Schema의 제한된 타입(object/string/number/boolean/array/enum/default)으로 시작한다.

- React SDK: `defineReactElement(manifest, Component):ElementDefinition`. Component에는 {props:JsonValue,frame:FrameContext} 전달. SDK의 MotionTarget·MotionSlot으로 편집 대상을 등록한다.
- HTML SDK: `defineHtmlElement(manifest,{html,css,bindings}):ElementDefinition`. 안정 data-motion-target/slot과 명시한 text/attribute/style binding만 허용한다. HTML 자체를 JSX로 변환하지 않는다.
- `buildDefinition(source:DefinitionSource):Promise<Result<DefinitionArtifact>>`; source={manifest,files:Record<relativePath,string>}, artifact={manifest,moduleHash,bundlePath,diagnostics}.
- `reconcileDefinition(doc,oldRef,newArtifact):Result<{document,orphanTargets,migrationRequired}>`. 대상 변경이 미해결이면 새 버전을 적용하지 않는다.
- 등록되지 않은 임의 내부 DOM은 inspector가 추측해 제어하지 않는다. stage wrapper는 모션 채널, 작성 모듈은 내용·구조를 소유한다.
- 자식은 host slot registry를 통해 삽입한다. React/HTML 혼합 전체가 한 stage 문서에서 합성된다. 2.5D transform은 공통 wrapper/부모 matrix를 따른다.
- 첫 React 작성 계약은 렌더가 frame/props에 대해 결정적이어야 한다. wall-clock·network·임의 effect 기반 상태 갱신은 지원하지 않는다. 비동기 자산은 렌더 전 브로커로 준비한다.

## C4 — stage와 실행기

`StagePort.load(ir,definitionArtifacts):Promise<Result<void>>`.
`StagePort.renderFrame(plan,signal):Promise<Result<FrameReceipt>>`.
`FrameReceipt={frameToken,documentRevision,tick,ready:true,targetBounds:Record<string,Rect>,warnings:string[]}`.
`StagePort.dispose():Promise<void>`.

순서: props/frame 전달 → React commit ACK/HTML 적용 → 등록 대상 확인 → 자산·font·media ready → 공통 채널 적용 → layout 확인 → 동일 token receipt. 늦게 도착한 다른 token의 ACK는 폐기한다. 빈 fallback이나 이전 video frame은 ready로 세지 않는다.

에디터는 stage와 다른 origin/context에 있다. 로컬 export·사용자 코드 미리보기는 실행기가 별도 Chromium 프로세스로 관리한다. 기본 내장 요소는 브라우저 격리 stage도 가능하되 동일 계약을 사용한다. 코드 stage가 멈춰도 타임라인 UI와 취소가 살아 있는지 T05로 검증한다. 임의 모듈이 편집기 프로세스 안에서 실행되는 fallback은 없다.

`RenderRequest={projectId,revision,range,format:'mp4'|'png-sequence',outputPath}`.
`startRender(request):Promise<Result<{jobId:string}>>`.
`cancelRender(jobId):Promise<Result<void>>`.
job states: queued→preparing→rendering→encoding→completed | failed | cancelled.
`RenderManifest={revision,runtimeHashes,frames,fps,durationTicks,assetsHash,outputHash,warnings}`.

- 최초 stage 준비 제한 30초, warm frame 제한 2초, 취소 후 자식 프로세스 종료 목표 1초. 숫자는 제품 설계 기본값이며 P0 측정 후 변경 시 ADR·fixture를 함께 갱신한다.
- server는 loopback에만 bind. editor 연결은 session token + origin 검사, stage는 일회성 최소 자산 권한만 받는다. 원본 path·키·CDP endpoint를 stage에 전달하지 않는다.
- source build는 browser target·고정 vendor allowlist·plugin 없음. 소스를 Node에서 import 실행하지 않는다. network/file URL·팝업·다운로드를 차단하고 자산 hash 경로만 허용한다. shell은 문자열 명령 합성 대신 argv 배열로 호출한다.
- Node process 분리나 iframe 하나만을 보안 sandbox로 간주하지 않는다. Chromium sandbox를 유지하고 `--no-sandbox`로 오류를 덮지 않는다.

## C5 — 미디어와 포터블 프로젝트

`probeAsset(file):Promise<Result<AssetMetadata>>`; asset metadata에는 duration, streams, dimensions, rotation, fps/timebase, VFR 판별 결과.
`prepareAsset(file,options):Promise<Result<PreparedAsset>>`; prepared={asset,proxy,sourceToProxyMap,waveform,thumbnails}.
`getSourceTick(clip,timelineTick):Result<Tick>`.
`decodeFrame(assetId,sourceTick,signal):Promise<Result<DecodedFrame>>`; DecodedFrame={pts,sourceTimebase,bitmap}.
`mixAudio(doc,range):Promise<Result<AudioArtifact>>`; 결과는 48kHz WAV와 시작·끝 tick metadata.

P0 테스트 원본은 프로그램으로 만든 CFR 영상·WAV·OFL 한글 폰트다. P1에서 VFR·회전·기본 codec 검증을 추가한다. export는 소스 PTS 기반 디코더를 사용하고 미리보기 proxy에도 원본 시간 매핑을 유지한다. 음악 재생 clock은 transport master를 따르며 오디오가 없으면 monotonic 재생 clock에서 정수 tick을 산출한다. frame evaluator 자체는 이 clock과 독립이다.

`saveProject(doc,path):Promise<Result<void>>`, `loadProject(path):Promise<Result<ProjectDocument>>`.
`packProject(doc,selection):Promise<Result<BundleArtifact>>`, `unpackProject(bundle,destination):Promise<Result<ProjectDocument>>`.
bundle은 `.motionproj` ZIP: project.json, definitions, dependency lock, assets, manifest/hashes. working cache·API 키·사용자 절대경로 제외. 외부참조 모드는 missing/relink를 명시한다. manifest 경계 밖 상대경로·symlink·과도한 확장 크기·hash 불일치를 거절한다.

## C6 — 편집과 이력

`EditCommand`: AddInstance, RemoveInstance, MoveInstance, TrimClip, SplitClip, DuplicateInstance, ReorderTrack, SetProps, SetKeyframe, RemoveKeyframe, SetLock, SetChannelOwner, UpdateScore, SetReference. 각 명령은 stable ID·값·필요 사전조건만 가진 JSON union이다.
`EditTransaction={id,baseRevision,author:'user'|'agent'|'recipe',scope:EditScope,commands:EditCommand[]}`.
`EditScope={instanceIds:string[],range:TickRange,preserveDuration:boolean,ripple:boolean}`.
`applyTransaction(doc,tx):Result<{document,inverse,affectedIds}>`는 원문을 바꾸지 않는 atomic 연산이다.
`undo(state):Result<HistoryState>`, `redo(state):Result<HistoryState>`; HistoryState={document,past,future}. undo도 revision은 증가한다. 콘텐츠 복원은 `projectContentHash`로 비교하고 revision/audit 제외를 명시한다.
dry-run과 최종 적용은 같은 검증 함수 사용. 잠금·범위·revision·부모 cycle·음수 길이·키프레임 고아 여부를 모두 먼저 확인한다.

## C7 — 악보·지식

Phrase={id,range,primaryActor,eventIds}; Event={id,phraseId,kind:'onset'|'arrival'|'response'|'accent'|'rest'|'prepare'|'release',tick,targetIds}; RoleWindow={id,range,targetIds,role:'reading'|'transform'|'texture'|'tension'|'closure'}.
TensionIntent={id,cueEvent,unresolvedState,releaseEvent?,intentionalUnresolvedEnd:boolean}; Handoff={id,fromTarget,toTarget,at,mode:'match-cut'|'continuous',preserve:('position'|'direction'|'shape'|'meaning')[]}.
`compileScore(doc):Result<EditTransaction>`는 recipe 소유 채널만 변경한다. 수동/locked 충돌은 `OWNERSHIP_CONFLICT`.
`planPhrase(doc,request:PhraseRequest):Result<EditTransaction>`, PhraseRequest={range,grammar,actorIds,events,windows,handoffs}; 임의 내용 추가 금지.

`importOntology(input,assetMap):Result<KnowledgeSnapshot>`; Snapshot={hash,nodes,relations,assets,issues}.
`queryKnowledge(snapshot,query:KnowledgeQuery):EvidencePacket`; query={conceptIds,text,limit}, limit≤3; Packet={snapshotHash,candidates:[{conceptId,definition,applyWhen,counterexamples,caseIds,sceneIds,images,evidenceClasses,limits}]}.
이미지는 참조와 실제 관찰이 다르며 candidate card에 둘을 구분한다.

## C8 — 외부 에이전트·CLI·상태 동기화

프로그램은 모델을 호출하지 않는다. 코딩 에이전트가 스킬·SDK·CLI를 사용하며 모델 선택·추론·자격 증명은 에이전트 호스트의 책임이다.

`AutomationContext={protocolVersion:1,documentRevision,scope,locks,selectedContent,neighbourHandoffs,skillVersion,evidence}`.
`ChangeSet={protocolVersion:1,requestId,baseRevision,transaction,explanation,evidenceRefs}`.
`DefinitionChange={source,baseDefinitionRevision,testCases}`.
`validateChangeSet(doc,change):Result<EditTransaction>`는 명령을 전수 검사한다.
`applyChangeSet(change):Promise<Result<CommitReceipt>>`; CommitReceipt={requestId,documentRevision,affectedIds,contentHash}.
`getContext(doc,selection,evidence):AutomationContext`.
`createVariant(doc,tx):Result<Variant>`; Variant={id,baseRevision,document,label}; variant 생성만으로 본 작업을 갱신하지 않는다.

명령군: `motiframe init/inspect/context/validate/patch/element/knowledge/capture/render/review/kit`. 모든 자동화 명령은 `--json`, 큰 입력은 `--file` 또는 stdin. stdout은 `CommandResponse<T>={protocolVersion:1,requestId,ok,value?,error?}` 한 JSON, 진단은 stderr. render의 반환은 job receipt이며 `motiframe render --wait`는 최종 receipt까지 기다린다. streaming은 별도 opt-in JSONL 규격으로만 허용한다. exit code: 0 성공, 2 입력/스키마, 3 revision/lock/ownership 충돌, 4 런타임/IO, 130 취소. `motiframe patch --dry-run`은 검증·diff만 반환한다.

`DocumentService.submit(tx):Promise<Result<CommitReceipt>>`.
`DocumentService.subscribe(afterRevision):AsyncIterable<DocumentEvent>`; DocumentEvent={revision,requestId,affectedIds,contentHash}.
앱이 열려 있으면 runner가 단일 writer이며 CLI는 로컬 IPC를 통해 연결한다. 앱이 닫혔으면 CLI가 같은 service와 OS 파일 잠금을 획득한다. 두 writer는 허용하지 않으며 서비스 접근 실패를 무조건 offline 쓰기로 우회하지 않는다. UI는 이벤트를 반영하고 외부 변경도 같은 undo 이력에 남긴다. browser-only 편집은 로컬 단독 문서이며 로컬 에이전트 연동에는 runner 연결 또는 명시 bundle 교환이 필요하다.

요소 소스 파일은 외부 에이전트가 편집할 수 있다. watcher는 새 definition candidate를 만들고 build→검사→등록 후 instance revision을 교체한다. 프로젝트 JSON을 임의 덮어써서 살아 있는 타임라인을 자동 병합하지 않는다. 선언형 변경은 CLI transaction 경로, 소스 구조는 revision 경로를 사용한다.

스킬 배포 묶음에는 SKILL.md·필요한 참고 문서·React/HTML 예제·JSON Schema·SDK/CLI 버전 manifest를 둔다. 모션리듬 원칙은 버전·출처와 함께 제공하되 특정 사용자의 볼트/절대경로를 필수 의존성으로 넣지 않는다.

`QualityReport={technical,implementation,perception}`; 각 항목에 range, observation, status='keep'|'revise'|'unverified', source를 기록. 텐션·미감 점수 자동 합산 없음. GUI와 `motiframe review --json`은 동일 report를 사용한다.

## 범위·버전 관리

통합 core 계약이 바뀌면 소비 task와 fixture를 같은 변경에서 수정한다. source definition version, document schemaVersion, runtime version은 각각 다른 것임을 유지한다. 모든 OS에서 시각 byte 동일성은 약속하지 않으며, 기본 primitive의 기하 오차 0.5px 이내·정확한 사건 tick·동일 폰트 glyph 순서를 검사한다. raster tolerance는 P0 결과물과 함께 측정·기록한다.
