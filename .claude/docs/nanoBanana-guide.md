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

**중요: Free Tier에서는 이미지 생성이 완전 차단됩니다.** 반드시 결제 활성화(Paid Tier) 필요.
https://aistudio.google.com 에서 결제 설정 후 API 키 발급.

---

## API 호출

SDK 의존성 없이 REST API 직접 호출. 자동화 스크립트 사용:

```bash
# 기본 실행
node scripts/generate-images.mjs --outline slide-outline.md --output slides/프레젠테이션명/assets

# 체인 모드 (첫 이미지를 참조로 일관성 유지)
node scripts/generate-images.mjs --outline slide-outline.md --output slides/프레젠테이션명/assets --chain

# 특정 슬라이드만 재생성
node scripts/generate-images.mjs --outline slide-outline.md --output slides/프레젠테이션명/assets --regenerate 3,5,8

# 전부 재생성
node scripts/generate-images.mjs --outline slide-outline.md --output slides/프레젠테이션명/assets --force
```

### 스크립트 옵션

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--model` | `gemini-2.5-flash-image` | 모델 ID |
| `--size` | `2K` | 해상도 (대문자 K 필수) |
| `--concurrency` | `2` | 동시 호출 수 (IPM 제한 고려) |
| `--chain` | false | 첫 이미지를 참조로 나머지 생성 (덱 일관성) |
| `--force` | false | 기존 이미지 전부 덮어쓰기 |
| `--regenerate` | - | 특정 슬라이드만 재생성 (쉼표 구분) |
| `--optimize` | true | Sharp 후처리 (1920×1080 리사이즈 + 압축) |
| `--no-optimize` | - | 후처리 건너뜀 |
| `--dry` | false | 프롬프트만 확인 (API 호출 없음) |

### 자동 처리 기능

- **Rate Limit (429)**: 지수 백오프 자동 재시도 (최대 5회)
- **Safety Filter**: `finishReason` 파싱 → 차단 사유별 한글 안내
- **스타일 앵커**: outline Meta 섹션의 Color Palette + Tone/Mood를 모든 프롬프트에 자동 prepend
- **Sharp 후처리**: 비율별 해상도로 리사이즈 + 압축 (아래 테이블 참조). 미등록 비율은 경고 출력 + 원본 비율 유지 (16:9 폴백 없음)

#### Sharp 지원 비율-해상도 테이블

| 비율 | 해상도 (w×h) | 용도 |
|------|-------------|------|
| `16:9` | 1920×1080 | 전체 배경, 표지, 인포그래픽 |
| `4:3` | 1440×1080 | 좌우 분할 (body padding 있음) |
| `3:4` | 1080×1440 | 좌우 50:50 분할 (body padding 없음) |
| `1:1` | 1080×1080 | 정사각 일러스트/아이콘 |
| `3:2` | 1620×1080 | 와이드 사진 |
| `2:3` | 1080×1620 | 세로 사진 |
| `9:16` | 1080×1920 | 세로 전체 (모바일) |
| `21:9` | 2520×1080 | 울트라와이드 |

새 비율 추가 시 `scripts/generate-images.mjs`의 `dimensions` 맵 (2곳: `optimizeImage()` + 단일 이미지 모드) 업데이트 필요
- **체인 모드**: 첫 이미지를 참조 이미지로 나머지에 전달 → 덱 시각 일관성 확보

### API 에러 대응

| 에러 | 원인 | 대응 |
|------|------|------|
| 429 RESOURCE_EXHAUSTED | Rate Limit / IPM 초과 | 자동 백오프 재시도 |
| 403 PERMISSION_DENIED | Free Tier 또는 결제 미설정 | 결제 활성화 안내 |
| SAFETY | 프롬프트 안전 필터 | 민감 표현 순화 안내 |
| IMAGE_SAFETY | 생성 이미지 부적합 | 프롬프트 수정 안내 |

---

## 프롬프트 작성 10대 규칙

벤치마킹 12개 소스에서 추출한 핵심 규칙. 아웃라인 `NanoBanana:` 태그 → 영어 프롬프트 변환 시 반드시 적용.

### 1. 서술형 문장 사용 (키워드 나열 금지)

```
BAD:  "dog, park, 4k, realistic"
GOOD: "A golden retriever playing fetch in a sunlit city park, shot with 85mm lens, shallow depth of field"
```
출처: Google Developers Blog — Gemini 2.5 Flash Prompting Guide

### 2. 용도/의도를 문장 앞에 선언

```
GOOD: "A professional presentation slide background for a tech company quarterly report.
       Soft geometric shapes, gradient from navy blue to teal, subtle texture,
       no text, 16:9 aspect ratio."
