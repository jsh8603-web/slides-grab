# slides-grab — AI 프레젠테이션 프레임워크

HTML 슬라이드를 생성하고 편집 가능한 PPTX/PDF로 변환하는 에이전트 기반 도구.
기술스택: Node.js (ESM), Playwright, PptxGenJS, Express

## 핵심 명령어

```bash
npm ci && npx playwright install chromium   # 초기 설치
GEMINI_API_KEY=$GEMINI_API_KEY node scripts/editor-server.js --slides-dir slides/폴더명 --tunnel &  # 편집기 (Cloudflare tunnel)
node scripts/convert-native.mjs --slides-dir slides/폴더명 --output slides/폴더명/출력.pptx  # Preflight→변환→XML검증
node scripts/convert-native.mjs --slides-dir slides/폴더명 --output 출력.pptx --full  # + Playwright 동적 검증
node scripts/preflight-html.js --slides-dir slides/폴더명 [--full]  # HTML 정적/동적 검사 (단독 실행)
slides-grab pdf --slides-dir slides/폴더명 --output 출력.pdf       # PDF 변환
```

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

#### 오탐/정탐 분기 — 수정 대상이 다르다

에러 발견 시 먼저 **오탐인지 정탐인지 판정**. 판정에 따라 수정할 코드가 다르다:
- **오탐** (false positive): 탐지/비교 코드가 정상 결과물을 에러로 잡음 → **탐지 코드** 수정
- **정탐** (true positive): 탐지/비교 코드가 실제 문제를 정확히 잡음 → **생성 코드** 수정 (재발 방지)

#### 전체 탐지 프로세스별 오탐/정탐 수정 대상

| 탐지 프로세스 | 파이프라인 | 오탐 시 수정 대상 (탐지 코드) | 정탐 시 수정 대상 (생성 코드) |
|:------------:|:---------:|---------------------------|---------------------------|
| **PF** (HTML 정적/동적 검사) | HTML/PPTX | `preflight-html.js` 규칙 로직 | `design-skill/SKILL.md` + `html-prevention-rules.md` |
| **VP** (PPTX XML 검사) | HTML/PPTX | `validate-pptx.js` 규칙 로직 | `design-skill/SKILL.md` + `html-prevention-rules.md` |
| **COM** (HTML↔PPTX 스크린샷 비교) | HTML/PPTX | COM 비교 로직 (임계값, 영역 제외) | `design-skill/SKILL.md` + `html2pptx.cjs` 변환 로직 |
| **IV** (이미지 검증) | 이미지 | `generate-images.mjs` IV 검증부 | `nanoBanana-guide.md` 프롬프트 규칙 |
| **IP** (이미지 프롬프트 검사) | 이미지 | `generate-images.mjs` IP 검증부 | `nanoBanana-guide.md` + `enhancePrompt()` |
| **IC** (이미지 맥락 확인) | 이미지 | IC 검증 프롬프트/임계값 | `plan-skill/SKILL.md` 아웃라인 이미지 설명 규칙 |
| **VQA** (이미지 품질 스코어링) | 이미지 | `scoreImageWithVQA` 프롬프트/임계값 | `nanoBanana-guide.md` + `enhancePrompt()` |

#### 공통 절차 (오탐/정탐 무관) — 코드 수정 직후, 다음 작업 전에 순서대로 실행
1. `pptx-inspection-log.md`에 기록 (오탐도 "오탐 수정" 명시하여 기록)
2. `html-prevention-rules.md` 또는 `nanoBanana-guide.md`에 규칙 추가/갱신
3. `change-log.md`에 변동 항목 기재 + `progress.md` 체크박스 추가
4. 동일 WARN 3회+ → ERROR 승격 검토
5. 탐지 결과 승격 검토 (아래 §탐지 결과 승격 참조)

#### 탐지 결과 승격 — 후단계 탐지 패턴을 전단계 규칙으로 등록

후단계(COM/VP)에서 반복 발견된 패턴은 전단계(PF/VP)에서 사전 차단할 수 있는지 검토하여 규칙을 승격한다.
"변환해봐야 알 수 있는 이슈"를 "HTML 생성 단계에서 미리 방지하는 이슈"로 전환하는 것이 목표.

