#!/usr/bin/env node
/**
 * test-guard.mjs — Automated tests for checklist-guard.mjs + progress.md validator
 *
 * Usage:
 *   node tests/test-guard.mjs              # Run guard rule tests (Phase B + C)
 *   node tests/test-guard.mjs --validate slides/프레젠테이션명  # Validate progress.md pipeline
 */

import { spawnSync } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';

const PROJECT_ROOT = 'D:/projects/slides-grab';
const GUARD_SCRIPT = join(PROJECT_ROOT, 'scripts/checklist-guard.mjs');
const TEST_DIR = join(PROJECT_ROOT, 'slides/_guard-test');

// ─── Validator Mode ────────────────────────────────────────────────

if (process.argv.includes('--validate')) {
  const idx = process.argv.indexOf('--validate');
  const target = process.argv[idx + 1];
  if (!target) {
    console.error('Usage: node tests/test-guard.mjs --validate slides/프레젠테이션명');
    process.exit(1);
  }
  const progressPath = join(PROJECT_ROOT, target, 'progress.md');
  if (!existsSync(progressPath)) {
    console.error(`progress.md not found: ${progressPath}`);
    process.exit(1);
  }
  const content = readFileSync(progressPath, 'utf8');
  const results = validateProgress(content, target);
  printValidatorResults(results);
  process.exit(results.some(r => !r.pass) ? 1 : 0);
}

// ─── Validator Logic ───────────────────────────────────────────────

