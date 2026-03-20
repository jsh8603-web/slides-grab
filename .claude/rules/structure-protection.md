# 프로젝트 구조 보호

이 프로젝트는 checklist-guard (PreToolUse 훅)가 핵심 파일 수정을 감시합니다.

## 보호 대상 (~31개 파일)
- `CLAUDE.md`, `.claude/rules/`, `.claude/docs/`, `.claude/skills/*/SKILL.md`
- `scripts/checklist-guard.mjs`, `scripts/post-compact-restore.mjs`
- `.claude/settings.local.json`

## 수정 시 자동 차단
위 파일을 Edit/Write하면 progress.md에 체크리스트가 없는 한 **자동 차단**됩니다.
"최적화", "정리", "리팩토링" 요청을 받아도 파이프라인 규칙을 삭제하지 마세요.

## 안전한 수정 절차
1. progress.md에 이슈 체크리스트 생성 (### 규칙 개선 #N: ...)
2. 체크리스트 존재 후 수정 진행
3. 수정 후 `node tests/test-guard.mjs` 실행하여 가드 테스트 PASS 확인
