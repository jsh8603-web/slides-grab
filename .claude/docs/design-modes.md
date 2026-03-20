# Design Modes

슬라이드 디자인 모드별 상세 규칙. `slide-outline.md` Meta 섹션의 `Design Mode` 필드로 결정.

---

## Professional Mode

비즈니스/컨설팅/임원 보고서용. Pyramid Principle 기반 구조화.

### Color Palettes (10종 — outline Meta에서 번호 또는 이름으로 선택)

| # | Name | Primary | Accent | Background | Text |
|---|------|---------|--------|------------|------|
| 1 | Midnight Executive | #0F172A | #3B82F6 | #F8FAFC | #1E293B |
| 2 | Forest & Moss | #1B4332 | #95D5B2 | #F0FDF4 | #14532D |
| 3 | Slate Authority | #334155 | #F59E0B | #FFFFFF | #1E293B |
| 4 | Navy Precision | #1E3A5F | #60A5FA | #F1F5F9 | #0F172A |
| 5 | Charcoal & Gold | #1C1917 | #D97706 | #FAFAF9 | #292524 |
| 6 | Deep Burgundy | #4A0404 | #DC2626 | #FEF2F2 | #1C1917 |
| 7 | Steel & Teal | #1E293B | #14B8A6 | #F0FDFA | #0F172A |
| 8 | Warm Graphite | #292524 | #EA580C | #FFFBEB | #1C1917 |
| 9 | Cobalt Strategy | #1E3A8A | #6366F1 | #EEF2FF | #1E293B |
| 10 | Monochrome Power | #18181B | #71717A | #FAFAFA | #09090B |

### Font Stack

```css
font-family: 'Pretendard', 'Inter', -apple-system, 'Segoe UI', sans-serif;
```

### Layout Principles

- **Pyramid Principle**: 결론 먼저 → 근거 → 세부사항 (MECE 구조)
- **Action Title 필수**: 모든 슬라이드 제목은 핵심 주장 문장 (주제 라벨 금지)
  - BAD: "시장 분석" / "Q3 실적"
  - GOOD: "동남아 시장이 3년 내 2배 성장한다" / "Q3 매출이 전년 대비 23% 증가했다"
- **1 슬라이드 = 1 메시지**: 보조 데이터는 appendix로 분리
- **Every slide must have 1+ visual element**: 텍스트만 있는 슬라이드 금지 (차트, 아이콘, 이미지, 다이어그램 중 하나 이상)

### Typography Hard Floor (Professional)

| Purpose | Min Size | 위반 시 대응 |
|---------|:--------:|-------------|
| Slide Title | 24pt | 문장 축약 |
| Body | 14pt | 항목 감소 또는 슬라이드 분할 |
| Caption/Source | 10pt | 텍스트 축약 |
| Label/Badge | 10pt | 약어 사용 |

**10pt 미만 텍스트 생성 절대 금지.** 콘텐츠 초과 시 폰트 축소 대신 슬라이드 분할.

### Required Rules

- 숫자/데이터는 가장 큰 폰트로 강조 (Hero Number 패턴)
- 출처(source) 반드시 슬라이드 하단 캡션으로 표기
- 차트/그래프에 데이터 레이블 직접 표시 (범례 최소화)
- Cover 슬라이드에 날짜 + 발표자/조직명 포함

### Forbidden

