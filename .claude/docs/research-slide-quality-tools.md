# 슬라이드 품질 검증 도구 종합 리서치 (2026-03-18)

## 개요

슬라이드 품질 검증 도구는 **브랜드 컴플라이언스** (UpSlide, Templafy, slidecheck)과 **접근성** (Grackle, MS Accessibility Checker) 두 범주. 순수 레이아웃/콘텐츠 밀도 검증 오픈소스 도구는 사실상 없음 — 우리 파이프라인이 이 영역 선두.

## 도구별 규칙 비교

### slidecheck.app (SaaS)
- 폰트 패밀리 일관성, 제목 정렬(수직 위치 편차 px), 푸터 존재, 페이지 번호, 맞춤법/문법(일본어 포함)

### UpSlide (PowerPoint 애드인)
- 테마/마스터 폰트 일치, 오프-브랜드 색상, 이중 공백, 빈 플레이스홀더, 정렬 불일치

### PPT Productivity (PowerPoint 애드인)
- **폰트 크기 범위**: 제목/텍스트박스/푸터별 min~max pt 검사
- **슬라이드 경계 초과**: 바깥 요소 감지
- **No-Fly Zone**: 사용자 정의 안전영역 외부 요소
- **선 두께/모서리 반경 일관성**
- **애니메이션/트랜지션 존재 여부** (제거 권장)
- **텍스트박스/테이블 셀 마진 일관성**
- **반복 단어 감지**

### Templafy (엔터프라이즈 SaaS, 40+ 규칙)
- 폰트/색상 브랜드 준수, 마스터 버전 일치, 로고 위치/버전, 정렬 불일치

### Grackle Slides (Google Slides 접근성, 16개 체크)
- **슬라이드 제목 존재 + 고유성**
- **색상 대비 WCAG 4.5:1**
- **8pt 미만 "미세 텍스트" 경고** (10pt 권장)
- **이미지 alt text 존재**
- **읽기 순서** (시각 vs DOM)
- **언어 설정**
- Section 508 / PDF/UA 준수

### Microsoft PowerPoint 내장 접근성 검사기
- 이미지 alt text, 슬라이드 제목 누락/고유성, 읽기 순서, 색상만으로 정보 전달

### PPTAgent / PPTEval (연구, GitHub)
- PPTEval 3차원: Content(간결/문법/정보량), Design(대비/겹침/가독성), Coherence(내러티브/스토리)
- 인간-LLM 상관 Pearson 0.71

### 2502.15412 논문 — Self-Verification
- 요소 겹침, 텍스트 오버플로, 이미지 품질, 요소 정렬, 폰트 계층, 경계 강제, 비율 보존

## 업계 표준 수치

| 출처 | 규칙 | 수치 |
|------|------|------|
| Guy Kawasaki 10-20-30 | 슬라이드/시간/폰트 | 10장/20분/30pt |
| 5x5 Rule | 줄당 단어/슬라이드당 줄 | ≤5/≤5 |
| 6x6 Rule | 줄당 단어/슬라이드당 줄 | ≤6/≤6 |
| McKinsey/BCG | 10초 이내 이해, 1인치 마진 | 72pt 마진, 1메시지/슬라이드 |
| WCAG 2.1 AA | 대비율 | 일반 4.5:1, 대형(18pt+) 3:1 |
| 이미지 해상도 | 프로젝션용 | 1920×1080px (96~144DPI) |
| 여백 표준 | 안전 여백 | 0.5~0.75" (36~54pt) |

## 우리 규칙 vs 업계 대조

| 우리 규칙 | 업계 표준 | 상태 |
|-----------|----------|------|
| VP-04 대비 1.5:1 ERROR / 4.5:1 WARN | WCAG 2.1 AA 4.5:1 | 일치 |
| PF-25 10pt 미만 ERROR | Grackle 8pt/10pt, 10-20-30 30pt | 일치 |
| VP-11 Reading Order | Grackle/MS | 일치 |
| VP-12 빈 슬라이드 | Grackle/MS | 일치 |
| VP-01 슬라이드 경계 | PPT Productivity | 일치 |
| PF-18 요소 겹침 > 20% | 2502.15412 논문 | 일치 |
| PF-26 콘텐츠 블록 ≤ 3 | BCG "10초" 원칙 정량화 | 일치 |
| IL-27 CJK 3열+ ≤ 7.5pt | 업계 선례 없음 | 고유 |
| VP-16 CJK 폭 추정 | 업계 선례 없음 | 고유 |

## 미구현 가치 있는 규칙 (우선순위순)

### 높은 우선순위
1. **슬라이드당 단어 수 한도** — 5x5/6x6 Rule, > 80단어 WARN
2. **이미지 alt text 누락** — WCAG, Grackle, MS
3. **슬라이드 제목 고유성** — Grackle, MS
4. **폰트 계층 역전** — 제목 < 본문 WARN (2502.15412 논문)
5. **이미지 해상도 DPI 최소값** — 72DPI 미만 WARN (PF-21 확장)

### 중간 우선순위
6. **Action Title 체크** — McKinsey/BCG
7. **언어 속성 설정** — WCAG
8. **빈 텍스트박스** — UpSlide, Grackle
9. **타임라인 CJK 라벨 길이 PF 자동 감지** — IL-35

### 불필요 (우리 파이프라인 특성상)
- 슬라이드 마스터 버전 (HTML 기반, 마스터 없음)
- 브랜드 폰트/색상 (모드별 다름)
- 애니메이션 감지 (PPTX에 애니메이션 없음)

## 오픈소스 생성 도구 품질 검증 현황

| 도구 | 내장 품질 검증 |
|------|-------------|
| Marp | 없음 (오버플로 이슈 #1894 미해결) |
| Slidev | 없음 |
| reveal.js | 없음 |
| PptxGenJS | 없음 (생성 전용) |
| python-pptx | XML 스키마 검증만 |
| presenton | 없음 (density 옵션만) |
| PPTAgent | PPTEval (LLM 기반, 수치 없음) |

## 참고 자료 URL
- PPTAgent: https://github.com/icip-cas/PPTAgent
- PPTAgent 논문: https://arxiv.org/html/2501.03936v3
- 2502.15412 논문: https://arxiv.org/html/2502.15412
- slidecheck: https://slidecheck.app/
- UpSlide: https://upslide.com/features/powerpoint-slide-check/
- PPT Productivity: https://pptproductivity.com/powerpoint-addin/refine-easier/powerpoint-proofing-tools-check-slides/check-formatting-presentations
- Templafy: https://www.templafy.com/validator-update-enable-absolute-control-over-company-owned-slides/
- Grackle: https://workspace.google.com/marketplace/app/grackle_slides/273764076887
- WCAG 2.1: https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html
- MS Accessibility: https://support.microsoft.com/en-us/office/make-your-powerpoint-presentations-accessible-to-people-with-disabilities-6f7772b2-2f33-4bd2-8ca7-dae3b2b3ef25
- McKinsey Design: https://visualsculptors.com/design-ex-mckinsey-presentation-designers/
- BCG Style: https://deckary.com/blog/bcg-presentation-style
- 10-20-30 Rule: https://guykawasaki.com/the_102030_rule/
- 6x6 Rule: https://slidemodel.com/6x6-rule-powerpoint/
