---
name: plan-skill
description: Supervisor skill that plans presentation outlines and manages user approval loops. Use when designing PPT structure, slide composition, or writing outlines.
---

# Plan Skill - Presentation Outline Planning

A **supervisor skill** that takes a user topic, generates a `slide-outline.md` outline, and manages a revision loop until the user approves.

Does not write the outline directly — delegates the work to `organizer-agent`.

---

## Role Assignment

| Role | Owner | Responsibility |
|------|-------|----------------|
| **Supervisor** | plan-skill (you) | User communication, quality control, revision loop management |
| **Worker** | organizer-agent | Draft and revise `slide-outline.md` |

---

## Input

- User topic (required)
- Research results (optional — research-agent output)
- Reference materials, tone/mood requests, etc.

## Design Mode Selection

아웃라인 작성 **전에** 디자인 모드를 결정한다. 사용자 요청의 청중/톤/주제를 분석하여 자동 매칭.

### Auto-Matching Rules

| 키워드 감지 | Mode | 근거 |
|------------|------|------|
| 비즈니스, 임원, 보고서, 투자, 컨설팅, 전략, 실적 | **Professional** | Pyramid Principle, Action Title |
| 마케팅, 디자인, 창작, 공모전, 브랜딩, 캠페인 | **Creative** | Anti-AI-slop, display fonts |
| 어린이, 유치원, 주일학교, 초등, 아이들, 교회학교 | **Education** | Mayer 원리, 18pt min |
| 학술, 연구, 논문, 학회, 실험, 데이터 분석 | **Academic** | Ghost Deck Test, 3 colors |
| 기타, 범용, 미지정 | **Minimal** | 기본값 |

### 적용 절차

1. 사용자 토픽에서 키워드 감지 → 모드 자동 추천
2. organizer-agent 호출 시 `Design Mode: {mode}` 포함
3. outline Meta 섹션에 `Design Mode` 필드 추가
4. 사용자가 모드를 명시적으로 지정하면 해당 모드 우선 적용
5. 모드별 상세 규칙: `.claude/docs/design-modes.md` 참조

## Output

- User-approved `slide-outline.md`

---

## Workflow

### 1. Delegate Draft Creation to organizer-agent

Use the Task tool to call `organizer-agent` and generate a `slide-outline.md` draft.

**Include in the prompt:**
- User topic and requirements
- Research results (if available)
- Tone/mood requests
- Expected format for `slide-outline.md` (see format below)

### 2. Present Outline to User

Read the generated `slide-outline.md` and present to the user:

- Total number of slides
- Slide order and each slide's role
- Key message summary
- Design tone/mood
- **NanoBanana 이미지 설명 (필수)**: 각 슬라이드의 `NanoBanana:` 태그에 포함된 한글 설명을 반드시 표시. 사용자가 어떤 이미지가 생성될지 승인 전에 확인할 수 있어야 한다.

### 3. Feedback Revision Loop

When user provides feedback:
1. Organize the feedback
2. Call `organizer-agent` again with the existing `slide-outline.md` and feedback
3. Present the revised outline to the user
4. Repeat until user approves

### 4. Approval Confirmation

Complete the outline stage when the user explicitly approves.

---

## Absolute Rules

1. **Never proceed to the next stage without approval** — Maintain the revision loop until the user explicitly signals approval ("looks good", "approved", "OK", "proceed", etc.).
2. **Never write the outline directly** — Always delegate to `organizer-agent`.
3. **Never start HTML generation** — This skill's scope ends at `slide-outline.md` approval. HTML generation is the responsibility of `design-skill`.

---

## NanoBanana 이미지 태그

아웃라인 작성 시, 이미지가 필요한 슬라이드에 `NanoBanana:` 태그를 포함한다.
사용자가 Gemini 앱에서 미리 이미지를 생성할 수 있도록 아웃라인 단계에서 안내하는 것이 목적.

### 태그 형식

```markdown
- NanoBanana: [한글 설명] | [English prompt for Gemini]
```

- **한글 설명**: 사용자가 이미지 의도를 이해할 수 있는 간단한 설명
- **English prompt**: Gemini에 그대로 복사-붙여넣기할 수 있는 완성형 영어 프롬프트

### 비율 힌트 (레이아웃 기반 필수 결정)

**16:9를 기본값으로 쓰지 않는다.** 슬라이드 Layout에서 이미지 컨테이너의 실제 비율에 맞춰 결정한다.
프롬프트 앞에 `[비율]` 힌트를 넣으면 스크립트가 자동 파싱하여 Gemini API에 전달.