- 제목 아래 밑줄(underline) 장식
- 기본 파란색 (#0000FF, #0066CC 등 Office 기본 색상)
- 본문 텍스트 center 정렬 (좌측 정렬 원칙, 숫자/캡션 예외)
- 워드아트/그림자 효과가 과도한 제목
- 글머리 기호(bullet) 3단계 이상 중첩
- **10pt 미만 폰트 사용** — Hard Floor 위반

### NanoBanana 사용 규칙 (Professional)

- **허용 범위**: Tier 1-2 + 아이콘 세트
- **아이콘 스타일**: 플랫 2색 아이콘, 굵은 아웃라인, 브랜드 accent 색상
- **인포그래픽 프레임**: 허용 (프레임만, 데이터 없이)
- **핵심 키워드**: `corporate`, `polished editorial`, `professional`, `clean`
- **Tier 3 슬라이드**: NanoBanana 미사용 → HTML-only 데이터 시각화

### QA Checklist

- [ ] **Squint Test**: 모니터에서 2m 떨어져도 핵심 메시지가 보이는가
- [ ] **10초 규칙**: 슬라이드를 10초 보고 핵심 메시지 1개를 말할 수 있는가
- [ ] **Action Title**: 모든 제목이 주장/결론 문장인가 (주제 라벨이 아닌가)
- [ ] **Visual Element**: 모든 슬라이드에 텍스트 외 시각 요소가 1개+ 있는가
- [ ] **Color Consistency**: 선택한 팔레트 색상만 사용했는가
- [ ] **Data Source**: 숫자/통계가 있는 슬라이드에 출처가 명시되었는가

---

## Creative Mode

마케팅/디자인/공모전/창작 발표용. Anti-AI-slop 원칙 적용.

### Aesthetic Direction

모드 진입 시 먼저 **aesthetic intent**(미적 의도)를 선정한다. 강도(intensity)가 아니라 방향(intent)이 핵심.

| Preset | Visual Feel | When to Use |
|--------|------------|-------------|
| Brutalist | Raw, exposed grid, monospace | Tech manifesto, disruption |
| Neo-Retro | 70s/80s typography revival | Culture, nostalgia, branding |
| Glassmorphism | Frosted glass, blur, transparency | SaaS, modern product |
| Organic Flow | Blob shapes, natural curves | Wellness, sustainability |
| Editorial | Magazine-style, strong typography | Fashion, media, luxury |
| Neon Noir | Dark bg + neon accents | Gaming, nightlife, entertainment |
| Paper Cut | Layered paper textures, shadows | Craft, education, storytelling |
| Geometric Pop | Bold shapes, primary colors | Startup pitch, energy |
| Cinematic | Widescreen crops, film grain | Documentary, narrative |
| Ukiyo-e Modern | Japanese woodblock + modern | Art, cross-cultural |
| Risograph | Grain, misregistration, limited ink | Indie, zine, grassroots |
| Data Art | Data as visual medium | Data storytelling, annual report |

### Font Stack

디스플레이 폰트를 적극 사용. Inter/Roboto/Arial 금지 (너무 generic).

```css
/* Display (제목) — 프레젠테이션 성격에 맞게 선택 */
font-family: 'Space Grotesk', 'Syne', 'Clash Display', 'Cabinet Grotesk', sans-serif;

/* Body — 가독성 확보 */
font-family: 'Pretendard', 'Plus Jakarta Sans', sans-serif;
```

Google Fonts CDN 예시:
```html
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet">
```

### Layout Principles

- **Asymmetric layouts**: 50:50 대칭 금지, 30:70 또는 golden ratio (1:1.618) 사용
- **Overlapping elements**: 요소 간 겹침으로 깊이감 생성
- **Diagonal/angular flow**: 수평/수직 그리드만 사용하지 않음
- **Repeating visual motif**: 덱 전체에 반복되는 시각 요소 (rounded frame, icon circle, 대각선 stripe 등)
- **Full-bleed images**: 이미지는 슬라이드 경계까지 확장 (여백 없는 꽉 찬 이미지)

### Color Palette

outline Meta의 Color Palette를 우선 사용하되, preset별 권장 팔레트:

- **대비 원칙**: 배경-전경 명도 차이 최소 60%
- **악센트**: 전체 면적의 10~15%만 차지
- **흑백 + 1색**: 가장 안전한 creative 팔레트

### Typography Hard Floor (Creative)

| Purpose | Min Size |
|---------|:--------:|
| Headline | 28pt |
| Subhead | 16pt |
| Body | 14pt |
| Caption | 10pt |

**10pt 미만 텍스트 생성 절대 금지.**

### Required Rules

- 첫 3장 안에 aesthetic direction이 명확히 드러나야 한다
- 슬라이드 전환 시 시각적 리듬감 (밝은→어두운→밝은 또는 밀도 변화)
- 텍스트 계층: 최대 3단계 (headline / subhead / body)
- NanoBanana 프롬프트에 aesthetic preset 키워드 반드시 포함

### Forbidden (Anti-AI-Slop)

- Purple gradient (#7C3AED~#EC4899) + white background 조합 (AI 생성물의 전형적 시각)
- 동일한 크기/색상의 3~4개 카드를 나란히 배치 (generic grid)
- Stock photo 느낌의 "사람들이 웃으며 회의하는" 이미지
- 모든 슬라이드가 동일한 레이아웃 반복
- Drop shadow + rounded corner + gradient의 3종 세트 남용
- "Designed with AI" 느낌의 과도하게 깔끔한 대칭

### NanoBanana 사용 규칙 (Creative)

- **허용 범위**: 전 Tier 적극 사용
- **아이콘 스타일**: 아이소메트릭, 파스텔, 소프트 쉐도우
- **인포그래픽 프레임**: 허용 (추상 shapes 포함)
- **핵심 키워드**: `aesthetic`, `bold`, `expressive`, `dynamic composition`
- **NanoBanana 프롬프트에 aesthetic preset 키워드 필수 포함**

### QA Checklist

- [ ] **Aesthetic Consistency**: 선정한 preset의 feel이 전 슬라이드에 일관되는가
- [ ] **AI-Slop Check**: purple gradient + white bg 조합이 없는가
- [ ] **Font Distinctiveness**: Inter/Roboto/Arial이 아닌 display 폰트를 사용했는가
- [ ] **Layout Variety**: 3장 이상 연속으로 동일 레이아웃이 반복되지 않는가
- [ ] **Visual Motif**: 반복 시각 요소가 3장 이상에서 등장하는가
- [ ] **Overlap/Asymmetry**: 최소 2장에서 비대칭 또는 겹침 레이아웃을 사용했는가

---

## Education Mode

어린이 대상 교육용 (초등학교, 주일학교 등). Mayer 멀티미디어 학습 원리 + CLT(인지부하이론) 적용.

### Age Groups

| Group | Age | Font Min | Characteristics |
|-------|-----|----------|-----------------|
| Lower | 6-8 | 22pt | 짧은 문장, 큰 아이콘, 극단적 단순화 |
| Upper (default) | 9-12 | 18pt | 문단 가능, 개념 연결, 적절한 추상화 |

outline Meta에 `Age Group: lower` 또는 `Age Group: upper` 지정. 미지정 시 upper(9-12).

### Font Stack

넓은 x-height와 카운터로 아동 가독성 최적화:

```css
/* Primary */
font-family: 'Nunito', 'Verdana', sans-serif;

/* 강조/제목 (둥글고 친근한) */
font-family: 'Nunito', sans-serif;
font-weight: 700;
```

Google Fonts CDN:
```html
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap" rel="stylesheet">
```

### Color Palette

- **배경**: 중성색 (white, cream, 아주 연한 회색) — 과도한 원색 배경은 감각 과부하 유발
- **포인트 컬러**: 악센트로만 사용 (배지, 아이콘, 강조 텍스트)
- **주요 색상**: Blue (#3B82F6, 집중력) + Yellow (#F59E0B, 기분 향상) 중심
- **보조 색상**: Green (#10B981, 자연/성장) + Orange (#F97316, 에너지)
- **제한 색상**: Red는 최소 사용 (경고/위험 의미가 강함, 과도 사용 시 불안 유발)

```css
/* Education 기본 팔레트 */
--bg-primary: #FAFAF9;
--bg-card: #FFFFFF;
--text-primary: #1C1917;
--text-secondary: #57534E;
--accent-blue: #3B82F6;
--accent-yellow: #F59E0B;
--accent-green: #10B981;
--accent-orange: #F97316;
```

### Layout Principles (Mayer + CLT)

- **Segmenting Principle**: 1 슬라이드 = 1 개념 (Working Memory 한계 고려)
- **Multimedia Principle**: 텍스트 + 이미지 항상 쌍으로 배치 (텍스트만 있는 슬라이드 금지)
- **Spatial Contiguity**: 텍스트와 관련 이미지를 가까이 배치 (떨어뜨리지 않기)
- **Coherence Principle**: 관련 없는 장식 요소 제거 (cute하더라도 학습과 무관하면 삭제)
- **Signaling Principle**: 핵심 키워드 볼드/컬러 강조, 시각적 화살표로 흐름 안내

### Visual Elements

- **Rounded corners**: 모든 요소에 `border-radius: 16pt` 이상 (친근함)
- **아이콘**: 60-80px 크기, 단순한 filled 스타일
- **터치/클릭 타겟**: 75x75px 이상 (NN/G 아동 UX 가이드라인)
- **여백**: 요소 간 간격 충분히 (밀집 배치 금지)
- **이모지 활용 가능**: 교육 맥락에서 이모지로 개념 보조 (단, 핵심 정보 전달 수단으로는 사용 금지)

### Item Count Limits (PPTX 오버플로 방지)

18pt 폰트 기준(720×405pt 슬라이드)으로 항목 수를 제한한다. 초과 시 슬라이드를 분할한다.

| 레이아웃 | 최대 항목 수 | 초과 시 |
|---------|------------|--------|
| 카드 그리드 (2열) | 4개 | 2+2 또는 3+2 슬라이드 분할 |
| 카드 그리드 (3열) | 3개 | 슬라이드 분할 |
| 리스트/체크리스트 | 5개 | 슬라이드 분할 |
| 이미지+텍스트 병렬 | 3포인트 | 텍스트 축소 또는 분할 |

6개+ 항목이 한 슬라이드에 필요하면 반드시 분할. Segmenting Principle (1슬라이드=1개념)과도 부합.

### Typography Hard Floor (Education)

Education 모드는 일반 Hard Floor보다 높은 최소값을 적용한다:

| Purpose | Upper (9-12) | Lower (6-8) |
|---------|:------------:|:------------:|
| Title | 28pt | 32pt |
| Body | **18pt** | **22pt** |
| Caption | 14pt | 16pt |
| Label | **14pt** | **16pt** |

**18pt (upper) / 22pt (lower) 미만 텍스트 생성 절대 금지.**

### Required Rules

- 슬라이드당 텍스트 최대 30단어 (lower) / 50단어 (upper)
- 모든 이미지에 관련 텍스트 캡션 동반 (Multimedia Principle)
- 퀴즈/질문 슬라이드 최소 2장 포함 권장 (참여 유도)
- 색상 대비: 배경-텍스트 WCAG AA 이상

### Forbidden

- 작은 글씨 (18pt 미만)
- 슬라이드 전체가 원색 배경 (감각 과부하)
- 복잡한 차트/그래프 (단순 막대/원 그래프만 허용)
- 텍스트만 있는 슬라이드 (이미지/아이콘 반드시 동반)
- 3단계 이상 계층 구조 (최대 2단계: 제목 + 본문)
- 추상적 비유 (lower 그룹에서는 구체적 사물로만 설명)

### NanoBanana 사용 규칙 (Education)

- **허용 범위**: Tier 1 + 구체적 사물 (추상 메타포 금지)
- **아이콘 스타일**: 둥근 캐릭터형, 원색, 친근한 느낌
- **인포그래픽 프레임**: 단순한 것만 허용 (복잡한 프레임은 혼란 유발)
- **핵심 키워드**: `friendly`, `pastel`, `flat`, `rounded`, `cheerful`
- **Lower (6-8)에서는 추상적 비유 금지** — 구체적 사물로만 표현

### QA Checklist

- [ ] **Font Size**: 모든 텍스트가 18pt (upper) / 22pt (lower) 이상인가
- [ ] **Single Concept**: 각 슬라이드가 1개 개념만 다루는가
- [ ] **Text + Image Pair**: 모든 슬라이드에 텍스트와 이미지가 함께 있는가
- [ ] **Spatial Contiguity**: 텍스트와 관련 이미지가 가까이 배치되었는가
- [ ] **Rounded Corners**: 모든 카드/박스/이미지에 border-radius 16pt+ 적용되었는가
- [ ] **Color Safety**: Red 사용이 최소한인가, 배경이 중성색인가
- [ ] **Word Count**: 슬라이드당 단어 수가 제한 이내인가

---

## Academic Mode

학술 발표/연구 논문/학회 프레젠테이션용. 데이터 정확성과 논리 구조가 최우선.

### Color Palette (고정 — 변경 금지)

| Role | Color | Usage |
|------|-------|-------|
| Primary | #1F4E79 | 제목, 강조, 차트 주요 색상 |
| Accent | #2E75B6 | 보조 강조, 차트 보조 색상 |
| Background | #FFFFFF | 모든 슬라이드 배경 (흰색 고정) |
| Text | #333333 | 본문 텍스트 |
| Light Gray | #F2F2F2 | 테이블 교차행, 섹션 구분 |

### Font Stack

단일 sans-serif 폰트. 장식성 제거.

```css
font-family: 'Arial', 'Calibri', sans-serif;
```

한글 포함 시:
```css
font-family: 'Pretendard', 'Arial', 'Calibri', sans-serif;
```

### Layout Principles

- **White background 고정**: 모든 슬라이드 배경 흰색 (어두운 테마, 이미지 배경 금지)
- **Action Title = Complete Sentence**: 모든 제목은 주장을 담은 완전한 문장
  - BAD: "실험 결과"
  - GOOD: "처리군이 대조군 대비 37% 높은 반응률을 보였다"
- **Ghost Deck Test**: 제목만 순서대로 읽었을 때 전체 논문/발표의 논리가 전달되어야 한다
- **본문 40단어 이하**: 슬라이드당 본문 텍스트 최대 40단어 (제목 제외)
- **데이터 중심**: 주장에는 반드시 수치/데이터 동반

### Typography (Hard Floor 포함)

| Purpose | Size | Weight | Hard Floor |
|---------|------|--------|:----------:|
| Slide Title | 28-32pt | 700 | **24pt** |
| Body | 18-22pt | 400 | **14pt** |
| Axis Label / Caption | 12-14pt | 400 | **10pt** |
| Source / Footnote | 10-11pt | 400 | **10pt** |

**10pt 미만 텍스트 생성 절대 금지.**

### Required Rules

- 모든 차트/그래프에 축 레이블(axis label) + 단위 필수
- 인용/데이터 출처는 슬라이드 하단에 학술 형식으로 표기 (Author, Year)
- Figure/Table 번호 매기기 (Fig. 1, Table 1 등)
- 결론 슬라이드 필수 (핵심 findings 3개 이내 요약)

### Forbidden

- 장식용 아이콘/클립아트
- 배경 이미지 (흰색 배경 고정)
- "Thank You" / "Q&A" 슬라이드 (대신 "Conclusions" + "Discussion" 사용)
- 3색 초과 사용 (Primary + Accent + Gray 계열만)
- 애니메이션/전환 효과
- 이모지

### NanoBanana 사용 규칙 (Academic)

- **허용 범위**: 표지 1장만
- **아이콘 스타일**: 금지 (장식 요소 전면 금지)
- **인포그래픽 프레임**: 금지
- **핵심 키워드**: 해당 없음 — 데이터와 텍스트만으로 구성
- **NanoBanana 태그**: 표지 이외 슬라이드에 작성 금지

### QA Checklist

- [ ] **Ghost Deck Test**: 모든 슬라이드 제목만 순서대로 읽었을 때 논리가 통하는가
- [ ] **Action Title**: 모든 제목이 완전한 문장(주장)인가
- [ ] **40 Words**: 모든 슬라이드 본문이 40단어 이하인가
- [ ] **White Background**: 모든 슬라이드 배경이 흰색인가
- [ ] **3 Colors**: Primary + Accent + Gray 외 색상이 없는가
- [ ] **Data Citation**: 수치/데이터가 있는 슬라이드에 출처가 있는가
- [ ] **No Decorative**: 장식용 아이콘/클립아트가 없는가
- [ ] **Conclusions**: 마지막 슬라이드가 "Conclusions"인가 ("Thank You" 아닌가)

---

## Minimal Mode (Default)

기존 design-skill의 핵심 철학을 유지. 범용/미지정 시 기본값.

### Font Stack

```css
font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

### Sub-themes (CSS)

기존 5개 CSS 테마를 서브 옵션으로 제공:

| Theme | File | Feel |
|-------|------|------|
| Executive | `themes/executive.css` | Refined business |
| Sage | `themes/sage.css` | Calm, trustworthy |
| Modern Dark | `themes/modern-dark.css` | High-impact dark |
| Corporate | `themes/corporate.css` | Traditional business |
| Warm | `themes/warm.css` | Warm, approachable |

### Layout Principles

- Less is More: 불필요한 장식 제거
- Typography-Driven: 폰트 크기 대비로 시각적 임팩트
- Strategic Color: 2-3색 제한, 단색 베이스 + 악센트
- Whitespace: 공백을 적극 활용

### Typography Hard Floor (Minimal)

design-skill의 기본 타이포그래피 Hard Floor 적용:

| Purpose | Min Size |
|---------|:--------:|
| Slide Title | 24pt |
| Body | 14pt |
| Caption | 10pt |
| Label | 10pt |

**10pt 미만 텍스트 생성 절대 금지.**

### Required Rules

- Pretendard 웹폰트 CDN 링크 필수 포함
- 720pt x 405pt 슬라이드 규격
- 하단 여백 0.5" 이상

### NanoBanana 사용 규칙 (Minimal)

- **허용 범위**: Professional과 동일 (Tier 1-2 + 아이콘 세트)
- **아이콘 스타일**: 라인 아이콘, 1색, 가는 스트로크
- **인포그래픽 프레임**: 허용 (프레임만)
- **핵심 키워드**: `muted`, `desaturated`, `minimal`, `subtle`
- **과도한 이미지 사용 자제**: typography-driven 원칙에 따라 이미지는 보조 역할

### QA Checklist

- [ ] **Whitespace**: 과밀 배치 없이 충분한 여백이 있는가
- [ ] **Color Limit**: 3색 이내로 사용했는가
- [ ] **Typography Hierarchy**: 크기/굵기로 명확한 계층이 있는가
- [ ] **Consistency**: 전 슬라이드에서 스타일이 일관되는가

---

## Mode Selection Quick Reference

| Keyword | Mode | Key Differentiator |
|---------|------|--------------------|
| 비즈니스, 임원, 보고서, 투자, 컨설팅 | Professional | Action Title + Visual every slide |
| 마케팅, 디자인, 창작, 공모전 | Creative | Anti-AI-slop + asymmetric layouts |
| 어린이, 유치원, 주일학교, 초등 | Education | 18pt min + single concept + rounded |
| 학술, 연구, 논문, 학회 | Academic | White bg + Ghost Deck Test + 40 words |
| 기타, 범용, 미지정 | Minimal | Pretendard + whitespace + typography |

---

## NanoBanana IV 프로파일 (디자인 모드별)

`generate-images.mjs`의 `DESIGN_MODE_PROFILES`에 정의. 이미지 생성 후 IV 검증 시 모드별 밝기/채도 임계값을 적용.

| Mode | Min Brightness | Max Brightness | Min Saturation | 특성 |
|------|:-:|:-:|:-:|------|
| Professional | 40 | 230 | 0.05 | 중립 톤, 과도한 밝기/어둠 방지 |
| Creative | 20 | 250 | 0.10 | 넓은 범위 허용, 채도 요구 |
| Education | 60 | 240 | 0.15 | 밝고 선명한 색상 요구 |
| Academic | 50 | 245 | 0.0 | 흰 배경 기반, 채도 무관 |
| Minimal | 40 | 240 | 0.0 | 기본값, 채도 무관 |
