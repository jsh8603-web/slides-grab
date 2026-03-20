# slides-grab — AI 프레젠테이션 프레임워크

HTML 슬라이드를 생성하고 편집 가능한 PPTX/PDF로 변환하는 에이전트 기반 도구.
기술스택: Node.js (ESM), Playwright, PptxGenJS, Express

## 핵심 명령어

```bash
npm ci && npx playwright install chromium   # 초기 설치
node scripts/convert-native.mjs --slides-dir slides/폴더명 --output 출력.pptx --full  # Preflight→변환→XML검증
```
기타 명령어(편집기, PDF, 단독 PF 등)는 각 Step docs 참조.

## 프레젠테이션 워크플로우

사용자 요청 시 `.claude/rules/presentation-flow.md` 트리거 → `.claude/docs/presentation-flow.md` 상세 절차.
핵심: 소스 확인 → 아웃라인 → 이미지 생성 → HTML 슬라이드 → 편집기(editor-server + Cloudflare tunnel) → PPTX/PDF 변환
NanoBanana: `node scripts/generate-images.mjs --outline outline.md --output assets/` (가이드: `.claude/docs/nanoBanana-guide.md`)

## 자가 개선 피드백 루프

두 파이프라인 모두 **발견 → 기록 → 규칙 갱신 → 자동 방지** 루프를 따른다:

| | HTML/PPTX | 이미지 생성 (NanoBanana) |
|---|---|---|
| 감지 | PF/VP + COM 비교 | IV/IP + VQA 스코어링 |
| 기록 | `pptx-inspection-log.md` | `nanoBanana-report.json` (recommendations 포함) |
| 규칙 갱신 | `html-prevention-rules.md` + PF/VP 코드 | IV/IP 규칙 + STOPWORDS + VQA 게이트 |
| 자동 방지 | 다음 빌드에서 PF/VP 검출 | 다음 생성에서 IV/IP 검출 |
| 학습 루프 | 에러→IL 기록→규칙→PF/VP | VQA→키워드 DB→plan-skill→프롬프트 개선 |

### 파이프라인 자동 개선 의무 — 에러 발견 즉시 코드 수정

"향후 개선"으로 미루지 않는다.

#### 3분류 판정 — 수정 대상이 다르다

에러 발견 시 먼저 **3분류 판정**. 판정에 따라 수정 대상과 체크리스트가 달라진다:
- **오탐** (false positive): 탐지 코드가 정상 결과물을 에러로 잡음 → **탐지 코드** 수정 → A~I 체크리스트
- **정탐-수정** (true positive, fixable): 실제 문제 + 수정 가능 → **생성 코드** 수정 → A~I 체크리스트
- **정탐-한계** (true positive, limitation): 실제 문제 + 수정 불가 (엔진/모델 한계) → IL 기록 + 회피 규칙 → **간소화** 체크리스트

#### 전체 탐지 프로세스별 수정 대상

| 탐지 프로세스 | 파이프라인 | 오탐 → 탐지 코드 | 정탐-수정 → 생성 코드 | 정탐-한계 → 회피 규칙 |
|:------------:|:---------:|---------------|-------------------|-----------------|
| **PF** | HTML/PPTX | `preflight-html.js` | `design-skill/SKILL.md` + `html-prevention-rules.md` | (거의 없음) |
| **VP** | HTML/PPTX | `validate-pptx.js` | `design-skill/SKILL.md` + `html-prevention-rules.md` | html2pptx 변환 한계 |
| **COM** | HTML/PPTX | COM 비교 로직 | `design-skill/SKILL.md` + `html2pptx.cjs` | html2pptx 고유 동작 |
| **IV** | 이미지 | `generate-images.mjs` IV부 | `nanoBanana-guide.md` | Gemini 모델 한계 |
| **IP** | 이미지 | `generate-images.mjs` IP부 | `nanoBanana-guide.md` + `enhancePrompt()` | (거의 없음) |
| **IC** | 이미지 | IC 검증 기준 | `plan-skill/SKILL.md` NanoBanana 태그 | Gemini 생성 한계 |
| **VQA** | 이미지 | `scoreImageWithVQA` 프롬프트/게이트 | `nanoBanana-guide.md` + `enhancePrompt()` | 카테고리 점수 천장 |