| 레이아웃 | 이미지 컨테이너 | 비율 힌트 |
|---------|---------------|----------|
| 전체 배경 (표지, 섹션, 인포그래픽) | 720×405pt | `[16:9]` |
| 좌우 50:50 분할 (body padding 없음) | 360×405pt | `[3:4]` |
| 좌우 55:45 분할 (body padding 없음) | 396×405pt | `[1:1]` |
| 좌우 분할 (body padding 있음, 내부 flex) | ~330~360×290pt | `[4:3]` |
| 일러스트/아이콘 (독립) | 정사각 | `[1:1]` |

```markdown
- NanoBanana: 쥬라기 풍경 | [3:4] A charming illustration of a Jurassic landscape... 3:4 portrait aspect ratio.
- NanoBanana: T-Rex 일러스트 | [4:3] A powerful illustration of a T-Rex... 4:3 aspect ratio.
```

지원 비율: `1:1`, `16:9`, `4:3`, `3:4`, `3:2`, `2:3`, `9:16`, `21:9` (Sharp 후처리도 동일 8개 지원)

### 영어 프롬프트 작성 규칙

`.claude/docs/nanoBanana-guide.md`의 10대 규칙을 반드시 적용:

1. **서술형 문장** — 키워드 나열 금지, "A professional..." 형태의 완전한 문장
2. **용도 선언** — 문장 앞에 "A presentation slide background for..." 등 용도 명시
3. **`no text` 필수** — 이미지 내 텍스트 금지 (HTML에서 오버레이)
4. **긍정 표현** — "no X" 대신 원하는 상태를 서술
5. **촬영 용어** — 구도 제어: `wide-angle`, `bird's-eye view` 등
6. **조명 묘사** — `soft ambient lighting`, `three-point softbox` 등
7. **색상 hex 코드** — 슬라이드 테마와 일치하는 팔레트 명시 (Meta Color Palette에서 가져옴)
8. **스타일 키워드** — `minimalist`, `flat design`, `corporate` 등 2~3개
9. **`[비율] aspect ratio`** — 레이아웃 기반 비율 결정 (위 테이블 참조). 전체 배경만 16:9, 분할 레이아웃은 컨테이너 비율에 맞춤
10. **네거티브 스페이스** — 배경용 이미지는 텍스트 영역 확보 명시
11. **`transparent` 금지** — Gemini 투명 배경 미지원, `pure white (#FFFFFF) background` 사용

### 슬라이드 유형별 프롬프트 템플릿

**표지 (Cover)** — 전체 배경, `[16:9]`:
```
[16:9] A professional presentation cover for [주제].
[스타일] design with [색상 팔레트 hex].
Clean centered composition with ample negative space for title text overlay.
No text. 16:9 aspect ratio, high resolution.
```

**콘텐츠 배경 (Content)** — 전체 배경, `[16:9]`:
```
[16:9] A subtle muted background for a presentation content slide about [주제].
Soft [색상] tones, abstract [패턴] texture.
Must not compete with overlaid text and data. Desaturated, professional.
No text. 16:9 aspect ratio.
```

**병렬 레이아웃 이미지** — 비율은 레이아웃에 따라 결정:
```
[비율] A [스타일] illustration of [대상] for a presentation slide.
[상세 묘사]. [색상 팔레트].
Muted desaturated background. No text. [비율] aspect ratio.
```
비율 결정: 위 "비율 힌트" 테이블에서 Layout에 맞는 비율 선택. 분할 레이아웃에 16:9 사용 금지.

**일러스트 (Illustration)** — 독립 아이콘, `[1:1]`:
```
[1:1] A [스타일] illustration of [대상] for a presentation slide.
Flat design, limited [N]-color palette ([hex 코드]).
Clean vector-like appearance, pure white (#FFFFFF) background.
No text. 1:1 square aspect ratio.
```
주의: Gemini는 투명 배경 미지원. `transparent` 대신 `pure white (#FFFFFF) background` 사용.

**인포그래픽 (Infographic)** — 전체 폭, `[16:9]`:
```
[16:9] A polished editorial infographic showing [데이터/프로세스].
[N] steps with labeled icons. Flat vector style, [색상 팔레트].
Legible at 600px width. No text labels (will be added separately).
16:9 aspect ratio.
```

### 태그 작성 예시

```markdown
### Slide 1 - Cover
- **Type**: Cover
- **Title**: AI가 바꾸는 물류의 미래
- NanoBanana: AI 물류 테마 표지 배경 | [16:9] A professional presentation cover for AI-powered logistics innovation. Futuristic tech aesthetic with deep navy (#0F172A) and electric blue (#3B82F6) gradient. Abstract network nodes and flowing data streams in the background. Clean centered composition with ample negative space for title text overlay. Soft ambient lighting with subtle glow effects. No text. 16:9 aspect ratio, high resolution.

### Slide 5 - 스마트 창고 시스템
- **Type**: Content
- **Layout**: 왼쪽 이미지 (50%) + 오른쪽 카드 (50%), body padding 없음
- **Key Message**: 자동화 창고의 핵심 구성요소
- NanoBanana: 스마트 창고 내부 전경 | [3:4] A photorealistic elevated shot of a modern automated warehouse interior with robotic arms and conveyor systems. Illuminated by cool white industrial LED lighting from above. Clean, organized shelving rows stretching into the distance. Professional corporate photography style. No text. 3:4 portrait aspect ratio.

### Slide 8 - 비용 절감 효과
- **Type**: Statistics (전체 배경)
- **Key Message**: 연간 30% 비용 절감
- NanoBanana: 비용 절감 인포그래픽 배경 | [16:9] A subtle muted background for a statistics slide. Soft blue-gray (#94A3B8) tones with abstract upward-trending arrow shapes. Desaturated, minimal, with significant negative space for chart overlay. No text. 16:9 aspect ratio.
```

