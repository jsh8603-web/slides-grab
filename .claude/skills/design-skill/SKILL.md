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
- **슬라이드 밀도 제한**: 표+계산박스+수식 동시 배치 시 분할 의무
- **콘텐츠 균형**: 좌우/상하 분할 시 콘텐츠에 비례 (50:50 고정 금지)
- **빈 공간 활용**: 30%+ 빈 공간+다른 영역 넘침 → 레이아웃 재설계
- Inline text: `<span>`으로 감싸서 editor selectability 확보
- NanoBanana image: `assets/slide-{NN}-{slug}.png`, 비율은 컨테이너에 맞춤
- **AI 이미지 금지**: 가짜 데이터(차트/표/숫자), AI 이미지 내 한글 텍스트
- PPTX inspection log: `.claude/docs/pptx-inspection-log.md` 확인 후 생성
- **PPTX 호환 규칙**: `.claude/docs/html-prevention-rules.md` 참조 (금지/필수 규칙의 단일 소스)

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

### Font Size Scale

| Purpose | Size | Min | Weight |
|---------|------|:---:|--------|
| Hero Title | 72-96pt | **48pt** | 700-800 |
| Section Title | 48-60pt | **36pt** | 700 |
| Slide Title | 32-40pt | **24pt** | 600-700 |
| Subtitle | 20-24pt | **16pt** | 500 |
| Body | 16-20pt | **14pt** | 400 |
| Caption | 12-14pt | **10pt** | 400 |
| Label | 10-12pt | **10pt** | 500-600 |

Hard Floor·밀도 제한·대비 기준 → `html-prevention-rules.md` §최소 폰트 사이즈, §밀도 제한, §텍스트-배경 대비 참조

---

## Layout System

### PPTX-Compatible Templates
`templates/layouts.css` 참조. PPTX 호환 상세 → `html-prevention-rules.md` 참조

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

### CSS 차트/이미지 규칙
차트·다이어그램·배경이미지 PPTX 호환 규칙 → `html-prevention-rules.md` 참조 (IL-67~69, PF-36, PF-66 등)

---

## Text Usage Rules

`<p>` 안의 모든 텍스트 조각을 `<span>`으로 감싸야 editor에서 개별 선택 가능.
텍스트 태그 규칙·금지 패턴 → `html-prevention-rules.md` 참조

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

1. **Webfonts**: Pretendard CDN 필수
2. **Image paths**: Absolute paths or URLs
3. **Colors**: CSS에 `#` prefix 포함
