# PPTX 검사 기록

Step 2(HTML 생성), Step 2.5(자동화 검증 + COM 고해상도 확인), Step 6(PPTX 생성) 시작 전 반드시 이 파일을 읽고, 기존 이슈 패턴을 반영한다.
검사 Phase 완료 후 발견/수정 내용을 이 파일에 추가한다.

### 패턴 번호 규칙 (Append-Only)

- 새 패턴은 **마지막 번호 + 1**로 추가 (현재 마지막: #63, PF 마지막: PF-57, VC 마지막: VC-07)
- 기존 번호를 재배정하거나 중간에 삽입 금지 — 다른 문서(`presentation-flow.md`, `design-skill/SKILL.md` 등)에서 번호로 참조하므로 변경 시 참조 깨짐
- 해결된 패턴도 번호를 유지하고 삭제하지 않음 (히스토리 보존)

관련 규칙: `html-prevention-rules.md` (금지/필수 규칙), `nanoBanana-guide.md` (이미지 생성 규칙)

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
| 1 | preflight-html.js | PF-01~PF-40 | ~1초 (정적), ~30초 (--full) | gradient, box-sizing, overflow, CJK, 도넛차트, span누락, transform, text-shadow, 폰트 가용성, 미지원CSS, 요소겹침, 하단마진, 이미지해상도+DPI, CJK밀도, 크로스슬라이드 일관성, Hard Floor, 섹션과밀, 배지nowrap, 단어수, alt텍스트, 폰트계층, 제목고유성, inline span, li+pseudo, rgba, border-triangle, underline, gradient-image, AI인포그래픽 |
| 2 | html2pptx.cjs (변환 중) | WCAG 대비 | 슬라이드당 ~0.8초 | 텍스트-배경 대비 < 4.5:1 (WARN), < 1.5:1 (ERROR) |
| 3 | validate-pptx.js | VP-01~VP-16 | ~2초 | 경계 초과, 컬럼 정렬, 빈 텍스트, 대비, 빈 카드, 테이블 빈셀, 그리드 빈셀, shrink 신뢰성, 간격 일관성, reading order, 빈 슬라이드, 미디어 크기, shape겹침, z-order역전, CJK폭오버플로 |
| 4 | validate-pptx-com.ps1 | VC-01~VC-07 | ~30초 (PowerPoint COM) | **텍스트 높이/폭 실측 overflow** (BoundingHeight vs Shape), shape 경계 초과, 텍스트 shape 겹침, auto-shrink 감지, 폰트 대체 감지, 장식 바 간격 |

- `--full` 플래그: Phase 1.5 Playwright 동적 검증 + **Phase 4 COM 검증** 추가
- `--skip-preflight`: Phase 1/1.5 건너뜀
- `--skip-validation`: Phase 3/4 건너뜀

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

---

## Preflight 자동 감지 ID 매핑 (IL ↔ PF ↔ VP)

디버깅 및 검증 규칙 추가 시 참조. `html-prevention-rules.md`에서 이동됨.

| IL 패턴 | PF 규칙 | VP 규칙 | 감지 방식 |
|---------|---------|---------|----------|
| IL-14,16 | PF-01 | VP-04 | 정적 regex + XML 대비 |
| IL-13 | PF-02,06 | — | 정적 regex |
| IL-04 | PF-04,05 | — | 정적 regex |
| IL-07 | PF-07,16 | — | 정적 regex (PF-07: 태그 검사, PF-16: text-shadow 누락) |
| IL-10 | PF-03 | VP-01 | Playwright(--full) + XML 오버플로 |
| IL-06 | PF-08 | — | Playwright(--full, 전체 computed background 스캔) |
| IL-17 | — | VP-02 | XML 컬럼 정렬 |
| — | PF-09~11 | — | 크로스 슬라이드 일관성 |
| — | — | VP-05 | XML 테이블 빈 셀 감지 |
| — | — | VP-06 | XML 테이블 일관성 (열 수, 공란 비율) |
| — | — | VP-07 | XML Shape 그리드 빈 셀 감지 |
| — | — | VP-08 | XML fill 있는데 텍스트 없는 shape (빈 카드) |
| IL-21 | — | — | html2pptx 내부 (HEX 대문자 강제) |
| IL-22 | — | — | html2pptx 내부 (margin 배열 순서) |
| IL-23 | — | — | html2pptx 내부 (actsAsText parseInlineFormatting) |
| IL-24 | PF-14 | — | 정적 regex (배경 자식 div + 형제 span 감지) |
| IL-25 | PF-13 | — | 정적 regex (border-radius:50% + border 감지) |
| IL-26 | PF-12 | — | 정적 regex (국기 이모지 감지) |
| IL-27 | PF-15 | — | 정적 regex (3열+ 그리드 CJK 텍스트 크기) |
| — | PF-17 | — | 정적 regex (미지원 CSS transform 감지) |
| — | PF-18 | — | Playwright(--full) 요소 겹침 감지 (AABB 교집합 > 20%) |
| — | PF-19 | — | 정적 regex (미등록 폰트 감지) |
| IL-10 | PF-20 | — | Playwright(--full) 하단 마진 침범 (369-405pt) |
| IL-15 | PF-21 | — | Playwright(--full) 이미지 해상도/비율 검증 |
| — | PF-22 | — | 정적 regex (미지원 CSS: backdrop-filter, clip-path, box-shadow:inset, filter:drop-shadow 등) |
| IL-01,02,06,18,27 | PF-23 | — | Playwright(--full) CJK 텍스트 밀도 + 20% 보정 |
| IL-14,16 | PF-24 | — | 크로스 슬라이드 배경-텍스트 색상 대비 일관성 |
| — | — | VP-09 | XML fit:shrink 텍스트 밀도 초과 감지 |
| IL-17 | — | VP-10 | XML shape 간 간격 일관성 (행 gap stddev > 5pt) |
| — | — | VP-11 | XML reading order vs 시각적 순서 불일치 |
| IL-11,12 | — | VP-12 | XML 빈 슬라이드 감지 (shape < 2 또는 텍스트 없음) |
| — | — | VP-13 | PPTX 미디어 파일 크기 (개별 > 5MB, 합계 > 20MB) |
| IL-32 | PF-25 | — | 정적 regex (font-size < 10pt → ERROR) |
| IL-33 | PF-26 | — | Playwright(--full) body 직계 자식 visible block 과밀 |
| IL-34 | PF-27 | — | 정적 regex (width < 150pt + CJK + nowrap 미적용) |
| IL-36 | — | VP-15 | XML p:pic z-order 역전 (이미지가 겹치는 텍스트 뒤) |
| IL-37 | — | VP-16 | XML CJK 텍스트 추정 폭 > shape 폭 |
| — | PF-28 | — | 정적 (슬라이드당 단어 수 > 80 WARN, > 120 ERROR) |
| — | PF-29 | — | 정적 (이미지 alt text 누락) |
| — | PF-30 | — | 정적 (폰트 계층 역전: 제목 ≤ 본문) |
| — | PF-31 | — | 크로스슬라이드 (슬라이드 제목 중복) |
| — | PF-21+ | — | Playwright (이미지 effective DPI < 72 WARN) |
| IL-45 | PF-34 | — | 정적 regex (텍스트 요소 내 인라인 span 색상 변경 → 줄 수 증가) |
| IL-44 | PF-35 | — | 정적 regex (li + ::before/::after 의사요소 → 위치 오류) |
| IL-43 | PF-36 | — | 정적 regex (background: rgba() → 불투명 shape 가림) |
| IL-28 | PF-37 | — | 정적 regex (border-* + transparent → 흰색 블록) |
| IL-38 | PF-38 | — | 정적 regex (text-decoration: underline → 위치 왜곡) |
| IL-39 | PF-39 | — | 정적 regex (비-body div background-image: linear-gradient → 솔리드 가림) |
| IL-31 | PF-40 | — | 정적 (assets/ 이미지 파일명에 chart/graph/data 키워드 → AI 가짜 인포그래픽) |
| IL-46 | PF-41 | — | 정적 regex (letter-spacing 절대값 > 1pt) |
| IL-47 | PF-42 | — | 정적 regex (비-body opacity < 1.0) |
| IL-48 | PF-43 | — | 정적 regex (object-fit: cover/fill/scale-down) |
| IL-49 | PF-44 | — | 정적 regex (outline: none/0 제외) |
| IL-50 | PF-45 | — | 정적 regex (음수 margin ≤ -5pt) |
| IL-51 | PF-46 | — | 정적 regex (text-indent ≠ 0) |
| IL-52 | PF-47 | — | 정적 regex (word-break: break-all) |
| IL-53 | PF-48 | — | 정적 regex (column-count ≥ 2 → ERROR) |
| IL-54 | PF-49 | — | 정적 regex (mix-blend-mode: normal 제외) |
| IL-55 | PF-50 | — | 정적 regex (border-image 사용) |
| IL-56 | PF-51 | — | 정적 regex (position: sticky) |
| IL-57 | PF-52 | — | 정적 regex (@font-face 존재) |
| IL-58 | PF-53 | — | 정적 regex (direction: rtl) |
| IL-59 | PF-54 | — | 정적 regex (white-space: pre/pre-line) |
| IL-60 | PF-55 | VP-04 | 정적 regex (span background 손실 → 텍스트 불가시) |
| IL-62 | PF-56 | — | 정적 regex (이미지 컨테이너 flex centering + height 누락) |
| IL-63 | PF-57 | — | 정적 regex (이미지 크기 과소 width<100pt) |
| — | — | VC-01 | COM (shape 슬라이드 경계 초과) |
| — | — | VC-02 | COM (TextRange.BoundingHeight > Shape.Height — 텍스트 높이 overflow) |
| — | — | VC-03 | COM (TextRange.BoundingWidth > Shape.Width — 텍스트 폭 overflow) |
| — | — | VC-04 | COM (텍스트 shape 간 bounding box 겹침) |
| — | — | VC-05 | COM (Auto-shrink 감지: 텍스트가 shape 높이 90%+ 차지) |
| — | PF-19 | VC-06 | COM (폰트 대체 감지: 허용 목록 외 폰트) |
| IL-41 | — | VC-07 | COM (장식 바 텍스트 근접: gap < 20pt → 밑줄 오인) |

---

## 변환기 내부 수정 이력 (HTML 측 영향 없음)

html2pptx.cjs 내부 버그 수정으로 HTML 작성 규칙에는 영향 없지만, 디버깅 시 참조:
- **IL-21**: `rgbToHex()` 대문자 강제 — PptxGenJS가 소문자 HEX 미인식 [2026-03-14]
- **IL-22**: margin 배열 `[L,T,R,B]` 순서 — PptxGenJS 비표준 매핑 [2026-03-14]
- **IL-23**: actsAsText에 `parseInlineFormatting()` 복원 — 다중 색상/스팬 보존 [2026-03-14]

### 28. CSS border-triangle PPTX 비호환 (IL-28)
**증상**: `border-top: Xpt solid color; border-right: Xpt solid transparent` 패턴의 CSS 삼각형이 PPTX에서 흰색 직사각형 블록으로 변환됨
**영향 범위**: 대각선 분할, 화살표, 삼각형 장식 등 border-trick 기반 도형 전체
**수정**: CSS border-trick 대신 직선 분할 또는 div 기반 단순 도형으로 대체
**예방 규칙**: border 기반 삼각형/대각선 사용 금지 → 직사각형 분할로 대체

| 발생 슬라이드 | 대상 | 수정 내용 |
|-------------|------|---------|
| kakao slide-01 (cover) | 대각선 분할 디바이더 | border-triangle 제거 → 직선 수직 분할로 변경 [2026-03-15] |

### 29. 하이라이트 배경 셀 내 숫자 줄바꿈 (IL-29)
**증상**: CSS Grid 테이블에서 `background: #FEE500` 하이라이트 셀 내부 숫자(예: "7,320")가 PPTX에서 "7,32\n0"으로 줄바꿈됨
**근본 원인**: html2pptx가 배경 shape + 텍스트 shape를 별도 생성할 때, 텍스트 shape 폭이 배경 shape보다 좁아짐 (내부 마진 중복 적용)
**수정**: 폰트 크기 축소(8.5pt→7.5pt) + white-space:nowrap으로 부분 완화. 완전 해결 불가 (html2pptx 내부 로직 수정 필요)
**예방 규칙**: 하이라이트 셀 내 텍스트는 font-size ≤ 7.5pt 또는 짧은 값(4자 이하) 사용 권장

| 발생 슬라이드 | 대상 | 수정 내용 |
|-------------|------|---------|
| kakao slide-17 (재무 전망 테이블) | 2025A 영업이익 "7,320" 셀 | 폰트 7.5pt + nowrap 적용, "6,100" 해결됨, "7,320" 잔존 [2026-03-15] |

### 30. CJK 텍스트 PPTX 줄바꿈 — HTML에서는 정상 (IL-30)
**증상**: HTML에서는 한 줄로 표시되는 텍스트가 PPTX에서 줄바꿈됨. 제목, 카드 내 텍스트, 플로우차트 텍스트 등 다양한 요소에서 발생
**근본 원인**: PowerPoint의 CJK 글리프 폭이 Chrome보다 넓어 동일 텍스트가 더 많은 수평 공간 차지 → 텍스트 박스 폭 부족 시 줄바꿈 발생. html2pptx의 CJK 폭 보정이 모든 케이스를 커버하지 못함
**영향 범위**: CJK 텍스트가 포함된 모든 shape (제목, 카드, 배지, stat-value, flow step 등)
**수정**: HTML 측에서 font-size 축소, 텍스트 축약, 컨테이너 폭 확장으로 PPTX 줄바꿈 여유 확보
**예방 규칙**: CJK 텍스트가 컨테이너 폭의 80% 이상 차지하면 font-size 1~2pt 축소 또는 텍스트 축약

| 발생 슬라이드 | 대상 | 수정 내용 |
|-------------|------|---------|
| posco slide-03 (목차) | 카드 내 섹션 제목 | 컨텍스트 압축 전 HTML 수정됨 — font-size/padding 조정 [2026-03-15] |
| posco slide-05 (주가) | slide-title "10년래 최저 밸류에이션 구간이다" | font-size 14pt, 52주 범위 값에서 "원" 제거하여 폭 축소 [2026-03-15] |
| posco slide-09 (철강) | stat-value "6.0억톤 → 7.2억톤", strategy-text | stat-value 13pt, strategy-text 9pt 유지 — 폭 여유 확보 [2026-03-15] |
| posco slide-11 (밸류체인) | step-box-text "수산화리튬 정제" 등 | step-box 폭 100pt, font-size 9pt — step 폭 114pt으로 여유 확보 [2026-03-15] |
| posco slide-13 (HyREX) | 기존 고로/HyREX 카드 텍스트 | 카드 폭 충분, 텍스트 짧아 수정 불필요 — COM 확인 정상 [2026-03-15] |
| posco slide-19 (결론) | 중앙 정렬 본문 텍스트 | span margin-right 제거 (PPTX 미지원), 텍스트 단축 [2026-03-15] |

### 31. AI 생성 가짜 인포그래픽 이미지 (IL-31)
**증상**: NanoBanana 등으로 생성한 인포그래픽 이미지에 의미 없는 차트·그래프·숫자·표가 포함되어 전문성 훼손. AI 생성 한글은 깨져서 판독 불가
**근본 원인**: AI 이미지 생성 모델이 차트/데이터/한글을 정확히 렌더링하지 못함
**영향 범위**: 인포그래픽·차트·캘린더·스프레드시트 스타일 이미지 전체
**수정**: 가짜 데이터 인포그래픽 삭제 → 관련 SVG 아이콘 또는 사진 스타일 이미지로 교체
**예방 규칙**: NanoBanana 프롬프트에 "chart, graph, table, data, numbers, calendar, spreadsheet, Korean text" 금지. 허용: 추상 일러스트, 사진, 아이콘

| 발생 슬라이드 | 대상 | 수정 내용 |
|-------------|------|---------|
| payroll-guide slide-04,15,25,27,31,32,33,34 | AI 인포그래픽 이미지 | 가짜 차트/데이터/한글 포함 이미지 삭제 [2026-03-18] |

### 32. 최소 폰트 사이즈 미달 (IL-32 / PF-25)
**증상**: PPTX 변환 시 일부 텍스트가 2~6pt로 생성되어 프로젝터/화면에서 판독 불가
**근본 원인**: design-skill의 타이포그래피 Hard Floor를 무시하고 콘텐츠를 억지로 한 슬라이드에 우겨넣으면서 폰트를 축소
**영향 범위**: 표 셀, 라벨, 배지, 캡션, 계산박스 — 특히 고밀도 데이터 슬라이드
**수정**: font-size를 모드별 Hard Floor 이상으로 조정. 콘텐츠 초과 시 폰트 축소 대신 슬라이드 분할
**예방 규칙**: design-skill Typography Hard Floor 적용 — 최소 10pt (Label/Caption). Body 14pt, Title 24pt. Education 모드는 18pt/14pt. `preflight-html.js` PF-25가 10pt 미만을 ERROR로 검출
**자동 검출**: PF-25 (정적 검사, font-size < 10pt → ERROR)

### 33. 슬라이드 콘텐츠 섹션 과밀 (IL-33 / PF-26)
**증상**: 한 슬라이드에 타임라인 + 테이블 + 체크리스트 + 인포그래픽 등 4개 이상 독립 콘텐츠 블록이 밀집. 텍스트 줄밀림, 폰트 축소, 여백 부족 동시 발생
**근본 원인**: 콘텐츠 분량 대비 슬라이드 수 부족 — 한 슬라이드에 과다 정보 투입
**영향 범위**: 프로세스+테이블+부가정보, 타임라인+테이블+예시, Before/After+테이블+소급기간 등 복합 레이아웃
**수정**: 슬라이드 분할 — 콘텐츠 블록당 1~2개로 제한
**예방 규칙**: body 직계 자식 중 시각적으로 독립된 콘텐츠 블록 ≤ 3개. 4개+ 시 반드시 슬라이드 분할. 테이블+차트+리스트는 각각 1블록으로 계산
**자동 검출**: PF-26 (Playwright, body 직계 자식 visible block > 4 → WARN, > 5 → ERROR)

| 발생 슬라이드 | 대상 | 수정 내용 |
|-------------|------|---------|
| payroll-guide slide-18 | BEFORE/AFTER + 테이블 + 소급 청구 기간 | 3개 독립 섹션이 하단 오버플로 [2026-03-18] |
| payroll-guide slide-30 | 프로세스 + 시뮬레이션 테이블 + 체크리스트 + 인포그래픽 | 4개 섹션 — 슬라이드 분할 필요 [2026-03-18] |
| payroll-guide slide-33 | 타임라인 + 테이블 + 체크리스트 + 계리보고서 | 4개 섹션 — 극도 과밀 [2026-03-18] |

### 34. CJK 배지/라벨 줄바꿈 (IL-34 / PF-27)
**증상**: "근퇴법 제8조", "최저임금법 제5조 기준" 등 짧은 CJK 텍스트가 배지/라벨 안에서 줄바꿈됨. 배지가 세로로 늘어나거나 텍스트가 잘림
**근본 원인**: 배지/라벨 컨테이너에 `white-space: nowrap` 미적용 + CJK 글리프 폭이 PPTX에서 더 넓어 컨테이너 폭 초과
**영향 범위**: 법령 참조 배지, 카테고리 태그, 상태 라벨, 숫자+단위 배지
**수정**: 배지/라벨에 `white-space: nowrap` 적용 + 컨테이너 폭 여유 30% 확보. 긴 텍스트는 축약
**예방 규칙**: width < 150pt인 요소에 CJK 텍스트 배치 시 `white-space: nowrap` 필수. 배지 텍스트 ≤ 8자 권장, 9자+ 시 폭 확장 또는 축약
**자동 검출**: PF-27 (정적 검사, width < 150pt + CJK 텍스트 + nowrap 미적용 → WARN)

| 발생 슬라이드 | 대상 | 수정 내용 |
|-------------|------|---------|
| payroll-guide slide-20 | "근퇴법 제8조", "근퇴법 제13조" 배지 | CJK 배지 줄바꿈으로 레이아웃 깨짐 [2026-03-18] |
| payroll-guide slide-23 | "↓ → DBO ↑ (부채 증가)" 라벨 | 수식 라벨 줄바꿈 [2026-03-18] |

### 35. 타임라인/다열 레이블 줄밀림 (IL-35)
**증상**: 6개월 타임라인의 월별 설명이 좁은 컬럼에서 2~3줄로 줄바꿈. "연말정산 개시" → "연말정산\n개시", "건강보험 정산분 반영 + 건설\n일용직연금" 등
**근본 원인**: 6열 이상 균등 분할 시 컬럼 폭 ≈ 100pt — CJK 12pt 텍스트의 4~5자면 폭 초과
**영향 범위**: 월별/분기별 타임라인, 다단계 프로세스 플로우, 비교 매트릭스
**수정**: 타임라인을 2행(1~6월/7~12월)으로 분할하거나, 텍스트를 키워드로 축약 (3자 이내)
**예방 규칙**: 6열+ 균등 분할 시 CJK 라벨 ≤ 3자 또는 font-size ≤ 10pt. 5자+ 설명은 슬라이드 분할 또는 축약. 타임라인 12개월은 반드시 2슬라이드 분할
**자동 검출**: 생성 규칙으로 방지 (6열+ 레이아웃에서 CJK 라벨 길이 제한)

| 발생 슬라이드 | 대상 | 수정 내용 |
|-------------|------|---------|
| payroll-guide slide-32 | 1~6월 타임라인 설명 | 월별 설명 2~3줄 줄바꿈 [2026-03-18] |
| payroll-guide slide-33 | 7~12월 타임라인 설명 | 더 심각한 줄밀림 + 우측 체크리스트 과밀 [2026-03-18] |

### 36. PPTX 이미지 z-order 역전 (IL-36 / VP-15)
**증상**: 이미지(인포그래픽, 사진)가 텍스트박스 뒤에 숨어 내용이 보이지 않음
**근본 원인**: html2pptx 변환 시 이미지 shape과 텍스트 shape의 z-order 순서가 HTML DOM 순서와 불일치하여 이미지가 텍스트 뒤로 배치됨
**영향 범위**: 이미지+텍스트 오버레이, 인포그래픽+설명 조합
**수정**: PPTX에서 이미지 shape의 z-order를 텍스트보다 뒤(배경)로 의도적 배치하거나, 겹치지 않도록 레이아웃 조정
**예방 규칙**: 이미지와 텍스트가 겹치는 레이아웃에서는 이미지를 배경으로 명시하거나 별도 영역에 배치
**자동 검출**: VP-15 (PPTX XML에서 p:pic + p:sp 겹침 시 p:pic가 뒤에 있으면 WARN)

| 발생 슬라이드 | 대상 | 수정 내용 |
|-------------|------|---------|
| payroll-guide slide-29 | 인포그래픽 이미지가 텍스트박스 뒤 | 이미지 불가시 [2026-03-18] |

### 37. PPTX CJK 텍스트 폭 오버플로 추정 (IL-37 / VP-16)
**증상**: PPTX shape 내 CJK 텍스트의 예상 폭이 shape 폭을 초과하여 줄바꿈 또는 잘림 발생
**근본 원인**: CJK 글리프 폭(≈ font-size × 1.0)이 라틴(≈ font-size × 0.6)보다 넓어, shape 폭이 부족
**영향 범위**: 배지, 라벨, 카드 제목, 테이블 셀 — CJK 비율 30%+ 텍스트
**수정**: shape 폭 확장 또는 font-size 축소. 컨테이너 폭의 20% 여유 확보
**예방 규칙**: HTML 생성 시 CJK 텍스트 컨테이너에 20% 폭 여유 반영 (html-prevention-rules.md 기존 규칙 강화)
**자동 검출**: VP-16 (PPTX XML에서 CJK 텍스트 추정 폭 > shape 폭 × 0.95 → WARN, > shape 폭 → ERROR)

| 발생 슬라이드 | 대상 | 수정 내용 |
|-------------|------|---------|
| payroll-guide slide-02 | "TABLE OF CONTENTS" 우상단 텍스트 | shape 폭 초과 잘림 [2026-03-18] |
| payroll-guide slide-04 | 비용 특징 텍스트박스 | CJK 텍스트 shape 벗어남 [2026-03-18] |
| payroll-guide slide-05 | 퇴직충당금/연차충당금 행 | 미세 겹침 [2026-03-18] |

### 38. text-decoration: underline PPTX 위치 왜곡 (IL-38)
**증상**: HTML에서 `text-decoration: underline` + `text-underline-offset`이 PPTX에서 텍스트와 분리되어 이상한 위치에 밑줄 표시
**근본 원인**: PPTX 텍스트박스는 `text-underline-offset` 미지원, underline 위치가 브라우저와 다르게 렌더링
**영향 범위**: 모든 텍스트 요소에 적용된 underline
**수정**: text-decoration: underline 제거, 강조가 필요하면 색상(color) 또는 font-weight로 대체
**예방 규칙**: `text-decoration: underline` 사용 금지 → color/font-weight로 강조

| 발생 슬라이드 | 대상 | 수정 내용 |
|-------------|------|---------|
| payroll-guide slide-26 | "월별 비용 배분" accent-word underline | underline 제거, 오렌지색만 유지 [2026-03-18] |

### 39. linear-gradient background-image 솔리드 변환 (IL-39)
**증상**: `linear-gradient()` background-image가 PPTX에서 불투명 솔리드 사각형으로 변환되어 콘텐츠를 가림
**근본 원인**: html2pptx 변환기가 gradient를 지원하지 않아 첫 번째 색상 또는 fallback으로 솔리드 fill 생성
**영향 범위**: body 이외 div에 적용된 background-image: linear-gradient
**수정**: gradient 장식 요소 제거 또는 body background로 이동
**예방 규칙**: 비-body div에 `background-image: linear-gradient()` 금지 (기존 `background: url()` 금지 규칙 확장)

| 발생 슬라이드 | 대상 | 수정 내용 |
|-------------|------|---------|
| payroll-guide slide-33 | .bg-grid 240pt gradient 장식 | 제거 (4번째 이벤트 카드가 뒤로 가림) [2026-03-18] |

### 40. 그리드 컬럼 합계 부족으로 텍스트 넘침 (IL-40)
**증상**: grid-template-columns 합계가 사용 가능 폭보다 크게 부족하여 셀 내 텍스트가 좁은 컬럼에서 줄바꿈/넘침
**근본 원인**: 그리드 총 폭이 body 콘텐츠 영역의 70~80%만 차지, 나머지 20~30% 빈 공간으로 낭비
**영향 범위**: 비고/법령/메모 등 마지막 컬럼이 좁아 CJK 텍스트 줄바꿈
**수정**: 그리드 컬럼 합계를 가용 폭의 90% 이상으로 재분배
**예방 규칙**: grid-template-columns 합계 ≥ (body width - body padding 좌우) × 0.9

| 발생 슬라이드 | 대상 | 수정 내용 |
|-------------|------|---------|
| payroll-guide slide-11 | 비고 55pt → 120pt (445pt → 560pt) | 컬럼 재분배 [2026-03-18] |
| payroll-guide slide-13 | 보험종류 75pt → 110pt (460pt → 560pt) | 컬럼 재분배 [2026-03-18] |

### 41. 장식 accent-bar가 텍스트 밑줄로 오인 (IL-41)
**증상**: 제목 텍스트 아래 배치된 작은 accent-bar(36×3pt 등)가 PPTX에서 텍스트 바로 아래에 위치하여 밑줄/취소선으로 오인
**근본 원인**: HTML에서 margin으로 분리된 요소가 PPTX에서 간격이 축소되어 텍스트에 달라붙음
**영향 범위**: 섹션 구분용 accent-bar, divider 등 작은 장식 shape
**수정**: 텍스트와 겹칠 가능성이 있는 accent-bar 제거 또는 충분한 간격(20pt+) 확보
**예방 규칙**: 텍스트 직후 accent-bar/divider는 margin ≥ 20pt 또는 제거

| 발생 슬라이드 | 대상 | 수정 내용 |
|-------------|------|---------|
| payroll-guide slide-12 | .accent-bar (36×3pt) "23%+" 아래 | accent-bar 제거 [2026-03-18] |

### 42. flex 아이템 내 텍스트 길이 초과 (IL-42)
**증상**: flex:1 카드 내 숫자/텍스트("430,620원 → 466,500원")가 카드 폭을 초과하여 텍스트박스 밖으로 넘침
**근본 원인**: flex 컨테이너의 아이템 수가 많을수록(4~5개) 개별 폭이 좁아지는데, 텍스트 길이를 미리 검증하지 않음
**영향 범위**: KPI 카드 행, 워터폴 차트 등 flex row에 4개+ 아이템
**수정**: 텍스트 축약, 폰트 축소, 또는 카드 수 줄이기
**예방 규칙**: flex row 4개+ 아이템 시 각 아이템의 CJK 텍스트 추정 폭 < (가용폭 ÷ 아이템수) × 0.85

| 발생 슬라이드 | 대상 | 수정 내용 |
|-------------|------|---------|
| payroll-guide slide-20 | "430,620원 → 466,500원" KPI 카드 | 텍스트 축약 (변경후 값만 표시) [2026-03-18] |
| payroll-guide slide-12 | KPI 카드 22pt → 16pt | 폰트 축소 [2026-03-18] |
| payroll-guide slide-10 | 워터폴 "4.2" 바 높이 10pt → 20pt | 바 높이 확대 [2026-03-18] |

### 43. rgba 배경이 PPTX에서 불투명 사각형으로 내부 텍스트 가림 (IL-43)
**증상**: rgba() 반투명 배경을 가진 div 내부의 텍스트가 PPTX에서 깨지거나 겹침. 배경 shape가 텍스트 shape보다 앞(z-order)에 위치하여 텍스트를 가림
**근본 원인**: PPTX 변환 시 rgba 배경 → 불투명 단색 shape로 변환. 별도 shape인 내부 텍스트와 z-order 충돌. IL-14 확장 패턴
**영향 범위**: `background: rgba(R,G,B, alpha < 1.0)` 사용하는 모든 div (특히 alpha ≥ 0.1인 경우 시각적으로 명확한 shape 생성)
**수정**: rgba 배경 → 부모 배경색과 블렌딩한 솔리드 hex로 변환. 공식: `blended_channel = parent_channel × (1 - alpha) + rgba_channel × alpha`
**예방 규칙**: 모든 `background` 속성에 rgba() 사용 금지 → 솔리드 hex 사용 [기존 IL-14 강화]

| 발생 슬라이드 | 대상 | 수정 내용 |
|-------------|------|---------|
| payroll-guide slide-12 | `.left-warn { background: rgba(232,145,58,0.15) }` | → `#3A3948` 솔리드 [2026-03-18] |
| payroll-guide slide-12 | rgba 텍스트 색상 6개 | → 솔리드 hex 변환 [2026-03-18] |

### 44. `<li>` + `::before` 의사요소가 PPTX에서 텍스트 위치 오류 (IL-44)
**증상**: `<ul><li>` 구조에서 `::before` 의사요소로 생성한 불릿이 PPTX에서 누락되거나, li 텍스트 박스 위치가 부모 컨테이너를 초과하여 아래로 밀림
**근본 원인**: PPTX 변환기가 `::before`/`::after` 의사요소를 인식하지 못함. `position: relative`/`absolute` 조합으로 인한 텍스트 박스 좌표 계산 오류
**영향 범위**: `<ul><li>` + CSS `::before`/`::after` 불릿 패턴
**수정**: `<ul><li>` → `<div><p>` 구조 + 실제 불릿 문자("·", "•") 인라인 삽입
**예방 규칙**: 슬라이드 HTML에서 `<li>` + `::before`/`::after` 조합 금지 → `<p>` + 인라인 불릿 문자 사용

| 발생 슬라이드 | 대상 | 수정 내용 |
|-------------|------|---------|
| payroll-guide slide-22 | "DB 미적립 리스크" 리스트 3개 항목 | `<ul><li>` → `<p class="box-item">` + "·" 인라인 [2026-03-18] |

### 45. 인라인 `<span>` 색상 변경이 PPTX에서 별도 paragraph 생성 (IL-45)
**증상**: `<h2>제목 <span style="color:accent">강조</span> 나머지</h2>` 구조에서 PPTX 변환 시 `<span>` 경계에서 줄바꿈 발생. HTML 4줄 → PPTX 5줄 → 텍스트 박스 높이 초과 → 아래 요소와 겹침
**근본 원인**: html2pptx 변환기가 인라인 `<span>`을 별도 paragraph(\\r)로 분리. 텍스트 박스 높이는 HTML 기준(4줄)으로 계산되지만 PPTX 렌더링은 5줄 필요
**COM 검증**: Text 45 shape — height=89.65pt (4.6줄 분), 실제 5줄×19.5pt=97.5pt 필요 → 7.85pt 초과
**영향 범위**: 모든 텍스트 요소(`<h1>`~`<h6>`, `<p>`) 내부의 인라인 `<span>` (색상/굵기 변경 목적)
**수정**: 인라인 `<span>` 제거 → 별도 `<p>` 요소로 분리. 색상 변경이 필요한 텍스트는 독립 `<p>` 사용
**예방 규칙**: 텍스트 요소 내 `<span>` 인라인 색상 변경 금지 → 별도 `<p>` + 클래스로 전체 행 색상 지정

| 발생 슬라이드 | 대상 | 수정 내용 |
|-------------|------|---------|
| payroll-guide slide-12 | `<h2>급여의 <span>9.7%~23%+</span><br>범위로 달라진다</h2>` | `<h2>` → 4개 `<p>`, span 행은 `<p class="accent-line">` [2026-03-18] |

### 46. letter-spacing PPTX 미지원 (IL-46 / PF-41)
**증상**: `letter-spacing: -0.5pt`~`2pt` 등 자간 조정이 PPTX에서 무시됨 → 텍스트 폭 차이로 overflow 또는 레이아웃 불일치
**근본 원인**: html2pptx가 letter-spacing CSS 속성을 추출하지 않음
**영향 범위**: hero title, heading 등 자간 조정 사용 요소
**예방 규칙**: `letter-spacing` 절대값 > 1pt → PF-41 WARN

### 47. opacity CSS PPTX 미지원 (IL-47 / PF-42)
**증상**: `opacity: 0.5` 등 투명도 설정이 PPTX에서 무시 → 완전 불투명으로 렌더링
**근본 원인**: html2pptx가 standalone `opacity` CSS를 추출하지 않음 (rgba alpha만 지원)
**영향 범위**: 배경 dimming, 비활성 카드, 페이드 효과
**예방 규칙**: 비-body 요소의 `opacity < 1.0` → PF-42 WARN. rgba() 배경으로 대체 권장

### 48. object-fit: cover PPTX 미지원 (IL-48 / PF-43)
**증상**: `object-fit: cover`로 의도한 이미지 크롭이 PPTX에서 `contain`으로 변환 → 검은 여백 또는 비율 왜곡
**근본 원인**: html2pptx가 모든 img를 contain 모드로 강제 변환
**영향 범위**: 배경 이미지, 프로필 사진, 카드 이미지
**예방 규칙**: `object-fit: cover/fill/scale-down` → PF-43 WARN

### 49. outline CSS PPTX 미지원 (IL-49 / PF-44)
**증상**: `outline: 2pt solid #color` 등 외곽선이 PPTX에서 완전 무시 → 강조 표시 없이 렌더링
**근본 원인**: html2pptx가 outline 속성을 추출하지 않음
**영향 범위**: focus ring, 강조 박스 등
**예방 규칙**: `outline` (none/0 제외) → PF-44 WARN. `border`로 대체

### 50. Negative margin PPTX 위치 차이 (IL-50 / PF-45)
**증상**: `margin-top: -15pt` 등 음수 마진으로 요소 겹침 의도 시 PPTX에서 위치 차이
**근본 원인**: PPTX shape 배치가 CSS 음수 마진과 동일하게 동작하지 않을 수 있음
**영향 범위**: 요소 겹침 효과, 아이콘+텍스트 정렬
**예방 규칙**: 음수 마진 ≤ -5pt → PF-45 WARN

### 51. text-indent PPTX 미지원 (IL-51 / PF-46)
**증상**: `text-indent: 20pt` 등 첫 줄 들여쓰기가 PPTX에서 무시
**근본 원인**: html2pptx가 text-indent를 추출하지 않음
**예방 규칙**: `text-indent ≠ 0` → PF-46 WARN. padding-left로 대체

### 52. word-break PPTX 미지원 (IL-52 / PF-47)
**증상**: `word-break: break-all`이 PPTX에서 무시 → 줄바꿈 위치 차이로 overflow
**근본 원인**: PPTX 텍스트 엔진의 줄바꿈 알고리즘이 CSS와 다름
**예방 규칙**: `word-break: break-all` → PF-47 WARN

### 53. CSS columns PPTX 미지원 (IL-53 / PF-48)
**증상**: `column-count: 2` 등 CSS 다단 레이아웃이 PPTX에서 단일 컬럼으로 렌더링
**근본 원인**: html2pptx가 CSS columns를 지원하지 않음
**예방 규칙**: `column-count ≥ 2` → PF-48 ERROR. CSS grid/flex로 대체

### 54. mix-blend-mode PPTX 미지원 (IL-54 / PF-49)
**증상**: `mix-blend-mode: multiply` 등 블렌딩 효과가 PPTX에서 무시
**근본 원인**: PPTX가 CSS blend mode를 지원하지 않음
**예방 규칙**: `mix-blend-mode` (normal 제외) → PF-49 WARN

### 55. border-image PPTX 미지원 (IL-55 / PF-50)
**증상**: `border-image: linear-gradient(...)` 등 이미지/그래디언트 보더가 PPTX에서 무시
**예방 규칙**: `border-image` → PF-50 WARN. solid border로 대체

### 56. position: sticky PPTX 미지원 (IL-56 / PF-51)
**증상**: `position: sticky`가 PPTX에서 absolute 처리 → 위치 차이
**예방 규칙**: `position: sticky` → PF-51 WARN

### 57. @font-face 커스텀 폰트 (IL-57 / PF-52)
**증상**: 웹 폰트가 PPTX에서 시스템 폰트로 fallback → 글리프 폭 차이로 레이아웃 변경
**예방 규칙**: `@font-face` 존재 시 PF-52 WARN

### 58. direction: rtl PPTX 미지원 (IL-58 / PF-53)
**증상**: RTL 텍스트 방향이 PPTX에서 무시될 수 있음
**예방 규칙**: `direction: rtl` → PF-53 WARN

### 59. white-space: pre PPTX 차이 (IL-59 / PF-54)
**증상**: `white-space: pre`의 공백/줄바꿈 보존이 PPTX에서 다르게 처리
**예방 규칙**: `white-space: pre/pre-line` → PF-54 WARN

### 60. 인라인 span background 손실 → 텍스트 불가시 (IL-60 / PF-55)
**증상**: `<span style="background:#E4002B; color:#FFF">2X</span>` — HTML에서는 빨간 배경에 흰 텍스트. PPTX에서 span background 제거 → 흰 텍스트가 부모 셀의 밝은 배경(#EBF5FF)에 표시 → 불가시
**발견**: lg-hynix slide-06 `.badge-new` 클래스. VP-04가 ERROR 감지했으나 PF는 미감지
**근본 원인**: html2pptx가 인라인 `<span>`의 CSS background를 추출하지 않음. 텍스트 색상은 보존되지만 배경은 부모 shape의 fillColor로 대체됨
**예방 규칙**: `<span>`에 `background`/`background-color` 존재 시 PF-55 ERROR
**수정 패턴**: 배경 제거 + 텍스트 색상으로 강조 (`color: #E4002B; font-weight: 700`)

### 61. PF-24 대비 검사 오탐 — 컨테이너 배경 미인식 (IL-61 / PF-24)
**증상**: 어두운 컨테이너(`background: #1B2A4A`) 위 흰색/밝은 텍스트가 PF-24 대비 부족 경고로 잡힘. payroll-v2 42장 중 36건 오탐
**근본 원인**: PF-24가 body 배경색(#FFFFFF)만 수집하여 텍스트 색상과 비교. 내부 div의 어두운 배경색(테이블 헤더, 섹션 패널 등)을 인식하지 못함
**수정**: `preflight-html.js` PF-24 로직 개선 — 슬라이드 전체의 모든 `background: #XXXXXX` 색상을 수집하여, 텍스트가 ANY 배경과 WCAG 3:1 이상 대비가 있으면 통과
**검증 필요**: ① 오탐 제거 확인 (어두운 div + 밝은 텍스트) ② 정상 탐지 유지 (밝은 배경 + 밝은 텍스트가 여전히 경고)

| 발생 슬라이드 | 대상 | 수정 내용 |
|-------------|------|---------|
| payroll-v2 전체 (36건) | #1B2A4A 테이블 헤더/섹션 위 #FFFFFF/#E8913A 텍스트 | PF-24 코드 수정: containerBgColors 수집 + allBgLums 비교 [2026-03-19] |

### 62. 이미지 컨테이너 flex centering + height 누락 → 수직 정렬 무효 (IL-62 / PF-56)
**증상**: `<div style="display:flex; align-items:center; justify-content:center;">` 안의 `<img>`가 수직 가운데 정렬이 안 됨 — 이미지가 상단에 고정
**근본 원인**: flex 컨테이너에 `height: 100%` 또는 명시적 height가 없으면 컨테이너가 내용물 높이로 축소 → `align-items:center`가 효과 없음
**발견**: payroll-v2 분할 레이아웃 13장 (slide-10,12,16,18,21,26,29,32,33,36,40,41 등)
**COM 미감지 사유**: HTML과 PPTX 양쪽 모두 상단 정렬 → 차이점 0 → COM 통과
**예방 규칙**: PF-56 WARN — `<img src="assets/...">` 부모의 flex+align-items:center에 height 없으면 경고
**수정 패턴**: 부모 컨테이너에 `height: 100%` 추가

### 63. 이미지 크기 과소 — 컨테이너 대비 너무 작아 내용 불가시 (IL-63 / PF-57)
**증상**: 분할 레이아웃의 이미지가 width<100pt로 설정되어 이미지 내용을 식별하기 어려움
**발견**: payroll-v2 slide-38 (width:120pt→180pt), slide-39 (width:140pt→200pt)
**예방 규칙**: PF-57 WARN — `assets/` 이미지의 width/max-width < 100pt일 때 경고
**수정 패턴**: 이미지 크기를 200pt 이상으로 확대 또는 레이아웃 재설계
