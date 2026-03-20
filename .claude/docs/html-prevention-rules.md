# HTML 작성 시 금지/필수 규칙 (Quick Reference)

슬라이드 HTML 생성/수정 시 준수. 상세 예시: `docs/html-rule-examples.md`. 이슈 이력: `docs/pptx-inspection-log.md`.

## 규칙 작성 메타규칙

모든 규칙은 **정량적** 작성. 정성적 표현("적절히", "여유 확보") 금지 → 에이전트가 무시함.
필수: ① 수치 임계값 ② 계산 공식 ③ 위반/수정 예시 (`docs/html-rule-examples.md`에)

_파이프라인 수정 의무 (3분류 판정: 오탐/정탐-수정/정탐-한계, A~I 절차) → `CLAUDE.md` §자가 개선 피드백 루프_

## 금지 (ERROR — 변환 실패 또는 텍스트 불가시)

- `linear-gradient` + 흰색/밝은 텍스트 → 단색 `background` 대체 [IL-14,16 / PF-01]
- `<p>`,`<h1>`~`<h6>`,`<li>`에 background/border → `<div>`로 래핑 [PF-07]
- 비-body DIV에 `background: url()` → body만 허용 [IL-04 / PF-05]
- `rgba()` 반투명 배경(alpha < 1.0) → 솔리드 hex 블렌딩: `ch = parent×(1-a) + rgba×a` [IL-14,43]
- 배경 있는 자식 div와 형제 `<span>` → `<span>` 대신 `<p>` 사용 [IL-24 / PF-14]
- `border-radius:50%` + `border` 원형 차트 → PNG `<img>` + 텍스트 오버레이 [IL-25 / PF-13]
- 국기 이모지(🇺🇸🇰🇷) → PNG/SVG `<img>` [IL-26 / PF-12]
- `text-decoration: underline` → `color` 또는 `font-weight:700` [IL-38]
- 비-body DIV `background-image: linear-gradient()` → 솔리드 사각형으로 변환 [IL-39]
- `border-*` + `transparent` 삼각형 → 수직/수평 분할로 대체 [IL-28]
- `<li>` + `::before`/`::after` → `<p>` + 인라인 불릿("·","•") [IL-44]
- 텍스트 요소 내 `<span>` 색상 변경 → 별도 `<p>` + 클래스로 전체 행 지정 [IL-45]
- `<span>`에 `background`/`background-color` → 텍스트 색상+font-weight로 강조 [IL-60 / PF-55]
- `column-count: N` (N≥2) → grid/flex로 다단 구현 [IL-53 / PF-48]

## 필수 — Flex/Box 모델 [IL-13 / PF-02,06]

- `flex:1` div → `box-sizing:border-box; min-width:0` 필수
- flex 컨테이너 → `overflow:hidden` 필수
- 이미지 div → `min-width:0` 필수

## 필수 — 이미지 컨테이너 수직 정렬 [IL-62 / PF-56]

- 이미지 컨테이너에 `display:flex; align-items:center` 사용 시 반드시 `height:100%` 또는 명시적 height 설정
- height 없으면 컨테이너가 이미지 높이로 축소 → `align-items:center` 무효
- 분할 레이아웃(.image-col) 필수: `height: 100%`

## 경고 — 이미지 크기 하한 [IL-63 / PF-57]

- `assets/` 이미지 width < 100pt → 내용 식별 불가. 최소 width 150pt 이상 권장
- 분할 레이아웃 이미지: width 200pt 이상, 헤더/아이콘 이미지: width 120pt 이상

## 경고 — flex:1 + overflow:hidden 내 고정높이 잘림 [IL-65 / PF-59]

- `flex:1; overflow:hidden` 컨테이너 안에 `height > 90pt` 자식 → 상단 콘텐츠 잘릴 수 있음
- 막대 차트: 최대 막대 높이 80pt 이하 권장, 라벨 공간 확보
- `align-items: flex-end` 사용 시 특히 주의 — 상단 라벨이 먼저 잘림

## 경고 — 배지/장식 div 내 텍스트 색상 불가시 [IL-66 / PF-60]

