# NanoBanana 검증된 프롬프트 라이브러리

VQA 스코어링으로 검증된 고품질 프롬프트 템플릿. `--vqa --update-scores` 실행 시 자동 갱신.

---

## 사용법

1. 카테고리 선택 (metaphor/icon/frame/cover/background)
2. 해당 카테고리의 검증된 템플릿 선택
3. `[주제]`, `[색상]` 등 변수를 실제 값으로 대체
4. `nanoBanana-prompt-scores.json`의 고점수 키워드를 우선 사용

---

## Metaphor (개념적/감정적 비주얼)

### 금융/투자

```
[16:9] A cinematic aerial shot of a financial district at dusk, glass towers reflecting warm golden sunset light on still water. Professional editorial photography, 85mm lens, shallow DOF. Color palette: deep navy ([hex1]), warm gold ([hex2]). No text.
```
VQA 기대 점수: 23+ | 핵심 키워드: `cinematic`, `aerial`, `shallow DOF`, `editorial`

```
[16:9] Zen stones carefully stacked on perfectly still water surface, single warm directional light from left creating long shadows. Contemplative mood, metaphor for balanced portfolio. No text.
```
VQA 기대 점수: 22+ | 핵심 키워드: `zen stones`, `directional light`, `contemplative`

### 기술

```
[16:9] Abstract neural pathways glowing in dark space, interconnected nodes with subtle pulse animations frozen in time. Color palette: electric blue ([hex1]), deep purple ([hex2]). Futuristic, clean. No text.
```
VQA 기대 점수: 22+ | 핵심 키워드: `neural pathways`, `glowing`, `futuristic`

```
[16:9] Data center corridor with blue LED lights, perfectly symmetrical composition, cinematic depth. Modern infrastructure, polished concrete floor reflecting light. No text.
```
VQA 기대 점수: 23+ | 핵심 키워드: `symmetrical`, `cinematic depth`, `LED lights`

### 법률/규정

```
[16:9] Brass balance scales on polished marble surface, three-point softbox lighting, shallow DOF. Classical precision and fairness metaphor. Color palette: warm brass tones, cool marble white. No text.
```
VQA 기대 점수: 23+ | 핵심 키워드: `balance scales`, `marble`, `softbox lighting`

### 교육

```
[16:9] An open book with pages transforming into birds taking flight against a warm golden sky. Knowledge becoming freedom, conceptual photography. Soft ambient light. No text.
```
VQA 기대 점수: 22+ | 핵심 키워드: `open book`, `birds`, `golden sky`, `conceptual`

### 성장/전략

```
[16:9] A single green seedling emerging through cracked concrete, dramatic side lighting creating deep shadows. Breakthrough growth against all odds. Macro photography. No text.
```
VQA 기대 점수: 23+ | 핵심 키워드: `seedling`, `cracked concrete`, `dramatic`, `macro`

```
[16:9] Antique brass compass resting on a vintage navigation chart, warm directional light from upper left. Strategic direction and planning metaphor. Macro photography, shallow DOF. No text.
```
VQA 기대 점수: 22+ | 핵심 키워드: `compass`, `navigation chart`, `macro`, `directional light`

---

## Icon (플랫 아이콘/아이콘 세트)

### 단일 플랫 아이콘

```
[1:1] A flat design icon of [object], minimal style. 2-color palette ([hex1], [hex2]). Bold clean outlines, 2px stroke, rounded corners, no gradients, no shadow. Absolutely no text, no letters, no numbers, no labels, no currency symbols, no mathematical symbols, no punctuation marks. Pure geometric shapes only. White background. 1:1 square format.
```
VQA 기대 점수: 22+ | 핵심 키워드: `flat design`, `2-color`, `bold outlines`, `rounded corners`

### 아이콘 세트 (2×2)

```
[1:1] A set of 4 matching flat icons on white background, arranged in a 2x2 grid: top-left: [icon1], top-right: [icon2], bottom-left: [icon3], bottom-right: [icon4]. All icons share consistent style: 2-color palette ([hex1], [hex2]), 2px stroke, rounded corners, minimal flat design, no shadow. Absolutely no text, no letters, no numbers, no currency symbols, no mathematical symbols, no punctuation marks. Pure geometric shapes only.
```
VQA 기대 점수: 21+ | 핵심 키워드: `matching`, `consistent style`, `2px stroke`, `flat`

---

## Frame (인포그래픽 프레임)

### 타임라인 배경

```
[16:9] A minimal timeline background graphic for a presentation slide. Horizontal flow from left to right, [N] equally-spaced circular nodes connected by a thin curved ribbon path. Flat vector style, [accent hex] accent on nodes, light gray (#E5E7EB) background with subtle gradient to [bg hex]. Clearly visible shapes. No text, no numbers, no labels. 16:9 aspect ratio.
```
VQA 기대 점수: 21+ | 핵심 키워드: `timeline`, `circular nodes`, `ribbon path`, `flat vector`

### 프로세스 플로우

```
[16:9] Abstract process flow frame, [N] stages connected by dotted dashed lines with small arrow indicators. Clean flat vector style, subtle isometric grid background, [색상] color scheme. No text labels, no data. Suitable as presentation slide background. 16:9 ratio.
```
VQA 기대 점수: 21+ | 핵심 키워드: `process flow`, `dotted lines`, `arrow indicators`, `flat vector`

---

## Cover (표지)

```
[16:9] A professional presentation cover for [주제]. [스타일] design with [색상 팔레트 hex]. Clean centered composition with ample negative space for title text overlay. Soft ambient lighting with subtle glow effects. No text. 16:9 aspect ratio, high resolution.
```
VQA 기대 점수: 22+ | 핵심 키워드: `professional`, `centered composition`, `negative space`, `ambient lighting`

---

## Background (콘텐츠 배경)

```
[16:9] A subtle muted background for a presentation content slide about [주제]. Soft [색상] tones, abstract [패턴] texture. Must not compete with overlaid text and data. Desaturated, professional. No text. 16:9 aspect ratio.
```
VQA 기대 점수: 21+ | 핵심 키워드: `subtle`, `muted`, `desaturated`, `abstract texture`

---

## 회피 키워드 (VQA avg < 18 시 추가)

*초기 상태: `--vqa --update-scores` 실행으로 데이터 수집 후 자동 갱신*

---

## 갱신 방법

```bash
# 1. VQA 스코어링 + 키워드 DB 갱신
node scripts/generate-images.mjs --outline outline.md --output assets/ --vqa --update-scores

# 2. .claude/docs/nanoBanana-prompt-scores.json 확인
# 3. 고점수 키워드를 이 라이브러리의 해당 카테고리에 반영
# 4. avg < 18 키워드를 "회피 키워드" 섹션에 추가
```
