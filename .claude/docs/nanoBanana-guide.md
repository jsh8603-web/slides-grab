# NanoBanana 이미지 생성 가이드

PPTX 슬라이드용 이미지를 Gemini NanoBanana로 생성할 때 참조하는 가이드.
아웃라인의 `NanoBanana:` 태그를 영어 프롬프트로 변환하고, API를 호출하는 전체 절차를 다룬다.

---

## 모델 선택

| 용도 | 모델 ID | 특징 | 비용 |
|------|---------|------|------|
| 기본 (스크립트 기본값) | `gemini-2.5-flash-image` | 빠름, 이미지 생성 지원 확인됨 | ~$0.039/장 |
| 고품질 표지/핵심 비주얼 | `gemini-3-pro-image-preview` | Pro 최신, 고품질 | ~$0.067/장 |
| 최신 Flash | `gemini-3.1-flash-image-preview` | Flash 최신 | 미정 |

기본값: `gemini-2.5-flash-image`. 표지/핵심 슬라이드만 Pro 모델 사용.
**중요: Free Tier에서는 이미지 생성이 완전 차단됩니다.** 결제 활성화(Paid Tier) 필요.

---

## API 호출

```bash
# 기본 실행
node scripts/generate-images.mjs --outline slide-outline.md --output slides/프레젠테이션명/assets
# 체인 모드 (첫 이미지를 참조로 일관성 유지)
node scripts/generate-images.mjs --outline slide-outline.md --output slides/프레젠테이션명/assets --chain
# 특정 슬라이드만 재생성
node scripts/generate-images.mjs --outline slide-outline.md --output slides/프레젠테이션명/assets --regenerate 3,5,8
```

### 스크립트 옵션

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--model` | `gemini-2.5-flash-image` | 모델 ID |
| `--size` | `2K` | 해상도 (대문자 K 필수) |
| `--concurrency` | `3` | 동시 호출 수 (IPM 제한 고려) |
| `--chain` | false | 첫 이미지를 참조로 나머지 생성 |
| `--force` | false | 기존 이미지 전부 덮어쓰기 |
| `--regenerate` | - | 특정 슬라이드만 재생성 (쉼표 구분) |
| `--optimize` | true | Sharp 후처리 (리사이즈+압축) |
| `--dry` | false | 프롬프트만 확인 (API 호출 없음) |
| `--vqa` | false | VQA 스코어링 실행 |
| `--update-scores` | false | 누적 키워드 DB 갱신 |

### 자동 처리 기능

- **Rate Limit (429)**: 지수 백오프 자동 재시도 (최대 5회), Adaptive Concurrency
- **Safety Filter**: `finishReason` 파싱 → 차단 사유별 한글 안내
- **스타일 앵커**: outline Meta의 Color Palette + Tone/Mood를 모든 프롬프트에 자동 prepend
- **Sharp 후처리**: 비율별 해상도로 리사이즈+압축
- **체인 모드**: 첫 이미지를 참조 이미지로 나머지에 전달 → 덱 시각 일관성 확보

#### Sharp 지원 비율-해상도

| 비율 | 해상도 | 비율 | 해상도 |
|------|--------|------|--------|
| `16:9` | 1920×1080 | `4:3` | 1440×1080 |
| `3:4` | 1080×1440 | `1:1` | 1080×1080 |
| `3:2` | 1620×1080 | `2:3` | 1080×1620 |
| `9:16` | 1080×1920 | `21:9` | 2520×1080 |

새 비율 추가 시 `generate-images.mjs`의 `ASPECT_DIMENSIONS` 맵 업데이트 필요.

---

## IV/IP/IC/VQA 에러 발생 시 3분류 판정

| 탐지 | 오탐 시 수정 (탐지 코드) | 정탐-수정 시 수정 (생성 코드) | 정탐-한계 시 행동 |
|:----:|----------------------|----------------------|----------------|
| **IV** | `generate-images.mjs` IV부 | 이 파일의 프롬프트 규칙 | IL 기록 + 해당 구도 금지 |
| **IP** | `generate-images.mjs` IP부 | 이 파일 + `enhancePrompt()` | (거의 없음 — 프롬프트 수정 항상 가능) |
| **IC** | IC 프롬프트/임계값 | `plan-skill/SKILL.md` | IL 기록 + 추상 메타포 대체 |
| **VQA** | `scoreImageWithVQA` | 이 파일 + `enhancePrompt()` | IL 기록 + 해당 카테고리 게이트 하향 |

기록 의무 (판정 무관): 모든 에러를 `pptx-inspection-log.md`에 기록. 오탐은 "오탐", 정탐-한계는 "정탐-한계 + 한계 원인" 명시.
체크리스트: 오탐/정탐-수정 → `CLAUDE.md` §공통 절차 A~I, 정탐-한계 → 간소화 A~D.
상세: `vqa-pipeline-maintenance.md` §0.

---

## 프롬프트 작성 10대 규칙

### 1. 서술형 문장 사용 (키워드 나열 금지)
`BAD: "dog, park, 4k"` → `GOOD: "A golden retriever playing fetch in a sunlit city park, 85mm lens, shallow DOF"`

### 2. 용도/의도를 문장 앞에 선언
`"A professional presentation slide background for a tech quarterly report..."`

### 3. 텍스트는 HTML에서 처리
- `"No text whatsoever."` 명시 (자동 추가됨)
- **텍스트 고유 피사체 회피** (IP-11): 나침반, 시계, 계기판, 키보드, 계산기, 신문, 간판, 번호판

### 4. 긍정 표현 사용 (부정형 금지)
`BAD: "no cars, no people"` → `GOOD: "An empty, serene street with clean sidewalks"`

### 5. 촬영 용어로 구도 제어
`wide-angle shot` | `85mm portrait lens` | `low-angle` | `bird's-eye view` | `elevated 45°` | `macro shot`