#### 공통 절차 — 3분류 판정 + 선행 체크리스트 + 완료 게이트

**원리**: 규칙을 읽어도 실행하지 않는 근본 원인은 "코드 수정에 집중 → 후속 행정 절차 누락". 이를 방지하기 위해 **코드 수정 전에 체크리스트를 먼저 생성**하고, **전부 `[x]` 전까지 다음 작업을 차단**한다.

##### 3분류 판정 (모든 파이프라인, 모든 심각도에 동일 적용 — "맥락 판단" 금지)

| 판정 | 정의 | 수정 대상 | 체크리스트 |
|------|------|---------|:--------:|
| **오탐** | 탐지가 틀림 (실제 문제 없음) | 탐지 코드 | A~I 전체 |
| **정탐-수정** | 탐지 맞음 + 수정 가능 | 생성/HTML/프롬프트 코드 | A~I 전체 |
| **정탐-한계** | 탐지 맞음 + 수정 불가 (엔진/모델 한계) | 없음 | **간소화 A~D** |

ERROR 정탐-한계는 추가로 **심각도 재검토** 필수 (ERROR 유지 or WARN 강등).

**절차**:

**Step 1 — 판정 + 체크리스트 선행 생성 (코드 수정 전에 반드시 실행)**:
**트리거**: PF/VP/COM/IV/IP/IC/VQA에서 ERROR/WARN/FAIL 발견 시 **또는 사용자가 이슈를 지적한 경우**, **수정과 동시에** progress.md에 판정 결과에 맞는 체크리스트를 추가. HTML만 수정하고 체크리스트 없이 다음 작업으로 넘어가는 것은 금지.

**사용자 피드백 = 무조건 정탐**: 사용자가 지적한 이슈는 오탐이 될 수 없다 (사용자가 문제라고 보면 문제). 판정은 **정탐-수정 / 정탐-한계**만 해당. 추가로 **"어떤 파이프라인이 이걸 잡았어야 하는가?"** 를 판단하여 탐지 규칙 보강 여부를 결정한다.

체크리스트 템플릿(A~I / A~D)은 `presentation-flow.md` §progress.md 템플릿 참조. `checklist-guard.mjs`가 체크리스트 존재를 자동 검증 — **progress.md에 존재하지 않으면 코드 수정 차단**.

##### 파이프라인별 재검증 방법 (A~I 체크리스트 C항목)

| 파이프라인 | 오탐 재검증 | 정탐-수정 재검증 |
|----------|----------|-------------|
| **PF** | 수정된 PF 규칙으로 동일 HTML 재실행 → 에러 소멸 | HTML 수정 후 PF 재실행 → PASS |
| **VP** | 수정된 VP 규칙으로 동일 PPTX 재실행 → 에러 소멸 | HTML 수정 → 재변환 → VP PASS |
| **COM** | — (수동 비교라 N/A) | HTML 수정 → 재변환 → 재비교 |
| **IP** | 동일 프롬프트 `--dry` 재실행 → 에러 소멸 | 프롬프트 수정 `--dry` → IP PASS |
| **IV** | 동일 이미지에 수정된 IV 재실행 → 소멸 | `--regenerate {번호}` → IV PASS |
| **VQA** | 기존 WARN 이미지 5개 재스코어링 → 점수 변화 | `--regenerate {번호}` → VQA 점수 개선 |
| **IC** | 수정된 기준으로 재판정 | 프롬프트 수정+재생성 → IC PASS |

**Step 2 — 순차 실행 + 체크**:
항목을 순서대로 실행. 각 항목 완료 시 즉시 `[x]`로 갱신.

**Step 3 — 완료 게이트**:
전부 `[x]`가 된 후에만 다음 작업(다음 이슈, 다음 슬라이드, 다음 Step 등)으로 진행.
미완료 항목이 있으면 **반드시 해당 항목부터 처리**.

#### 탐지 결과 승격

