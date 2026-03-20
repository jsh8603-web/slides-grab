#!/usr/bin/env node
/**
 * checklist-guard.mjs — Pre-tool-call hook
 *
 * Four enforcement rules:
 * 1. BLOCK pipeline code edits when no open checklist exists in progress.md
 * 2. BLOCK step advancement (marking steps complete) while uncompleted issue checklists exist
 * 3. BLOCK slide HTML edits when issue checklists exist without proper 3분류 판정 (A. 판정 항목 미완료)
 * 4. WARN when Step 7 is complete but V-NN verification items remain unchecked
 *
 * On block, outputs analysis prompt for MD rule auto-improvement.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';

const PROJECT_ROOT = 'D:/projects/slides-grab';

// Pipeline code files that require a checklist before editing
const PIPELINE_FILES = new Set([
  'scripts/preflight-html.js',
  'scripts/validate-pptx.js',
  'scripts/generate-images.mjs',
  'scripts/html2pptx.cjs',
  'scripts/convert-native.mjs',
  '.claude/docs/html-prevention-rules.md',
  '.claude/docs/nanoBanana-guide.md',
  '.claude/docs/pptx-inspection-log.md',
  '.claude/skills/design-skill/SKILL.md',
  'tests/detection-regression/run-pf-regression.mjs',
  'tests/detection-regression/run-vp-regression.mjs',
  'tests/detection-regression/run-ip-iv-regression.mjs',
  'tests/detection-regression/pf-cases.json',
  'tests/detection-regression/vp-cases.json',
  'tests/detection-regression/ip-iv-cases.json',
]);

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

  const ISSUE_PATTERN = /^### (이슈|사용자 피드백|정탐-한계|규칙 개선)/;

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
  return /^slides\/[^/]+\/slide-\d+\.html$/.test(relPath);
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

  // Find the relevant progress.md
  const progressPath = isSlide
    ? findProgressForSlide(relPath)
    : findActiveProgress();

  if (!progressPath) {
    process.exit(0); // No active presentation
  }

  let content;
  try {
    content = readFileSync(progressPath, 'utf8');
  } catch {
    process.exit(0);
  }

  const { hasOpenChecklist, openItems, issuesWithout판정, issuesMissingFormat } = parseChecklists(content);

  // --- Rule 4: Step 7 complete but V-NN items unchecked ---
  const step7Done = /\[x\]\s*Step 7/.test(content);
  const vnnSection = content.match(/## 탐지 코드 수정 검증[^\n]*\n([\s\S]*?)(?=\n##[^#]|\n### |$)/);
  if (step7Done && vnnSection) {
    const vnnOpenItems = vnnSection[1].split('\n')
      .filter(l => /^- \[ \]\s*V-\d+/.test(l.trim()));
    if (vnnOpenItems.length > 0) {
      const msg = `BLOCKED: 프로덕션 후 검증(V-NN) 미완료

Step 7 출력이 완료되었으나 탐지 코드 수정 검증이 남아있습니다:
${vnnOpenItems.map(l => '  ' + l.trim()).join('\n')}

pf-step-5-6-7.md §Step 7.5에 따라:
1. 회귀 테스트/스트레스 테스트는 즉시 실행 (테스트 슬라이드 생성 + PF/VP)
2. 이월은 "다음 프레젠테이션 프로덕션에서만 확인 가능"한 항목에 한정
3. 전부 [x] 후에만 완료 보고 가능`;
      console.log(msg);
      process.exit(1);
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

  // --- Rule 1: Pipeline code edit without checklist ---
  if (isPipelineFile && !hasOpenChecklist) {
    const msg = `BLOCKED: 파이프라인 코드 수정 시 체크리스트 필수

수정 대상: ${relPath}
progress.md에 열린 체크리스트([ ] 항목)가 없습니다.

CLAUDE.md §공통 절차에 따라:
1. 먼저 progress.md에 이슈 체크리스트를 생성하세요 (### 이슈 #N: ...)
2. 체크리스트가 존재한 후에 코드 수정을 진행하세요

위반 분석 의무:
→ 왜 체크리스트 없이 수정하려 했는지 분석
→ CLAUDE.md 또는 관련 MD 규칙이 불명확하다면 더 명료하게 개선`;
    console.log(msg);
    process.exit(1);
  }

  // --- Rule 3: Slide HTML edit without proper 3분류 판정 ---
  if (isSlide) {
    // Block if issue sections lack proper format (no A. 판정 item at all)
    if (issuesMissingFormat.length > 0) {
      const msg = `BLOCKED: 3분류 판정 없이 슬라이드 수정 금지

수정 대상: ${relPath}
progress.md에 3분류 형식이 아닌 이슈 섹션이 있습니다:
${issuesMissingFormat.map(s => '  - ' + s).join('\n')}

CLAUDE.md §공통 절차에 따라:
1. 이슈 섹션에 "A. 판정: {정탐-수정 / 정탐-한계}" 항목을 추가하세요
2. 사용자 피드백 = 무조건 정탐. 정탐-수정 / 정탐-한계만 해당
3. 판정 완료 후 슬라이드 수정을 진행하세요

위반 분석 의무:
→ 3분류 판정 없이 수정하려 한 이유 분석
→ 체크리스트 형식이 올바르지 않다면 즉시 수정`;
      console.log(msg);
      process.exit(1);
    }

    // Block if A. 판정 exists but is unchecked
    if (issuesWithout판정.length > 0) {
      const msg = `BLOCKED: 판정 미완료 상태에서 슬라이드 수정 금지

수정 대상: ${relPath}
progress.md에 판정(A항목)이 완료되지 않은 이슈가 있습니다:
${issuesWithout판정.map(s => '  - ' + s).join('\n')}

CLAUDE.md §공통 절차에 따라:
1. 먼저 A. 판정을 완료하세요 (정탐-수정 / 정탐-한계)
2. 판정 완료 → [x] 체크 후 슬라이드 수정을 진행하세요`;
      console.log(msg);
      process.exit(1);
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