```
출처: Google Blog — 7 Tips for NanoBanana Pro

### 3. 텍스트는 HTML에서 처리 (이미지 내 텍스트 최소화)

- AI 텍스트 렌더링은 오탈자 발생 가능 (특히 한글)
- 프롬프트에 `"no text"` 또는 `"without any text or labels"` 명시
- 텍스트가 반드시 필요하면 `'exact text in quotes'` 형태로 지정
- 출처: NanoBanana Pro Prompting Tips, guidebean.com 13가지 패턴

### 4. 긍정 표현 사용 (부정형 금지)

```
BAD:  "no cars, no people, no clutter"
GOOD: "An empty, serene street with clean sidewalks and open sky"
```
출처: Google Developers Blog, Atlabs AI Ultimate Guide

### 5. 촬영 용어로 구도 제어

| 키워드 | 효과 |
|--------|------|
| `wide-angle shot` | 전체 장면, 배경 강조 |
| `85mm portrait lens` | 인물 중심, 보케 배경 |
| `low-angle perspective` | 위엄, 권위감 |
| `bird's-eye view` | 전체 조망, 다이어그램 느낌 |
| `elevated 45-degree shot` | 제품 사진 표준 |
| `macro shot` | 디테일 클로즈업 |

출처: Google Developers Blog, fotor.com 40+ Prompts

### 6. 조명 묘사 필수

| 키워드 | 분위기 |
|--------|--------|
| `soft golden-hour light` | 따뜻함, 인간적 |
| `three-point softbox lighting` | 스튜디오 전문성 |
| `cinematic lighting` | 극적, 하이엔드 |
| `cold clinical lighting` | 과학/의료 |
| `warm ambient glow` | 편안함 |
| `rim lighting` | 윤곽 강조 |

출처: Google Blog Pro Tips, Medium Deep Dive

### 7. 색상 팔레트 hex 코드 명시

```
GOOD: "Color palette of deep navy (#1E3A8A) and warm orange (#F97316),
       with off-white (#FAFAF9) background"
```
- 슬라이드 테마 색상과 일치시키면 시각 일관성 확보
- 출처: glbgpt.com PPT 그래픽 가이드, SlideGenius AI Images Guide

### 8. 스타일 키워드 조합

| 카테고리 | 권장 키워드 |
|---------|------------|
| 비즈니스 | `corporate`, `professional`, `clean`, `minimal`, `polished editorial` |
| 기술 | `futuristic`, `tech aesthetic`, `gradient mesh`, `dark mode`, `circuit pattern` |
| 교육 | `pastel illustration`, `friendly`, `flat design`, `colorful icons` |
| 창의적 | `vibrant`, `bold`, `high contrast`, `dynamic composition` |

출처: Pingax 2025 Guide, EdrawMind + NanoBanana 워크플로우

### 9. 슬라이드 배경용 네거티브 스페이스 확보

```
GOOD: "... with significant negative space in the right half for text overlay.
       Muted, desaturated tones to ensure high text readability."
```
- 배경 이미지는 텍스트 가독성이 최우선
- `"muted"`, `"subtle"`, `"desaturated"` 키워드 사용
- 출처: SlideGenius, Pingax, carat.im 총정리

### 10. 참조 이미지로 덱 일관성 유지

- 첫 슬라이드 이미지를 생성한 뒤, 나머지 슬라이드에 참조 이미지로 전달
- "Maintain the same visual style, color palette, and artistic approach as the reference image"
- NanoBanana 2: 최대 14장, Pro: 최대 11장 참조 가능
- 출처: guidebean.com 13가지 패턴, Google DeepMind 모델 페이지

---

## 이미지 비율 결정 규칙 (필수)

