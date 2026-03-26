# Change Log — Full-Slide Regression Test System

## C-01: 정탐-수정 — preflight-html.js JSON 출력 추가
**파일+함수**: scripts/preflight-html.js parseIssueLine(), preflightCheck(), main()
**변경**: ANSI-only 출력 → --json 플래그로 구조화된 JSON 배열 출력 지원
**이유**: 회귀 테스트가 PF 결과를 프로그래밍 방식으로 파싱해야 함
**검증**: `node scripts/preflight-html.js --slides-dir slides/sailing-ships --json` → JSON 배열 출력

## C-02: 정탐-수정 — validate-pptx.js JSON 출력 + quiet 모드 추가
**파일+함수**: scripts/validate-pptx.js parseCliArgs(), main(), validatePptx()
**변경**: ANSI-only 출력 → --json 플래그 + validatePptx(path, {quiet:true}) 콘솔 출력 억제
**이유**: 회귀 테스트가 VP 결과를 프로그래밍 방식으로 파싱하고, 프로그래밍 호출 시 콘솔 노이즈 제거
**검증**: `node scripts/validate-pptx.js --input slides/sailing-ships/sailing-ships.pptx --json` → JSON 배열 출력

## C-03: 정탐-수정 — tests/run-full-regression.mjs 신규 생성
**파일+함수**: tests/run-full-regression.mjs (전체)
**변경**: 없음 → PF+VP 과거 슬라이드 baseline 비교 회귀 테스트 스크립트
**이유**: PF/VP 규칙 변경이 과거 프레젠테이션에 새 오탐을 만드는지 자동 검증
**검증**: `node tests/run-full-regression.mjs --save` → baseline 생성 + `node tests/run-full-regression.mjs` → 0 regression

## C-04: 정탐-수정 — 기존 스니펫 회귀 테스트 폐기 + 규칙 갱신
**파일+함수**: checklist-guard.mjs PIPELINE_FILES, testing-rules.md (전체)
**변경**: run-pf-regression.mjs, pf-cases.json, run-vp-regression.mjs, vp-cases.json 삭제 → run-full-regression.mjs로 대체
**이유**: 합성 HTML 스니펫 기반 → 과거 프레젠테이션 기반 풀슬라이드 회귀로 전환
**검증**: `node tests/run-full-regression.mjs` → 0 regression (풀슬라이드 회귀 대체 확인)

## C-05: 신규등록 — production-reporting-rules.md 압축 시 강제 로드 + 내용 갱신
**파일+함수**: scripts/post-compact-restore.mjs additionalContext, .claude/docs/production-reporting-rules.md (전체)
**변경**: PostCompact 복원 지시에 production-reporting-rules.md Read 추가 + 보고 규칙을 현재 상태(풀슬라이드 회귀, 4분류 판정)로 재작성
**이유**: 대화 압축 후 보고 규칙이 유실되어 보고 누락 발생 방지 + 신규등록 분류 추가
**검증**: `node scripts/post-compact-restore.mjs` → additionalContext에 production-reporting-rules.md 포함 확인