### 6. 조명 묘사 필수
`soft golden-hour light` | `three-point softbox` | `cinematic lighting` | `cold clinical` | `warm ambient glow` | `rim lighting`

### 7. 색상은 이름으로 지정 (hex 직접 사용 금지)
프롬프트에 hex 코드 넣으면 Gemini가 텍스트로 렌더링. 색상 이름(deep navy, warm amber 등) 사용.
**D3 hex injection**: frame/icon 카테고리에서 `enhancePrompt()`가 palette hex를 자동 주입.

### 8. 스타일 키워드 조합
비즈니스: `corporate, professional, clean` | 기술: `futuristic, tech aesthetic, dark mode` | 교육: `pastel, friendly, flat design` | 창의: `vibrant, bold, high contrast`

### 9. 슬라이드 배경용 네거티브 스페이스 확보
- 배경용: `"muted"`, `"subtle"`, `"desaturated"` + `"negative space for text overlay"`
- frame/diagram: `"light gray background"` 사용 (순백은 IV-03 FAIL)

### 10. 분할 레이아웃(4:3, 3:4) — 프레임 채움 구도 필수
분할 레이아웃에서는 텍스트가 별도 컬럼이므로 네거티브 스페이스 불필요.
**금지**: `negative space`, `deep shadows`, `shallow depth of field`, `side lighting` 단독
**필수**: `centered composition` / `fills the frame` + `even lighting` / `balanced lighting`
`enhancePrompt()`가 4:3/3:4/1:1 비율 감지 시 "Subject fills the frame" 자동 추가.

### 11. 참조 이미지로 덱 일관성 유지
첫 이미지 생성 후 나머지에 참조 전달. NanoBanana 2: 최대 14장, Pro: 최대 11장.

---

## 이미지 유형 결정 트리

```
슬라이드 콘텐츠 분석
├─ 정량 데이터 (숫자, 비율, 비교 3+) → HTML/CSS 차트
├─ 프로세스/플로우 (3단계+, 실제 데이터) → HTML/CSS 다이어그램
├─ 표/매트릭스 → HTML Grid 테이블
├─ 아이콘/심볼 필요
│   ├─ 4~6개 일관된 세트 → NanoBanana 아이콘 세트
│   └─ 단일 아이콘 → NanoBanana 1:1 플랫 아이콘
├─ 인포그래픽 프레임 (데이터 없이 뼈대만)
│   └─ 타임라인/프로세스/비교 배경 → NanoBanana 허용
├─ 개념적/감정적 비주얼
│   ├─ 구체적 사물/장면 → NanoBanana 메타포 사진
│   └─ 추상 개념만 → NanoBanana 추상 일러스트
└─ 배경/분위기 설정 → NanoBanana 배경 사진
```

### Frame 카테고리 요소 수 가이드

