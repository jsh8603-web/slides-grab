#!/usr/bin/env node
/**
 * post-compact-restore.mjs — PostCompact hook
 *
 * After context compaction, outputs additionalContext instructing the agent
 * to re-read progress.md and reload active rules.
 */

import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = 'D:/projects/slides-grab';

function findActiveProgress() {
  const slidesDir = join(PROJECT_ROOT, 'slides');
  let best = null;
  let bestMtime = 0;
  try {
    for (const dir of readdirSync(slidesDir)) {
      if (dir.startsWith('_')) continue;
      const p = join(slidesDir, dir, 'progress.md');
      try {
        const st = statSync(p);
        if (st.mtimeMs > bestMtime) { bestMtime = st.mtimeMs; best = p; }
      } catch { /* no progress.md */ }
    }
  } catch { /* slides/ doesn't exist */ }
  return best;
}

const progressPath = findActiveProgress();
if (!progressPath) {
  // No active presentation — nothing to restore
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

const result = {
  additionalContext: `[PostCompact 세션 복원] 컨텍스트 압축이 발생했습니다.

즉시 실행 (CLAUDE.md §세션 복원 절차):
1. Read: ${progressPath}
2. ## 활성 규칙의 [ ] 미체크 항목 → 해당 docs 파일을 Read로 재로드
3. 미완료 이슈 체크리스트([ ] 항목) → 해당 항목부터 처리
4. ## 로그 기록 상태의 [ ] 항목 → pptx-inspection-log.md에 먼저 기록
5. 위 완료 후에만 작업 재개`
};

process.stdout.write(JSON.stringify(result));