function validateProgress(content, target) {
  const results = [];

  // V1: Step 순서 완전성 — Step 0~7 전부 [x]
  {
    const steps = [0, 1, 2, 3, 4, 5, 6, 7];
    const missing = steps.filter(n => {
      const re = new RegExp(`\\[x\\]\\s*Step ${n}[:\\s]`);
      return !re.test(content);
    });
    // Also check for Step 1.5A, 1.5B, 2.5 (common sub-steps)
    results.push({
      id: 'V1', name: 'Step 순서 완전성',
      pass: missing.length === 0,
      detail: missing.length === 0
        ? 'Step 0~7 전부 [x]'
        : `미완료 Step: ${missing.join(', ')}`
    });
  }

  // V2: 이슈 체크리스트 완료
  {
    const issuePattern = /^### (이슈|사용자 피드백|정탐-한계|승격|규칙 개선)/gm;
    const lines = content.split('\n');
    const openIssueItems = [];
    let inIssue = false;
    for (const line of lines) {
      if (issuePattern.test(line)) inIssue = true;
      else if (/^##[^#]/.test(line) || (/^### /.test(line) && !issuePattern.test(line))) {
        // Reset for non-issue ### headers — but need to re-check
        if (/^##[^#]/.test(line)) inIssue = false;
      }
      // Re-check issue pattern each line since lastIndex moves
      issuePattern.lastIndex = 0;
      if (/^### (이슈|사용자 피드백|정탐-한계|승격|규칙 개선)/.test(line)) inIssue = true;
      else if (/^##[^#]/.test(line)) inIssue = false;

      if (inIssue && /^- \[ \]/.test(line.trim())) {
        openIssueItems.push(line.trim());
      }
    }
    results.push({
      id: 'V2', name: '이슈 체크리스트 완료',
      pass: openIssueItems.length === 0,
      detail: openIssueItems.length === 0
        ? '모든 이슈 체크리스트 완료'
        : `미완료 ${openIssueItems.length}건: ${openIssueItems[0]}...`
    });
  }

  // V3: V-NN 검증 완료
  {
    const vnnSection = content.match(/## 탐지 코드 수정 검증[^\n]*\n([\s\S]*?)(?=\n##[^#]|$)/);
    const openVnn = vnnSection
      ? vnnSection[1].split('\n').filter(l => /^- \[ \]\s*V-\d+/.test(l.trim()))
      : [];
    results.push({
      id: 'V3', name: 'V-NN 검증 완료',
      pass: openVnn.length === 0,
      detail: openVnn.length === 0
        ? (vnnSection ? 'V-NN 전부 완료' : 'V-NN 섹션 없음 (수정 없었음)')
        : `미완료: ${openVnn.map(l => l.trim()).join('; ')}`
    });
  }

  // V4: V-NN 부적절한 이월 없음
  {
    const vnnSection = content.match(/## 탐지 코드 수정 검증[^\n]*\n([\s\S]*?)(?=\n##[^#]|$)/);
    const badDeferrals = vnnSection
      ? vnnSection[1].split('\n').filter(l => {
          const t = l.trim();
          return /^\- \[x\].*이월/.test(t) && /스트레스|회귀|regression|stress/.test(t);
        })
      : [];
    results.push({
      id: 'V4', name: 'V-NN 부적절한 이월 없음',
      pass: badDeferrals.length === 0,
      detail: badDeferrals.length === 0
        ? '부적절한 이월 없음'
        : `부적절 이월 ${badDeferrals.length}건`
    });
  }

  // V5: 활성 규칙 전부 로드
  {
    const activeSection = content.match(/## 활성 규칙[^\n]*\n([\s\S]*?)(?=\n##[^#]|$)/);
    const openRules = activeSection
      ? activeSection[1].split('\n').filter(l => /^- \[ \]/.test(l.trim()))
      : [];
    results.push({
      id: 'V5', name: '활성 규칙 전부 로드',
      pass: openRules.length === 0,
      detail: openRules.length === 0
        ? '활성 규칙 전부 완료'
        : `미로드: ${openRules.map(l => l.trim()).join('; ')}`
    });
  }

  // V6: 로그 기록 완료
  {
    const logSection = content.match(/## 로그 기록 상태[^\n]*\n([\s\S]*?)(?=\n##[^#]|$)/);
    const openLogs = logSection
      ? logSection[1].split('\n').filter(l => /^- \[ \]/.test(l.trim()))
      : [];
    results.push({
      id: 'V6', name: '로그 기록 완료',
      pass: openLogs.length === 0,
      detail: openLogs.length === 0
        ? (logSection ? '로그 기록 전부 완료' : '로그 기록 섹션 없음')
        : `미기록 ${openLogs.length}건`
    });
  }

  // V7: change-log 정리
  {
    const changeLogPath = join(PROJECT_ROOT, target, 'change-log.md');
    const exists = existsSync(changeLogPath);
    results.push({
      id: 'V7', name: 'change-log 정리',
      pass: !exists,
      detail: exists ? 'change-log.md가 아직 남아있음 (삭제 필요)' : 'change-log.md 정리 완료'
    });
  }

  return results;
}

function printValidatorResults(results) {
  console.log('\n=== progress.md Pipeline Validator ===\n');
  let allPass = true;
  for (const r of results) {
    const icon = r.pass ? 'PASS' : 'FAIL';
    console.log(`  ${icon}  ${r.id}: ${r.name}`);
    console.log(`        ${r.detail}`);
    if (!r.pass) allPass = false;
  }
  console.log(`\n${allPass ? 'ALL PASS' : 'SOME FAILED'}\n`);
}

// ─── Guard Rule Tests ──────────────────────────────────────────────

function setup() {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
}

function cleanup() {
  rmSync(TEST_DIR, { recursive: true, force: true });
}

function writeProgress(content) {
  writeFileSync(join(TEST_DIR, 'progress.md'), content, 'utf8');
}

function removeProgress() {
  rmSync(join(TEST_DIR, 'progress.md'), { force: true });
}

/**
 * Invoke checklist-guard with a fake tool call via stdin.
 * Returns { exitCode, stdout, stderr }
 * For Write tool, pass content in opts.content.
 */
function invokeGuard(filePath, toolName = 'Edit', opts = {}) {
  const absPath = filePath.startsWith(PROJECT_ROOT)
    ? filePath
    : join(PROJECT_ROOT, filePath).replace(/\\/g, '/');

  const toolInput = { file_path: absPath };
  if (opts.content !== undefined) toolInput.content = opts.content;

  const stdinData = JSON.stringify({
    tool_name: toolName,
    tool_input: toolInput
  });

  const result = spawnSync('node', [GUARD_SCRIPT], {
    input: stdinData,
    encoding: 'utf8',
    timeout: 10000,
  });

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const exitCode = result.status ?? 1;

  // Try to parse JSON output (new format)
  let json = null;
  try { json = JSON.parse(stdout); } catch { /* raw text output */ }

  return {
    exitCode,
    stdout,
    stderr,
    json,
    blocked: exitCode === 2 || (json && json.decision === 'block'),
    reason: json?.reason || stdout,
    hasAnalysis: !!(json?.additionalContext),
  };
}

// ─── Test Runner ───────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(testId, description, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  PASS  ${testId}: ${description}`);
  } else {
    failed++;
    console.log(`  FAIL  ${testId}: ${description}`);
    if (detail) console.log(`        ${detail}`);
    failures.push(`${testId}: ${description}`);
  }
}

// ─── Phase B: Existing Rule Tests ──────────────────────────────────

function runPhaseB() {
  console.log('\n--- Phase B: Existing Rule Tests ---\n');

  // B1: Rule 1 BLOCK — pipeline file edit with no checklist
  setup();
  writeProgress(`# Progress\n## 현재 단계\n- [ ] Step 0\n`);
  {
    const r = invokeGuard('scripts/preflight-html.js');
    assert('B1', 'Rule 1 차단: pipeline edit without checklist', r.blocked && r.hasAnalysis,
      `blocked=${r.blocked}, hasAnalysis=${r.hasAnalysis}, exitCode=${r.exitCode}`);
  }

  // B2: Rule 1 ALLOW — pipeline file edit with open checklist
  writeProgress(`# Progress\n## 수정 이력\n### 이슈 #1: test\n- [ ] A. 판정: 정탐-수정\n- [ ] B. 원인 수정\n`);
  {
    const r = invokeGuard('scripts/preflight-html.js');
    assert('B2', 'Rule 1 허용: pipeline edit with open checklist', r.exitCode === 0,
      `exitCode=${r.exitCode}`);
  }

  // B3: Rule 3 BLOCK — slide HTML edit with A.판정 unchecked
  writeProgress(`# Progress\n## 수정 이력\n### 이슈 #1: test\n- [ ] A. 판정: 정탐-수정\n- [ ] B. 원인 수정\n`);
  {
    const r = invokeGuard('slides/_guard-test/slide-01.html');
    assert('B3', 'Rule 3 차단: slide edit with 판정 unchecked', r.blocked && r.hasAnalysis,
      `blocked=${r.blocked}, hasAnalysis=${r.hasAnalysis}`);
  }

  // B4: Rule 3 ALLOW — slide HTML edit with A.판정 checked
  writeProgress(`# Progress\n## 수정 이력\n### 이슈 #1: test\n- [x] A. 판정: 정탐-수정\n- [ ] B. 원인 수정\n`);
  {
    const r = invokeGuard('slides/_guard-test/slide-01.html');
    assert('B4', 'Rule 3 허용: slide edit with 판정 checked', r.exitCode === 0,
      `exitCode=${r.exitCode}`);
  }

  // B5: Rule 4 BLOCK — Step 7 done but V-NN open
  writeProgress(`# Progress\n## 현재 단계\n- [x] Step 7: 최종 출력\n## 탐지 코드 수정 검증\n- [ ] V-01: PF-60 회귀 테스트\n`);
  {
    const r = invokeGuard('scripts/preflight-html.js');
    assert('B5', 'Rule 4 차단: Step 7 done + V-NN open', r.blocked && r.hasAnalysis,
      `blocked=${r.blocked}, hasAnalysis=${r.hasAnalysis}`);
  }

  // B6: Rule 2 WARNING — progress.md edit with open items (stderr warning, exit 0)
  writeProgress(`# Progress\n## 수정 이력\n### 이슈 #1: test\n- [ ] A. 판정\n- [ ] B. 원인 수정\n`);
  {
    const r = invokeGuard('slides/_guard-test/progress.md');
    assert('B6', 'Rule 2 경고: progress.md edit with open items', r.exitCode === 0 && r.stderr.includes('미완료'),
      `exitCode=${r.exitCode}, stderr includes 미완료=${r.stderr.includes('미완료')}`);
  }

  // B7: Rule 5 BLOCK — Step 7 done but active rules unchecked
  writeProgress(`# Progress\n## 현재 단계\n- [x] Step 7: 최종 출력\n## 활성 규칙\n- [ ] production-reporting-rules.md\n- [x] html-prevention-rules.md\n`);
  {
    const r = invokeGuard('scripts/preflight-html.js');
    assert('B7', 'Rule 5 차단: Step 7 done + active rules unchecked', r.blocked && r.reason.includes('활성 규칙'),
      `blocked=${r.blocked}, reason=${r.reason.slice(0, 60)}`);
  }

  // B8: Rule 5 ALLOW — Step 7 done, all active rules checked
  writeProgress(`# Progress\n## 현재 단계\n- [x] Step 7: 최종 출력\n## 활성 규칙\n- [x] production-reporting-rules.md\n- [x] html-prevention-rules.md\n## 수정 이력\n### 이슈 #1: test\n- [ ] A. 판정\n`);
  {
    const r = invokeGuard('scripts/preflight-html.js');
    assert('B8', 'Rule 5 허용: Step 7 done + all rules checked', r.exitCode === 0,
      `exitCode=${r.exitCode}`);
  }

  cleanup();
}

// ─── Phase C: Gap Tests ────────────────────────────────────────────

function runPhaseC() {
  console.log('\n--- Phase C: Gap Tests ---\n');

  // C1: No progress.md in slide folder — slide HTML edit should be blocked
  setup();
  removeProgress(); // ensure no progress.md in _guard-test
  {
    const r = invokeGuard('slides/_guard-test/slide-01.html');
    assert('C1', 'Gap 1: no progress.md -> BLOCK slide edit', r.blocked,
      `blocked=${r.blocked}, exitCode=${r.exitCode}`);
  }

  // C2: Unmonitored skill files should be blocked
  writeProgress(`# Progress\n## 현재 단계\n- [ ] Step 1\n`);
  {
    const r = invokeGuard('.claude/skills/plan-skill/SKILL.md');
    assert('C2', 'Gap 3: plan-skill/SKILL.md monitored', r.blocked,
      `blocked=${r.blocked}`);
  }
  {
    const r = invokeGuard('.claude/skills/pptx-skill/SKILL.md');
    assert('C2b', 'Gap 3: pptx-skill/SKILL.md monitored', r.blocked,
      `blocked=${r.blocked}`);
  }
  {
    const r = invokeGuard('.claude/skills/presentation-skill/SKILL.md');
    assert('C2c', 'Gap 3: presentation-skill/SKILL.md monitored', r.blocked,
      `blocked=${r.blocked}`);
  }

  // C3: 승격 section recognized as issue
  writeProgress(`# Progress\n## 수정 이력\n### 승격: COM-01 -> PF-60\n- [ ] 1. IL 기록\n- [ ] 2. 전단계 규칙\n`);
  {
    const r = invokeGuard('slides/_guard-test/slide-01.html');
    assert('C3', 'Gap 5: 승격 section recognized', r.blocked,
      `blocked=${r.blocked}`);
  }

  // C4: Non-standard HTML name (cover.html, not slide-NN.html)
  writeProgress(`# Progress\n## 수정 이력\n### 이슈 #1: test\n- [ ] A. 판정: 정탐-수정\n`);
  {
    const r = invokeGuard('slides/_guard-test/cover.html');
    assert('C4', 'Gap 8: cover.html matched as slide HTML', r.blocked,
      `blocked=${r.blocked}`);
  }

  // C5: Block outputs include additionalContext for agent analysis
  writeProgress(`# Progress\n## 현재 단계\n- [ ] Step 0\n`);
  {
    const r = invokeGuard('scripts/preflight-html.js');
    assert('C5', 'Block output has additionalContext for auto-analysis', r.hasAnalysis && r.json?.additionalContext.includes('근본 원인 분석'),
      `hasAnalysis=${r.hasAnalysis}`);
  }

  cleanup();
}

// ─── Phase D: Integrity & Extended Coverage ─────────────────────────

function runPhaseD() {
  console.log('\n--- Phase D: Integrity & Extended PIPELINE_FILES Tests ---\n');

  // C6: CLAUDE.md Edit without checklist → BLOCK (Rule 1)
  setup();
  writeProgress(`# Progress\n## 현재 단계\n- [ ] Step 0\n`);
  {
    const r = invokeGuard('CLAUDE.md');
    assert('C6', 'CLAUDE.md Edit without checklist → BLOCK', r.blocked,
      `blocked=${r.blocked}`);
  }

  // C7: .claude/settings.local.json Edit without checklist → BLOCK (Rule 1)
  {
    const r = invokeGuard('.claude/settings.local.json');
    assert('C7', 'settings.local.json Edit without checklist → BLOCK', r.blocked,
      `blocked=${r.blocked}`);
  }

  // C8: pf-step-2-2.5.md Edit without checklist → BLOCK (Rule 1)
  {
    const r = invokeGuard('.claude/docs/pf-step-2-2.5.md');
    assert('C8', 'pf-step-2-2.5.md Edit without checklist → BLOCK', r.blocked,
      `blocked=${r.blocked}`);
  }

  // C9: CLAUDE.md Write with checklist + all required sections → ALLOW
  writeProgress(`# Progress\n## 수정 이력\n### 이슈 #1: test\n- [ ] A. 판정: 정탐-수정\n- [ ] B. 원인 수정\n`);
  {
    const fullContent = [
      '# CLAUDE.md',
      '## 자가 개선 피드백 루프',
      '### 파이프라인 자동 개선 의무',
      '## 파이프라인 MD 생성 규칙',
      '### 활성 규칙 체크박스',
      '## 온디맨드 참조',
    ].join('\n');
    const r = invokeGuard('CLAUDE.md', 'Write', { content: fullContent });
    assert('C9', 'CLAUDE.md Write with all required sections → ALLOW', r.exitCode === 0,
      `exitCode=${r.exitCode}`);
  }

  // C10: CLAUDE.md Write with checklist but missing required section → BLOCK (Rule 6)
  {
    const partialContent = [
      '# CLAUDE.md',
      '### 파이프라인 자동 개선 의무',
      '## 파이프라인 MD 생성 규칙',
      '### 활성 규칙 체크박스',
      '## 온디맨드 참조',
      // Missing: '## 자가 개선 피드백 루프'
    ].join('\n');
    const r = invokeGuard('CLAUDE.md', 'Write', { content: partialContent });
    assert('C10', 'CLAUDE.md Write missing section → BLOCK (Rule 6)', r.blocked && r.reason.includes('필수 섹션'),
      `blocked=${r.blocked}, reason=${(r.reason || '').slice(0, 60)}`);
  }

  // C11: settings.local.json Write missing checklist-guard → BLOCK (Rule 6)
  {
    const badSettings = JSON.stringify({ hooks: { PreToolUse: [] } });
    const r = invokeGuard('.claude/settings.local.json', 'Write', { content: badSettings });
    assert('C11', 'settings.local.json Write missing guard hooks → BLOCK (Rule 6)', r.blocked && r.reason.includes('필수 섹션'),
      `blocked=${r.blocked}, reason=${(r.reason || '').slice(0, 60)}`);
  }

  // C11b: validate-pptx-com.mjs Edit without checklist → BLOCK (Rule 1)
  writeProgress(`# Progress\n## 현재 단계\n- [ ] Step 0\n`);
  {
    const r = invokeGuard('scripts/validate-pptx-com.mjs');
    assert('C11b', 'validate-pptx-com.mjs Edit without checklist → BLOCK', r.blocked,
      `blocked=${r.blocked}`);
  }

  // C12: "### 정탐-수정 #N:" heading recognized as issue section → has open checklist
  setup();
  writeProgress(`# Progress\n## 이벤트 발생\n### 정탐-수정 #1: test\n- [x] A. 판정: 정탐-수정\n- [ ] B. 원인 수정\n`);
  {
    const r = invokeGuard('scripts/preflight-html.js');
    // Should be ALLOWED because there IS an open checklist ([ ] B.)
    assert('C12', '정탐-수정 heading recognized → open checklist allows edit', !r.blocked,
      `blocked=${r.blocked}`);
  }

  // C13: test-vision-accuracy.mjs Edit without checklist → BLOCK
  writeProgress(`# Progress\n## 현재 단계\n- [ ] Step 0\n`);
  {
    const r = invokeGuard('scripts/test-vision-accuracy.mjs');
    assert('C13', 'test-vision-accuracy.mjs Edit without checklist → BLOCK', r.blocked,
      `blocked=${r.blocked}`);
  }

  // C14: vision-ground-truth.json Edit without checklist → BLOCK
  {
    const r = invokeGuard('tests/vision-ground-truth.json');
    assert('C14', 'vision-ground-truth.json Edit without checklist → BLOCK', r.blocked,
      `blocked=${r.blocked}`);
  }

  cleanup();
}

// ─── Phase E: Auto-Checklist Injection Tests ─────────────────────────

async function runPhaseE() {
  console.log('\n--- Phase E: Auto-Checklist Injection Tests ---\n');

  // E1: injectChecklist creates placeholder in progress.md
  setup();
  writeProgress(`# Progress\n## 완료 단계\n- [x] Step 2 HTML 생성\n## 이벤트 발생 → 체크박스 TASK 관리\n\n### 이슈 #1: test\n- [x] A. 판정: 정탐-수정\n- [x] B. 완료\n\n## 탐지 코드 수정 검증\n`);
  {
    // Import and call injectChecklist
    const { injectChecklist } = await import(pathToFileURL(join(PROJECT_ROOT, 'scripts/auto-checklist.mjs')).href);
    const injected = injectChecklist(TEST_DIR, {
      pipeline: 'PF',
      errors: ['[slide-01.html] PF-01: gradient text', '[slide-03.html] PF-07: p with background']
    });
    assert('E1', 'injectChecklist returns true on success', injected === true, `injected=${injected}`);

    // Verify content
    const content = readFileSync(join(TEST_DIR, 'progress.md'), 'utf8');
    assert('E1b', 'Injected checklist has issue #2', content.includes('### 이슈 #2:'),
      `content includes issue #2: ${content.includes('### 이슈 #2:')}`);
    assert('E1c', 'Injected checklist has 판정 placeholder', content.includes('- [ ] A. 판정: (미입력'),
      `has 판정: ${content.includes('- [ ] A. 판정: (미입력')}`);
    assert('E1d', 'Injected checklist mentions PF pipeline', content.includes('PF ERROR 2건'),
      `has PF ERROR: ${content.includes('PF ERROR 2건')}`);
    assert('E1e', 'Injected before 탐지 코드 수정 검증', content.indexOf('이슈 #2') < content.indexOf('탐지 코드 수정 검증'),
      `order correct`);
  }

  // E2: Guard blocks slide edit when auto-checklist has unchecked 판정
  {
    // progress.md now has the auto-injected checklist with [ ] A. 판정
    const r = invokeGuard('slides/_guard-test/slide-01.html');
    assert('E2', 'Guard blocks slide edit with auto-injected unchecked 판정', r.blocked,
      `blocked=${r.blocked}`);
  }

  // E3: After agent fills in 판정, guard allows slide edit
  {
    let content = readFileSync(join(TEST_DIR, 'progress.md'), 'utf8');
    // Replace the auto-generated placeholder with a filled 판정
    content = content.replace(
      '- [ ] A. 판정: (미입력 — 오탐/정탐-수정/정탐-한계 중 선택)',
      '- [x] A. 판정: 정탐-수정 — gradient 대체 필요'
    );
    writeFileSync(join(TEST_DIR, 'progress.md'), content, 'utf8');
    const r = invokeGuard('slides/_guard-test/slide-01.html');
    assert('E3', 'Guard allows slide edit after 판정 filled', !r.blocked,
      `blocked=${r.blocked}`);
  }

  // E4: injectChecklist returns false when no progress.md exists
  {
    const tmpDir = join(PROJECT_ROOT, 'slides/_no-progress-test');
    mkdirSync(tmpDir, { recursive: true });
    const { injectChecklist } = await import(pathToFileURL(join(PROJECT_ROOT, 'scripts/auto-checklist.mjs')).href);
    const injected = injectChecklist(tmpDir, { pipeline: 'VP', errors: ['test error'] });
    assert('E4', 'injectChecklist returns false when no progress.md', injected === false, `injected=${injected}`);
    rmSync(tmpDir, { recursive: true, force: true });
  }

  // E5: injectChecklist returns false when no errors
  {
    const { injectChecklist } = await import(pathToFileURL(join(PROJECT_ROOT, 'scripts/auto-checklist.mjs')).href);
    const injected = injectChecklist(TEST_DIR, { pipeline: 'PF', errors: [] });
    assert('E5', 'injectChecklist returns false with empty errors', injected === false, `injected=${injected}`);
  }

  // E6: Multiple injections increment issue number
  setup();
  writeProgress(`# Progress\n## 이벤트 발생\n\n### 이슈 #1: existing\n- [x] A. done\n\n## 탐지 코드 수정 검증\n`);
  {
    const { injectChecklist } = await import(pathToFileURL(join(PROJECT_ROOT, 'scripts/auto-checklist.mjs')).href);
    injectChecklist(TEST_DIR, { pipeline: 'PF', errors: ['slide-01: err1'] });
    injectChecklist(TEST_DIR, { pipeline: 'CONTRAST', errors: ['slide-05: err2'] });
    const content = readFileSync(join(TEST_DIR, 'progress.md'), 'utf8');
    assert('E6', 'Multiple injections produce #2 and #3', content.includes('이슈 #2') && content.includes('이슈 #3'),
      `has #2=${content.includes('이슈 #2')}, #3=${content.includes('이슈 #3')}`);
  }

  cleanup();
}

// ─── Phase F: Rule 7 Completion Gate Tests ───────────────────────

async function runPhaseF() {
  console.log('\n--- Phase F: Rule 7 Completion Gate Tests ---\n');

  // F1: 정탐-수정 [ ] 남음 + 다른 slide Edit → BLOCK 7a
  setup();
  writeProgress(`# Progress
## 수정 이력
### 이슈 #1: PF ERROR (slide-01) — gradient text
- [x] A. 판정: 정탐-수정
- [ ] B. 원인 수정: PF 규칙 추가
- [ ] C. 재검증
`);
  {
    const r = invokeGuard('slides/_guard-test/slide-05.html');
    assert('F1', 'Rule 7a 차단: 정탐-수정 미완료 + 다른 slide', r.blocked && r.json?.additionalContext?.includes('Rule 7a'),
      `blocked=${r.blocked}, analysis includes 7a=${r.json?.additionalContext?.includes('Rule 7a')}`);
  }

  // F2: 정탐-수정 [ ] 남음 + 이슈 내 slide Edit → ALLOW
  {
    const r = invokeGuard('slides/_guard-test/slide-01.html');
    assert('F2', 'Rule 7a 허용: 정탐-수정 미완료 + 이슈 내 slide', !r.blocked,
      `blocked=${r.blocked}`);
  }

  // F3: 정탐-한계 [ ] 남음 + 다른 slide Edit → ALLOW
  setup();
  writeProgress(`# Progress
## 수정 이력
### 이슈 #1: VP WARN (slide-02) — 변환 한계
- [x] A. 판정: 정탐-한계
- [ ] B. IL 기록
- [ ] C. 회피 규칙
`);
  {
    const r = invokeGuard('slides/_guard-test/slide-05.html');
    assert('F3', 'Rule 7a 허용: 정탐-한계는 Rule 7 미적용', !r.blocked,
      `blocked=${r.blocked}`);
  }

  // F4: 오탐 [ ] 남음 + 다른 slide Edit → BLOCK 7a
  setup();
  writeProgress(`# Progress
## 수정 이력
### 이슈 #1: PF 오탐 (slide-03) — false positive
- [x] A. 판정: 오탐
- [ ] B. 탐지 코드 수정
- [ ] C. 테스트 실행
`);
  {
    const r = invokeGuard('slides/_guard-test/slide-07.html');
    assert('F4', 'Rule 7a 차단: 오탐 미완료 + 다른 slide', r.blocked && r.json?.additionalContext?.includes('Rule 7a'),
      `blocked=${r.blocked}, analysis includes 7a=${r.json?.additionalContext?.includes('Rule 7a')}`);
  }

  // F5: 정탐-수정 전부 [x] + 다른 slide Edit → ALLOW
  setup();
  writeProgress(`# Progress
## 수정 이력
### 이슈 #1: PF ERROR (slide-01) — gradient text
- [x] A. 판정: 정탐-수정
- [x] B. 원인 수정: PF-60 규칙 추가
- [x] C. 재검증: PF PASS
- [x] D. change-log C-01 기록
- [x] E. 회귀 테스트 PASS
`);
  {
    const r = invokeGuard('slides/_guard-test/slide-05.html');
    assert('F5', 'Rule 7a 허용: 정탐-수정 전부 완료 + 다른 slide', !r.blocked,
      `blocked=${r.blocked}`);
  }

  // F6: Write progress.md: 정탐-수정 전부 [x], 코드 항목 없음 → BLOCK 7b
  setup();
  writeProgress('dummy');
  {
    const newContent = `# Progress
## 수정 이력
### 이슈 #1: PF ERROR (slide-01) — gradient text
- [x] A. 판정: 정탐-수정
- [x] B. HTML 수정 완료
- [x] C. 확인 완료
`;
    const r = invokeGuard('slides/_guard-test/progress.md', 'Write', { content: newContent });
    assert('F6', 'Rule 7b 차단: 정탐-수정 완료인데 코드/change-log/테스트 누락', r.blocked && r.json?.additionalContext?.includes('Rule 7b'),
      `blocked=${r.blocked}, analysis includes 7b=${r.json?.additionalContext?.includes('Rule 7b')}`);
  }

  // F7: Write progress.md: 정탐-수정 전부 [x], 필수 항목 있음 → ALLOW
  {
    const newContent = `# Progress
## 수정 이력
### 이슈 #1: PF ERROR (slide-01) — gradient text
- [x] A. 판정: 정탐-수정
- [x] B. 대상 수정: slide-01 gradient 제거
- [x] C. 원인 수정: html-prevention-rules.md에 gradient 금지 추가
- [x] D. 재발 방지: PF-60 규칙 정상 검출 확인
- [x] E. 테스트 통과, 회귀 테스트 PASS
- [x] F. change-log C-01 기록
`;
    const r = invokeGuard('slides/_guard-test/progress.md', 'Write', { content: newContent });
    assert('F7', 'Rule 7b 허용: 정탐-수정 완료 + 필수 항목 존재', !r.blocked,
      `blocked=${r.blocked}`);
  }

  // F8: Write progress.md: 오탐 전부 [x], 테스트 없음 → BLOCK 7b
  {
    const newContent = `# Progress
## 수정 이력
### 이슈 #1: PF 오탐 (slide-03)
- [x] A. 판정: 오탐
- [x] B. 탐지 코드 수정: PF-50 조건 완화
- [x] C. change-log C-02 기록
`;
    const r = invokeGuard('slides/_guard-test/progress.md', 'Write', { content: newContent });
    assert('F8', 'Rule 7b 차단: 오탐 완료인데 테스트 없음', r.blocked && r.json?.additionalContext?.includes('Rule 7b'),
      `blocked=${r.blocked}, analysis includes 7b=${r.json?.additionalContext?.includes('Rule 7b')}`);
  }

  // F9: B~I placeholder + 다른 slide Edit → ALLOW (Rule 3이 처리)
  setup();
  writeProgress(`# Progress
## 수정 이력
### 이슈 #1: PF ERROR 2건 (slide-01, slide-03) — 자동 생성
- [ ] A. 판정: (미입력 — 오탐/정탐-수정/정탐-한계 중 선택)
- [ ] B~I. (판정 후 체크리스트 완성)
`);
  {
    // Rule 3 will block this for 판정 missing, but Rule 7a should NOT trigger
    // because isExpanded=false (B~I placeholder)
    const r = invokeGuard('slides/_guard-test/slide-05.html');
    // It will be blocked by Rule 3 (판정 missing), not by 7a
    assert('F9', 'Placeholder: Rule 3 차단 (7a 아님)', r.blocked && !r.reason.includes('7a'),
      `blocked=${r.blocked}, reason=${(r.reason || '').slice(0, 80)}`);
  }

  // F10: 이슈 2개: 1개 완료 + 1개 미완료(정탐-수정) → BLOCK 7a
  setup();
  writeProgress(`# Progress
## 수정 이력
### 이슈 #1: PF ERROR (slide-01) — 완료
- [x] A. 판정: 정탐-수정
- [x] B. 원인 수정: PF-60 규칙 추가
- [x] C. change-log C-01 기록
- [x] D. 회귀 테스트 PASS

### 이슈 #2: VP ERROR (slide-03) — 미완료
- [x] A. 판정: 정탐-수정
- [ ] B. 원인 수정: VP 규칙 추가
- [ ] C. 재검증
`);
  {
    const r = invokeGuard('slides/_guard-test/slide-07.html');
    assert('F10', 'Rule 7a 차단: 2개 이슈 중 1개 미완료 + 다른 slide', r.blocked && r.json?.additionalContext?.includes('Rule 7a'),
      `blocked=${r.blocked}, analysis includes 7a=${r.json?.additionalContext?.includes('Rule 7a')}`);
  }

  // F11: 정탐-수정 open (slide-01) + outline.md Edit → BLOCK 7a (비-HTML 콘텐츠)
  setup();
  writeProgress(`# Progress
## 수정 이력
### 이슈 #1: IV ERROR (slide-01) — 이미지 품질
- [x] A. 판정: 정탐-수정
- [ ] B. 원인 수정: IV 규칙 추가
- [ ] C. 재검증
`);
  {
    const r = invokeGuard('slides/_guard-test/outline.md');
    assert('F11', 'Rule 7a 차단: 이미지 파이프라인 이슈 + outline.md 수정', r.blocked && r.json?.additionalContext?.includes('Rule 7a'),
      `blocked=${r.blocked}, analysis includes 7a=${r.json?.additionalContext?.includes('Rule 7a')}`);
  }

  // F12: 정탐-수정 open (slide-01) + assets/image-05.png Edit → BLOCK 7a
  {
    const r = invokeGuard('slides/_guard-test/assets/image-05.png');
    assert('F12', 'Rule 7a 차단: 이슈 open + 다른 이미지 파일 수정', r.blocked && r.json?.additionalContext?.includes('Rule 7a'),
      `blocked=${r.blocked}, analysis includes 7a=${r.json?.additionalContext?.includes('Rule 7a')}`);
  }

  // F13: 정탐-수정 open (slide-01) + slide-01.json 관련 파일 Edit → ALLOW
  {
    const r = invokeGuard('slides/_guard-test/slide-01.json');
    assert('F13', 'Rule 7a 허용: 이슈 내 슬라이드와 같은 stem 파일', !r.blocked,
      `blocked=${r.blocked}`);
  }

  // F14: Rule 7b — 이미지 파이프라인 (IV) 정탐-수정 닫을 때 테스트 없음 → BLOCK
  {
    const newContent = `# Progress
## 수정 이력
### 이슈 #1: IV ERROR (slide-03) — 이미지 텍스트 감지 실패
- [x] A. 판정: 정탐-수정
- [x] B. 탐지 코드 수정: IV 규칙 완화
- [x] C. change-log C-03 기록
`;
    const r = invokeGuard('slides/_guard-test/progress.md', 'Write', { content: newContent });
    assert('F14', 'Rule 7b 차단: IV 이슈 닫을 때 테스트 누락', r.blocked && r.json?.additionalContext?.includes('Rule 7b'),
      `blocked=${r.blocked}, analysis includes 7b=${r.json?.additionalContext?.includes('Rule 7b')}`);
  }

  // F19: Rule 7b — 테스트 있지만 회귀 없음 → BLOCK
  {
    const newContent = `# Progress
## 수정 이력
### 이슈 #1: PF ERROR (slide-01) — gradient
- [x] A. 판정: 정탐-수정
- [x] B. 탐지 코드 수정: PF-60 규칙 추가
- [x] C. change-log C-01 기록
- [x] D. 테스트 PASS
`;
    const r = invokeGuard('slides/_guard-test/progress.md', 'Write', { content: newContent });
    assert('F19', 'Rule 7b 차단: 테스트 있지만 회귀 테스트 없음', r.blocked && r.json?.additionalContext?.includes('Rule 7b'),
      `blocked=${r.blocked}, analysis includes 7b=${r.json?.additionalContext?.includes('Rule 7b')}`);
  }

  // F20: Rule 7b — 회귀 있지만 테스트 통과 없음 → BLOCK
  {
    const newContent = `# Progress
## 수정 이력
### 이슈 #1: PF ERROR (slide-01) — gradient
- [x] A. 판정: 정탐-수정
- [x] B. 탐지 코드 수정: PF-60 규칙 추가
- [x] C. change-log C-01 기록
- [x] D. 회귀 확인 예정
`;
    const r = invokeGuard('slides/_guard-test/progress.md', 'Write', { content: newContent });
    assert('F20', 'Rule 7b 차단: 회귀 있지만 테스트 통과 없음', r.blocked && r.json?.additionalContext?.includes('Rule 7b'),
      `blocked=${r.blocked}, analysis includes 7b=${r.json?.additionalContext?.includes('Rule 7b')}`);
  }

  // F21: Rule 7b — 테스트 통과 + 회귀 모두 있음 → ALLOW
  {
    const newContent = `# Progress
## 수정 이력
### 이슈 #1: PF ERROR (slide-01) — gradient
- [x] A. 판정: 정탐-수정
- [x] B. 대상 수정: slide-01 gradient 제거
- [x] C. 원인 수정: 직접 수정 (수동 생성)
- [x] D. 재발 방지: PF-60 기존 규칙 정상 검출
- [x] E. 테스트 통과, 회귀 테스트 PASS
- [x] F. change-log C-01 기록
`;
    const r = invokeGuard('slides/_guard-test/progress.md', 'Write', { content: newContent });
    assert('F21', 'Rule 7b 허용: 테스트 통과 + 회귀 모두 존재', !r.blocked,
      `blocked=${r.blocked}`);
  }

  // F22: 오탐 C에 파일명 없음 (우회 문구 "수정 불필요") → BLOCK
  {
    const newContent = `# Progress
### 이슈 #1: IP WARN — 오탐
- [x] A. 판정: 오탐
- [x] B. 대상 수정: 해당 없음 (오탐)
- [x] C. 원인 수정: 수정 불필요
- [x] D. 재발 방지: 이미 처리됨
- [x] E. 테스트 통과, 회귀 테스트 passed
- [x] F. change-log C-01
`;
    const r = invokeGuard('slides/_guard-test/progress.md', 'Write', { content: newContent });
    assert('F22', '포지티브 차단: 오탐 C에 탐지코드 파일명 없음 (우회 문구)', r.blocked,
      `blocked=${r.blocked}`);
  }

  // F23: 오탐 C에 탐지코드 파일명 없이 "탐지 규칙 수정"만 → BLOCK
  {
    const newContent = `# Progress
### 이슈 #1: IP WARN — 오탐
- [x] A. 판정: 오탐
- [x] B. 대상 수정: 해당 없음 (오탐)
- [x] C. 원인 수정: 탐지 규칙 수정
- [x] D. 재발 방지: C=D (탐지 코드 수정)
- [x] E. 테스트 통과, 회귀 테스트 passed
- [x] F. change-log C-01
`;
    const r = invokeGuard('slides/_guard-test/progress.md', 'Write', { content: newContent });
    assert('F23', '포지티브 차단: 오탐 C에 구체적 파일명 없음', r.blocked,
      `blocked=${r.blocked}`);
  }

  // F24: 오탐 C에 generate-images.mjs + D에 C=D → ALLOW
  {
    const newContent = `# Progress
### 이슈 #1: IP WARN — 오탐
- [x] A. 판정: 오탐
- [x] B. 대상 수정: 해당 없음 (오탐)
- [x] C. 원인 수정: generate-images.mjs IP-14 면제 조건 추가
- [x] D. 재발 방지: C=D (탐지 코드 수정)
- [x] E. 테스트 통과, 회귀 테스트 passed
- [x] F. change-log C-01
`;
    const r = invokeGuard('slides/_guard-test/progress.md', 'Write', { content: newContent });
    assert('F24', '포지티브 허용: 오탐 C에 generate-images.mjs + D에 C=D', !r.blocked,
      `blocked=${r.blocked}`);
  }

  // F25: 정탐-수정 C에 파일명 없음 (우회 문구) → BLOCK
  {
    const newContent = `# Progress
### 이슈 #1: PF ERROR — 정탐-수정
- [x] A. 판정: 정탐-수정
- [x] B. 대상 수정: slide-03 수정
- [x] C. 원인 수정: 적절히 수정함
- [x] D. 재발 방지: PF-28 정상 검출
- [x] E. 테스트 통과, 회귀 테스트 passed
- [x] F. change-log C-01
`;
    const r = invokeGuard('slides/_guard-test/progress.md', 'Write', { content: newContent });
    assert('F25', '포지티브 차단: 정탐-수정 C에 생성 규칙 파일명 없음', r.blocked,
      `blocked=${r.blocked}`);
  }

  // F26: 정탐-수정 C "직접 수정" + D "PF-28" → ALLOW
  {
    const newContent = `# Progress
### 이슈 #1: PF ERROR — 정탐-수정
- [x] A. 판정: 정탐-수정
- [x] B. 대상 수정: slide-03 수정
- [x] C. 원인 수정: HTML 직접 수정 (수동 생성)
- [x] D. 재발 방지: PF-28 기존 탐지 규칙 정상 검출
- [x] E. 테스트 통과, 회귀 테스트 passed
- [x] F. change-log C-01
`;
    const r = invokeGuard('slides/_guard-test/progress.md', 'Write', { content: newContent });
    assert('F26', '포지티브 허용: 정탐-수정 C "직접 수정" + D "PF-28"', !r.blocked,
      `blocked=${r.blocked}`);
  }

  // F27: 오탐 D에 C=D도 파일명도 없음 → BLOCK
  {
    const newContent = `# Progress
### 이슈 #1: IP WARN — 오탐
- [x] A. 판정: 오탐
- [x] B. 대상 수정: 해당 없음 (오탐)
- [x] C. 원인 수정: generate-images.mjs IP-14 면제
- [x] D. 재발 방지: 처리 완료
- [x] E. 테스트 통과, 회귀 테스트 passed
- [x] F. change-log C-01
`;
    const r = invokeGuard('slides/_guard-test/progress.md', 'Write', { content: newContent });
    assert('F27', '포지티브 차단: 오탐 D에 파일명/C=D 없음', r.blocked,
      `blocked=${r.blocked}`);
  }

  // F28: 정탐-수정 D에 규칙코드도 파일명도 없음 → BLOCK
  {
    const newContent = `# Progress
### 이슈 #1: PF ERROR — 정탐-수정
- [x] A. 판정: 정탐-수정
- [x] B. 대상 수정: slide-03 수정
- [x] C. 원인 수정: HTML 직접 수정
- [x] D. 재발 방지: 기존 규칙으로 충분
- [x] E. 테스트 통과, 회귀 테스트 passed
- [x] F. change-log C-01
`;
    const r = invokeGuard('slides/_guard-test/progress.md', 'Write', { content: newContent });
    assert('F28', '포지티브 차단: 정탐-수정 D에 규칙코드/파일명 없음', r.blocked,
      `blocked=${r.blocked}`);
  }

  // F29: 정탐-수정 C에 html-prevention-rules.md → ALLOW
  {
    const newContent = `# Progress
### 이슈 #1: PF ERROR — 정탐-수정
- [x] A. 판정: 정탐-수정
- [x] B. 대상 수정: slide-06 수정
- [x] C. 원인 수정: html-prevention-rules.md table 금지 규칙 추가
- [x] D. 재발 방지: PF-63 기존 탐지 규칙 정상 검출
- [x] E. 테스트 통과, 회귀 테스트 passed
- [x] F. change-log C-01
`;
    const r = invokeGuard('slides/_guard-test/progress.md', 'Write', { content: newContent });
    assert('F29', '포지티브 허용: 정탐-수정 C html-prevention-rules.md + D PF-63', !r.blocked,
      `blocked=${r.blocked}`);
  }

  // F30: 정탐-수정 D에 VP-02 규칙코드 → ALLOW
  {
    const newContent = `# Progress
### 이슈 #1: VP WARN — 정탐-수정
- [x] A. 판정: 정탐-수정
- [x] B. 대상 수정: slide-05 수정
- [x] C. 원인 수정: HTML 직접 수정
- [x] D. 재발 방지: VP-02 기존 규칙 정상 검출
- [x] E. 테스트 통과, 회귀 테스트 passed
- [x] F. change-log C-01
`;
    const r = invokeGuard('slides/_guard-test/progress.md', 'Write', { content: newContent });
    assert('F30', '포지티브 허용: 정탐-수정 D에 VP-02', !r.blocked,
      `blocked=${r.blocked}`);
  }

  // F31: 오탐 C에 preflight-html.js + D에 preflight-html.js → ALLOW
  {
    const newContent = `# Progress
### 이슈 #1: PF WARN — 오탐
- [x] A. 판정: 오탐
- [x] B. 대상 수정: 해당 없음 (오탐)
- [x] C. 원인 수정: preflight-html.js PF-99 면제 조건 추가
- [x] D. 재발 방지: preflight-html.js 동일 코드 수정
- [x] E. 테스트 통과, 회귀 테스트 passed
- [x] F. change-log C-01
`;
    const r = invokeGuard('slides/_guard-test/progress.md', 'Write', { content: newContent });
    assert('F31', '포지티브 허용: 오탐 C/D 모두 preflight-html.js', !r.blocked,
      `blocked=${r.blocked}`);
  }

  // F32: 정탐-수정 C에 nanoBanana-guide.md → ALLOW (이미지 파이프라인)
  {
    const newContent = `# Progress
### 이슈 #1: IV ERROR — 정탐-수정
- [x] A. 판정: 정탐-수정
- [x] B. 대상 수정: 이미지 재생성
- [x] C. 원인 수정: nanoBanana-guide.md 프롬프트 규칙 추가
- [x] D. 재발 방지: IV-02 generate-images.mjs 탐지 확인
- [x] E. 테스트 통과, 회귀 테스트 passed
- [x] F. change-log C-01
`;
    const r = invokeGuard('slides/_guard-test/progress.md', 'Write', { content: newContent });
    assert('F32', '포지티브 허용: 정탐-수정 C nanoBanana-guide + D generate-images', !r.blocked,
      `blocked=${r.blocked}`);
  }

  // F15: auto-checklist WARN severity — 체크리스트 주입 + 라벨 확인
  setup();
  writeProgress(`# Progress\n## 이벤트 발생\n\n## 탐지 코드 수정 검증\n`);
  {
    const { injectChecklist } = await import(pathToFileURL(join(PROJECT_ROOT, 'scripts/auto-checklist.mjs')).href);
    const injected = injectChecklist(TEST_DIR, {
      pipeline: 'PF',
      errors: ['[slide-02.html] PF-23: CJK overflow'],
      severity: 'WARN'
    });
    assert('F15', 'WARN severity 체크리스트 주입 성공', injected === true, `injected=${injected}`);
    const content = readFileSync(join(TEST_DIR, 'progress.md'), 'utf8');
    assert('F15b', 'WARN 라벨 포함', content.includes('PF WARN 1건'),
      `has PF WARN: ${content.includes('PF WARN 1건')}`);
  }

  // F16: WARN 체크리스트도 가드가 판정 미완료로 차단
  {
    const r = invokeGuard('slides/_guard-test/slide-02.html');
    assert('F16', 'WARN 체크리스트도 판정 미완료 시 slide 수정 차단', r.blocked,
      `blocked=${r.blocked}`);
  }

  // F17: WARN 정탐-수정 이슈 open + 다른 slide → BLOCK 7a
  {
    let content = readFileSync(join(TEST_DIR, 'progress.md'), 'utf8');
    content = content.replace(
      '- [ ] A. 판정: (미입력 — 오탐/정탐-수정/정탐-한계 중 선택)',
      '- [x] A. 판정: 정탐-수정 — PF-23 조건 조정 필요'
    ).replace(
      '- [ ] B~I. (판정 후 체크리스트 완성)',
      '- [ ] B. 탐지 코드 수정\n- [ ] C. 테스트'
    );
    writeFileSync(join(TEST_DIR, 'progress.md'), content, 'utf8');
    const r = invokeGuard('slides/_guard-test/slide-05.html');
    assert('F17', 'WARN 정탐-수정 미완료 + 다른 slide → BLOCK 7a', r.blocked && r.json?.additionalContext?.includes('Rule 7a'),
      `blocked=${r.blocked}, analysis includes 7a=${r.json?.additionalContext?.includes('Rule 7a')}`);
  }

  // F18: WARN 정탐-수정 이슈의 해당 slide → ALLOW
  {
    const r = invokeGuard('slides/_guard-test/slide-02.html');
    assert('F18', 'WARN 정탐-수정 미완료 + 이슈 내 slide → ALLOW', !r.blocked,
      `blocked=${r.blocked}`);
  }

  cleanup();
}

// ─── Main ──────────────────────────────────────────────────────────

console.log('=== Checklist Guard Tests ===');
runPhaseB();
runPhaseC();
runPhaseD();
await runPhaseE();
await runPhaseF();

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed > 0 ? 1 : 0);