- `border-radius: 50%` 또는 width/height ≤ 40pt인 장식 div 내 텍스트 → PPTX에서 배지 배경이 텍스트에 전달 안 됨
- 텍스트 `color`는 **해당 div의 부모 배경** 대비 3:1 이상 필수
- 흰색 텍스트(#FFFFFF)를 배지 안에 쓸 때: 부모 배경이 밝으면(#F8FAFC, #FFF7ED 등) 불가시 → 어두운 색(#92400E, #065F46 등) 사용

## 경고 — 배경 이미지 위 텍스트 대비 부족 [IL-69 / PF-61]

- 배경 `<img>`(absolute) 위에 텍스트를 배치할 때 반드시 **불투명 오버레이 + text-shadow** 필요
- 오버레이: `background: #1E293B; opacity: 0.5~0.7` (rgba() 금지 — PF-36 위반)
- text-shadow: `text-shadow: 0 2px 8pt rgba(0,0,0,0.5)` 등
- PF-61 WARN (--full 모드): Playwright가 조상/형제에서 absolute `<img>` 탐지 → overlay/text-shadow 없으면 경고

## 금지 — 이미지 src 경로 불일치 [IL-64 / PF-58]

- `<img src="assets/...">` 작성 시 반드시 `ls assets/` 실행하여 실제 파일명 확인
- NanoBanana 생성 파일명은 generate-images.mjs가 결정 → 아웃라인 slug와 다를 수 있음
- PF-58 ERROR: 존재하지 않는 파일 참조 시 에러

## 필수 — 이미지 높이 [IL-04 / PF-04]

- `height:100%` 금지 → `max-height:{N}pt` 또는 고정 pt

## 필수 — CJK 텍스트 폭 공식 (전 규칙 공통)

- `text_width = CJK문자수 × font_size + 라틴문자수 × font_size × 0.6`
- 검증: `text_width ≤ container_width × 0.8` (20% 여유) [IL-37]

## 필수 — CJK 카드 텍스트 [IL-06 / PF-08]

- 카드 내 CJK font-size ≤ 11pt
- `card_width = (body_width - padding_lr - gap×(N-1)) ÷ N`
- 검증: `text_width < card_width × 0.8` (전 규칙 공통 20% 여유 기준)

## 필수 — 3열+ 그리드 CJK [IL-27 / PF-15]

- font-size ≤ 7.5pt, line-height ≤ 1.4, padding ≤ 8pt
- 텍스트 폭 > 셀 가용 폭 85% → font-size 1pt 축소 또는 축약

## 필수 — 50% 분할 [IL-18]

- 한글 제목 font-size ≤ 14pt, `<br>` ≤ 3줄

## 필수 — 밀집 레이아웃 [IL-10]

- 4+카드: body padding ≤ 32pt, gap ≤ 10pt
- 5+리스트: gap ≤ 7pt, 아이템 padding ≤ 10pt
- 높이: `padding_tb + title_h + Σ(item_h) + gap×(N-1) ≤ 405pt`

## 필수 — 배경 이미지 + 텍스트 오버레이 [IL-07 / PF-16]

- gradient: 상단 ≥ 0.7, 텍스트 영역 ≥ 0.9
- `text-shadow: 0 2px 8px rgba(0,0,0,0.5)` 필수
- CSS transform: `rotate`만 지원 [PF-17]

## 필수 — Grid 테이블 [IL-17,40]

- `grid-template-columns: 고정pt ...` 사용
- 열 합계: `Σ(columns) ≥ 가용폭 × 0.9`
- 헤더 행 배경색 필수, 셀: `<div class="cell"><span>텍스트</span></div>`

## 필수 — Flex Row 오버플로 [IL-42]

- 4+아이템: `(body_w - padding_lr - gap×(N-1)) ÷ N - item_padding_lr` = 가용 폭
- 검증: `text_width < available × 0.85`

## 필수 — 바 차트 [IL-42]

- 바 내부 텍스트 시: `bar_height ≥ font_size + 8pt`

## 필수 — 장식 요소 간격 [IL-41]

- 텍스트 직후 accent-bar: `margin-top ≥ 20pt` (미만이면 밑줄로 오인)
- 20pt 불가 → 장식 요소 제거

## 필수 — 장식용 absolute [IL-39]

- absolute 영역이 텍스트/테이블과 겹치면 → 콘텐츠 외곽 이동 또는 body background

## 하이라이트 셀 [IL-29]

- font-size ≤ 7.5pt + `white-space:nowrap`
- 셀 폭 ≥ CJK: `문자수 × fs × 0.7`, 라틴: `문자수 × fs × 0.45` + padding

## AI 생성 이미지 [IL-30]

- 가짜 데이터 인포그래픽 금지, AI 한글 텍스트 금지
- 허용: 사진, 아이콘(SVG), 추상 일러스트, 스크린샷

## 최소 폰트 사이즈 [IL-31 / PF-25]

| 용도 | 최소pt | 용도 | 최소pt |
|------|:------:|------|:------:|
| Hero Title | 48 | Subtitle | 16 |
| Section Title | 36 | Body | 14 |
| Slide Title | 24 | Caption/Label | 10 |

**10pt 미만 절대 금지.** 콘텐츠 초과 시 폰트 축소 대신 슬라이드 분할.

## 밀도 제한 [IL-33 / PF-26]

- 독립 콘텐츠 블록 **최대 3개** (4+ → 분할). 12개월 타임라인 → 2슬라이드.

## CJK 배지/라벨 [IL-34 / PF-27]

- width < 150pt → `white-space:nowrap` 필수
- ≤ 8자, 컨테이너 폭 = `CJK수 × fs × 1.3`

## 타임라인/다열 라벨 [IL-35]

- 열 폭 < 60pt → CJK ≤ 3자, < 40pt → ≤ 2자 또는 아이콘
- 12개월 → 6개월씩 분할

## 이미지 z-order [IL-36]

- 이미지 배경 → body `background-image`만 허용. 겹침 방지: 좌우/상하 분할.

## PPTX 미지원 CSS (preflight 자동 검출)

| 속성 | 수준 | 대안 | PF |
|------|:----:|------|:--:|
| `letter-spacing` >1pt | WARN | thin space(U+2009) | 41 |
| `opacity` <1.0 | WARN | 솔리드 hex 블렌딩 | 42 |
| `object-fit: cover/fill` | WARN | 사전 크롭 이미지 | 43 |
| `outline` (≠none/0) | WARN | `border`로 대체 | 44 |
| `box-shadow: inset` | WARN | 배경색 또는 중첩 div | 22 |
| `margin-*: -N` (≥5pt) | WARN | `position:absolute` | 45 |
| `text-indent` (≠0) | WARN | `padding-left` | 46 |
| `word-break: break-all` | WARN | 수동 폭 검증 | 47 |
| `mix-blend-mode` (≠normal) | WARN | 사전 렌더링 이미지 | 49 |
| `border-image` | WARN | `border:solid` 단색 | 50 |
| `position: sticky` | WARN | 슬라이드에서 무의미 | 51 |
| `@font-face` | WARN | 시스템 폰트 사용 | 52 |
| `direction: rtl` | WARN | — | 53 |
| `white-space: pre/pre-line` | WARN | `<br>` + `&nbsp;` | 54 |
