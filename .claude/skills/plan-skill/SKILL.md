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

### 0. Prepare VQA Keyword Data (자동 — organizer-agent 호출 전)

**필수**: organizer-agent를 호출하기 전에 아래 명령으로 키워드 데이터를 자동 추출:

```bash
node scripts/extract-keywords.mjs
```

출력 결과를 organizer-agent 호출 프롬프트의 `[KEYWORD_INJECTION]` 자리에 그대로 삽입.

이 단계를 건너뛰면 organizer-agent가 검증된 키워드를 사용하지 않아 VQA 점수가 낮아집니다.

### 1. Delegate Draft Creation to organizer-agent

Use the Task tool to call `organizer-agent` and generate a `slide-outline.md` draft.

**Include in the prompt:**
- User topic and requirements
- Research results (if available)
- Tone/mood requests
- **VQA keyword data** (Step 0에서 추출한 추천/비추천 키워드)
- Expected format for `slide-outline.md` (see format below)

### 1.5. NanoBanana Prompt Review (자동 — organizer-agent 완료 후)

organizer-agent가 아웃라인을 완성하면, supervisor가 직접 모든 `NanoBanana:` 프롬프트를 검토·개선한다.
이 단계는 VQA 테스트에서 학습한 패턴을 실제 프롬프트에 반영하는 **품질 게이트** 역할.

**검토 기준** (nanoBanana-guide.md + extract-keywords.mjs 출력 참조):

1. **추천 키워드 반영**: Step 0 키워드 데이터에서 해당 카테고리의 추천 키워드가 프롬프트에 자연스럽게 포함되어 있는지 확인. 없으면 추가.
2. **비추천 키워드 제거**: avg < 18 키워드가 포함되어 있으면 대체어로 교체.
3. **10대 규칙 준수**: 서술형 문장, no text 필수, hex 색상, 비율 힌트, 조명/구도 키워드 등.
4. **Tier 적합성**: 슬라이드 복잡도에 맞는 tier가 지정되었는지 확인.
5. **알려진 한계 회피**: hub-spoke 3/5+, staircase 등 불안정 도형이 사용되면 대체안 제시.
6. **프롬프트 길이**: 600자 이내 (IP-08 WARN 방지). enhancePrompt()가 ~150자를 추가하므로 원본은 ~450자 이내.

**수정 방법**: 아웃라인 파일의 NanoBanana 태그를 직접 Edit하여 개선. 구조/콘텐츠는 변경하지 않음.

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
4. **NanoBanana 인포그래픽 금지** — AI 생성 이미지에 가짜 데이터(차트, 그래프, 표, 캘린더, 숫자)가 포함되는 프롬프트 작성 금지. 데이터 시각화는 HTML/CSS로 직접 구현한다.
5. **NanoBanana 한글 텍스트 금지** — AI 이미지 내 한글 텍스트가 포함되는 프롬프트 금지. 텍스트가 필요하면 영문만 사용하거나 HTML 텍스트 오버레이로 처리.

## 슬라이드 밀도 제한

1슬라이드에 다음 조합이 동시에 존재하면 **반드시 2장 이상으로 분할**:
- 표(table/grid) + 계산박스(calculation) + 수식(formula)
- 5행 이상 표 + 3개 이상 부가 텍스트 블록
- 4개 이상 카드 + 각 카드에 3줄 이상 텍스트

**밀도 초과 시 대응 (폰트 축소 대신):**
1. 슬라이드 분할 (요약 → 상세)
2. 항목 수 감소 (핵심 3개만 남기고 appendix로 이동)
3. 레이아웃 단순화 (표 → 핵심 지표 3개 하이라이트)

---

## 복잡도 사전 판정 (NanoBanana 태그 작성 전 필수)

1. 핵심 개념 수 → Tier 1(1-2개) / Tier 2(3-5개) / Tier 3(6개+)
2. `nanoBanana-guide.md` "이미지 유형 결정 트리" 적용
3. Visual 메타 태그로 판정 기록:

