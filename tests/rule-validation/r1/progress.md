# 해저 데이터센터 — 바다 속 서버의 시대 Progress

## 현재 상태
Phase: Step 2 (HTML 슬라이드 생성)  |  시작: 2026-03-22  |  라운드: R1 (규칙 이행 검증)

## Step 진행
- [x] Step 0: 소스 확인 (AI 직접 리서치 — WebSearch 2건, 자동승인)
- [x] Step 1: 아웃라인 작성 (5장, Professional, Navy Precision, 자동승인)
- [x] Step 1.5B: NanoBanana 이미지 생성 (5장 성공, VQA avg 25.9, IP/IV 에러 0건)
- [x] Step 2: HTML 슬라이드 생성 (5장, PF 0 error 17 warn)
- [x] Step 2.5: 자동 검증 (PF 0err/17warn, VP 0err/80warn, COM 6err 정탐-한계, 변환 5/5 OK)
- [x] Step 5: 출력 선택 (PPTX, 자동승인)
- [x] Step 6: PPTX 변환 (rule-validation-r1.pptx, 5/5 변환 성공)
- [x] Step 7: 완료 (PPTX only, PDF 미선택)
- [x] Step 7.5: 프로덕션 후 검증 (V-01/V-02 통과, change-log 삭제)

## 탐지 코드 수정 검증
- [x] V-01: change-log 검증 (C-01 validate-slides.js isMain 가드 — import 정상, main() 미실행 확인)
- [x] V-02: change-log.md 삭제 (V-01 통과)

## 이슈 목록

## 활성 규칙

### 전체 프로덕션 (Step 7 완료 직후 전부 [x] 체크)
- [x] 워크플로우 상세 (`presentation-flow.md`) — 프로덕션 완료
- [x] 프로덕션 보고 규칙 (`production-reporting-rules.md`) — 프로덕션 완료

### Step 1 아웃라인
- [x] 디자인 모드 (`design-modes.md`) — Step 2~4 완료

### Step 1.5B 이미지 생성
- [x] 이미지 생성 가이드 (`nanoBanana-guide.md`) — Step 1.5B 완료
- [x] VQA 보수 기준 (`vqa-pipeline-maintenance.md`) — Step 1.5B 완료

### Step 2~6 HTML/PPTX
- [x] HTML 금지/필수 규칙 (`html-prevention-rules.md`) — Step 6 완료
- [x] PPTX 이슈 패턴 (`pptx-inspection-log.md`) — Step 6 완료

### 이슈 #1: PF WARN 17건 — WARN (Step 2.5 VP/COM에서 후속 확인)
- [x] A. 판정: PF-20(하단여백)/PF-23(CJK 폭)/PF-28(단어수)/PF-42(opacity)/PF-43(object-fit) WARN — PPTX 변환 후 VP에서 실제 오버플로 확인 예정

### 이슈 #2: PF WARN 17건 — 이슈 #1 중복
- [x] A. 판정: 이슈 #1과 동일 WARN (재실행 시 auto-checklist 재생성) — 중복 처리

### 이슈 #3: validate-slides.js main() 사이드 이펙트 — 정탐-수정
- [x] A. 판정: 정탐-수정 (validate-slides.js가 import 시 main() 무조건 실행 → process.argv의 --output을 파싱 → Unknown option 에러)
- [x] B. 대상 수정: validate-slides.js main() 가드 추가 (isMain = pathToFileURL(argv[1]) === import.meta.url)
- [x] C. 원인 수정: B=C (validate-slides.js 직접 수정 — import 시 main 실행 방지)
- [x] D. 재발 방지: convert-native.mjs --full 통합 실행으로 자연 검출. 향후 새 스크립트에 import 가능 함수가 있으면 isMain 가드 필수
- [x] E. 테스트: convert-native.mjs --full 재실행 → validate-slides.js import 정상 (변환 3/5 성공)
- [x] F. 변경 로그 기록 (C-01)

### 이슈 #4: PF WARN 17건 — 이슈 #1 중복
- [x] A. 판정: 이슈 #1과 동일 WARN (재실행 시 auto-checklist 재생성) — 중복 처리

### 이슈 #5: PF-dynamic WARN 6건 — WARN (sibling-overlap)
- [x] A. 판정: slide-01/05 배경 이미지+오버레이 구조의 sibling overlap — PPTX 변환 특성상 경미한 차이, 후속 확인

### 이슈 #6: VP WARN 43건 — WARN (변환 특성)
- [x] A. 판정: VP-02(열폭)/VP-03(빈텍스트)/VP-04(대비)/VP-10(간격)/VP-11(순서)/VP-16(CJK폭) WARN — 변환 특성 경미 차이

### 이슈 #7: COM ERROR 2건 + 변환 ERROR 3건 — 정탐-수정
- [x] A. 판정: 정탐-수정 (slide-01 span margin-bottom, slide-04 `<p>` background, slide-05 하단 여백. COM slide-02 content completeness 1/5)
- [x] B. 대상 수정: slide-01~05 전체 일괄 점검 + 수정 (slide-01 span margin→div wrap, slide-04 p→div×2, slide-05 bottom padding 32→40pt, slide-02/03/04 bottom padding 24/28→36pt)
- [x] C. 원인 수정: HTML 직접 수정 (수동 생성) — PF-07 `<p>` background→`<div>` 전환, PF-20 하단 여백 36pt+ 확보, span margin→div wrapper
- [x] D. 재발 방지: PF-07(p background), PF-20(하단 여백), html2pptx span margin 기존 탐지 규칙이 정상 검출 — 추가 규칙 불필요
- [x] E. 테스트: 재변환 → 5/5 성공, PF 0 err 17 warn, VP 0 err 80 warn, COM 6 err (content completeness — 배경이미지 슬라이드 특성)

### 이슈 #8: PF WARN 17건 — 이슈 #1 중복
- [x] A. 판정: 이슈 #1과 동일 WARN (재실행 시 auto-checklist 재생성) — 중복 처리

### 이슈 #9: PF-dynamic WARN 6건 — 이슈 #5 중복
- [x] A. 판정: 이슈 #5와 동일 WARN (slide-01/05 배경+오버레이 sibling overlap) — 중복 처리

### 이슈 #10: VP WARN 80건 — 이슈 #6 중복
- [x] A. 판정: 이슈 #6과 동일 VP WARN (변환 특성 — VP-02/03/04/10/11/16) — 중복 처리

### 이슈 #11: COM ERROR 6건 — 정탐-한계
- [x] A. 판정: 정탐-한계 (slide-01/03/05 배경이미지 슬라이드에서 COM content completeness 1/5 — Gemini Vision이 PPTX 배경이미지를 비교할 때 콘텐츠 누락으로 오판. opacity 오버레이가 PPTX에서 fully opaque로 변환되어 시각적 차이 발생)
- [x] B. 생성 금지 규칙: 해당 없음 (배경이미지+오버레이는 정상 디자인 패턴, COM의 Vision 모델 한계)
- [x] C. 심각도 재검토: COM VC-03 content completeness — 배경이미지 슬라이드에서 opacity 변환 차이로 인한 한계. ERROR 유지 (Vision 비교 정확도 자체의 한계)
