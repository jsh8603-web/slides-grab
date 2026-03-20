<h1 align="center">slides-grab</h1>

<p align="center">AI가 생성한 HTML 슬라이드를 시각적으로 편집하고 PPTX/PDF로 변환하는 도구</p>

<p align="center">
슬라이드에서 영역을 드래그하면 에이전트가 해당 부분을 수정합니다.<br>
텍스트, 크기, 굵기 같은 간단한 편집은 직접 수정할 수도 있습니다.
</p>

<p align="center">
슬라이드는 HTML & CSS로 작성되어 AI 에이전트가 자유롭게 편집할 수 있고,<br>
최종 결과물은 편집 가능한 PPTX 또는 PDF로 변환됩니다.
</p>

<p align="center">
  <a href="https://github.com/vkehfdl1/slides-grab/releases/download/v0.0.1-demo/demo.mp4">
    <img src="docs/assets/demo.gif" alt="slides-grab demo" width="720">
  </a>
</p>

---

## 핵심 파이프라인

### 1. 슬라이드 생성 파이프라인

```
주제/자료 → 아웃라인(plan-skill) → HTML 슬라이드(design-skill) → 편집기 → PPTX/PDF
```

- **아웃라인**: 슬라이드 구성, 레이아웃 타입, 색상 팔레트를 Markdown으로 설계
- **HTML 생성**: 각 슬라이드를 독립 HTML 파일로 생성 (720pt × 405pt)
- **편집기**: 브라우저 기반 시각 편집기에서 영역 선택 → AI 수정
- **변환**: HTML → 편집 가능한 PPTX (PptxGenJS) 또는 PDF (Playwright)

### 2. 이미지 생성 파이프라인 (NanoBanana)

```
아웃라인 → 프롬프트 추출 → Gemini Flash 이미지 생성 → IP/IV 검증 → VQA 스코어링 → 키워드 DB 갱신
```

- **IP 검증**: 프롬프트 품질 검사 (길이, 비율 일치, 필수 키워드)
- **IV 검증**: 이미지 품질 검사 (밝기, 파일 크기, 색상 팔레트, 복잡도)
- **VQA 게이트**: Gemini Vision으로 5항목 평가 (25점 만점), 20점 미만 자동 재시도
- **키워드 피드백**: 고득점 프롬프트 키워드를 DB에 축적 → 다음 생성에 반영

---

## 빠른 시작

코딩 에이전트에 아래를 붙여넣으세요:

**Claude Code:**
```
Read https://raw.githubusercontent.com/vkehfdl1/slides-grab/main/docs/prompts/setup-claude.md and follow every step.
```

**Codex:**
```
Read https://raw.githubusercontent.com/vkehfdl1/slides-grab/main/docs/prompts/setup-codex.md and follow every step.
```

직접 설치:
```bash
git clone https://github.com/vkehfdl1/slides-grab.git && cd slides-grab
npm ci && npx playwright install chromium
```

> Node.js >= 18 필요

## 주요 명령어

```bash
# 편집기 실행 (Cloudflare 터널 포함)
GEMINI_API_KEY=$KEY node scripts/editor-server.js --slides-dir slides/폴더명 --tunnel &

# PPTX 변환 (Preflight 검사 → 변환 → XML 검증)
node scripts/convert-native.mjs --slides-dir slides/폴더명 --output 출력.pptx

# PDF 변환
slides-grab pdf --slides-dir slides/폴더명 --output 출력.pdf

# 이미지 생성 (VQA 스코어링 + 키워드 DB 갱신)
node scripts/generate-images.mjs --outline outline.md --output assets/ --vqa --update-scores

# HTML 검증 (정적 + 동적)
node scripts/preflight-html.js --slides-dir slides/폴더명 --full
```

## 프로젝트 구조

```
bin/                CLI 진입점
src/editor/         브라우저 기반 시각 편집기
scripts/            빌드, 검증, 변환, 이미지 생성
templates/          슬라이드 HTML 템플릿 (cover, content, chart, ...)
themes/             색상 테마 (modern-dark, executive, sage, ...)
slides/             프레젠테이션별 슬라이드 + 출력물
.claude/skills/     Claude Code 스킬 정의 (plan/design/pptx/presentation)
.claude/docs/       온디맨드 참조 문서 (가이드, 이슈 이력, 키워드 DB)
docs/               설치 및 사용 가이드
```

## 라이선스

[MIT](LICENSE)

## 감사의 말

이 프로젝트는 Builder Josh의 [ppt_team_agent](https://github.com/uxjoseph/ppt_team_agent)를 기반으로 합니다.