### 이미지 자동 생성

아웃라인 승인 후 `generate-images.mjs`가 태그를 파싱하여 Gemini API로 자동 생성한다.
```bash
node scripts/generate-images.mjs --outline slide-outline.md --output slides/프레젠테이션명/assets
```

### 이미지 파일 명명 규칙 (자동 생성됨)

```
slides/프레젠테이션명/assets/slide-{NN}-{영문슬러그}.png
```
예: `assets/slide-01-cover.png`, `assets/slide-05-smart-warehouse.png`

---

## Expected slide-outline.md Format

```markdown
# [Presentation Title]

## Meta
- **Topic**: ...
- **Target Audience**: ...
- **Tone/Mood**: ...
- **Design Mode**: Professional / Creative / Education / Academic / Minimal
- **Slide Count**: N slides
- **Aspect Ratio**: 16:9
- **Color Palette**: Primary [hex], Accent [hex], Background [hex]

## Slide Composition

### Slide 1 - Cover
- **Type**: Cover
- **Title**: ...
- **Subtitle**: ...
- NanoBanana: [한글 설명] | [English prompt]

### Slide 2 - Table of Contents
- **Type**: Contents
- **Items**: ...

### Slide 3 - [Title]
- **Type**: Section Divider / Content / Statistics / Quote / Timeline / ...
- **Key Message**: ...
- **Details**:
  - ...
  - ...
- NanoBanana: [한글 설명] | [English prompt]

...

### Slide N - Closing
- **Type**: Closing
- **Message**: ...
- NanoBanana: [한글 설명] | [English prompt]
```

---

## organizer-agent Call Examples

```
Task tool call:
- subagent_type: "organizer-agent"
- prompt: |
    Create a presentation outline for the following topic.

    Topic: [user topic]
    Requirements: [user requirements]
    Research results: [if available]
    Design Mode: [auto-matched mode — Professional/Creative/Education/Academic/Minimal]

    IMPORTANT — Design Mode:
    Meta 섹션에 "Design Mode: [mode]" 필드를 반드시 포함하세요.
    모드별 규칙은 .claude/docs/design-modes.md 참조.
    - Professional: Action Title (주장 문장), 모든 슬라이드에 visual element 필수
    - Creative: aesthetic preset 선정, Anti-AI-slop, display font
    - Education: 1 슬라이드 = 1 개념, 텍스트+이미지 쌍, 18pt 이상
    - Academic: 제목 = 완전한 문장, 40단어 이하, 흰색 배경 고정
    - Minimal: 기본값, Pretendard, typography-driven

    IMPORTANT — NanoBanana 이미지 태그:
    이미지가 필요한 슬라이드에 NanoBanana: 태그를 포함하세요.
    형식: - NanoBanana: [한글 설명] | [English prompt for Gemini]

    프롬프트 작성 규칙 (.claude/docs/nanoBanana-guide.md 참조):
    - 서술형 완전한 영어 문장 (키워드 나열 금지)
    - "no text" 필수 (이미지 내 텍스트 금지)
    - 색상은 Meta Color Palette의 hex 코드 사용
    - 기본 비율 16:9, 다른 비율 시 [1:1] 힌트 포함
    - "transparent" 금지 → "pure white (#FFFFFF) background" 사용
    - 조명/구도/스타일 키워드 포함

    Meta 섹션에 Color Palette 필수 포함 (hex 코드).

    Save as slide-outline.md.
    [include expected format]
```

For feedback revisions:

```
Task tool call:
- subagent_type: "organizer-agent"
- prompt: |
    Revise the existing outline.

    Current outline: [slide-outline.md content]
    User feedback: [feedback content]
    Design Mode: [current mode from Meta section]

    Design Mode 변경 요청 시 Meta 섹션 업데이트 + 전체 슬라이드에 모드 규칙 반영.
    모드별 규칙: .claude/docs/design-modes.md 참조.

    NanoBanana 태그도 피드백에 맞게 수정하세요.
    프롬프트 규칙: .claude/docs/nanoBanana-guide.md 참조.

    Save the revised slide-outline.md.
```
