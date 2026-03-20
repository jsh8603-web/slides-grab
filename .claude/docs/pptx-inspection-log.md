# PPTX 검사 기록

Step 2(HTML 생성), Step 2.5(자동화 검증 + COM 고해상도 확인), Step 6(PPTX 생성) 시작 전 반드시 이 파일을 읽고, 기존 이슈 패턴을 반영한다.
검사 Phase 완료 후 발견/수정 내용을 이 파일에 추가한다.

### 패턴 번호 규칙 (Append-Only)

- 새 패턴은 **마지막 번호 + 1**로 추가 (현재 마지막: #63, PF 마지막: PF-57, VC 마지막: VC-07)
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

---

## 현재 검사 파이프라인 (convert-native.mjs 3단계)

| Phase | 스크립트 | 규칙 | 속도 | 감지 대상 |
|-------|---------|------|------|----------|
| 1 | preflight-html.js | PF-01~PF-57 | ~1초 (정적), ~30초 (--full) | gradient, box-sizing, CJK, span누락, 미지원CSS, 이미지, 과밀, 대비 등 |
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
