/**
 * auto-checklist.mjs — Auto-inject placeholder checklists into progress.md
 *
 * When pipeline scripts detect ERRORs or WARNs, they call injectChecklist() to add
 * a placeholder issue section. The checklist-guard then blocks slide edits
 * until the agent completes 3분류 판정 (A항목).
 *
 * Usage:
 *   import { injectChecklist } from './auto-checklist.mjs';
 *   injectChecklist(slidesDir, { pipeline: 'PF', errors: ['slide-01: ...'], severity: 'ERROR' });
 *   injectChecklist(slidesDir, { pipeline: 'PF', errors: ['slide-01: ...'], severity: 'WARN' });
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Find the next issue number from progress.md content.
 */
function nextIssueNumber(content) {
  const matches = content.matchAll(/^### (?:이슈|사용자 피드백|정탐-한계|정탐-수정|규칙 개선|승격)\s*#(\d+)/gm);
  let max = 0;
  for (const m of matches) {
    const n = parseInt(m[1], 10);
    if (n > max) max = n;
  }
  return max + 1;
}

/**
 * Inject a placeholder checklist into progress.md.
 *
 * @param {string} slidesDir - Path to the slides directory (e.g. slides/my-pres)
 * @param {object} opts
 * @param {string} opts.pipeline - Pipeline name (PF, VP, CONTRAST, IV, IP, VQA, COM)
 * @param {string[]} opts.errors - Array of error/warning description strings
 * @param {string} [opts.severity='ERROR'] - Severity level (ERROR or WARN)
 * @returns {boolean} true if checklist was injected, false if skipped
 */
export function injectChecklist(slidesDir, { pipeline, errors, severity = 'ERROR' }) {
  if (!errors || errors.length === 0) return false;

  const progressPath = join(slidesDir, 'progress.md');
  if (!existsSync(progressPath)) return false;

  let content = readFileSync(progressPath, 'utf8');

  // Extract affected slide numbers from error strings
  const slideNums = new Set();
  for (const err of errors) {
    const m = err.match(/slide[- _]?(\d+)/i);
    if (m) slideNums.add(m[1].padStart(2, '0'));
  }
  const slideList = slideNums.size > 0
    ? [...slideNums].sort().map(n => `slide-${n}`).join(', ')
    : '(상세 확인 필요)';

  const issueNum = nextIssueNumber(content);
  const sevLabel = severity === 'WARN' ? 'WARN' : 'ERROR';
  const summary = `${pipeline} ${sevLabel} ${errors.length}건 (${slideList})`;

  const checklist = `
### 이슈 #${issueNum}: ${summary} — 자동 생성
- [ ] A. 판정: (미입력 — 오탐/정탐-수정/정탐-한계 중 선택)
- [ ] B~I. (판정 후 체크리스트 완성)
`;

  // Insert before "## 탐지 코드 수정 검증" if it exists, otherwise append
  const insertPoint = content.indexOf('\n## 탐지 코드 수정 검증');
  if (insertPoint >= 0) {
    content = content.slice(0, insertPoint) + checklist + content.slice(insertPoint);
  } else {
    content = content.trimEnd() + '\n' + checklist;
  }

  writeFileSync(progressPath, content, 'utf8');
  console.log(`\n📋 progress.md에 자동 체크리스트 추가: 이슈 #${issueNum} (${pipeline} ${sevLabel} ${errors.length}건)`);
  return true;
}