**승격 방향** (후단계 → 전단계):
| 탐지 출처 | 승격 대상 | 예시 |
|-----------|----------|------|
| COM 정탐 → | PF 규칙 등록 | VC-02 텍스트 overflow → PF에서 컨테이너 높이 대비 텍스트량 사전 검사 |
| COM 정탐 → | VP 규칙 등록 | VC-04 shape 겹침 → VP-14로 XML 단계 자동 탐지 |
| VP 정탐 → | PF 규칙 등록 | VP-16 CJK overflow → PF에서 폰트+컨테이너 폭 사전 검사 |
| VQA 저점 → | IP 규칙 등록 | 특정 키워드 PF 2-3 고착 → IP에서 해당 키워드 WARN |
| COM/VP 정탐 → | design-skill 생성 규칙 | 반복 패턴 → `html-prevention-rules.md` + `design-skill/SKILL.md` |

**승격 기준**:
- 동일 패턴 **2회 이상** 발견 (1회는 개별 수정, 2회부터 규칙화)
- 전단계에서 탐지 가능한 **구조적 특징**이 있을 때 (예: HTML에서 컨테이너 폭 계산 가능)
- 승격 불가: 변환 엔진 고유 동작 (예: gradient fallback) — 이것은 `html-prevention-rules.md` 생성 규칙으로만 방지

**승격 시 필수 행동**:
1. `pptx-inspection-log.md`에 "승격: {COM/VP}-{NN} → {PF/VP/IP}-{NN}" 기록
2. 전단계 탐지 코드에 새 규칙 구현 (`preflight-html.js`, `validate-pptx.js`, `generate-images.mjs`)
3. `html-prevention-rules.md` 또는 `nanoBanana-guide.md`에 생성 규칙 추가
4. `change-log.md` + `progress.md` 체크박스 추가

#### 테스트 규칙 — 탐지 코드 수정 시 의무 절차

탐지 코드 수정 시 회귀 테스트 + 스트레스 테스트 + 프로덕션 자동 테스트를 실행. 상세: `.claude/docs/testing-rules.md` 참조

```bash
# 코드 수정 후 의무 실행 순서:
node tests/detection-regression/run-pf-regression.mjs    # PF 단위 회귀
node tests/detection-regression/run-vp-regression.mjs    # VP 단위 회귀
node tests/detection-regression/run-ip-iv-regression.mjs # IP/IV 단위 회귀
node tests/stress-slides/run-stress.mjs --dir {테스트명}  # 통합 스트레스
node scripts/auto-production-test.mjs --slides 10 --compare tests/production-runs/baseline-10.json  # 프로덕션 품질
```

## 파이프라인 MD 생성 규칙

`progress.md`, `change-log.md` 등 파이프라인 추적 MD를 생성·갱신할 때 아래 규칙을 모두 적용한다.

### 토큰 효율 원칙
- **범용 규칙은 이 섹션(CLAUDE.md)에, 프로젝트 전용 상세는 해당 docs 파일에** — 동일 내용을 두 곳에 쓰지 않고 포인터로 참조
- **활성 규칙에는 현재 Step에 필요한 파일만 등록** — 완료된 Step의 파일은 `[x]` 체크하여 불필요한 재로드 방지
- **progress.md에 docs 내용을 복사하지 않는다** — 규칙 파일명 + 포인터만 기록, 상세는 해당 파일 Read로 참조
- **Step별 로드 매트릭스 준수** — 현재 Step에 해당하는 docs만 Read (`rules/presentation-flow.md` §Step별 로드 규칙)

### progress.md 체크박스 즉시 생성 원칙

**트리거**: 아래 이벤트가 발생한 **직후** (다음 작업 전에) progress.md에 `- [ ]` 체크박스를 추가. "나중에 기록", "일괄 기록" 금지.

체크박스 생성 대상 이벤트:

**HTML/PPTX 파이프라인**:
- PF/VP/COM ERROR 또는 오탐 판정한 WARN 발견 → 오탐/정탐 판정 + 코드 수정 체크박스
- `pptx-inspection-log.md` 기록 → IL 기록 체크박스
- 변환 에러 수정 (Step 6-2) → HTML 수정 + 재변환 체크박스
- 디자인 모드 QA 체크리스트 → QA 실행 완료 체크박스