| 요소 수 | NanoBanana | VQA avg | 비고 |
|:-------:|:----------:|:-------:|------|
| 2-3 | O 권장 | 24.3+ | pyramid/flowchart 안정적 |
| 4 | △ 주의 | 21.7 | "circular"+4 조합 피할 것 |
| 5+ | X HTML 권장 | — | 요소 수 오류 빈발 |

### 카테고리별 VQA 성능

| 카테고리 | avg VQA | 안정성 |
|----------|:-------:|:------:|
| background | 27.0 | 최우수 |
| cover | 26.5 | 우수 |
| metaphor | 26.8 | 우수 |
| icon | 26.0 | 양호 |
| frame | 23.5 | 불안정 (요소 수 의존) |

---

## 주제별 비주얼 메타포 매핑

**메타포 강도**: Literal(직접적) → **Metaphorical(은유적, 권장)** → Abstract(순수 추상, 배경만)

대표 예시 (전체 8개 도메인):

| 주제 | 메타포 | 프롬프트 요약 |
|------|--------|-------------|
| 금융/성장 | 콘크리트 뚫는 새싹 | Single seedling through cracked concrete, dramatic side lighting |
| 법률/준수 | 저울 | Brass balance scales on marble, three-point softbox |
| 기술/AI | 뉴럴 네트워크 | Abstract neural pathways in dark space, blue-purple palette |
| 전략/계획 | 나침반/지도 | Antique brass compass on vintage chart, warm directional light |

각 도메인(금융, 법률, HR, 기술, 전략, 의료, 교육, 제조, 지속가능성)의 세부 메타포는 git history 참조.

---

## 복잡도별 프롬프트 전략 (Tier 1/2/3)

| Tier | 개념 수 | NanoBanana 역할 | 전략 |
|------|--------|---------------|------|
| 1 | 1-2 | 주인공 이미지 (Hero) | 메타포 사진, 슬라이드 50%+ |
| 2 | 3-5 | 분위기 설정+아이콘 | 배경+아이콘, HTML이 데이터 |
| 3 | 6+ | 아이콘만 또는 미사용 | HTML-only, NanoBanana는 장식만 |

`| tier:N` 힌트는 선택적. 생략 시 기본 Tier 2.

---

## 아이콘/심볼 생성 가이드

### 단일 플랫 아이콘
```
[1:1] A flat design icon of [object], minimal style.
[N]-color palette ([hex1], [hex2], white).
Bold clean outlines, no gradients, no shadow.
Absolutely no text, no letters, no numbers, no labels.
Pure geometric shapes only. White background. 1:1 square format.
```

### 아이콘 세트 일괄 생성
```
[1:1] A set of [N] matching flat icons on white background,
arranged in a [rows×cols] grid: [위치별 아이콘 설명].
All icons share consistent style: [N]-color palette, 2px stroke,
rounded corners, minimal flat design, no shadow.
Absolutely no text, no letters, no numbers.
```

### 스타일 일관성
- 같은 프레젠테이션 내 아이콘은 한 프롬프트에 일괄 생성
- --chain 모드로 스타일 참조, 색상 hex 명시, 비율 항상 `[1:1]`

---

## 인포그래픽 프레임 생성

데이터 없이 시각적 뼈대만 AI로 생성. 순백 배경은 IV-03 FAIL → `#E5E7EB`~`#F1F5F9` 지정.

### 허용/금지
| 요소 | 허용? | 기준 |
|------|:---:|------|
| 노드/연결선 (텍스트 없이) | O | 시각적 뼈대만 |
| 분할/레이아웃 배경 | O | 장식용 |
| 수치가 적힌 차트 | X | 가짜 데이터 |
| 한글 라벨 | X | 렌더링 오탈자 |
| 영문 라벨 (2단어↓, 4개↓) | △ | Pro 모델 추천 |

---

## 이미지 검수 프로세스 (IP/IV/IC)

### IP (Image Preflight) — 생성 전 프롬프트 검증

| IP | 검사 | 판정 |
|----|------|------|
| IP-01 | 한글 포함 | ERROR → 건너뛰기 |
| IP-02 | Tier 3 + NanoBanana 태그 | WARN |
| IP-04 | 숫자 데이터 (`\d+%`, `$\d+`) | ERROR |
| IP-05 | 텍스트 렌더링 키워드 | ERROR |
| IP-07 | 인용부호 텍스트 | ERROR |
| IP-08 | 600자 초과 | WARN |
| IP-09 | 비율 불일치 (portrait+wide 등) | WARN |
| IP-13 | `staircase` 포함 | WARN |