| 태그 | 의미 |
|------|------|
| `Visual: NanoBanana (Tier 1, metaphor photo)` | AI 히어로 이미지 |
| `Visual: NanoBanana (Tier 2, context background)` | AI 배경 |
| `Visual: NanoBanana (Tier 2, icon set: [아이콘...])` | AI 아이콘 세트 |
| `Visual: NanoBanana (infographic frame, timeline N nodes)` | AI 프레임 |
| `Visual: HTML chart/diagram` | HTML 직접 구현 |
| `Visual: HTML only` | 텍스트/테이블만 |

---

## NanoBanana 이미지 태그

### 태그 형식
```markdown
- NanoBanana: [한글 설명] | [English prompt for Gemini]
```

### 비율 힌트 (레이아웃 기반 결정 — 16:9 기본값 금지)

| 레이아웃 | 비율 |
|---------|------|
| 전체 배경 (표지, 섹션) | `[16:9]` |
| 좌우 50:50 (padding 없음) | `[3:4]` |
| 좌우 55:45 (padding 없음) | `[1:1]` |
| 좌우 분할 (padding 있음) | `[4:3]` |
| 일러스트/아이콘 | `[1:1]` |

### 프롬프트 작성 규칙

**`nanoBanana-guide.md` 10대 규칙 필수 적용.** 핵심 요약:
1. 서술형 문장 (키워드 나열 금지)
2. 용도 선언 ("A presentation slide background for...")
3. `"no text"` 필수
4. 긍정 표현
5. 촬영 용어 (wide-angle, bird's-eye 등)
6. 조명 묘사
7. 색상은 이름으로 (hex 직접 사용 금지 — enhancePrompt가 자동 주입)
8. 스타일 키워드 2-3개
9. `[비율]` 힌트 + aspect ratio 문구
10. 분할 레이아웃: `centered composition, fills the frame` (negative space 금지)
11. `transparent` 금지 → `pure white (#FFFFFF) background`

### 태그 작성 예시

```markdown
### Slide 1 - Cover
- **Type**: Cover
- NanoBanana: AI 물류 표지 | [16:9] A professional presentation cover for AI-powered logistics. Futuristic tech aesthetic with deep navy and electric blue. Abstract network nodes, ample negative space. No text. 16:9 aspect ratio.

### Slide 5 - 스마트 창고
- **Layout**: 왼쪽 이미지 (50%) + 오른쪽 카드 (50%), body padding 없음
- NanoBanana: 스마트 창고 내부 | [3:4] A photorealistic elevated shot of modern automated warehouse with robotic arms. Cool white LED lighting. Fills the frame, centered composition. No text. 3:4 portrait aspect ratio.
```

### 이미지 자동 생성

아웃라인 승인 후: `node scripts/generate-images.mjs --outline slide-outline.md --output slides/프레젠테이션명/assets`
파일 명명: `assets/slide-{NN}-{영문슬러그}.png`

---

## Expected slide-outline.md Format

```markdown
# [Presentation Title]

## Meta
- **Topic**: ...
- **Target Audience**: ...
- **Tone/Mood**: ... (반드시 영어로 작성 — 예: "Professional, data-driven, practical guide". 한국어 Tone/Mood는 generate-images.mjs 스타일 앵커에서 제거됨)
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

    CRITICAL — VQA 검증된 키워드 (준수 필수, 검증 대상):
    아래는 VQA 스코어링으로 검증된 카테고리별 키워드 데이터입니다.
    각 NanoBanana 프롬프트는 해당 카테고리의 추천 키워드를 2~4개 포함해야 합니다 (5개 이상 금지 — 과밀은 VQA 점수를 낮춤).
    키워드를 자연스러운 영어 문장 안에 녹여서 사용하세요 (단순 나열 금지).
    hex 색상 코드(#RRGGBB)는 프롬프트에 넣지 마세요 — Gemini가 무시하며 PF를 낮춥니다. 자연어 색상명("deep navy", "warm gold") 사용.
    프롬프트 길이는 450자 이내로 작성하세요 (자동 강화로 ~150자 추가됨).

    [KEYWORD_INJECTION]

    검증된 프롬프트 템플릿: .claude/docs/nanoBanana-prompt-library.md 참조

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
