---
name: design-skill
description: Design presentation slides as polished HTML. Use when generating slide HTML, visual design, or layout composition is needed.
---

# Design Skill - Professional Presentation Design System

A skill for designing HTML slides for top-tier business presentations.

---

## Design Mode

Read `Design Mode` from `slide-outline.md` Meta. Apply mode-specific rules from `.claude/docs/design-modes.md`.

| Mode | When | Key Rule |
|------|------|----------|
| **Professional** | Business/consulting | Action Titles, visual every slide, Pyramid |
| **Creative** | Marketing/design | Anti-AI-slop, asymmetric, display fonts |
| **Education** | Children/school | 18pt min, rounded corners, 1 concept/slide |
| **Academic** | Research/papers | White bg, 3 colors, Ghost Deck, 40 words |
| **Minimal** | General/default | Core Design Philosophy below |

No Design Mode specified → **Minimal**. Mode details in `.claude/docs/design-modes.md`.

### Common Rules (All Modes)
- Slide size: 720pt x 405pt (16:9)
- Bottom margin: 0.5" minimum
- **Typography Hard Floor**: 10pt 미만 금지. 콘텐츠 초과 시 슬라이드 분할
- **슬라이드 밀도 제한**: 표+계산박스+수식 동시 배치 시 분할 의무
- **콘텐츠 균형**: 좌우/상하 분할 시 콘텐츠에 비례 (50:50 고정 금지)
- **빈 공간 활용**: 30%+ 빈 공간+다른 영역 넘침 → 레이아웃 재설계
- Text in `<p>`, `<h1>`-`<h6>`, `<li>` only
- `<p>`, `<h1>`-`<h6>`, `<li>`에 background/border 금지 → `<div>` 래핑
- Inline text: `<span>`으로 감싸서 editor selectability 확보
- NanoBanana image: `assets/slide-{NN}-{slug}.png`, 비율은 컨테이너에 맞춤
- **AI 이미지 금지**: 가짜 데이터(차트/표/숫자), AI 이미지 내 한글 텍스트
- PPTX inspection log: `.claude/docs/pptx-inspection-log.md` 확인 후 생성

---

## Core Design Philosophy

1. **Less is More** — 불필요한 장식 제거, whitespace 활용, 명확한 시각 위계
2. **Typography-Driven** — Pretendard 기본, 크기 대비로 임팩트, letter-spacing/line-height 미세 조정
3. **Strategic Color** — 2-3색 팔레트, 모노톤+액센트, 고대비 가독성

---

## Base Settings

```html
<body style="width: 720pt; height: 405pt;">
```

### Default Font Stack
```css
font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

### Pretendard CDN
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
```

---

## Typography System

### Font Size Scale (Hard Floor — 위반 금지)

| Purpose | Size | Min | Weight |
|---------|------|:---:|--------|
| Hero Title | 72-96pt | **48pt** | 700-800 |
| Section Title | 48-60pt | **36pt** | 700 |
| Slide Title | 32-40pt | **24pt** | 600-700 |
| Subtitle | 20-24pt | **16pt** | 500 |
| Body | 16-20pt | **14pt** | 400 |
| Caption | 12-14pt | **10pt** | 400 |
| Label | 10-12pt | **10pt** | 500-600 |

Hard Floor 위반 시: 텍스트 축약 → 항목 수 줄이기 → 슬라이드 분할 → 레이아웃 변경

### 슬라이드 텍스트 밀도 제한 (PF-28)

**계산**: `word_equiv = latin_words + ceil(cjk_chars / 2)`

| 수준 | word equiv | 조치 |
|------|:---------:|------|
| 정상 | ≤ 80 | — |
| WARN | 81–120 | 축약 검토 |
| ERROR | > 120 | 슬라이드 분할 필수 |

생성 시: 표 `행×열×셀평균(CJK 3-5자)` → word equiv 추산. 120 초과 예상 시 분할.

### 텍스트-배경 대비 (PF-24)

| 텍스트 크기 | 최소 대비 |
|------------|:--------:|
| 24pt+ | 3:1 |
| 24pt 미만 | 4.5:1 |

밝은 배경→어두운 텍스트(#333333↓), 어두운 배경→밝은 텍스트. 중간톤 배경(#999 근처) 사용 금지.

---

## Layout System

### PPTX-Compatible Templates
`templates/layouts.css` 참조. 주요 호환성 수정 포함:
- **분할 레이아웃**: `box-sizing: border-box`, `overflow: hidden`, `min-width: 0`
- **카드 그리드**: max-items 제한, 안전 padding/gap
- **CSS Grid 테이블**: 고정 pt 컬럼, 헤더/교차 배경 필수
- **전체 배경+텍스트**: 단색 오버레이, text-shadow
- **배지/태그**: `min-width: 40pt`, `white-space: nowrap`

### Spacing Standards
```css
padding: 48pt;       /* Full slide */
gap: 32pt;           /* Section */
gap: 16pt;           /* Element */
gap: 8pt;            /* Text block internal */
```

### Grid System
```css
grid-template-columns: 1fr 1fr;       /* 2-column */
grid-template-columns: repeat(3, 1fr); /* 3-column */
grid-template-columns: 2fr 3fr;       /* 40:60 */
grid-template-columns: 1fr 1.618fr;   /* Golden ratio */
```

---

## Chart / Diagram / Image Guide

차트, 다이어그램, SVG 아이콘, 이미지 사용 시 → `media-guide.md` 참조.

---

## Text Usage Rules

```html
<!-- All text in block tags -->
<p>, <h1>-<h6>, <ul>, <ol>, <li>

<!-- span OK as inline wrapper INSIDE block tags -->
<p><span>text</span></p>                              <!-- ✅ -->
<div style="background:..."><span>text</span></div>    <!-- ✅ -->

<!-- Forbidden -->
<span>text without block parent</span>                 <!-- ❌ -->
```

### Inline Text Wrapping (Editor Selectability)
`<p>` 안의 모든 텍스트 조각을 `<span>`으로 감싸야 editor에서 개별 선택 가능.

---

## Slide Templates

Template files in `templates/`: cover, contents, section-divider, content, statistics, split-layout, team, quote, timeline, closing, chart, diagram. Custom: `templates/custom/`.

---

## Workflow (Stage 2)

1. **Analyze + Design**: Read `slide-outline.md` → generate HTML slides
2. **Auto-build viewer**: `node scripts/build-viewer.js --slides-dir <path>`
3. **Guide review**: User checks in browser
4. **Revision loop**: Edit HTML → rebuild viewer → review
5. **Completion**: User signals approval for PPTX

### Absolute Rules
- Never start PPTX conversion without approval
- Always rebuild viewer after modifications

---

## Important Notes

1. **CSS gradients**: `linear-gradient` + 흰색 텍스트 절대 금지 (텍스트 사라짐). 단색 대체
2. **Webfonts**: Pretendard CDN 필수
3. **Image paths**: Absolute paths or URLs
4. **Colors**: CSS에 `#` prefix 포함
5. **Text**: Never place text directly in div without block tag
