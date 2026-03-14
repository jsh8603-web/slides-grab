# slides-grab — AI 프레젠테이션 프레임워크

HTML 슬라이드를 생성하고 편집 가능한 PPTX/PDF로 변환하는 에이전트 기반 도구.
기술스택: Node.js (ESM), Playwright, PptxGenJS, Express

## 핵심 명령어

```bash
npm ci && npx playwright install chromium   # 초기 설치
node scripts/build-viewer.js --slides-dir slides/폴더명  # 뷰어 빌드
node scripts/convert-native.mjs --slides-dir slides/폴더명 --output slides/폴더명/출력.pptx  # Preflight→변환→XML검증
node scripts/convert-native.mjs --slides-dir slides/폴더명 --output 출력.pptx --full  # + Playwright 동적 검증
node scripts/preflight-html.js --slides-dir slides/폴더명 [--full]  # HTML 정적/동적 검사 (단독 실행)
slides-grab pdf --slides-dir slides/폴더명 --output 출력.pdf       # PDF 변환
```

## 프레젠테이션 워크플로우

사용자 요청 시 `.claude/rules/presentation-flow.md` 트리거 → `.claude/docs/presentation-flow.md` 상세 절차.
핵심: 소스 확인 → 아웃라인(NanoBanana 태그 포함) → 이미지 자동 생성 → 슬라이드 생성 → 뷰어 → 수정 → PPTX 변환 → 검사/수정
NanoBanana: `node scripts/generate-images.mjs --outline outline.md --output assets/` (가이드: `.claude/docs/nanoBanana-guide.md`)

## 온디맨드 참조 문서 (`.claude/docs/` — 자동 로드 안 됨)

필요 시점에 `Read`로 읽기:
- `pptx-inspection-log.md` — PPTX 변환 이슈 패턴 24개 (Step 2/6 시작 전 읽기)
- `presentation-flow.md` — 전체 워크플로우 상세 절차 (프레젠테이션 제작 시 읽기)
- `design-modes.md` — 5개 디자인 모드 상세 (Step 2 슬라이드 생성 시 읽기)
- `nanoBanana-guide.md` — 이미지 생성 가이드 (Step 1.5B 이미지 생성 시 읽기)
- `notebooklm-fetch.md` — NotebookLM 추출 절차 (Step 0 소스 수집 시 읽기)

## 폴더 구조

```
slides/                      # 프레젠테이션 루트 (프레젠테이션별 하위 폴더)
  tax-efficient-jv-guide/    # 예시: 개별 프레젠테이션
    slide-01.html ~ NN.html
    viewer.html
    출력.pptx
scripts/                     # 빌드/변환/유틸
.claude/skills/              # 스킬 정의 (plan/design/pptx/presentation)
```

## Critical Rules

- `slides-grab convert`는 스크린샷 기반 (수정 불가) → 편집 가능 PPTX는 `convert-native.mjs` 사용
- html2pptx 규칙: `<p>`, `<h1>`~`<h6>`, `<li>`에 background/border 사용 금지 → `<div>`로 래핑
- 슬라이드 규격: 720pt × 405pt, 하단 여백 0.5" 이상, Pretendard 폰트
- package.json `"type": "module"` → html2pptx.cjs는 CJS 래퍼 (`createRequire` 사용)
- 새 프레젠테이션은 반드시 `slides/프레젠테이션명/` 하위 폴더에 생성
