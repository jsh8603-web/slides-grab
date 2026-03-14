---
name: design-skill
description: Design presentation slides as polished HTML. Use when generating slide HTML, visual design, or layout composition is needed.
---

# Design Skill - Professional Presentation Design System

A skill for designing HTML slides for top-tier business presentations.
Delivers minimal, refined design with professional typography and precise layouts.

---

## Design Mode

Read the `Design Mode` field from `slide-outline.md` Meta section. Apply mode-specific rules from `.claude/docs/design-modes.md`.

| Mode | When | Key Rule |
|------|------|----------|
| **Professional** | Business/consulting/executive | Action Titles, visual every slide, Pyramid Principle |
| **Creative** | Marketing/design/competitions | Anti-AI-slop, asymmetric layouts, display fonts |
| **Education** | Children/school/Sunday school | 18pt min, rounded corners, single concept per slide |
| **Academic** | Research/papers/conferences | White bg, 3 colors, Ghost Deck Test, 40 words max |
| **Minimal** | General/default | Current design philosophy below |

If no Design Mode specified → default to **Minimal**.
For mode-specific details (palettes, fonts, QA checklists), see `.claude/docs/design-modes.md`.

### Mode Branching Logic

1. Read `slide-outline.md` Meta → extract `Design Mode` value
2. Load `.claude/docs/design-modes.md` → find matching mode section
3. Apply mode-specific: color palette, font stack, layout principles, required/forbidden rules
4. **Minimal mode**: uses the "Core Design Philosophy" section below as-is (existing behavior)
5. **Other modes**: mode rules from `design-modes.md` override Core Design Philosophy where they conflict
6. After all slides generated, run the mode's QA Checklist before handing off

### Common Rules (All Modes)

These apply regardless of mode:
- Slide size: 720pt x 405pt (16:9 default)
- Bottom margin: 0.5" minimum
- Text in `<p>`, `<h1>`-`<h6>`, `<li>` only (no text directly in `<div>`)
- `<p>`, `<h1>`-`<h6>`, `<li>` must not have background/border → wrap in `<div>`
- Inline text wrapping with `<span>` for editor selectability
- NanoBanana image paths: `assets/slide-{NN}-{slug}.png`
- NanoBanana 이미지 비율: 레이아웃의 이미지 컨테이너 비율에 맞춰 생성 (비율 매핑은 `.claude/docs/nanoBanana-guide.md` "이미지 비율 결정 규칙" 참조). 분할 레이아웃에 16:9 사용 금지
- PPTX inspection log: check `.claude/docs/pptx-inspection-log.md` before generating

---

## Core Design Philosophy

### 1. Less is More
- Remove unnecessary decorative elements
- Content takes center stage
- Leverage whitespace aggressively
- Clear visual hierarchy

### 2. Typography-Driven Design
- Pretendard as the default font
- Font size contrast creates visual impact
- Fine-tuned letter-spacing and line-height
- Weight variations for emphasis

### 3. Strategic Color Usage
- Limited color palette (2-3 colors)
- Monotone base + accent color
- Background color sets the mood
- High contrast for readability

---

## Base Settings

### Slide Size (16:9 default)
```html
<body style="width: 720pt; height: 405pt;">
```

### Supported Aspect Ratios
| Ratio | Size | Use Case |
|-------|------|----------|
| 16:9 | 720pt x 405pt | Default, monitors/screens |
| 4:3 | 720pt x 540pt | Legacy projectors |
| 16:10 | 720pt x 450pt | MacBook |

### Default Font Stack
```css
font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

### Pretendard Webfont CDN
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
```

---

## Typography System

### Font Size Scale
| Purpose | Size | Weight | Example |
|---------|------|--------|---------|
| Hero Title | 72-96pt | 700-800 | Cover main title |
| Section Title | 48-60pt | 700 | Section divider heading |
| Slide Title | 32-40pt | 600-700 | Slide heading |
| Subtitle | 20-24pt | 500 | Subtitle, description |
| Body | 16-20pt | 400 | Body text |
| Caption | 12-14pt | 400 | Caption, source |
| Label | 10-12pt | 500-600 | Badge, tag |

### Letter Spacing
```css
/* Large titles: tight */
letter-spacing: -0.02em;

/* Medium titles */
letter-spacing: -0.01em;

/* Body: default */
letter-spacing: 0;

/* Captions, labels: slightly wider */
letter-spacing: 0.02em;
```

### Line Height
```css
/* Titles */
line-height: 1.2;

/* Body text */
line-height: 1.6 - 1.8;

/* Single-line text */
line-height: 1;
```

---

## Color Palette System

### 1. Executive Minimal (Recommended Default)
Refined business presentation look
- File: `themes/executive.css`

### 2. Sage Professional
Calm and trustworthy tone
- File: `themes/sage.css`

### 3. Modern Dark
High-impact dark theme
- File: `themes/modern-dark.css`

### 4. Corporate Blue
Traditional business tone
- File: `themes/corporate.css`

### 5. Warm Neutral
Warm and approachable tone
- File: `themes/warm.css`

