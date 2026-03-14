# PPTX 검사 기록

Step 2(HTML 생성), Step 2.5(자동화 검증 + COM 고해상도 확인), Step 6(PPTX 생성) 시작 전 반드시 이 파일을 읽고, 기존 이슈 패턴을 반영한다.
검사 Phase 완료 후 발견/수정 내용을 이 파일에 추가한다.

### 패턴 번호 규칙 (Append-Only)

- 새 패턴은 **마지막 번호 + 1**로 추가 (현재 마지막: #27)
- 기존 번호를 재배정하거나 중간에 삽입 금지 — 다른 문서(`presentation-flow.md`, `design-skill/SKILL.md` 등)에서 번호로 참조하므로 변경 시 참조 깨짐
- 해결된 패턴도 번호를 유지하고 삭제하지 않음 (히스토리 보존)

---

## 이슈 패턴

### 1. CJK 텍스트 줄바꿈 (한글 제목/키워드 밀림)
**증상**: PowerPoint에서 한글 텍스트가 Chrome 대비 15~20% 넓게 렌더링되어 텍스트 박스를 넘침
**근본 원인**: Chrome과 PowerPoint의 한글 글리프 폭 메트릭 차이
**수정**: html2pptx.cjs — CJK 비율 30%+ 텍스트에 폭 보정 20%(단일행)/15%(다중행), 단일행 `fit:"shrink"` 안전망
**HTML 예방**: 제목 박스 20% 여유 폭; 2~3글자 키워드는 font-size 1~2pt 축소; 긴 단일행에 높이 여유 확보

### 2. 초록/강조 바 텍스트 잘림
**증상**: 배경색 있는 바(div) 안의 텍스트가 높이 부족으로 하단 잘림
**근본 원인**: 텍스트 박스 높이 보정 부족 + CJK 폭 보정 미적용으로 줄바꿈 발생
**수정**: html2pptx.cjs — 텍스트 박스 높이 보정 10%→15%, CJK 폭 보정으로 줄바꿈 방지

### 3. 배지 번호 줄바꿈
**증상**: 작은 roundRect 안의 "01"~"08" 번호가 "0/1"처럼 줄바꿈
**근본 원인**: 텍스트 박스 폭이 2자리 숫자+볼드를 수용하기에 부족
**수정**: CJK 폭 보정 기본값(8%)으로 간접 해결; 일부는 PowerPoint에서 정상 렌더링

### 4. 변환 전 HTML 수정 패턴 (PPTX 변환 에러 → HTML 수정 필요)
**증상**: convert-native.mjs가 특정 HTML 패턴에서 에러를 반환
**근본 원인**: ① DIV `background:url()` 에러 ② Windows 이미지 경로 `file:///` 이중화 ③ `<img height:100%>` 하단 마진 침범
**수정**: html2pptx.cjs — url()만 에러, file:/// Windows 파싱 수정
**HTML 예방**: 전체 높이 이미지는 `height: 369pt` 고정값 또는 `max-height` 사용

### 6. 카드/박스 내 텍스트 오버플로 (PowerPoint 전용)
**증상**: PowerPoint에서 텍스트가 카드(roundRect) 경계를 넘침
**근본 원인**: PowerPoint가 Chrome보다 텍스트를 넓게 렌더링 + 카드 padding 부족
**HTML 예방**: 카드 내 텍스트 11pt 이하; 한글+괄호+숫자 조합 추가 1~2pt 축소; 카드 폭 30% 여유

### 7. 이미지 밝기로 인한 텍스트 가독성 저하
**증상**: 밝은 배경 이미지 위 텍스트가 PPTX에서 안 보임; 병렬 레이아웃에서 인접 텍스트 가독성 저하
**근본 원인**: gradient 오버레이 불투명도 부족
**수정**: gradient 최소 불투명도 0.7+(상단) / 0.9+(텍스트 영역); NanoBanana 프롬프트에 `"dark moody atmosphere"` 필수
**HTML 예방**: 배경+텍스트 오버레이 슬라이드에 `text-shadow: 0 2px 8px rgba(0,0,0,0.5)` 적용

### 8. 에디터 assets 서빙 미지원
**증상**: 비주얼 에디터에서 `assets/` 상대 경로 이미지가 깨짐 (404)
**근본 원인**: editor-server.js에 assets/ 정적 라우트 미설정
**수정**: `/assets/` + `/slides/assets/` 두 경로 모두 정적 서빙 추가; 에디터 실행 시 `GEMINI_API_KEY` 환경변수 전달 필수

### 9. CJK 폭 보정이 부모 컨테이너를 넘침 (텍스트 박스 오버플로)
**증상**: 카드/박스 안의 텍스트가 부모 배경 도형 경계를 넘어 오른쪽으로 삐져나옴
**근본 원인**: html2pptx.cjs의 CJK 폭 보정(+8~20%)이 부모 컨테이너 경계를 무시하고 텍스트 박스를 확장
**수정**: html2pptx.cjs — CJK 폭 보정 후 부모 shape 경계에 클램핑 로직 추가
**HTML 예방**: 변환기가 자동 처리하므로 HTML 측 예방 불필요

### 10. 슬라이드 전체 콘텐츠 하단 오버플로 (body 405pt 초과)
**증상**: 슬라이드 콘텐츠가 body 하단(405pt)을 넘어 잘림 — 브라우저에서는 스크롤로 보이나 PPTX에서 사라짐
**근본 원인**: body padding + 제목 + gap + 아이템 padding 누적이 405pt 초과
**수정**: padding 40→32pt, gap 14→10pt (5+리스트: 7pt), 아이템 padding 18→14→10pt, font-size 1~2pt 축소
**HTML 예방**: 4+카드: body padding≤32pt, gap≤10pt; 5+리스트: gap≤7pt, 아이템padding≤10pt; 높이 사전 계산 필수

### 11. 리프 DIV 텍스트 누락 (PPTX에 텍스트 미렌더링)
**증상**: 카드 내 본문 텍스트 전부 사라짐 — 제목(h1)만 보이고 나머지 누락
**근본 원인**: html2pptx.cjs가 `textTags = ['P','H1'~'H6','UL','OL','LI']`만 인식; 배경 없는 `<div>` 텍스트 건너뜀
**수정**: html2pptx.cjs — 리프 DIV 감지 추가: 블록 자식 없고 textContent 있으면 `<p>`처럼 처리

### 12. 배경 있는 리프 DIV의 span 텍스트 누락 (Shape 내부 텍스트 미삽입)
**증상**: `<div style="background:..."><span>텍스트</span></div>` — 배경 shape은 보이나 내부 텍스트 사라짐
**근본 원인**: shape 추출 시 `text:''`(빈 문자열)로 설정 후 return; `<span>`은 textTags 미포함으로 별도 처리도 안 됨
**수정**: html2pptx.cjs — 리프 shape 내 span/b/i/em에서 텍스트+스타일 추출 → shape.text에 PptxGenJS 포맷 배열 삽입

### 13. Flex 레이아웃 이미지+텍스트 분할 시 오버플로 (box-sizing 누락)
**증상**: 이미지+텍스트 좌우 분할에서 이미지가 슬라이드 오른쪽 경계(720pt)를 넘어 삐져나옴
**근본 원인**: `flex:1` 텍스트 div의 padding이 content-box 기본값으로 flex 할당 폭 바깥에 추가됨
**수정**: HTML — ① 텍스트 div: `box-sizing:border-box; min-width:0` ② flex 컨테이너: `overflow:hidden; max-width:720pt` ③ 이미지 div: `min-width:0`
**HTML 예방**: 이미지+텍스트 병렬 레이아웃에 위 3가지 동시 적용 필수

### 14. CSS linear-gradient 배경 + 흰색 텍스트 → PPTX에서 텍스트 안 보임
**증상**: `linear-gradient` 배경 div의 흰색 텍스트가 PPTX에서 완전히 사라짐
**근본 원인**: html2pptx.cjs가 `linear-gradient`를 PPTX shape fill로 변환하지 않아 배경이 사라지고 흰색 텍스트만 남음
**수정**: HTML — `linear-gradient` → 단색 `background: #주색상`으로 교체
**HTML 예방**: `linear-gradient` + 흰색 텍스트 절대 금지; gradient 대신 단색 배경 사용

### 15. 이미지 비율 불일치 (Sharp 후처리 폴백)
**증상**: `[3:4]` 힌트로 생성된 이미지가 1920×1080(16:9)으로 리사이즈되어 세로 컨테이너에 가로 이미지 배치
**근본 원인**: `generate-images.mjs` dimensions 맵에 `"3:4"` 미등록 → 16:9 silent fallback
**수정**: generate-images.mjs — dimensions 맵에 3:4, 2:3 추가(총 8개); 미등록 비율 시 경고+원본유지(폴백 제거); 해상도 로그 자동 출력
**HTML 예방**: 이미지 생성 로그에서 해상도와 비율 힌트 불일치 확인; 불일치 시 dimensions 맵 업데이트

### 16. WCAG 대비율 미달 (프로그래매틱 감지)
**증상**: 텍스트 색상과 배경 색상의 대비율 미달로 PPTX에서 텍스트가 보이지 않거나 읽기 어려움
**근본 원인**: gradient fallback 실패로 배경 소실, 또는 디자인 시 배경-텍스트 대비 미고려
**수정**: HTML — `linear-gradient` → 단색 배경 교체, 또는 텍스트 색상을 충분한 대비 색으로 변경 (임계값: <1.5:1 ERROR, <4.5:1 WARN)
**HTML 예방**: `linear-gradient` + 흰색 텍스트 절대 금지 (패턴 #14); 모든 텍스트의 배경 대비 확인

### 17. 테이블 컬럼 정렬 틀어짐 (CJK 폭 보정 + center-align 오프셋)
**증상**: 테이블에서 PPTX 컬럼이 행마다 어긋남 — 헤더(배경 있음)와 바디 셀(배경 없음) 수직 정렬 깨짐
**근본 원인**: ① 배경 있는 셀(shape)은 원본 위치 유지, 배경 없는 셀(text)은 CJK 보정으로 폭 변동 ② center-align 시 텍스트 x ≠ 셀 x로 좌표 매칭 불가
**수정**: html2pptx.cjs — 3단계 컬럼 정렬 후처리(Phase1: confirmed column 앵커 수집, Phase2: Containment Snapping, Phase3: Peer Normalization(테이블 슬라이드만))
**HTML 예방**: 테이블은 `display:grid; grid-template-columns:고정pt...` 필수; 헤더 행+교차 행에 배경 적용; 셀 내 `<div class="cell"><span>텍스트</span></div>` 패턴

### 18. 이미지+텍스트 50% 분할 레이아웃에서 제목 잘림
**증상**: 좌우 50:50 분할에서 긴 한글 제목이 텍스트 영역 오른쪽 경계를 넘어 잘림
**근본 원인**: 텍스트 영역 실제 폭 ≈316pt, 한글 16pt × 25자 + CJK 20% 보정 → ~336pt 초과
**수정**: HTML — 제목 font-size 16pt → 14pt 축소
**HTML 예방**: 50% 분할 레이아웃 텍스트 영역에서 한글 제목 14pt 이하; 15자+ 제목은 추가 1~2pt 축소

### 19. 테이블 셀 내부 패딩 불일치 (PptxGenJS `inset` 무효 속성)
**증상**: 같은 컬럼인데 배경 있는 셀(shape)과 없는 셀(text)의 좌측 정렬이 ~3.6pt 어긋남
**근본 원인**: PptxGenJS가 `inset` 속성을 silently 무시 → text element에 기본 내부 패딩(~3.6pt) 적용
**수정**: html2pptx.cjs — Phase2 containment snapping에서 스냅된 text element에 `margin:[0,0,0,0]` 적용(테이블 셀로 판정된 것만)

### 20. Phase 3 Peer Normalization이 비테이블 텍스트를 그룹화하여 폭 오버플로
**증상**: 테이블 없는 슬라이드에서 제목·히어로 숫자·캡션 등이 full width(720pt)로 확장되어 삐져나옴
**근본 원인**: Phase 3이 테이블 유무 무관하게 동일 X의 3개+ 텍스트를 그룹화 → CJK 보정된 제목의 넓은 width가 전파
**수정**: html2pptx.cjs — Phase 3을 `tableColumns.length >= 2`인 슬라이드에서만 실행

### 21. PptxGenJS HEX 색상 대문자 필수 (소문자 HEX → 폰트 색상 미적용)
**증상**: PPTX에서 텍스트 색상 미적용; COM 덤프에서 폰트 색상이 `-2147483648`(Invalid)로 표시
**근본 원인**: PptxGenJS가 소문자 HEX(`1a1a2e`)를 미인식; `<a:srgbClr val="..."/>` 는 대문자(`1A1A2E`) 필수
**수정**: html2pptx.cjs — `rgbToHex()` 함수에 `.toUpperCase()` 추가

### 22. PptxGenJS margin 배열 순서 비표준 ([L,T,R,B] ≠ CSS [T,R,B,L])
**증상**: Shape 내부 텍스트 padding이 잘못 적용되어 텍스트 위치가 HTML과 불일치 (상하좌우 뒤바뀜)
**근본 원인**: PptxGenJS가 `margin:[a,b,c,d]`를 `[Left,Top,Right,Bottom]`으로 매핑 — CSS [T,R,B,L]과 다른 비표준 동작
**수정**: html2pptx.cjs — margin 배열을 `[paddingLeft, paddingTop, paddingRight, paddingBottom]` 순서로 조정

### 23. 투명 배경 DIV의 텍스트가 Shape 내에서 단색/단일 스타일로 뭉개짐
**증상**: `actsAsText` 경로에서 다중 색상/볼드/스팬 구조가 사라지고 단일 textContent 문자열로 뭉개짐
**근본 원인**: `actsAsText` 경로에서 `el.textContent`로만 추출 — `parseInlineFormatting()` 미호출로 색상/굵기 정보 손실
**수정**: html2pptx.cjs — `actsAsText` 경로에서도 `parseInlineFormatting(el, baseRunOptions)` 호출하여 다중 스타일 보존

### 25. CSS border-radius: 50% + border 조합 원형/도넛 차트 → PPTX에서 둥근 사각형으로 렌더링
**증상**: `border-radius: 50%` + `border: Xpt solid color` 트릭으로 구현한 도넛 차트가 PPTX에서 원형이 아닌 둥근 사각형(roundRect)으로 변환됨
**근본 원인**: html2pptx.cjs가 `border-radius: 50%`를 PptxGenJS `roundRect`의 `rectRadius`로 매핑 — 정원(circle)이 아닌 모서리 둥근 사각형이 됨. border trick(투명 border + 특정 면 색상)은 PPTX shape에 대응 불가
**수정**: HTML — 도넛/원형 차트를 SVG→PNG 이미지로 생성하고 `<img>` 태그로 삽입. 중앙 텍스트는 absolute 포지션 오버레이
**HTML 예방**: `border-radius: 50%` + `border` 조합으로 원형/도넛 차트 구현 금지 → PNG 이미지(`<img>`) + 중앙 텍스트 오버레이로 대체 [IL-25]

### 26. 국기/복합 이모지 PPTX 미지원 (Flag Emoji → 텍스트 코드로 변환)
**증상**: 🇺🇸, 🇰🇷 등 국기 이모지가 PPTX에서 "US", "KR" 등 regional indicator 문자로 표시됨
**근본 원인**: PptxGenJS/PowerPoint가 국기 이모지(Regional Indicator Symbol 조합)를 단일 글리프로 렌더링하지 못함. 일반 이모지(🌐⚖️🏭)는 정상이지만 국기는 2개 regional indicator 조합이라 분리됨
**수정**: HTML — 국기 이모지를 PNG 이미지로 대체 (`<img src="assets/flag-xx.png">`)
**HTML 예방**: 국기 이모지 사용 금지 → PNG/SVG 이미지로 대체 [IL-26 / PF-12]

### 27. 3열+ 그리드 카드의 대응 텍스트 오버플로 (CJK 텍스트 박스 밀림)
**증상**: 3열 이상 grid 레이아웃에서 CJK 텍스트가 카드 하단 밖으로 밀려남
**근본 원인**: PowerPoint의 CJK 글리프 폭이 Chrome보다 넓어 줄바꿈이 추가 발생 → 세로 공간 부족
**수정**: 대응 텍스트 font-size 8pt → 7.5pt, line-height 1.5 → 1.4, padding 축소
**HTML 예방**: 3열+ 그리드 내 CJK 텍스트: font-size ≤ 7.5pt, line-height ≤ 1.4, padding ≤ 8pt [IL-27]

### 24. 비-leaf DIV 내 형제 span 텍스트 누락 (배경 있는 자식 div + 인라인 span 조합)
**증상**: `<div><div class="dot" style="background:..."></div><span>텍스트</span></div>` — dot shape은 보이나 span 텍스트 사라짐
**근본 원인**: 부모 div는 자식 div가 있어 leaf 아님(패턴#11 제외); `<span>`은 textTags 미포함으로 어떤 처리 경로에도 해당 안 됨
**수정**: HTML — `<span>텍스트</span>` → `<p>텍스트</p>`로 변경
**HTML 예방**: 아이콘/dot + 텍스트 조합에서 텍스트는 반드시 `<p>` 태그 사용 (`<span>` 금지)

---

## 현재 검사 파이프라인 (convert-native.mjs 3단계)

`convert-native.mjs` 실행 시 아래 3단계가 자동 순차 실행된다. 각 단계 ERROR 시 중단.

| Phase | 스크립트 | 규칙 | 속도 | 감지 대상 |
|-------|---------|------|------|----------|
| 1 | preflight-html.js | PF-01~PF-24 | ~1초 (정적), ~30초 (--full) | gradient, box-sizing, overflow, CJK, 도넛차트, span누락, transform, text-shadow, 폰트 가용성, 미지원CSS, 요소겹침, 하단마진, 이미지해상도, CJK밀도, 크로스슬라이드 일관성 |
| 2 | html2pptx.cjs (변환 중) | WCAG 대비 | 슬라이드당 ~0.8초 | 텍스트-배경 대비 < 4.5:1 (WARN), < 1.5:1 (ERROR) |
| 3 | validate-pptx.js | VP-01~VP-13 | ~2초 | 경계 초과, 컬럼 정렬, 빈 텍스트, 대비, 빈 카드, 테이블 빈셀, 그리드 빈셀, shrink 신뢰성, 간격 일관성, reading order, 빈 슬라이드, 미디어 크기 |

- `--full` 플래그: Phase 1 후 Playwright 동적 검증 추가 (Phase 1.5, PF-03/08/18/20/21/23)
- `--skip-preflight`: Phase 1/1.5 건너뜀
- `--skip-validation`: Phase 3 건너뜀

---

## 검사 프로세스 한계 및 개선사항

### 시각 검증: COM 300DPI Export (MCP 프리뷰 대체)

**2026-03-14 변경**: MCP `ppt_get_slide_preview`(~960px)를 PowerShell COM Export(4000×2250px, 300DPI)로 교체.
COM Export는 PowerPoint.exe 자체가 렌더링한 결과를 PNG로 저장하므로 화면에서 보이는 것과 동일.

```bash
powershell -ExecutionPolicy Bypass -File scripts/export-slides-png.ps1 \
  -PptxPath "PPTX경로" -OutputDir "preview경로" [-Slides "1,3,5"]
```

**감지 가능한 최소 차이**: ~1-2pt (4000px에서 충분히 식별 가능). 이전 MCP(960px)는 ~8-10pt가 한계였음.

**MCP `ppt_get_slide_preview` 더 이상 사용하지 않음** — COM Export가 상위 호환.
MCP의 프로그래매틱 도구(`ppt_get_table_data`, `ppt_get_shape_info`, `ppt_get_text`)는 여전히 유효 — 수치 검증이 필요할 때 사용.

**알려진 한계**: COM Export는 PowerPoint 앱이 백그라운드에서 실행됨 (슬라이드당 ~1-2초). CI/CD 환경에서는 부적합.

---

## 검사 통과 기록

| 날짜 | 프레젠테이션 | 슬라이드 수 | 결과 | 비고 |
|------|-------------|-----------|------|------|
| 2026-03-13 | coupang-investment-report | 14 | 패턴#17 최종 수정 — tableYMin을 confirmed columns에서만 계산 + Phase 3 비테이블 비활성(#20) | 근본 원인: 배지 shape이 tableYMin을 오염 → hero 요소가 테이블 범위 안으로 포함되어 스냅됨. Phase 3이 비테이블 슬라이드에서 제목을 full width로 확장(#20). `ppt_list_shapes`로 슬라이드 5/7/10 좌표 검증 완료 |
| 2026-03-14 (1차) | samsung-investment-report | 18 | 패턴#21,#22,#23 수정 후 통과 | HEX 대문자(#21), margin 배열 순서(#22), actsAsText parseInlineFormatting 복원(#23). COM 300DPI Export로 슬라이드 1,6,16 시각 확인 — 텍스트 가시성/정렬 정상. 슬라이드1 CONTRAST ERROR 5건은 배경이미지+overlay 패턴의 false positive (표지 텍스트 정상 표시) |
| 2026-03-14 (2차) | samsung-investment-report | 18 | 패턴#24 수정 후 통과 | 슬라이드6 도넛 차트 범례 span→p 변경. COM 300DPI Export로 슬라이드6 시각 확인 — 범례 텍스트 3개 정상 표시 |
| 2026-03-14 (3차) | lg-hynix-investment-strategy | 15 | 패턴#25,#26,#27 수정 후 통과 | 슬라이드5 도넛→PNG img(#25), 슬라이드10 국기emoji→PNG img(#26), 슬라이드13 3열 CJK 텍스트 축소(#27). COM 300DPI Export로 시각 확인 — 도넛 원형/국기/텍스트 정상 |
