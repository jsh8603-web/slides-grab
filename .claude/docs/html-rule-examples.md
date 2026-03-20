# HTML 규칙 예시 모음

`html-prevention-rules.md` 규칙의 상세 예시. 규칙 적용 시 참조.

## 금지 — inline span 색상 [IL-45]

```html
<!-- ❌ <span> 인라인 색상 → PPTX에서 "급여의"와 "9.7%~23%+"가 별도 줄 (4줄→5줄) -->
<h2>급여의 <span style="color:#E8913A">9.7%~23%+</span><br>범위로 달라진다</h2>

<!-- ✅ 별도 <p>로 분리 → 정확히 4줄, 각 <p>가 독립 텍스트 박스 -->
<p>급여의 9.7%~23%+</p>  <!-- 전체 행 accent 색상 -->
<p>범위로 달라진다</p>
```

## 금지 — li + 의사요소 [IL-44]

```html
<!-- ❌ PPTX에서 불릿 누락 + 위치 오류 -->
<ul><li style="position:relative;">텍스트<span style="position:absolute;">·</span></li></ul>
<!-- ❌ ::before 의사요소도 동일 -->
<style>li::before { content: '·'; position: absolute; }</style>
<!-- ✅ 인라인 불릿 문자 -->
<p>· 텍스트</p>
```

## 금지 — span background [IL-60]

```html
<!-- ❌ PPTX에서 span background 제거 → 흰 텍스트가 밝은 #EBF5FF 위에 표시 -->
<div class="cell cell-hbm4"><span>2,048비트 <span class="badge-new" style="background:#E4002B; color:#FFF;">2X</span></span></div>

<!-- ✅ 텍스트 색상으로 강조 (배경 불필요) -->
<div class="cell cell-hbm4"><span>2,048비트 <span class="badge-new" style="color:#E4002B; font-weight:700;">2X</span></span></div>
```

## 필수 — Flex/Box 모델 [IL-13]

```html
<!-- ✅ 올바른 flex 컨테이너 -->
<div style="display:flex; gap:10pt; overflow:hidden;">
  <div style="flex:1; box-sizing:border-box; min-width:0;">내용</div>
</div>
<!-- ❌ overflow/min-width 누락 → PPTX에서 폭 초과 -->
<div style="display:flex; gap:10pt;">
  <div style="flex:1;">내용</div>
</div>
```

## 필수 — 이미지 높이 [IL-04]

```html
<!-- ❌ --> <img style="height:100%">
<!-- ✅ --> <img style="max-height:180pt">
```

## CJK 카드 텍스트 계산 예시

```
720pt body, padding 36pt×2, gap 10pt, 카드 3개
card_width = (720 - 72 - 20) ÷ 3 = 209pt
"연차수당 미지급 과태료" (9 CJK) × 11pt = 99pt → 99 < 209×0.7(146pt) ✅
```

## 밀집 레이아웃 높이 계산 예시

```
padding 28+28=56, title 40pt, items 5개×40pt=200, gap 10×4=40
총 = 56+40+200+40 = 336pt ≤ 405pt ✅
```

## Grid 테이블 열 합계 검증 예시

```
5열 그리드, body 720pt, padding 36pt×2, 가용 648pt
grid-template-columns: 100pt 200pt 70pt 70pt 120pt = 560pt
560 ÷ 648 = 0.864 ≥ 0.9? ❌ → 열 폭 확장 필요
수정: 110pt 210pt 80pt 80pt 168pt = 648pt ✅
```

## Flex Row 오버플로 계산 예시

```
KPI 카드 5개, body 420pt(right panel), padding 24+28=52, gap 8×4=32
item_width = (420 - 52 - 32) ÷ 5 = 67.2pt, padding 10×2=20
available = 47.2pt
"기준소득월액 기준" (7 CJK) × 10pt = 70pt > 47.2×0.85(40pt) ❌
→ font-size 8pt: 56pt > 40pt ❌ → "소득기준" (4 CJK) × 10pt = 40pt ≤ 40pt ✅
```

## 바 차트 바 높이 [IL-42]

```html
<!-- 값 4.2, font 10pt → 최소 높이 18pt -->
<!-- ❌ --> <div style="height:10pt; font-size:10pt;">4.2</div>
<!-- ✅ --> <div style="height:20pt; font-size:10pt; padding:4pt 0;">4.2</div>
```

## 장식 요소 간격 [IL-41]

```html
<!-- ❌ 밑줄로 오인됨 -->
<h1 style="margin-bottom:8pt;">제목</h1>
<div style="width:48pt; height:3pt; background:#E8913A;"></div>

<!-- ✅ 충분한 간격 -->
<h1 style="margin-bottom:28pt;">제목</h1>
<div style="width:48pt; height:3pt; background:#E8913A;"></div>

<!-- ✅ 또는 장식 바 제거 -->
<h1>제목</h1>
```

## 장식용 absolute 요소 [IL-39]

```html
<!-- ❌ 240×240 원이 콘텐츠 영역과 겹침 -->
<div style="position:absolute; right:-60pt; top:50%; width:240pt; height:240pt; background:radial-gradient(...)"></div>

<!-- ✅ 작게 축소하여 콘텐츠 외곽에 배치 -->
<div style="position:absolute; right:10pt; bottom:10pt; width:80pt; height:80pt; background:radial-gradient(...)"></div>
```

## CJK 배지 폭 계산 예시

```
"근퇴법 제8조" (6 CJK) × 10pt × 1.3 = 78pt → 컨테이너 width ≥ 78pt
"연차수당미지급과태료" (9 CJK) × 10pt × 1.3 = 117pt → 9자 초과, "연차 과태료"(5자)로 축약
```

## CJK 텍스트 컨테이너 폭 계산 예시

```
container 120pt, "임금총액 × 8.33%" (5 CJK + 8 라틴)
text_width = 5×11 + 8×11×0.6 = 55 + 52.8 = 107.8pt
107.8 ≤ 120×0.8(96pt)? ❌ → font-size 10pt: 50+48=98 > 96 ❌ → 텍스트 축약
```
