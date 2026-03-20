#!/usr/bin/env node
/**
 * checklist-guard.mjs — Pre-tool-call hook
 *
 * Seven enforcement rules:
 * 1. BLOCK pipeline code edits when no open checklist exists in progress.md
 * 2. WARN step advancement (marking steps complete) while uncompleted issue checklists exist
 * 3. BLOCK slide HTML edits when issue checklists exist without proper 3분류 판정
 * 4. BLOCK when Step 7 complete but V-NN verification items remain unchecked
 * 4b. WARN improper deferrals of stress/regression tests
 * 5. BLOCK when Step 7 complete but active rules still unchecked
 * 6. BLOCK Write overwrites that remove required sections from protected files
 *
 * On block, outputs JSON with decision + additionalContext to trigger
 * agent-driven root cause analysis and rule file auto-improvement.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';

const PROJECT_ROOT = 'D:/projects/slides-grab';

// Pipeline code files that require a checklist before editing
const PIPELINE_FILES = new Set([
  // Detection / generation / conversion scripts
  'scripts/preflight-html.js',
  'scripts/validate-pptx.js',
  'scripts/generate-images.mjs',
  'scripts/html2pptx.cjs',
  'scripts/convert-native.mjs',
  // Rule / guide docs
  '.claude/docs/html-prevention-rules.md',
  '.claude/docs/nanoBanana-guide.md',
  '.claude/docs/pptx-inspection-log.md',
  // Skill definitions
  '.claude/skills/design-skill/SKILL.md',
  '.claude/skills/plan-skill/SKILL.md',
  '.claude/skills/pptx-skill/SKILL.md',
  '.claude/skills/presentation-skill/SKILL.md',
  // Regression test suites
  'tests/detection-regression/run-pf-regression.mjs',
  'tests/detection-regression/run-vp-regression.mjs',
  'tests/detection-regression/run-ip-iv-regression.mjs',
  'tests/detection-regression/pf-cases.json',
  'tests/detection-regression/vp-cases.json',
  'tests/detection-regression/ip-iv-cases.json',
  // Framework / rule backbone (added for integrity)
  'CLAUDE.md',
  '.claude/rules/presentation-flow.md',
  '.claude/docs/presentation-flow.md',
  '.claude/docs/pf-step-0-1.md',
  '.claude/docs/pf-step-1.5b.md',
  '.claude/docs/pf-step-2-2.5.md',
  '.claude/docs/pf-step-3-4.md',
  '.claude/docs/pf-step-5-6-7.md',
  '.claude/docs/production-reporting-rules.md',
  '.claude/docs/testing-rules.md',
  '.claude/settings.local.json',
  'scripts/checklist-guard.mjs',
  'scripts/post-compact-restore.mjs',
]);

// Required sections/strings that must survive Write overwrites (Rule 6)
const REQUIRED_SECTIONS = {
  'CLAUDE.md': [
    '## 자가 개선 피드백 루프',
    '### 파이프라인 자동 개선 의무',
    '## 파이프라인 MD 생성 규칙',
    '### 활성 규칙 체크박스',
    '## 온디맨드 참조',
  ],
  '.claude/rules/presentation-flow.md': [
    '## 트리거 매핑',
    '## 세션 복원',
    '## Step별 로드 규칙',
  ],
  '.claude/settings.local.json': [
    'checklist-guard.mjs',
    'post-compact-restore.mjs',
  ],
};

/**
 * Find the most recently modified progress.md in slides/
 */
function findActiveProgress() {
  const slidesDir = join(PROJECT_ROOT, 'slides');
  let best = null;
  let bestMtime = 0;
  try {
    for (const dir of readdirSync(slidesDir)) {
      const p = join(slidesDir, dir, 'progress.md');
      try {
        const st = statSync(p);
        if (st.mtimeMs > bestMtime) { bestMtime = st.mtimeMs; best = p; }
      } catch { /* no progress.md in this dir */ }
    }
  } catch { /* slides/ doesn't exist */ }
  return best;
}

/**
 * Find progress.md in the same presentation folder as the edited file.
 */
