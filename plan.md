# HTML/PPTX 프로그래매틱 검증 강화 계획 v2

## Context

현재 파이프라인: PF-01~17 (preflight-html.js) + VP-01~08 (validate-pptx.js) + html2pptx 내부 WCAG 체크.
IL 패턴 27개 중 대부분에 자동 감지가 있으나, Playwright 동적 검증과 PPTX XML 후검증에 추가 가능한 영역이 있다.

웹 리서치 + 기존 IL 패턴 분석 결과, 아래 13개 방안을 도출했다.

---

## 방안 목록

### 1. Playwright 요소 겹침(Overlap) 감지 — PF-18 (--full)

**문제**: 절대 위치(absolute) 요소가 다른 텍스트 위에 겹쳐 가독성 저하. PPTX에서는 z-order가 다르게 적용될 수 있음.
**근거**: IL-07 (이미지+텍스트 가독성), Playwright issue #34778 (overlap detection 미지원)
**구현**: `--full` 모드에서 모든 텍스트 요소의 `getBoundingClientRect()` 수집 → 텍스트-텍스트, 이미지-텍스트 간 겹침 면적 계산 → 겹침 > 20% 시 WARN
**Level**: WARN
**비용**: 낮음 (기존 Playwright 세션 재사용)

### 2. 폰트 가용성 검증 — PF-19 (정적)

**문제**: HTML에서 사용한 폰트가 PowerPoint에 없으면 Arial 폴백 → 레이아웃 전면 붕괴. Pretendard 같은 웹폰트는 시스템에 설치 안 되어 있을 수 있음.
**근거**: 리서치 — PptxGenJS는 폰트 임베딩 미지원, PowerPoint가 시스템 폰트로 폴백
**구현**: HTML `font-family` 파싱 → 허용 폰트 목록(`Pretendard`, `Segoe UI`, `Arial`, `sans-serif` 등)과 대조 → 미등록 폰트 WARN
**Level**: WARN
**비용**: 매우 낮음 (regex)

### 3. `fit:"shrink"` 신뢰성 보정 — VP-09

**문제**: PptxGenJS의 `fit:"shrink"`가 PowerPoint에서 즉시 적용 안 됨 (편집/리사이즈 후에만 동작). 텍스트가 shape 경계를 넘어도 shrink가 작동 안 할 수 있음.
**근거**: PptxGenJS issue #330, #544 — shrink가 편집 이벤트 없이는 미작동
**구현**: PPTX XML에서 `<a:bodyPr>` autofit 속성 + 텍스트 런 총 길이 추정 → shape 면적 대비 텍스트 밀도 계산 → 밀도 초과 시 WARN ("shrink may not activate without manual edit")
**Level**: WARN
**비용**: 중간 (텍스트 길이 × 추정 폰트 크기 → 면적 비교)

### 4. Shape 간 간격 일관성 검증 — VP-10

**문제**: 카드 레이아웃에서 shape 간 gap이 불균일하면 시각적 품질 저하. html2pptx CJK 보정으로 간격이 달라질 수 있음.
**근거**: IL-17 (컬럼 정렬), IL-13 (flex 오버플로)
**구현**: 같은 y 높이의 shape 그룹(행) 또는 같은 x의 shape 그룹(열) 식별 → 인접 shape 간 gap 계산 → gap stddev > 임계값 시 WARN
**Level**: WARN
**비용**: 중간 (기존 shape 추출 재사용)

### 5. 하단 마진 침범 검증 강화 — PF-20 (--full)

