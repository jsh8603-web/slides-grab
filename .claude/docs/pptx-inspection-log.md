# PPTX 검사 기록

Step 2(HTML 생성), Step 2.5(자동화 검증 + COM 고해상도 확인), Step 6(PPTX 생성) 시작 전 반드시 이 파일을 읽고, 기존 이슈 패턴을 반영한다.
검사 Phase 완료 후 발견/수정 내용을 이 파일에 추가한다.

### 패턴 번호 규칙 (Append-Only)

- 새 패턴은 **마지막 번호 + 1**로 추가 (현재 마지막: #71, PF 마지막: PF-66, VC 마지막: VC-07)
- 기존 번호를 재배정하거나 중간에 삽입 금지
- IL-1~59 상세: `pptx-inspection-log-archive.md` 참조 (해결된 패턴, PF 규칙으로 자동 방지)

관련 규칙: `html-prevention-rules.md` (금지/필수 규칙), `nanoBanana-guide.md` (이미지 생성 규칙)

---

## 활성 이슈 패턴 (최근, 미완전 자동화)

### 60. 인라인 span background 손실 → 텍스트 불가시 (IL-60 / PF-55)
**증상**: `<span style="background:#E4002B; color:#FFF">2X</span>` — PPTX에서 span background 제거 → 흰 텍스트가 밝은 배경에 불가시
**근본 원인**: html2pptx가 인라인 `<span>`의 CSS background를 추출하지 않음
**예방 규칙**: `<span>`에 `background`/`background-color` 존재 시 PF-55 ERROR
**수정 패턴**: 배경 제거 + 텍스트 색상으로 강조 (`color: #E4002B; font-weight: 700`)

### 61. PF-24 대비 검사 오탐 — 컨테이너 배경 미인식 (IL-61 / PF-24)
**증상**: 어두운 컨테이너(`background: #1B2A4A`) 위 밝은 텍스트가 PF-24 대비 부족 경고로 오탐
**수정**: `preflight-html.js` PF-24 — 모든 `background: #XXXXXX` 수집, ANY 배경과 WCAG 3:1 이상 대비 시 통과

### 62. 이미지 컨테이너 flex centering + height 누락 → 수직 정렬 무효 (IL-62 / PF-56)
**증상**: flex 컨테이너에 `height: 100%` 없으면 `align-items:center` 무효
**예방 규칙**: PF-56 WARN
**수정 패턴**: 부모 컨테이너에 `height: 100%` 추가

### 63. 이미지 크기 과소 — 컨테이너 대비 너무 작아 내용 불가시 (IL-63 / PF-57)
**증상**: 분할 레이아웃의 이미지가 width<100pt로 설정
**예방 규칙**: PF-57 WARN
**수정 패턴**: 이미지 크기를 200pt 이상으로 확대

### 65. flex:1 + overflow:hidden 컨테이너에서 고정높이 자식 잘림 (IL-65 / PF-59)
**증상**: `flex:1; overflow:hidden` 컨테이너 안에 `height: 100pt` 막대 + 라벨 텍스트 → 컨테이너 공간 부족 시 상단 라벨이 잘림 (슬라이드 13 Y1 "1억" 라벨 불가시)
**근본 원인**: `align-items: flex-end`로 하단 정렬 시 상단 콘텐츠가 overflow:hidden에 의해 잘림
**예방 규칙**: PF-59 WARN — `flex:1` + `overflow:hidden` 컨테이너 내 고정 height 합 > 90pt 시 경고
**수정 패턴**: 막대 높이 축소 또는 컨테이너에 충분한 고정 높이 할당

### 66. 배지(border-radius:50%) 내 텍스트 색상이 PPTX에서 불가시 (IL-66 / PF-60)
**증상**: `border-radius: 50%` 원형 배지 div(`background: #F59E0B`) 안에 `color: #FFFFFF` 텍스트 → PPTX에서 배지 배경이 텍스트 shape에 전달되지 않아 카드/슬라이드 배경(#FFF7ED, #F8FAFC) 대비 불가시
**근본 원인**: html2pptx가 작은 장식 div의 background를 자식 텍스트 shape의 fill로 전달하지 않음. 텍스트가 부모 카드 배경 위에 놓임
**예방 규칙**: PF-60 WARN — `border-radius: 50%` 또는 작은(≤40pt) div 내 텍스트의 color가 **해당 div의 부모 배경**과 대비 3:1 미만이면 경고
**수정 패턴**: 배지 텍스트 색상을 부모 카드 배경 대비 가시 색상으로 변경 (예: #FFFFFF → #92400E)

### 67. overflow:hidden flex 컨테이너에서 차트 바 라벨 잘림 (IL-67 / 정탐-수정)
**증상**: CSS flex 차트 바(height: 60pt)의 위에 위치한 숫자 라벨(-500)이 부모의 `overflow: hidden` + `flex: 1`에 의해 잘림
**근본 원인**: design-skill 생성 시 바 높이를 컨테이너 높이 대비 과하게 설정. PF-59는 >90pt만 검출하여 미탐지
**놓친 파이프라인**: PF-59 (임계값 >90pt → 60pt 미탐지)
**수정 패턴**: 바 높이를 컨테이너 높이의 70% 이내로 축소 (라벨+gap 공간 확보)
**예방**: design-skill 차트 생성 시 "바 최대 높이 = 컨테이너 여유높이 - 라벨 높이 - gap" 공식 적용

### 68. 다중 시리즈 차트에서 일부 시리즈 라벨 누락 (IL-68 / 정탐-한계)
**증상**: 정액법(gray)+정률법(orange) 2시리즈 비교 차트에서 정률법 라벨만 표시, 정액법 라벨 없음
**근본 원인**: design-skill이 시각적 강조 대상(정률법)만 라벨링하고 비교 대상(정액법) 라벨 생략
**놓친 파이프라인**: 없음 (의미론적 데이터 완전성은 자동 탐지 불가 — 정탐-한계)
**수정 패턴**: 모든 데이터 시리즈에 라벨 추가 (정액법 5천 × 5년)
**예방**: design-skill에 "다중 시리즈 차트는 모든 시리즈에 라벨 필수" 규칙 추가

### 69. 배경 이미지 위 텍스트 대비 부족 — 오버레이 없음 (IL-69 / PF-61)
**증상**: 밝은 도시 일출 배경 이미지 위 흰색 텍스트가 불가독
**근본 원인**: design-skill이 배경 이미지 슬라이드에 어두운 오버레이를 추가하지 않음
**예방 규칙**: PF-61 WARN (--full 모드) — Playwright로 텍스트 조상/형제에 absolute `<img>` 존재 시 overlay 또는 text-shadow 유무 검사
**수정 패턴**: 이미지 위에 `background: #1E293B; opacity: 0.65` 오버레이 div + text-shadow 추가. rgba() 금지 (PF-36 위반) → opacity 속성 사용
**예방**: design-skill에 "배경 이미지 위 텍스트 시 반드시 불투명 오버레이 + text-shadow 필수" 강화

### 70. conic-gradient / radial-gradient PPTX 변환 불가 (IL-70 / PF-62)
**증상**: CSS `conic-gradient()`로 구현한 도넛 차트가 PPTX에서 완전 소실. 빈 영역만 남고 차트 데이터 시각화 없음
**근본 원인**: html2pptx가 conic-gradient를 지원하지 않음. radial-gradient도 솔리드 색상으로 폴백
**놓친 파이프라인**: PF (미지원 CSS 목록에 conic-gradient 미등록)
**예방 규칙**: PF-62 ERROR (conic-gradient), PF-62 WARN (radial-gradient)
**수정 패턴**: 가로 바 차트(div+width%), 테이블, 또는 숫자 강조 카드로 대체

### 71. CSS 특이성 충돌로 텍스트 색상 소실 (IL-71 / 탐지 불가)
**증상**: `.tc-risk-high p { color: #EF4444 }`로 빨간색 지정했지만, `.r-odd .tc p { color: #1A1A2E }`가 특이성 우위(0,2,1 > 0,1,1)로 덮어씀 → 의도한 색상 미적용
**근본 원인**: CSS 특이성(specificity) 규칙 미준수. 더 구체적인 선택자가 우선
**놓친 파이프라인**: 전부 — HTML 렌더링 자체가 잘못되어 PF(정적), VP(XML), Vision(시각 비교) 모두 탐지 불가
**예방 규칙**: 자동 탐지 불가. html-prevention-rules.md에 생성 시 주의사항으로 등록
**수정 패턴**: 특이성 맞추기(`.r-odd .tc.tc-risk-high p`) 또는 inline style 사용

### 64. 이미지 src 파일명과 실제 assets 파일명 불일치 → 깨진 이미지 (IL-64 / PF-58)
**증상**: HTML에서 `src="assets/slide-14-three-shields.png"`로 참조하지만 실제 파일은 `slide-14-tax-shield-3-fcff.png` → 브라우저/PPTX에서 이미지 깨짐
**근본 원인**: 슬라이드 생성 시 NanoBanana 프롬프트 slug 기반 파일명을 추측하지만, generate-images.mjs가 실제 생성한 파일명과 다름
**예방 규칙**: PF-58 ERROR — `<img src="assets/...">`의 경로가 실제 파일로 존재하는지 검증
**수정 패턴**: `ls assets/` 확인 후 실제 파일명 사용

---

## 현재 검사 파이프라인 (convert-native.mjs 3단계)

| Phase | 스크립트 | 규칙 | 속도 | 감지 대상 |
|-------|---------|------|------|----------|
| 1 | preflight-html.js | PF-01~PF-59 | ~1초 (정적), ~30초 (--full) | gradient, box-sizing, CJK, span누락, 미지원CSS, 이미지, 과밀, 대비, 이미지경로, flex잘림 등 |
| 2 | html2pptx.cjs (변환 중) | WCAG 대비 | 슬라이드당 ~0.8초 | 텍스트-배경 대비 < 4.5:1 (WARN), < 1.5:1 (ERROR) |
| 3 | validate-pptx.js | VP-01~VP-16 | ~2초 | 경계 초과, 정렬, 빈 텍스트, 대비, shape겹침, CJK폭오버플로 등 |
| 4 | validate-pptx-com.ps1 | VC-01~VC-07 | ~30초 (COM) | 텍스트 실측 overflow, shape 겹침, auto-shrink, 폰트 대체 |

- `--full` 플래그: Phase 1.5 Playwright + Phase 4 COM 추가
- `--skip-preflight`: Phase 1/1.5 건너뜀
- `--skip-validation`: Phase 3/4 건너뜀

---

## Preflight 자동 감지 ID 매핑 (IL ↔ PF ↔ VP)

| IL 패턴 | PF 규칙 | VP 규칙 | 감지 방식 |
|---------|---------|---------|----------|
| IL-14,16 | PF-01 | VP-04 | 정적 regex + XML 대비 |
| IL-13 | PF-02,06 | — | 정적 regex |
| IL-04 | PF-04,05 | — | 정적 regex |
| IL-07 | PF-07,16 | — | 정적 regex |
| IL-10 | PF-03 | VP-01 | Playwright + XML |
| IL-06 | PF-08 | — | Playwright |
| IL-17 | — | VP-02 | XML 컬럼 정렬 |
| — | PF-09~11 | — | 크로스 슬라이드 |
| — | — | VP-05~08 | XML 테이블/그리드/빈카드 |
| IL-24 | PF-14 | — | 정적 regex |
| IL-25 | PF-13 | — | 정적 regex |
| IL-26 | PF-12 | — | 정적 regex |
| IL-27 | PF-15 | — | 정적 regex |
| — | PF-17~22 | — | 정적/Playwright |
| IL-01,02,06,18,27 | PF-23 | — | Playwright CJK 밀도 |
| IL-14,16 | PF-24 | — | 크로스 슬라이드 대비 |
| IL-32 | PF-25 | — | 정적 (font-size < 10pt) |
| IL-33 | PF-26 | — | Playwright (과밀) |
| IL-34 | PF-27 | — | 정적 (배지 nowrap) |
| — | PF-28~31 | — | 정적 (단어수, alt, 폰트계층, 제목) |
| IL-45 | PF-34 | — | 정적 (인라인 span 색상) |
| IL-44 | PF-35 | — | 정적 (li + pseudo) |
| IL-43 | PF-36 | — | 정적 (rgba 가림) |
| IL-28 | PF-37 | — | 정적 (border-triangle) |
| IL-38 | PF-38 | — | 정적 (underline) |
| IL-39 | PF-39 | — | 정적 (gradient-image) |
| IL-31 | PF-40 | — | 정적 (AI 인포그래픽) |
| IL-46~59 | PF-41~54 | — | 정적 (CSS 미지원 14종) |
| IL-60 | PF-55 | VP-04 | 정적 (span background) |
| IL-62 | PF-56 | — | 정적 (flex height) |
| IL-63 | PF-57 | — | 정적 (이미지 과소) |
| IL-64 | PF-58 | — | 정적 (이미지 경로) |
| IL-65 | PF-59 | — | 정적 (flex 잘림) |
| IL-66 | PF-60 | — | 정적 (배지 대비) |
| IL-69 | PF-61 | — | Playwright (이미지 배경 대비) |
| IL-70 | PF-62 | — | 정적 (conic/radial-gradient) |
| IL-36 | — | VP-15 | XML z-order 역전 |
| IL-37 | — | VP-16 | XML CJK 폭 오버플로 |
| — | — | VC-01~07 | COM (실측 overflow 등) |
| — | — | VP-09~14 | XML (shrink, 간격, reading order 등) |

---

## 시각 검증: COM 300DPI Export

```bash
powershell -ExecutionPolicy Bypass -File scripts/export-slides-png.ps1 \
  -PptxPath "PPTX경로" -OutputDir "preview경로" [-Slides "1,3,5"]
```

COM Export는 PowerPoint.exe 자체 렌더링 → PNG (4000×2250px, 300DPI).
MCP `ppt_get_slide_preview`는 더 이상 사용하지 않음.
