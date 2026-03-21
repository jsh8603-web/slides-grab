#!/usr/bin/env node
/**
 * Full-Slide Regression Test — PF + VP baseline comparison
 *
 * Runs PF (--full, Playwright) and VP against all past presentations,
 * compares results to a saved baseline, and reports new/resolved issues.
 *
 * Usage:
 *   node tests/run-full-regression.mjs --save          # Create baseline
 *   node tests/run-full-regression.mjs                  # Compare to baseline
 *   node tests/run-full-regression.mjs --pf-only        # PF regression only
 *   node tests/run-full-regression.mjs --vp-only        # VP regression only
 *   node tests/run-full-regression.mjs --exclude foo    # Exclude presentation
 *   node tests/run-full-regression.mjs --no-full        # Skip Playwright (static PF only)
 *
 * Exit code 0 = no regression, 1 = new issues found
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { preflightCheck } from '../scripts/preflight-html.js';
import { validatePptx } from '../scripts/validate-pptx.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SLIDES_DIR = path.join(PROJECT_ROOT, 'slides');
const BASELINE_PATH = path.join(__dirname, 'detection-regression', 'full-baseline.json');

// Presentations to always exclude (test directories)
const ALWAYS_EXCLUDE = new Set(['_keyword-tests', '_vqa-tests', '_full-regression-test']);

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// ── CLI parsing ───────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { save: false, pfOnly: false, vpOnly: false, exclude: [], noFull: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--save') opts.save = true;
    else if (args[i] === '--pf-only') opts.pfOnly = true;
    else if (args[i] === '--vp-only') opts.vpOnly = true;
    else if (args[i] === '--no-full') opts.noFull = true;
    else if (args[i] === '--exclude' && args[i + 1]) opts.exclude.push(args[++i]);
  }
  return opts;
}

// ── Discover presentations ────────────────────────────────────────────────────

function discoverPresentations(excludeList) {
  const excludeSet = new Set([...ALWAYS_EXCLUDE, ...excludeList]);
  const dirs = fs.readdirSync(SLIDES_DIR).filter(d => {
    if (excludeSet.has(d)) return false;
    const full = path.join(SLIDES_DIR, d);
    if (!fs.statSync(full).isDirectory()) return false;
    return true;
  }).sort();

  const presentations = [];
  for (const dir of dirs) {
    const dirPath = path.join(SLIDES_DIR, dir);
    const slides = fs.readdirSync(dirPath)
      .filter(f => /^slide-\d+[^]*\.html$/.test(f))
      .sort();
    if (slides.length === 0) continue;

    // Find canonical PPTX: directory-name.pptx
    const canonicalPptx = `${dir}.pptx`;
    const pptxPath = path.join(dirPath, canonicalPptx);
    const hasPptx = fs.existsSync(pptxPath);

    presentations.push({
      name: dir,
      dirPath,
      slides,
      slideCount: slides.length,
      pptxPath: hasPptx ? pptxPath : null,
    });
  }
  return presentations;
}

// ── Run PF on a single presentation ───────────────────────────────────────────

async function runPF(pres, useFull) {
  const result = await preflightCheck(pres.dirPath, { full: useFull, json: true });
  return result.structured || [];
}

// ── Run VP on a single presentation ───────────────────────────────────────────

async function runVP(pres) {
  if (!pres.pptxPath) return [];
  const { errors, warnings } = await validatePptx(pres.pptxPath, { quiet: true });
  return [...errors, ...warnings].map(issue => ({
    file: `slide-${issue.slide}`,
    rule: issue.code,
    level: issue.level,
    message: issue.message,
  }));
}

// ── Issue key for comparison ──────────────────────────────────────────────────

function issueKey(issue) {
  return `${issue.file}|${issue.rule}|${issue.level}`;
}

// ── Diff baseline vs current ──────────────────────────────────────────────────

function diffResults(baselineIssues, currentIssues) {
  const baseKeys = new Set(baselineIssues.map(issueKey));
  const currKeys = new Set(currentIssues.map(issueKey));

  const newIssues = currentIssues.filter(i => !baseKeys.has(issueKey(i)));
  const resolved = baselineIssues.filter(i => !currKeys.has(issueKey(i)));

  return { newIssues, resolved };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const presentations = discoverPresentations(opts.exclude);
  const runPf = !opts.vpOnly;
  const runVp = !opts.pfOnly;
  const useFull = !opts.noFull;

  const totalSlides = presentations.reduce((s, p) => s + p.slideCount, 0);
  const pptxCount = presentations.filter(p => p.pptxPath).length;

  // ── Save mode: generate baseline ────────────────────────────────────────
  if (opts.save) {
    console.log(`${BOLD}Generating baseline...${RESET}`);
    console.log(`  ${presentations.length} presentations, ${totalSlides} slides, ${pptxCount} PPTX files\n`);

    const baseline = { version: 1, created: new Date().toISOString(), pf: {}, vp: {} };

    if (runPf) {
      console.log(`${CYAN}[PF]${RESET} Running preflight on ${presentations.length} presentations...`);
      for (const pres of presentations) {
        process.stdout.write(`  ${DIM}${pres.name} (${pres.slideCount} slides)...${RESET}`);
        const issues = await runPF(pres, useFull);
        const byFile = {};
        for (const issue of issues) {
          if (!byFile[issue.file]) byFile[issue.file] = [];
          byFile[issue.file].push({ rule: issue.rule, level: issue.level, msg: issue.message });
        }
        baseline.pf[pres.name] = byFile;
        console.log(` ${issues.length} issues`);
      }
    }

    if (runVp) {
      console.log(`\n${CYAN}[VP]${RESET} Running validation on ${pptxCount} PPTX files...`);
      for (const pres of presentations) {
        if (!pres.pptxPath) continue;
        process.stdout.write(`  ${DIM}${pres.name}...${RESET}`);
        const issues = await runVP(pres);
        baseline.vp[pres.name] = issues.map(i => ({ slide: i.file, rule: i.rule, level: i.level, msg: i.message }));
        console.log(` ${issues.length} issues`);
      }
    }

    // Ensure directory exists
    const baselineDir = path.dirname(BASELINE_PATH);
    if (!fs.existsSync(baselineDir)) fs.mkdirSync(baselineDir, { recursive: true });

    fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
    console.log(`\n${GREEN}${BOLD}Baseline saved: ${BASELINE_PATH}${RESET}`);
    console.log(`  PF: ${Object.keys(baseline.pf).length} presentations`);
    console.log(`  VP: ${Object.keys(baseline.vp).length} presentations`);
    process.exit(0);
  }

  // ── Compare mode: diff against baseline ─────────────────────────────────
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error(`${RED}No baseline found. Run with --save first:${RESET}`);
    console.error(`  node tests/run-full-regression.mjs --save`);
    process.exit(1);
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8'));
  const baseDate = baseline.created ? baseline.created.split('T')[0] : 'unknown';

  console.log(`${BOLD}Full Regression Test (baseline: ${baseDate})${RESET}`);
  console.log('\u2501'.repeat(50) + '\n');

  let totalNew = 0;
  let totalResolved = 0;
  let pfPass = 0;
  let pfTotal = 0;
  let vpPass = 0;
  let vpTotal = 0;

  // ── PF comparison ──────────────────────────────────────────────────────
  if (runPf) {
    console.log(`${CYAN}[PF]${RESET} Scanning ${presentations.length} presentations, ${totalSlides} slides...`);

    for (const pres of presentations) {
      pfTotal++;
      const currentIssues = await runPF(pres, useFull);

      // Reconstruct baseline issues for this presentation
      const baseData = baseline.pf[pres.name] || {};
      const baseIssues = [];
      for (const [file, issues] of Object.entries(baseData)) {
        for (const issue of issues) {
          baseIssues.push({ file, rule: issue.rule, level: issue.level, message: issue.msg });
        }
      }

      const { newIssues, resolved } = diffResults(baseIssues, currentIssues);

      if (newIssues.length > 0) {
        console.log(`${YELLOW}\u26a0\ufe0f ${RESET} ${pres.name} (${pres.slideCount} slides): ${RED}${newIssues.length} NEW${RESET} issues`);
        for (const issue of newIssues) {
          console.log(`   ${RED}+ [${issue.file}] ${issue.rule} ${issue.level}: ${issue.message}${RESET}`);
        }
        totalNew += newIssues.length;
      } else if (resolved.length > 0) {
        console.log(`${CYAN}\u2139\ufe0f ${RESET} ${pres.name} (${pres.slideCount} slides): ${resolved.length} resolved`);
        pfPass++;
      } else {
        console.log(`${GREEN}\u2705${RESET} ${pres.name} (${pres.slideCount} slides): no regression`);
        pfPass++;
      }
      if (resolved.length > 0) {
        for (const issue of resolved) {
          console.log(`   ${GREEN}- [${issue.file}] ${issue.rule} ${issue.level} (resolved)${RESET}`);
        }
        totalResolved += resolved.length;
      }
    }
    console.log('');
  }

  // ── VP comparison ──────────────────────────────────────────────────────
  if (runVp) {
    const vpPresentations = presentations.filter(p => p.pptxPath);
    console.log(`${CYAN}[VP]${RESET} Scanning ${vpPresentations.length} presentations, ${vpPresentations.length} PPTX files...`);

    for (const pres of vpPresentations) {
      vpTotal++;
      const currentIssues = await runVP(pres);

      const baseIssues = (baseline.vp[pres.name] || []).map(i => ({
        file: i.slide || `slide-0`,
        rule: i.rule,
        level: i.level,
        message: i.msg,
      }));

      const { newIssues, resolved } = diffResults(baseIssues, currentIssues);

      if (newIssues.length > 0) {
        console.log(`${YELLOW}\u26a0\ufe0f ${RESET} ${pres.name}: ${RED}${newIssues.length} NEW${RESET} issues`);
        for (const issue of newIssues) {
          console.log(`   ${RED}+ [${issue.file}] ${issue.rule} ${issue.level}: ${issue.message}${RESET}`);
        }
        totalNew += newIssues.length;
      } else if (resolved.length > 0) {
        console.log(`${CYAN}\u2139\ufe0f ${RESET} ${pres.name}: ${resolved.length} resolved`);
        vpPass++;
      } else {
        console.log(`${GREEN}\u2705${RESET} ${pres.name}: no regression`);
        vpPass++;
      }
      if (resolved.length > 0) {
        for (const issue of resolved) {
          console.log(`   ${GREEN}- [${issue.file}] ${issue.rule} ${issue.level} (resolved)${RESET}`);
        }
        totalResolved += resolved.length;
      }
    }
    console.log('');
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const parts = [];
  if (runPf) parts.push(`PF ${pfPass}/${pfTotal} pass (${totalNew > 0 ? totalNew + ' new' : '0 new'})`);
  if (runVp) parts.push(`VP ${vpPass}/${vpTotal} pass`);

  console.log(`${BOLD}Results: ${parts.join(', ')}${RESET}`);
  if (totalResolved > 0) {
    console.log(`${GREEN}${totalResolved} issue(s) resolved since baseline${RESET}`);
  }

  if (totalNew > 0) {
    console.log(`\n${RED}${BOLD}REGRESSION: ${totalNew} new issue(s) detected${RESET}`);
    process.exit(1);
  } else {
    console.log(`\n${GREEN}${BOLD}No regression detected${RESET}`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
