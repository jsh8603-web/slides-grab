# PF/VP Full-Slide Regression Test System Progress

## 현재 상태
Phase: 구현  |  시작: 2026-03-22

## Step 진행
- [x] Phase 1: preflight-html.js --json 출력 추가
- [x] Phase 2: validate-pptx.js --json 출력 추가
- [x] Phase 3: tests/run-full-regression.mjs 신규 생성
- [x] Phase 4: 모델 검증 5단계 (PF 0→320→0, VP 0→249→0)
- [x] Phase 5: 기존 스니펫 테스트 폐기 + 규칙 파일 갱신

## 이슈 목록

### 이슈 #1: preflight-html.js JSON 출력 추가
- [x] A. 판정: 정탐-수정 (회귀 테스트를 위해 구조화된 출력 필요)
- [x] B. 원인 수정 (preflight-html.js에 parseIssueLine + --json CLI 옵션)
- [x] C. 재발 방지 (해당 없음 — 신규 기능 추가)
- [x] D. 테스트 (--json 실행 → JSON 배열 출력 확인)
- [x] E. 변경 로그 기록 (C-01)

### 이슈 #2: validate-pptx.js JSON 출력 추가
- [x] A. 판정: 정탐-수정 (회귀 테스트를 위해 구조화된 출력 필요)
- [x] B. 원인 수정 (validate-pptx.js에 --json CLI 옵션 + quiet 모드)
- [x] C. 재발 방지 (해당 없음 — 신규 기능 추가)
- [x] D. 테스트 (--json 실행 → JSON 배열 출력 확인)
- [x] E. 변경 로그 기록 (C-02)

### 이슈 #3: run-full-regression.mjs 신규 생성
- [x] A. 판정: 정탐-수정 (과거 슬라이드 대상 PF+VP 회귀 비교 시스템 없음)
- [x] B. 원인 수정 (tests/run-full-regression.mjs 생성)
- [x] C. 재발 방지 (해당 없음 — 신규 기능 추가)
- [x] D. 테스트 (모델 검증 5단계 통과: baseline→0 reg→PF 파괴 320 reg→원복 0→VP 파괴 249 reg→원복 0)
- [x] E. 변경 로그 기록 (C-03)

### 이슈 #4: testing-rules.md + checklist-guard + 스니펫 테스트 폐기
- [x] A. 판정: 정탐-수정 (테스트 체계에 풀슬라이드 회귀 추가, 스니펫 회귀 폐기)
- [x] B. 원인 수정 (testing-rules.md 재작성, checklist-guard 보호 파일 갱신, pf/vp 스니펫 삭제)
- [x] C. 재발 방지 (해당 없음 — 문서/설정 갱신)
- [x] D. 테스트 (회귀 테스트 0 regression 확인, 가드 테스트 필요)
- [x] E. 변경 로그 기록 (C-04)

### 이슈 #5: pfPass 카운터 중복 증가 버그
- [x] A. 판정: 정탐-수정 (resolved only 시 pfPass++ 2회 발생)
- [x] B. 원인 수정 (run-full-regression.mjs PF+VP 분기를 if/else if/else로 정리)
- [x] C. 재발 방지 (해당 없음 — 로직 버그 직접 수정)
- [x] D. 테스트 (PF 19/19, VP 17/17 정확한 카운터 확인, 회귀 0)
- [x] E. 변경 로그 기록 (C-03 범위 내)

## 활성 규칙
### 전체
- [x] `.claude/docs/testing-rules.md`

### 이슈 #6: production-reporting-rules.md 압축 시 강제 로드 + 내용 갱신
- [x] A. 판정: 신규등록 (보고 규칙을 세션 복원 시 자동 로드되도록 강제)
- [x] B. 원인 수정 (post-compact-restore.mjs에 reporting rules 로드 추가, production-reporting-rules.md 재작성)
- [x] C. 재발 방지 (해당 없음 — 신규 기능)
- [x] D. 테스트 (PostCompact 출력에 production-reporting-rules.md 3번 항목 포함 확인)
- [x] E. 변경 로그 기록 (C-05)