function findProgressForSlide(relPath) {
  // relPath like: slides/some-pres/slide-03.html
  const match = relPath.match(/^slides\/([^/]+)\//);
  if (!match) return null;
  const p = join(PROJECT_ROOT, 'slides', match[1], 'progress.md');
  try { statSync(p); return p; } catch { return null; }
}

/**
 * Parse progress.md for issue sections and their checklist state.
 * Returns:
 *   hasOpenChecklist: boolean — any [ ] items in issue sections
 *   openItems: string[] — the uncompleted items
 *   issuesWithout판정: string[] — issue sections that lack "A. 판정:" or have [ ] A. 판정
 *   issuesMissingFormat: string[] — issue sections that lack proper A~I / A~D format
 */
function parseChecklists(content) {
  const lines = content.split('\n');
  let inIssueSection = false;
  let currentSection = '';
  let hasOpenChecklist = false;
  const openItems = [];
  const issuesWithout판정 = [];
  const issuesMissingFormat = [];

  // Track per-section state
  let sectionHas판정 = false;
  let sectionHasOpen = false;
  let section판정Checked = false;

  const ISSUE_PATTERN = /^### (이슈|사용자 피드백|정탐-한계|정탐-수정|규칙 개선|승격)/;

  function flushSection() {
    if (currentSection && sectionHasOpen) {
      // Issue section has open items — check if 판정 exists and is completed
      if (!sectionHas판정) {
        issuesMissingFormat.push(currentSection);
      } else if (!section판정Checked) {
        issuesWithout판정.push(currentSection);
      }
    }
  }

  for (const line of lines) {
    if (ISSUE_PATTERN.test(line)) {
      flushSection();
      inIssueSection = true;
      currentSection = line.trim();
      sectionHas판정 = false;
      sectionHasOpen = false;
      section판정Checked = false;
      continue;
    }
    if (/^##[^#]/.test(line)) {
      flushSection();
      inIssueSection = false;
      currentSection = '';
      continue;
    }
    if (/^### /.test(line) && !ISSUE_PATTERN.test(line)) {
      flushSection();
      inIssueSection = false;
      currentSection = '';
      continue;
    }
    if (!inIssueSection) continue;

    const trimmed = line.trim();
    // Check for A. 판정 item
    if (/A\.\s*판정/.test(trimmed)) {
      sectionHas판정 = true;
      section판정Checked = /^\- \[x\]/.test(trimmed);
    }
    // Check for any uncompleted items
    if (/^- \[ \]/.test(trimmed)) {
      hasOpenChecklist = true;
      sectionHasOpen = true;
      openItems.push(trimmed);
    }
  }
  flushSection();

  return { hasOpenChecklist, openItems, issuesWithout판정, issuesMissingFormat };
}

/**
 * Check if a file is a slide HTML file in slides/
 */
function isSlideHtml(relPath) {
  return /^slides\/[^/]+\/[^/]+\.html$/.test(relPath);
}

/**
 * Block the tool call with structured JSON output.
 * `reason` = short block message shown to user.
 * `analysis` = detailed instructions injected into agent context via additionalContext.
 */
function block(ruleId, reason, { relPath, progressPath, violationDetails, ruleFiles }) {
  const analysis = `[checklist-guard Rule ${ruleId} 위반 분석 의무]

차단된 수정: ${relPath || '(unknown)'}
progress.md: ${progressPath || '(not found)'}
위반 상세: ${violationDetails}

아래 절차를 즉시 수행하라 (다음 Edit/Write 전에 완료 필수):

1. 근본 원인 분석: 왜 이 규칙을 위반하게 되었는가?
   - 규칙 자체가 불명확한가? → 해당 규칙 파일 수정
   - 규칙은 명확하지만 절차를 건너뛰었는가? → progress.md에 누락된 체크리스트 추가
   - 가드가 잡아야 할 새 패턴인가? → checklist-guard.mjs에 규칙 추가 검토

2. 규칙 파일 점검 대상: ${(ruleFiles || []).join(', ') || 'CLAUDE.md'}
   - 해당 규칙이 이 상황을 명확히 커버하는지 확인
   - 불명확하면 규칙 문구를 더 명료하게 수정
   - 수정 시 change-log.md 기록

3. 차단 해소: 위 분석 완료 후, 규칙에 따라 올바른 선행 작업을 수행한 뒤 재시도`;

  const output = JSON.stringify({
    decision: 'block',
    reason,
    additionalContext: analysis
  });
  console.log(output);
  process.exit(2);
}

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) { input += chunk; }

  const data = JSON.parse(input);
  const toolName = data.tool_name;
  const toolInput = data.tool_input || {};

  // Only check Edit and Write
  if (toolName !== 'Edit' && toolName !== 'Write') {
    process.exit(0);
  }

  const filePath = (toolInput.file_path || '').replace(/\\/g, '/');
  const rootNorm = PROJECT_ROOT.replace(/\\/g, '/');
  const relPath = filePath.startsWith(rootNorm + '/')
    ? filePath.slice(rootNorm.length + 1)
    : filePath;

  const isPipelineFile = PIPELINE_FILES.has(relPath);
  const isSlide = isSlideHtml(relPath);
  const isProgressMd = /slides\/[^/]+\/progress\.md$/.test(relPath);

  // Not a monitored file → allow
  if (!isPipelineFile && !isSlide && !isProgressMd) {
    process.exit(0);
  }

  // --- Rule 6: Content integrity — Write overwrites must preserve required sections ---
  if (toolName === 'Write' && REQUIRED_SECTIONS[relPath]) {
    const newContent = toolInput.content || '';
    const required = REQUIRED_SECTIONS[relPath];
    const missing = required.filter(s => !newContent.includes(s));
    if (missing.length > 0) {
      const missingList = missing.map(s => '  - ' + s).join('\n');
      const reason = `필수 섹션 삭제 감지 — 파이프라인 파괴 방지 (${relPath})`;
      const detail = `Write로 ${relPath}을 덮어쓰려 하나 필수 섹션/문자열이 누락됨:\n${missingList}\n\n이 파일의 필수 섹션은 삭제할 수 없습니다. Edit으로 부분 수정하거나, 필수 섹션을 포함한 내용으로 Write하세요.`;
      block('6', reason, {
        relPath, progressPath: '(integrity check)',
        violationDetails: detail,
        ruleFiles: ['CLAUDE.md', '.claude/rules/structure-protection.md']
      });
    }
  }

  // Find the relevant progress.md
  const progressPath = isSlide
    ? findProgressForSlide(relPath)
    : findActiveProgress();

  if (!progressPath) {
    if (isPipelineFile || isSlide) {
      block('0', 'progress.md가 존재하지 않음 — 먼저 생성 필요', {
        relPath, progressPath: '(not found)',
        violationDetails: '활성 프레젠테이션의 progress.md를 찾을 수 없음. 프레젠테이션 워크플로우 외 수정이라면 progress.md 생성 불필요 — 가드 감시 대상이 아닌 경로에서 작업할 것.',
        ruleFiles: ['CLAUDE.md §공통 절차', 'presentation-flow.md §progress.md 템플릿']
      });
    }
    process.exit(0);
  }

  let content;
  try {
    content = readFileSync(progressPath, 'utf8');
  } catch {
    process.exit(0);
  }

  const { hasOpenChecklist, openItems, issuesWithout판정, issuesMissingFormat } = parseChecklists(content);

  // --- Rule 4: Step 7 complete but V-NN items unchecked ---
  // Rules 4 and 5 skip progress.md (that is how you resolve these violations)
  const step7Done = /\[x\]\s*Step 7/.test(content);
  const vnnSection = content.match(/## 탐지 코드 수정 검증[^\n]*\n([\s\S]*?)(?=\n##[^#]|\n### |$)/);
  if (step7Done && vnnSection && !isProgressMd) {
    const vnnOpenItems = vnnSection[1].split('\n')
      .filter(l => /^- \[ \]\s*V-\d+/.test(l.trim()));
    if (vnnOpenItems.length > 0) {
      block('4', `프로덕션 후 검증(V-NN) ${vnnOpenItems.length}건 미완료`, {
        relPath, progressPath,
        violationDetails: `Step 7 완료 후 V-NN 미완료:\n${vnnOpenItems.map(l => '  ' + l.trim()).join('\n')}\n\npf-step-5-6-7.md §Step 7.5: 회귀/스트레스 테스트는 즉시 실행, 이월은 프로덕션에서만 확인 가능한 항목에 한정.`,
        ruleFiles: ['pf-step-5-6-7.md §Step 7.5', 'CLAUDE.md §테스트 규칙']
      });
    }

    // Rule 4b: Check for improper deferrals — stress/regression tests should not be deferred
    const vnnDeferredItems = vnnSection[1].split('\n')
      .filter(l => {
        const t = l.trim();
        return /^- \[x\].*이월/.test(t) && /스트레스|회귀|regression|stress/.test(t);
      });
    if (vnnDeferredItems.length > 0) {
      const msg = `WARNING: 스트레스/회귀 테스트가 이월 처리됨

테스트 슬라이드 생성으로 즉시 검증 가능한 항목이 이월되었습니다:
${vnnDeferredItems.map(l => '  ' + l.trim()).join('\n')}

이월은 "다음 프레젠테이션 프로덕션에서만 확인 가능"한 항목에 한정.
tests/stress-slides/에 TP/FP 테스트 슬라이드를 생성하여 PF/VP를 실행하세요.`;
      process.stderr.write(msg + '\n');
      // Warning only, not blocking — but logged for awareness
    }
  }

  // --- Rule 5: Step 7 complete but active rules still unchecked ---
  if (step7Done && !isProgressMd) {
    const activeSection = content.match(/## 활성 규칙[^\n]*\n([\s\S]*?)(?=\n##[^#]|$)/);
    if (activeSection) {
      const uncheckedRules = activeSection[1].split('\n')
        .filter(l => /^- \[ \]/.test(l.trim()));
      if (uncheckedRules.length > 0) {
        block('5', `활성 규칙 ${uncheckedRules.length}건 미체크 (Step 7 완료 후)`, {
          relPath, progressPath,
          violationDetails: `Step 7 완료 후 활성 규칙 미체크:\n${uncheckedRules.map(l => '  ' + l.trim()).join('\n')}\n\n전체 프로덕션 규칙은 Step 7 완료 직후 [x] 체크. Phase별 규칙은 해당 Phase 완료 시 체크.`,
          ruleFiles: ['CLAUDE.md §활성 규칙 체크박스', 'presentation-flow.md §활성 규칙 템플릿']
        });
      }
    }
  }

  // --- Rule 1: Pipeline code edit without checklist ---
  if (isPipelineFile && !hasOpenChecklist) {
    block('1', `파이프라인 코드 수정 시 체크리스트 필수 — ${relPath}`, {
      relPath, progressPath,
      violationDetails: 'progress.md에 열린 체크리스트([ ] 항목)가 없는 상태에서 파이프라인 코드를 수정하려 함. 먼저 이슈 체크리스트(### 이슈 #N: ...)를 생성해야 함.',
      ruleFiles: ['CLAUDE.md §공통 절차', 'CLAUDE.md §체크박스 즉시 생성 원칙']
    });
  }

  // --- Rule 3: Slide HTML edit without proper 3분류 판정 ---
  if (isSlide) {
    if (issuesMissingFormat.length > 0) {
      block('3a', `3분류 판정 없이 슬라이드 수정 금지 — ${relPath}`, {
        relPath, progressPath,
        violationDetails: `3분류 형식 미비 이슈 섹션:\n${issuesMissingFormat.map(s => '  - ' + s).join('\n')}\n\n이슈 섹션에 "A. 판정: {정탐-수정 / 정탐-한계}" 항목을 추가해야 함. 사용자 피드백 = 무조건 정탐.`,
        ruleFiles: ['CLAUDE.md §공통 절차 — 3분류 판정', 'CLAUDE.md §체크박스 즉시 생성 원칙']
      });
    }

    if (issuesWithout판정.length > 0) {
      block('3b', `판정(A항목) 미완료 — ${relPath}`, {
        relPath, progressPath,
        violationDetails: `판정 미완료 이슈:\n${issuesWithout판정.map(s => '  - ' + s).join('\n')}\n\nA. 판정을 [x]로 체크한 후 슬라이드 수정 가능.`,
        ruleFiles: ['CLAUDE.md §공통 절차 — 3분류 판정']
      });
    }
  }

  // --- Rule 2: Step advancement with uncompleted checklist ---
  if (isProgressMd && hasOpenChecklist) {
    process.stderr.write(`[checklist-guard] 미완료 항목 ${openItems.length}건 존재. 완료 게이트: 전부 [x] 전까지 다음 작업 차단.\n`);
    process.exit(0);
  }

  process.exit(0);
}

main().catch(err => {
  process.stderr.write(`checklist-guard error: ${err.message}\n`);
  process.exit(0); // On error, don't block
});