**16:9를 기본값으로 쓰지 않는다.** 슬라이드 레이아웃에서 이미지가 차지하는 실제 컨테이너 비율에 맞춰 생성한다.
`object-fit: cover`로 약간의 크롭은 허용되지만, 16:9 이미지를 세로 컨테이너에 넣으면 심하게 찌그러지거나 잘린다.

### 레이아웃별 비율 매핑 (720×405pt 슬라이드 기준)

| 레이아웃 | 이미지 컨테이너 크기 | 비율 힌트 |
|---------|-------------------|----------|
| 전체 배경 (표지, 배경) | 720×405pt | `[16:9]` |
| 좌우 50:50 분할 (body padding 없음) | 360×405pt | `[3:4]` |
| 좌우 55:45 분할 (body padding 없음) | 396×405pt | `[1:1]` |
| 좌우 ~55:45 분할 (body padding 있음) | ~359×290pt | `[4:3]` |
| 좌우 ~50:50 분할 (body padding 있음) | ~327×290pt | `[4:3]` |
| 일러스트/아이콘 (독립) | 정사각 | `[1:1]` |

### 아웃라인 작성 시 규칙

1. **Layout 필드를 먼저 결정** → 이미지 컨테이너 비율을 위 테이블에서 찾는다
2. **NanoBanana 프롬프트 맨 앞에 `[비율]` 힌트**를 추가한다 (예: `[3:4]`)
3. **프롬프트 마지막 aspect ratio 문구도 일치**시킨다 (예: `3:4 portrait aspect ratio`)
4. `generate-images.mjs`가 `[N:M]` 힌트를 파싱하여 Gemini API `aspectRatio` 파라미터에 전달

### Gemini 지원 비율

`16:9`, `4:3`, `3:4`, `1:1`, `3:2`, `2:3`, `9:16`, `21:9` — 이 8개 사용 가능. 정확히 맞지 않으면 가장 가까운 비율 선택. Sharp 후처리도 동일 8개 비율을 지원한다.

---

## 슬라이드 유형별 프롬프트 공식

### 표지 (Cover)

```
[16:9] A professional presentation cover for [주제].
[스타일] design with [색상 팔레트].
Clean, centered composition with ample space for title text overlay.
No text in the image. 16:9 aspect ratio, high resolution.
```

### 섹션 구분 (Section Divider)

```
[16:9] A bold section divider background for a presentation about [주제].
[컬러/무드] gradient, minimalist geometric accent in [위치].
Large negative space for section title. No text. 16:9 aspect ratio.
```

### 콘텐츠 배경 (Content Background)

```
[16:9] A subtle, muted background for a presentation content slide.
Soft [색상] tones, abstract [패턴] texture.
Must not compete with overlaid text and data.
Desaturated, professional. No text. 16:9 aspect ratio.
```

### 병렬 레이아웃 이미지 (이미지+텍스트 분할)

```
[비율] A [스타일] illustration of [대상] for a presentation slide.
[상세 묘사]. [색상 팔레트].
Muted desaturated background. No text. [비율] aspect ratio.
```
비율은 레이아웃별 비율 매핑 테이블 참조. 전체 배경이 아닌 분할 레이아웃 이미지에 16:9 사용 금지.

### 일러스트/아이콘 (Illustration)

```
[1:1] A [스타일] illustration of [대상] for a presentation slide.
Flat design, limited [N]-color palette ([hex 코드]).
Clean vector-like appearance, pure white (#FFFFFF) background.
No text. 1:1 square aspect ratio.
```
주의: Gemini는 투명 배경(alpha channel) 미지원. `transparent` 대신 `pure white (#FFFFFF) background` 사용.

### 인포그래픽/다이어그램 (Infographic)

```
[16:9] A polished editorial infographic showing [데이터/프로세스].
[N] steps/columns with labeled icons.
Flat vector style, [색상 팔레트].
Legible at 600px width. 16:9 aspect ratio.
```

### 사진/실사 (Photo-realistic)

```
[비율] A photorealistic [shot type] of [대상] [행동/상태],
set in [환경]. Illuminated by [조명].
Captured with [렌즈], [효과].
Professional, high-fidelity. [비율] aspect ratio.
```

---

## 제한사항 및 대응

