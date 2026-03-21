#!/usr/bin/env node
// session-restore-guard.mjs -- PreToolUse hook
// Blocks Edit/Write/Bash if progress.md exists but .restore-marker is stale/missing.

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const PROJECT_ROOT = "D:/projects/slides-grab";

// Read stdin to check if this tool call targets .restore-marker (allow through)
let toolInput = {};
try {
  toolInput = JSON.parse(readFileSync(0, "utf8"));
} catch { /* no stdin */ }

const cmd = toolInput.tool_input?.command || "";
const filePath = toolInput.tool_input?.file_path || "";
const isMarkerOp =
  cmd.includes(".restore-marker") ||
  filePath.endsWith(".restore-marker") ||
  filePath.endsWith("progress.md");

if (isMarkerOp) {
  // Allow .restore-marker creation and progress.md edits
  process.exit(0);
}

function findActiveProgress() {
  const slidesDir = join(PROJECT_ROOT, "slides");
  let best = null;
  let bestMtime = 0;
  try {
    for (const dir of readdirSync(slidesDir)) {
      if (dir.startsWith("_")) continue;
      const p = join(slidesDir, dir, "progress.md");
      try {
        const st = statSync(p);
        if (st.mtimeMs > bestMtime) {
          bestMtime = st.mtimeMs;
          best = { path: p, dir: join(slidesDir, dir), mtime: st.mtimeMs };
        }
      } catch {
        /* no progress.md */
      }
    }
  } catch {
    /* slides/ doesn't exist */
  }
  return best;
}

const progress = findActiveProgress();

if (!progress) {
  // No active presentation — no restoration needed
  process.exit(0);
}

// Check restore marker
const markerPath = join(progress.dir, ".restore-marker");
let markerMtime = 0;
try {
  markerMtime = statSync(markerPath).mtimeMs;
} catch {
  /* marker doesn't exist */
}

if (markerMtime > 0 && markerMtime >= progress.mtime) {
  // Marker is newer than progress.md — restoration done
  process.exit(0);
}

// Marker missing or stale — block
const result = {
  decision: "block",
  reason: `세션 복원 필수 — progress.md가 존재하지만 복원이 완료되지 않았습니다.

즉시 실행:
1. Read: ${progress.path}
2. ## 활성 규칙의 [ ] 미체크 항목 → 해당 docs 파일을 Read로 재로드
3. 미완료 이슈 체크리스트([ ] 항목) → 해당 항목부터 처리
4. 복원 완료 후: touch ${join(progress.dir, ".restore-marker").replace(/\\/g, "/")}`,
};

process.stdout.write(JSON.stringify(result));