후단계(COM/VP) 반복 패턴 → 전단계(PF/VP) 규칙 등록. 승격 기준: 동일 패턴 2회+, 전단계 탐지 가능한 구조적 특징.
승격 방향 테이블 + 체크리스트 → `presentation-flow.md` §승격 체크리스트 템플릿 참조.

#### 테스트 규칙

탐지 코드 수정 시 회귀 + 스트레스 + 프로덕션 자동 테스트 실행 의무. 명령어 + 상세: `testing-rules.md` 참조.

## 파이프라인 MD 생성 규칙

`progress.md`, `change-log.md` 등 파이프라인 추적 MD를 생성·갱신할 때 아래 규칙을 모두 적용한다.

### 토큰 효율 원칙
- **범용 규칙은 이 섹션(CLAUDE.md)에, 프로젝트 전용 상세는 해당 docs 파일에** — 동일 내용을 두 곳에 쓰지 않고 포인터로 참조
- **활성 규칙에는 현재 Step에 필요한 파일만 등록** — 완료된 Step의 파일은 `[x]` 체크하여 불필요한 재로드 방지
- **progress.md에 docs 내용을 복사하지 않는다** — 규칙 파일명 + 포인터만 기록, 상세는 해당 파일 Read로 참조
- **Step별 로드 매트릭스 준수** — 현재 Step에 해당하는 docs만 Read (`rules/presentation-flow.md` §Step별 로드 규칙)

### progress.md 체크박스 즉시 생성 원칙

이벤트 발생 **직후** progress.md에 `- [ ]` 체크박스 추가. "나중에 기록" 금지. `checklist-guard.mjs`가 자동 검증.
- **사용자 피드백 = 무조건 정탐** → 즉시 3분류 판정 + 체크리스트. A. 판정 `[x]` 전까지 HTML 수정 차단.
- Phase별 이벤트 상세: `presentation-flow.md` §체크박스 즉시 생성 원칙

### 활성 규칙 체크박스 — 대화 압축 후 규칙 파일 유실 방지

**트리거**: progress.md를 **최초 생성하는 시점에** on-demand 규칙 파일을 `## 활성 규칙`에 등록. Phase 완료 시 즉시 `[x]` 체크.

**원리**: `.claude/docs/`, `.claude/skills/`의 on-demand 파일은 자동 로드되지 않아, 대화 압축 후 에이전트가 해당 규칙을 적용 중이었다는 사실을 잊는다. progress.md에 `- [ ] {규칙 파일}` 체크박스가 있으면, 세션 복원 시 미완료 항목을 Read로 재로드하여 규칙 적용을 연속한다.

**적용 방법**:
1. progress.md 생성 시: 파이프라인의 각 Phase가 참조하는 on-demand 파일을 `## 활성 규칙`에 `- [ ]`로 등록
2. 해당 Phase 완료 시: `- [x]`로 체크 (불필요한 재로드 방지)
3. **`### 전체 프로덕션` 규칙은 Step 7 완료 직후 `[x]` 체크** — Phase에 귀속되지 않으므로 프로덕션 종료가 체크 오프 시점
4. 세션 복원 시: `[ ]` 미완료 항목의 파일을 Read로 재로드 후 작업 재개

상세 활성 규칙 템플릿: `presentation-flow.md` §활성 규칙
Step별 로드 파일: `rules/presentation-flow.md` §Step별 로드 규칙

### progress.md 갱신 타이밍

Step/Phase 완료, 수정 발생, IL 기록, 게이트 통과 시 **즉시** 갱신. "나중에 갱신" 불가 (자동 압축은 예고 없이 발생).

### 코드 변동 로그 (`change-log.md`)

**트리거**: 파이프라인 코드를 Edit/Write로 수정한 **직후** (다음 작업 전에) 아래 1~2를 실행. "수정 완료 후 일괄 기록" 금지.