**이미지 파이프라인**:
- IP ERROR 또는 오탐 WARN 발견 → 오탐/정탐 판정 + 코드 수정 체크박스
- IV FAIL 또는 오탐 WARN 발견 → 오탐/정탐 판정 + 코드 수정 체크박스
- VQA FAIL/WARN/DERAIL → 점수 기록 + 프롬프트 수정/게이트 조정 체크박스
- VQA 게이트 조정 → 조정 전후값 + 사유 + 재스코어링 검증 체크박스
- IC ERROR/WARN 발견 (Step 2.5/6-3) → 오탐/정탐 판정 + 수정 체크박스
- 이미지 재생성 필요 → 이미지 검수 기록 체크박스
- 이미지-컨테이너 비율 불일치 → 이미지 재생성 체크박스
- STOPWORDS/토크나이저 수정 → syntax check + 샘플 검증 체크박스
- IP/IV/VQA 규칙 승격 → 승격 기록 + 전단계 코드 구현 체크박스

**공통**:
- 규칙 파일 추가/수정 → 규칙 갱신 체크박스
- 탐지/생성 코드 수정 → 코드 수정 검증 계획(V-NN) 체크박스
- 사용자 피드백 수정 → 로그 기록 상태 체크박스

상세 Phase별 이벤트 테이블: `presentation-flow.md` §체크박스 즉시 생성 원칙

### 활성 규칙 체크박스 — 대화 압축 후 규칙 파일 유실 방지

**트리거**: progress.md를 **최초 생성하는 시점에** on-demand 규칙 파일을 `## 활성 규칙`에 등록. Phase 완료 시 즉시 `[x]` 체크.

**원리**: `.claude/docs/`, `.claude/skills/`의 on-demand 파일은 자동 로드되지 않아, 대화 압축 후 에이전트가 해당 규칙을 적용 중이었다는 사실을 잊는다. progress.md에 `- [ ] {규칙 파일}` 체크박스가 있으면, 세션 복원 시 미완료 항목을 Read로 재로드하여 규칙 적용을 연속한다.

**적용 방법**:
1. progress.md 생성 시: 파이프라인의 각 Phase가 참조하는 on-demand 파일을 `## 활성 규칙`에 `- [ ]`로 등록
2. 해당 Phase 완료 시: `- [x]`로 체크 (불필요한 재로드 방지)
3. 세션 복원 시: `[ ]` 미완료 항목의 파일을 Read로 재로드 후 작업 재개

상세 활성 규칙 템플릿: `presentation-flow.md` §활성 규칙
Step별 로드 파일: `rules/presentation-flow.md` §Step별 로드 규칙

### progress.md 갱신 타이밍

**트리거**: 아래 이벤트 발생 **직후** (다음 작업 전에) progress.md를 갱신. 자동 압축은 예고 없이 발생하므로 "나중에 갱신" 불가.
- **Step/Phase 완료 시**: 완료 단계 체크 + 현재 단계 갱신
- **수정 발생 시**: `## 로그 기록 상태`에 `[ ] {수정 내용 요약}` 추가
- **IL 기록 완료 시**: 해당 항목을 `[x]`로 갱신
- **게이트 통과 시**: 통과 기록 추가

### 코드 변동 로그 (`change-log.md`)

**트리거**: 파이프라인 코드를 Edit/Write로 수정한 **직후** (다음 작업 전에) 아래 1~2를 실행. "수정 완료 후 일괄 기록" 금지.

파이프라인 코드 수정(탐지/생성/변환 코드, 규칙 파일) 즉시:
1. `slides/프레젠테이션명/change-log.md`에 변동 항목 기재
2. `progress.md`에 `- [ ] change-log.md 검증 (C-01~C-NN)` 체크박스 추가
3. 프로덕션 완료 → 검증 에이전트가 change-log.md의 각 항목 검증 실행
4. 전 항목 통과 → change-log.md 삭제 + progress.md 체크 `[x]`

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

- `slides-grab convert`는 스크린샷 기반 (수정 불가) → 편집 가능 PPTX는 `convert-native.mjs` 사용
- html2pptx: `<p>`, `<h1>`~`<h6>`, `<li>`에 background/border 금지 → `<div>`로 래핑
- 슬라이드 규격: 720pt × 405pt, 하단 여백 0.5" 이상, Pretendard 폰트
- package.json `"type": "module"` → html2pptx.cjs는 CJS 래퍼 (`createRequire` 사용)
- 새 프레젠테이션은 반드시 `slides/프레젠테이션명/` 하위 폴더에 생성