**문제**: 현재 PF-03은 body scrollHeight > clientHeight만 체크. 하단 0.5" 마진 내 콘텐츠는 잡지 못함.
**근거**: IL-10 (콘텐츠 하단 오버플로), CLAUDE.md "하단 여백 0.5" 이상"
**구현**: Playwright에서 모든 자식 요소의 `getBoundingClientRect().bottom` 최대값 → 405pt - 36pt(0.5") = 369pt 초과 시 WARN
**Level**: WARN (369pt 초과), ERROR (405pt 초과 = 기존 PF-03)
**비용**: 낮음

### 6. 이미지 해상도/비율 검증 — PF-21 (--full)

**문제**: 저해상도 이미지가 프로젝터에서 깨져 보임. 비율 불일치로 이미지 왜곡.
**근거**: IL-15 (이미지 비율 불일치)
**구현**: Playwright에서 모든 `<img>` naturalWidth/naturalHeight vs. 렌더링 크기 비교 → 확대율 > 2x 시 WARN (저해상도), 비율 차이 > 5% 시 WARN (왜곡)
**Level**: WARN
**비용**: 낮음

### 7. PPTX Reading Order 검증 — VP-11

**문제**: PPTX의 shape 순서(`<p:spTree>` 내 순서)가 시각적 배치와 불일치하면 스크린리더 접근성 저하 + 탭 순서 혼란.
**근거**: 리서치 — Section508.gov reading order 가이드, PowerPoint 접근성 체커
**구현**: spTree 내 shape 순서 vs. y→x 좌표 기반 시각적 순서 비교 → 순서 불일치 비율 > 30% 시 WARN
**Level**: WARN
**비용**: 낮음 (기존 shape 좌표 활용)

### 8. 미지원 CSS 속성 종합 감지 — PF-22 (정적)

**문제**: html2pptx가 변환할 수 없는 CSS 속성 사용 시 시각적 차이 발생. 현재 PF-17은 transform만 감지.
**근거**: 리서치 — PptxGenJS 미지원: `backdrop-filter`, `mix-blend-mode`, `clip-path`, `mask`, `filter`(blur/brightness), `writing-mode: vertical`
**구현**: 미지원 속성 목록 regex 매칭 → 각각 WARN
**Level**: WARN
**비용**: 매우 낮음 (regex)

### 9. 텍스트 밀도 사전 계산 (CJK 보정 포함) — PF-23 (--full)

**문제**: PowerPoint의 CJK 글리프 폭이 Chrome보다 15-20% 넓어 줄바꿈 추가 발생 → 세로 오버플로.
**근거**: IL-01,02,06,09,18,27 (CJK 텍스트 관련 이슈 6개)
**구현**: Playwright에서 각 텍스트 요소의 `scrollWidth` vs. `clientWidth` 비교 + CJK 비율 × 1.2 보정 → 보정 후 오버플로 예상 시 WARN. 현재 PF-08은 font-size만 체크하지만 이건 실제 텍스트 길이 × 컨테이너 폭 비율까지 검증.
**Level**: WARN
**비용**: 중간 (모든 텍스트 요소 순회)

### 10. PPTX 내 빈 슬라이드 감지 — VP-12

**문제**: 변환 실패로 shape가 전혀 없거나 배경만 있는 빈 슬라이드 생성 가능.
**근거**: IL-11,12 (텍스트 누락 패턴)
**구현**: 슬라이드당 shape 수 < 2 또는 텍스트 런 총 수 = 0 시 ERROR
**Level**: ERROR
**비용**: 매우 낮음

### 11. 크로스 슬라이드 색상 대비 일관성 — PF-24 (정적)

**문제**: 동일 덱에서 밝은 배경 슬라이드와 어두운 배경 슬라이드가 혼재할 때, 텍스트 색상이 한쪽에서 안 보일 수 있음.
**근거**: IL-14,16 (gradient+흰텍스트), PF-11 (색상 팔레트)
**구현**: 각 슬라이드의 body background 밝기 분류 (light/dark) → 텍스트 색상이 배경 유형에 부적합한 경우 WARN (예: 어두운 배경에 어두운 텍스트)
**Level**: WARN
**비용**: 낮음 (기존 luminance 함수 재사용)

### ~~12. HTML `<style>` 블록 미지원 선택자 감지 — PF-25 (정적)~~ [삭제됨]

**삭제 사유**: html2pptx.cjs는 Playwright `page.evaluate`로 computed styles를 사용하므로 `<style>` 블록 클래스도 정상 처리됨. 전제가 잘못됨.

### 13. PPTX 파일 크기 + 이미지 최적화 검증 — VP-13

**문제**: 고해상도 이미지가 다수 포함되면 PPTX가 수십 MB → 이메일 첨부/공유 불가.
**근거**: 실무 — 프레젠테이션 공유 시 파일 크기 제한 (Gmail 25MB, Outlook 20MB)
**구현**: PPTX 내 `ppt/media/` 디렉토리의 이미지 파일 크기 합계 → 총 크기 > 20MB 시 WARN, 개별 이미지 > 5MB 시 WARN
**Level**: WARN
**비용**: 매우 낮음 (파일 크기 합산)

---

## 우선순위 매트릭스

| 순위 | 방안 | 영향도 | 구현 비용 | 기존 IL 커버 |
|------|------|--------|----------|-------------|
| 1 | #10 빈 슬라이드 감지 (VP-12) | 높음 | 매우 낮음 | IL-11,12 |
| 2 | #5 하단 마진 강화 (PF-20) | 높음 | 낮음 | IL-10 |
| 3 | #2 폰트 가용성 (PF-19) | 높음 | 매우 낮음 | 신규 |
| 4 | #9 CJK 텍스트 밀도 (PF-23) | 높음 | 중간 | IL-01,02,06,18,27 |
| 5 | #8 미지원 CSS 종합 (PF-22) | 중간 | 매우 낮음 | 신규 |
| 6 | #6 이미지 해상도/비율 (PF-21) | 중간 | 낮음 | IL-15 |
| 7 | #1 요소 겹침 감지 (PF-18) | 중간 | 낮음 | IL-07 |
| 8 | #4 Shape 간격 일관성 (VP-10) | 중간 | 중간 | IL-17 |
| ~~9~~ | ~~#12 style 블록 미지원 (PF-25)~~ | — | — | 삭제됨 (전제 오류) |
| 10 | #11 크로스 색상 대비 (PF-24) | 낮음 | 낮음 | IL-14,16 |
| 11 | #13 파일 크기 (VP-13) | 낮음 | 매우 낮음 | 신규 |
| 12 | #3 fit:shrink 신뢰성 (VP-09) | 낮음 | 중간 | 신규 |
| 13 | #7 Reading Order (VP-11) | 낮음 | 낮음 | 신규 |

## 수정 파일

| 파일 | 추가 규칙 |
|------|----------|
| `scripts/preflight-html.js` | PF-18~24 (정적 4개 + Playwright 4개, PF-25 삭제) |
| `scripts/validate-pptx.js` | VP-09~13 (5개) |
| `.claude/rules/html-prevention-rules.md` | 매핑 테이블 갱신 |
| `.claude/docs/pptx-inspection-log.md` | 파이프라인 테이블 갱신 |

## 구현 규모

- 정적 규칙 4개 (PF-19,22,24 + VP-12): regex/파일 크기 — 각 20~40줄
- Playwright 규칙 3개 (PF-18,20,21 + PF-23): 기존 세션 내 evaluate 추가 — 각 30~50줄
- VP XML 규칙 4개 (VP-09,10,11,13): 기존 shape/테이블 데이터 활용 — 각 20~40줄

총 예상: ~400줄 추가. S 스케일 직접 수행 가능.

## 검증

```bash
# 기존 테스트 통과
npm test

# 정적 검사 (신규 규칙 포함)
node scripts/preflight-html.js --slides-dir slides/lg-hynix-investment-strategy

# 동적 검사 (Playwright 신규 규칙)
node scripts/preflight-html.js --slides-dir slides/lg-hynix-investment-strategy --full

# PPTX 변환 + 검증
node scripts/convert-native.mjs --slides-dir slides/lg-hynix-investment-strategy --output slides/lg-hynix-investment-strategy/test-output.pptx

# 전체 슬라이드 폴더 false positive 확인
for dir in slides/*/; do node scripts/preflight-html.js --slides-dir "$dir"; done
```