파이프라인 코드 수정(탐지/생성/변환 코드, 규칙 파일) 즉시 — §공통 절차의 Step E에 해당:
1. `slides/프레젠테이션명/change-log.md`에 변동 항목 기재
2. `progress.md`에 `- [ ] change-log.md 검증 (C-01~C-NN)` 체크박스 추가
3. **Step 7.5 (프로덕션 후 검증)에서 change-log.md 검증 실행**:
   - 각 C-NN 항목의 `**검증**:` 명령어를 실제 실행하여 통과 확인
   - "다음 세션에서 확인" 류의 행동 검증 항목은 이월 사유 기재
   - 실행 가능한 검증 명령어가 전부 통과해야 다음 단계 진행
4. 전 항목 통과 → **change-log.md 삭제** + progress.md V-02 체크 `[x]`

**완료 게이트**: 1~2가 progress.md에 기록되기 전까지 다음 코드 수정 금지.

**프로덕션 후 검증 게이트**: Step 7 출력 완료 후, progress.md `## 탐지 코드 수정 검증`의 V-NN `[ ]` 항목을 전부 실행해야 완료 보고 가능. 상세: `pf-step-5-6-7.md` §Step 7.5

**기록 대상**: 탐지 코드(`preflight-html.js`, `validate-pptx.js`, `generate-images.mjs`), 생성 규칙(`design-skill/SKILL.md`, `html-prevention-rules.md`, `nanoBanana-guide.md`), 변환 코드(`html2pptx.cjs`, `convert-native.mjs`), 파이프라인 설정(STOPWORDS, 임계값)
**기록 제외** (progress.md에서 관리): HTML 슬라이드 내용 수정, 이미지 재생성, PPTX 재변환 실행

**항목 형식**:
```
## C-{NN}: {오탐/정탐/버그/최적화} — {요약}
**파일+함수**: {파일경로} {함수명}()
**변경**: {변경 전 동작} → {변경 후 동작}
**이유**: {왜 수정했는지}
**검증**: {검증 명령어 + 통과 기준}
```

## 온디맨드 참조 (`.claude/docs/` — 자동 로드 안 됨, 필요 시 Read)

- `presentation-flow.md` — 워크플로우 공통 (progress 템플릿, 체크박스, 세션 복원)
- `pf-step-0-1.md` / `pf-step-1.5b.md` / `pf-step-2-2.5.md` / `pf-step-3-4.md` / `pf-step-5-6-7.md` — Step별 상세 절차
- `pptx-inspection-log.md` — PPTX 변환 이슈 패턴 + 매핑 테이블 (Step 2/6 시작 전)
- `html-rule-examples.md` — HTML 규칙 코드 예시 모음 (규칙 적용/수정 시)
- `design-modes.md` — 5개 디자인 모드 (Step 2 슬라이드 생성 시)
- `nanoBanana-guide.md` — 이미지 생성 가이드 (Step 1.5B)
- `vqa-pipeline-maintenance.md` — VQA 파이프라인 보수 기준 (이미지 생성 후)
- `notebooklm-fetch.md` — NotebookLM 추출 절차 (Step 0)
- `research-slide-quality-tools.md` — 외부 슬라이드 품질 도구 리서치 (규칙 보완 시)
- `production-reporting-rules.md` — 프로덕션 파이프라인 단계별 보고 규칙 (프레젠테이션 제작 시)
- `html-prevention-rules.md` — HTML 금지/필수 규칙 (Step 2, 2.5, 3, 5-6)
- `testing-rules.md` — 회귀/스트레스/프로덕션 자동 테스트 상세 (탐지 코드 수정 시)

## 폴더 구조

- `slides/{프레젠테이션명}/` — 슬라이드 HTML + 출력 PPTX/PDF
- `scripts/` — 빌드/변환/유틸
- `.claude/skills/` — 스킬 정의 (plan/design/pptx/presentation)

## Critical Rules

- 편집 가능 PPTX → `convert-native.mjs` 사용 (`slides-grab convert`는 스크린샷 기반, 수정 불가)
- html2pptx: `<p>`/`<h1>`~`<h6>`/`<li>`에 background/border 금지 → `<div>` 래핑
- 슬라이드: 720pt × 405pt, 하단 여백 0.5"+, Pretendard. 새 프레젠테이션은 `slides/프레젠테이션명/` 하위
- ESM 프로젝트 (`"type": "module"`) — html2pptx.cjs는 CJS 래퍼 (`createRequire`)