Theme files use shared CSS variables (`:root`). Copy a theme file to create a custom theme.

---

## Layout System

### PPTX-Compatible Layout Templates

PPTX 호환성 수정이 미리 적용된 레이아웃 템플릿을 참조한다: `templates/layouts.css`

주요 템플릿:
- **50:50/55:45 이미지+텍스트 분할**: `box-sizing: border-box`, `overflow: hidden`, `min-width: 0` 포함 (패턴 #13, #18 방지)
- **카드 그리드 (2열/3열)**: max-items 제한, padding/gap 안전값 (패턴 #6, #10 방지)
- **CSS Grid 테이블**: 고정 pt 컬럼, 헤더/교차 배경 필수 (패턴 #17, #19 방지)
- **전체 배경 이미지 + 텍스트**: 단색 오버레이, text-shadow (패턴 #7, #14 방지)
- **배지/태그**: min-width 40pt, `white-space: nowrap` (패턴 #1, #3 방지)
- **체크리스트**: max 5 items, gap 7pt (패턴 #10 방지)

### Spacing Standards (padding/margin)
```css
/* Full slide padding */
padding: 48pt;

/* Section spacing */
gap: 32pt;

/* Element spacing */
gap: 16pt;

/* Text block internal spacing */
gap: 8pt;
```

### Grid System
```css
/* 2-column layout */
display: grid;
grid-template-columns: 1fr 1fr;
gap: 32pt;

/* 3-column layout */
grid-template-columns: repeat(3, 1fr);

/* Asymmetric layout (40:60) */
grid-template-columns: 2fr 3fr;

/* Asymmetric layout (30:70) */
grid-template-columns: 1fr 2.3fr;
```

---

## Design Components

### 1. Badge/Tag
```html
<p style="
  display: inline-block;
  padding: 6pt 14pt;
  border: 1px solid #1a1a1a;
  border-radius: 20pt;
  font-size: 10pt;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: uppercase;
">PRESENTATION</p>
```

### 2. Section Number
```html
<p style="
  display: inline-block;
  padding: 4pt 12pt;
  background: #1a1a1a;
  color: #ffffff;
  border-radius: 4pt;
  font-size: 10pt;
  font-weight: 600;
">SECTION 1</p>
```

### 3. Logo Area
```html
<div style="display: flex; align-items: center; gap: 8pt;">
  <div style="
    width: 20pt;
    height: 20pt;
    background: #1a1a1a;
    border-radius: 4pt;
    display: flex;
    align-items: center;
    justify-content: center;
  ">
    <p style="color: #fff; font-size: 12pt;">*</p>
  </div>
  <p style="font-size: 12pt; font-weight: 600;">LogoName</p>
</div>
```

### 4. Icon Button
```html
<div style="
  width: 32pt;
  height: 32pt;
  border: 1px solid #1a1a1a;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
">
  <p style="font-size: 14pt;">&#x2197;</p>
</div>
```

### 5. Divider Line
```html
<div style="
  width: 100%;
  height: 1pt;
  background: #d4d4d0;
"></div>
```

### 6. Info Grid
```html
<div style="display: flex; gap: 48pt;">
  <div>
    <p style="font-size: 10pt; color: #999; margin-bottom: 4pt;">Contact</p>
    <p style="font-size: 12pt; font-weight: 500;">334556774</p>
  </div>
  <div>
    <p style="font-size: 10pt; color: #999; margin-bottom: 4pt;">Date</p>
    <p style="font-size: 12pt; font-weight: 500;">March 2025</p>
  </div>
</div>
```

---

## Slide Templates

### 1. Cover Slide
- Template file: `templates/cover.html`

### 2. Table of Contents (Contents)
- Template file: `templates/contents.html`

### 3. Section Divider
- Template file: `templates/section-divider.html`

### 4. Content Slide
- Template file: `templates/content.html`

### 5. Statistics/Data Slide
- Template file: `templates/statistics.html`

### 6. Image + Text (Split Layout)
- Template file: `templates/split-layout.html`

### 7. Team Introduction
- Template file: `templates/team.html`

### 8. Quote Slide
- Template file: `templates/quote.html`

### 9. Timeline Slide
- Template file: `templates/timeline.html`

### 10. Closing Slide
- Template file: `templates/closing.html`

### 11. Chart Slide
- Template file: `templates/chart.html`

### 12. Diagram Slide
- Template file: `templates/diagram.html`

### Custom Templates
- Custom template directory: `templates/custom/`
- Users can add template files as drop-in for reuse.

---

## Advanced Design Patterns

### Asymmetric Layout
Eye-catching compositions
```css
/* Golden ratio */
grid-template-columns: 1fr 1.618fr;

/* Extreme asymmetry */
grid-template-columns: 1fr 3fr;
```

### Overlay Text
Text placed over images
```html
<div style="position: relative;">
  <div style="position: absolute; inset: 0; background: rgba(0,0,0,0.5);"></div>
  <div style="position: relative; z-index: 1;">
    <h2 style="color: #fff;">Overlay Text</h2>
  </div>
</div>
```

### Gradient Overlay
```html
<div style="
  background: linear-gradient(to right, #1a1a1a 0%, transparent 60%);
  position: absolute;
  inset: 0;
"></div>
```

### Card Style
```html
<div style="
  background: #ffffff;
  border-radius: 12pt;
  padding: 24pt;
  box-shadow: 0 2pt 8pt rgba(0,0,0,0.08);
"></div>
```

---

## Chart / Diagram / Image Guide

차트, 다이어그램, SVG 아이콘, 이미지 사용 시 → `media-guide.md` 참조.
아웃라인에 차트/다이어그램/이미지가 없으면 Read 불필요.

---

## Text Usage Rules

### Required Tags
```html
<!-- All text MUST be inside these block tags -->
<p>, <h1>-<h6>, <ul>, <ol>, <li>

<!-- <span> is OK as inline wrapper INSIDE block tags (for editor selectability) -->
<p><span>text</span></p>          <!-- ✅ OK -->
<div style="background:..."><span>text</span></div>  <!-- ✅ OK (pattern #12 fixed) -->

<!-- Forbidden - standalone text without block parent -->
<div>bare text here</div>          <!-- ⚠️ works but <p> preferred -->
<span>text without block parent</span>  <!-- ❌ not rendered -->
```

### Inline Text Wrapping (Editor Selectability)
비주얼 에디터에서 단어/구문 단위로 선택하여 서식(볼드, 색상 등)을 수정하려면,
`<p>` 등 블록 요소 안의 모든 텍스트 조각을 `<span>`으로 감싸야 한다.
태그 없는 순수 텍스트 노드는 `elementFromPoint`로 선택 불가.

```html
<!-- Good — 모든 텍스트가 span으로 감싸져 있어 개별 선택 가능 -->
<p style="font-size: 11pt;">
  <span style="color: #FAFAF9;">바다 생물의 </span>
  <span style="font-weight: 700; color: #D97706;">95%</span>
  <span style="color: #FAFAF9;">가 사라졌어요!</span>
</p>

<!-- Bad — "바다 생물의 "가 순수 텍스트 노드라 에디터에서 선택 불가 -->
<p style="font-size: 11pt; color: #FAFAF9;">
  바다 생물의 <span style="font-weight: 700; color: #D97706;">95%</span>가 사라졌어요!
</p>
```

**규칙**: `<p>`, `<h1>`~`<h6>`, `<li>` 안에 텍스트를 넣을 때, 단일 스타일 텍스트만 있는 경우를 제외하고 모든 텍스트 조각을 `<span>`으로 감싼다.

### Recommended Usage
```html
<!-- Good -->
<h1 style="...">Title</h1>
<p style="...">Body text</p>

<!-- Bad -->
<div style="...">Text directly in div</div>
```

---

## Output and File Structure

### File Save Rules
```
<slides-dir>/   (default: slides/)
├── slide-01.html  (Cover)
├── slide-02.html  (Contents)
├── slide-03.html  (Section Divider)
├── slide-04.html  (Content)
├── ...
└── slide-XX.html  (Closing)
```

### File Naming Rules
- Use 2-digit numbers: `slide-01.html`, `slide-02.html`
- Name sequentially
- No special characters or spaces

---

## Workflow (Stage 2: Design + Human Review)

This skill is **Stage 2**. It works from the `slide-outline.md` approved by the user in Stage 1 (plan-skill).

### Prerequisites
- `slide-outline.md` must exist and be approved by the user.

### Steps

1. **Analyze + Design**: Read `slide-outline.md`, decide theme/layout, generate HTML slides
2. **Auto-build viewer**: After slide generation, automatically run:
   ```bash
   node scripts/build-viewer.js --slides-dir <path>
   ```
3. **Guide user to review**: Tell the user to check slides in the browser:
   ```
   open <slides-dir>/viewer.html
   ```
4. **Revision loop**: When the user requests changes to specific slides:
   - Edit only the relevant HTML file
   - Re-run `node scripts/build-viewer.js --slides-dir <path>` to rebuild the viewer
   - Guide user to review again
5. **Completion**: Repeat the revision loop until the user signals approval for PPTX conversion

### Absolute Rules
- **Never start PPTX conversion without approval** — PPTX conversion is the responsibility of `pptx-skill` and requires explicit user approval.
- **Never forget to build the viewer** — Run `node scripts/build-viewer.js --slides-dir <path>` every time slides are generated or modified.

---

## Important Notes

1. **CSS gradients**: Not supported in PowerPoint conversion — **`linear-gradient` + 흰색 텍스트 조합 절대 금지** (텍스트 완전히 사라짐). gradient가 필요하면 단색 배경으로 대체 (gradient의 시작 색상 사용)
2. **Webfonts**: Always include the Pretendard CDN link
3. **Image paths**: Use absolute paths or URLs
4. **Colors**: Always include `#` prefix in CSS
5. **Text rules**: Never place text directly in div/span