| 제한 | 대응 |
|------|------|
| Free Tier 이미지 차단 | 결제 활성화 필수 (https://aistudio.google.com) |
| 한글 텍스트 오탈자 | 이미지에 텍스트 넣지 않고 HTML 오버레이로 처리 |
| 소형 얼굴 품질 저하 | `close-up portrait` 구도 요청 |
| 반복 편집 시 화질 열화 | 첫 프롬프트에 최대한 완성형 작성 |
| `imageSize` 소문자 버그 | 반드시 대문자 `"2K"` |
| Sharp 미등록 비율 폴백 | dimensions 맵에 없는 비율은 경고 출력 + 원본 유지 (16:9 폴백 없음). 비율 추가 시 `generate-images.mjs` dimensions 맵 업데이트 |
| 투명 배경 미지원 | `transparent` 대신 `pure white (#FFFFFF) background` 사용 |
| SynthID 워터마크 | 모든 출력에 비가시 워터마크 포함 (제거 불가) |
| 캐릭터 일관성 드리프트 | `--chain` 모드로 참조 이미지 연결 + 외모 재서술 병행 |
| Safety 차단 | 스크립트가 차단 사유별 한글 안내 자동 출력 |
| Seed/재현성 없음 | 동일 프롬프트도 매번 다른 결과 → `--chain` + 스타일 앵커로 보완 |

---

## 벤치마킹 출처 (12개)

| # | 출처 | 핵심 기여 |
|---|------|----------|
| 1 | [Gemini API 공식 이미지 생성 문서](https://ai.google.dev/gemini-api/docs/image-generation) | API 파라미터, Node.js 코드, 모델 ID |
| 2 | [Gemini 2.5 Flash Image 프롬프팅 가이드](https://developers.googleblog.com/en/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/) | 서술형 문장, 촬영 용어, 조명 묘사 규칙 |
| 3 | [NanoBanana Pro 프롬프트 팁](https://blog.google/products-and-platforms/products/gemini/prompting-tips-nano-banana-pro/) | Thinking 모드, 긍정 표현, 용도 선언 |
| 4 | [Gemini 2.5 Flash Image GA + 종횡비](https://developers.googleblog.com/en/gemini-2-5-flash-image-now-ready-for-production-with-new-aspect-ratios/) | 14종 종횡비, 프로덕션 설정 |
| 5 | [NanoBanana + EdrawMind PPT 워크플로우](https://www.edrawsoft.com/kr/program-review/nanobanana-edrawmind.html) | PPT 제작 속도 60% 향상, 배치 생성 |
| 6 | [나노바나나 PPT 표지 생성법](https://www.glbgpt.com/hub/kr/how-to-create-ppt-covers-and-presentation-graphics-using-nano-banana-pro/) | PPT 표지 프롬프트 공식, 색상 팔레트 명시 |
| 7 | [나노바나나 사용법 13가지](https://guidebean.com/nano-banana-guide/) | 참조 이미지 일관성, 다중 턴 편집 |
| 8 | [AI Images for PPT 2025 가이드](https://pingax.com/ai-images-for-ppt-slides-the-2025-guide-to-captivating-slides/) | 해상도 권장 (1920×1080 최소), 스타일 키워드 |
| 9 | [AI Images in PowerPoint 가이드](https://www.slidegenius.com/blog/guide-to-using-ai-images-in-powerpoint-presentations) | 브랜드 색상 일관성 > 개별 이미지 품질 |
| 10 | [Gemini 2.0 Flash Image Deep Dive](https://medium.com/@chongcht/gemini-2-0-flash-unleashing-native-image-generation-a-tech-deep-dive-85026fcd0f77) | 조명 묘사 필수, SynthID 워터마크 |
| 11 | [Firebase AI Logic 이미지 생성](https://firebase.google.com/docs/ai-logic/generate-images-gemini) | Node.js SDK 통합, 배치 호출 패턴 |
| 12 | [Google Cloud 생성형 미디어 + 나노바나나](https://cloud.google.com/blog/ko/products/ai-machine-learning/building-momentum-for-gen-media-including-nano-banana-?hl=ko) | 캐릭터 일관성 기능, 엔터프라이즈 배포 |
