# HTML 작성 시 금지/필수 규칙 (Quick Reference)

Step 2 (HTML 생성) 시 이 파일만 참조. 전체 히스토리는 `pptx-inspection-log.md` 참조.

## 금지 (ERROR — 변환 실패 또는 텍스트 불가시)

- `linear-gradient` + 흰색/밝은 텍스트 → 단색 `background` 대체 [IL-14,16 / PF-01]
- `<p>`,`<h1>`~`<h6>`,`<li>`에 background/border → `<div>`로 래핑 [PF-07]
- 비-body DIV에 `background: url()` → body만 허용 [IL-04 / PF-05]
- `rgba()` 반투명 배경 + 흰색 텍스트 → PPTX에서 예측 불가 [IL-14]
- 배경 있는 자식 div와 형제 `<span>` 텍스트 조합 → `<span>` 대신 `<p>` 사용 [IL-24]

## 필수 (WARN — 레이아웃 깨짐 가능)

- `flex:1` div에 `box-sizing: border-box; min-width: 0` [IL-13 / PF-02]
- flex 컨테이너(display:flex 부모)에 `overflow: hidden` [IL-13 / PF-06]
- 이미지 div에 `min-width: 0` (intrinsic size 방지) [IL-13]
- 카드 내 CJK 텍스트 ≤ 11pt, 카드 폭 30% 여유 [IL-06 / PF-08]
- 50% 분할 한글 제목 ≤ 14pt [IL-18]
- 4+ 카드 그리드: body padding ≤ 32pt, gap ≤ 10pt [IL-10]
- 5+ 리스트: gap ≤ 7pt, 아이템 padding ≤ 10pt [IL-10]
- `<img height:100%>` → `max-height` 또는 고정 pt값 사용 [IL-04 / PF-04]
- 배경 이미지 + 텍스트 오버레이: gradient 불투명도 ≥ 0.7 (상단) / ≥ 0.9 (텍스트 영역) [IL-07]
- 텍스트 위 이미지 슬라이드: `text-shadow: 0 2px 8px rgba(0,0,0,0.5)` 필수 [IL-07]

## 테이블 레이아웃 (CSS grid 필수)

- `display: grid; grid-template-columns: 고정pt 고정pt ...` 사용 (flex:1 대신) [IL-17]
- 헤더 행에 반드시 배경색 적용 (컬럼 앵커 역할) [IL-17]
- 교차 행 배경(`.alt { background: #F5F5F4 }`) 권장 [IL-17]
- 셀 내 텍스트는 `<div class="cell"><span>텍스트</span></div>` 패턴 [IL-17]

## 콘텐츠 높이 사전 계산 (405pt 슬라이드)

```
body padding(상+하) + 제목(~30pt) + 메시지(~18pt)
+ (아이템높이 × 수) + (gap × (수-1)) ≤ 405pt
```

여유분 없으면 font-size 1~2pt 축소. 초과 시 슬라이드 분할 [IL-10].

## Preflight 자동 감지 ID 매핑

| IL 패턴 | PF 규칙 | VP 규칙 | 감지 방식 |
|---------|---------|---------|----------|
| IL-14,16 | PF-01 | VP-04 | 정적 regex + XML 대비 |
| IL-13 | PF-02,06 | — | 정적 regex |
| IL-04 | PF-04,05 | — | 정적 regex |
| IL-07 | PF-07 | — | 정적 regex |
| IL-10 | PF-03 | VP-01 | Playwright(--full) + XML 오버플로 |
| IL-06 | PF-08 | — | Playwright(--full) |
| IL-17 | — | VP-02 | XML 컬럼 정렬 |
| — | PF-09~11 | — | 크로스 슬라이드 일관성 |
| — | — | VP-05 | XML 테이블 빈 셀 감지 |
| — | — | VP-06 | XML 테이블 일관성 (열 수, 공란 비율) |
| — | — | VP-07 | XML Shape 그리드 빈 셀 감지 |
| IL-21 | — | — | html2pptx 내부 (HEX 대문자 강제) |
| IL-22 | — | — | html2pptx 내부 (margin 배열 순서) |
| IL-23 | — | — | html2pptx 내부 (actsAsText parseInlineFormatting) |
| IL-24 | — | — | HTML 작성 규칙 (비-leaf div 내 span → p 변경) |

## 변환기 내부 수정 이력 (HTML 측 영향 없음)

html2pptx.cjs 내부 버그 수정으로 HTML 작성 규칙에는 영향 없지만, 디버깅 시 참조:
- **IL-21**: `rgbToHex()` 대문자 강제 — PptxGenJS가 소문자 HEX 미인식 [2026-03-14]
- **IL-22**: margin 배열 `[L,T,R,B]` 순서 — PptxGenJS 비표준 매핑 [2026-03-14]
- **IL-23**: actsAsText에 `parseInlineFormatting()` 복원 — 다중 색상/스팬 보존 [2026-03-14]

## 레이아웃 템플릿 참조

→ `.claude/skills/design-skill/templates/layouts.css`