### IV (Image Validate) — 생성 후 자동 검증

| IV | 검사 | 기준 | 판정 |
|----|------|------|------|
| IV-01 | Safety Filter | finishReason=SAFETY | FAIL |
| IV-02 | 밝기 < 30 | 너무 어두움 (커버/야경 제외) | WARN |
| IV-03 | 밝기 > 240 | 거의 흰색 | FAIL |
| IV-05 | 파일 < 10KB | 빈 이미지 | FAIL |
| IV-06 | 비율 차이 > 10% | 비율 불일치 | WARN |
| IV-09 | CIEDE2000 > 40 | 팔레트 불일치 | WARN |

### VQA (Vision Quality Assessment)

5항목 각 1-5점: prompt_fidelity, text_absence, composition, color_harmony, presentation_fit

| Total | 판정 | 대응 |
|:---:|------|------|
| 23-25 | PASS | 우수 |
| 20-22 | WARN | 허용 |
| < gate | FAIL | VQA 피드백 반영 재생성 |

**동적 gate**: `max(floor, categoryAvg × 0.85)`. floor: icon/frame=18, metaphor/bg=17, cover=16.
**절대 하한 (D4)**: total < 15 → 무조건 재시도 (subject derailment 방지).

**VQA 피드백 재시도**: FAIL 시 reason 기반 정밀 수정. PF≤2→단순화, TA≤3→no-text강화, CH≤2→색상가이드.

### IC (Image in Context) — PPTX 내 확인

IC-01 이미지 로딩, IC-02 텍스트 대비, IC-03 크롭/비율, IC-04 해상도 열화

### 재시도 전략 (최대 3회)

1차: 프롬프트 개선 (reason 기반) → 2차: 유형 전환 (메타포→일러스트→아이콘→SVG→HTML) → 3차: HTML-only

---

## 이미지 비율 결정 규칙

**16:9를 기본값으로 쓰지 않는다.** 컨테이너 비율에 맞춤.

| 레이아웃 | 컨테이너 | 비율 |
|---------|----------|------|
| 전체 배경 (표지, 배경) | 720×405pt | `[16:9]` |
| 좌우 50:50 (padding 없음) | 360×405pt | `[3:4]` |
| 좌우 55:45 (padding 없음) | 396×405pt | `[1:1]` |
| 좌우 분할 (padding 있음) | ~330~360×290pt | `[4:3]` |
| 일러스트/아이콘 | 정사각 | `[1:1]` |

Gemini 지원 비율: `16:9`, `4:3`, `3:4`, `1:1`, `3:2`, `2:3`, `9:16`, `21:9`

---

## 프롬프트 자동 강화 `enhancePrompt()`

항상 적용 (--vqa 무관):
1. hex 코드 자동 제거
2. `"no text"` 미포함 시 `"No text whatsoever."` 추가
3. aspect ratio 미언급 시 자동 추가
4. frame/diagram: `"light gray background"` + vector style 추가
5. frame 중 hub/spoke/pyramid 등: `"Main element offset left."` 추가
6. cover: `"Large empty area for text overlay."` 추가
7. photographic: `"Sharp focus, high quality."` 추가
8. **D3 hex injection**: frame/icon → palette hex 2색 주입
9. **D1 chevron**: `"arrow-shaped"` → `"pointed"`
10. **D5 hub-spoke**: `"hub-spoke"` → `"radial connection diagram"` + 원형 배치
11. **D2 staircase v2**: `"staircase"` → `"bar chart"`, `"steps"` → `"bars"`

---

## Adaptive Concurrency

429 빈도에 따라 동시성 자동 조절: 429 발생→50% 감소, 5회 연속 성공→+1 복구.

---

## 알려진 모델 한계

| 도형 | 증상 | 대안 |
|------|------|------|
| Hub-spoke 5+ node | 요청보다 +1~3 생성 | HTML radial 다이어그램 |
| Hub-spoke 3 node | 4 생성 (compensation 불가) | HTML 대체 |
| Staircase | D2 rewrite로 대부분 해결, 간헐적 +1 | IP-13 WARN 자동 출력 |

기타: Free Tier 차단, 한글 오탈자→HTML 오버레이, 투명배경 미지원→white bg, SynthID 워터마크, Seed/재현성 없음, `imageSize` 대문자 `"2K"` 필수.
