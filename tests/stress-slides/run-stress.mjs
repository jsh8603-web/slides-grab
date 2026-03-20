#!/usr/bin/env node
/**
 * Stress test runner — runs full pipeline (PF → convert-native → VP) on test slides
 * and compares results against manifest expectations.
 *
 * Usage: node tests/stress-slides/run-stress.mjs --dir <test-name>
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dirIdx = args.indexOf('--dir');
const testName = dirIdx >= 0 ? args[dirIdx + 1] : args[0];

if (!testName) {
  console.error('Usage: node tests/stress-slides/run-stress.mjs --dir <test-name>');
  process.exit(1);
}

const testDir = path.resolve(__dirname, testName);
const manifestPath = path.join(testDir, 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error(`manifest.json not found in ${testDir}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
console.log(`\nStress Test: ${manifest.name}`);
console.log(`${'='.repeat(60)}`);
console.log(`${manifest.description}\n`);

let passed = 0;
let failed = 0;
const failures = [];

// ── Phase 1: PF checks ──────────────────────────────────────────────────
console.log('Phase 1: Preflight (PF) checks');
console.log('-'.repeat(40));

// Run PF once on entire test dir
let pfOutput = '';
const hasPfCases = manifest.cases.some(c => Object.keys(c.expect).some(k => k.startsWith('PF-')));
if (hasPfCases) {
  try {
    pfOutput = execSync(
      `node scripts/preflight-html.js --slides-dir "${testDir}"`,
      { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 60000 }
    );
  } catch (e) {
    pfOutput = (e.stdout || '') + (e.stderr || '');
  }
}

for (const c of manifest.cases) {
  const pfExpects = Object.entries(c.expect).filter(([k]) => k.startsWith('PF-'));
  if (pfExpects.length === 0) continue;

  // Extract lines for this specific slide
  const slideBase = c.slide.replace('.html', '');
  const slideLines = pfOutput.split('\n').filter(l => l.includes(slideBase) || l.includes(c.slide));

  for (const [rule, expectedLevel] of pfExpects) {
    const ruleLines = slideLines.filter(l => l.includes(rule));
    const hasRule = ruleLines.length > 0;
    let actualLevel = null;
    if (hasRule) {
      actualLevel = ruleLines.some(l => /ERROR/i.test(l)) ? 'ERROR' :
                     ruleLines.some(l => /WARN/i.test(l)) ? 'WARN' : 'DETECTED';
    }

    if (expectedLevel === null && !hasRule) {
      console.log(`  ✓ ${c.slide}: ${rule} — expected clean, got clean`);
      passed++;
    } else if (expectedLevel && actualLevel) {
      console.log(`  ✓ ${c.slide}: ${rule} — expected ${expectedLevel}, got ${actualLevel}`);
      passed++;
    } else {
      console.log(`  ✗ ${c.slide}: ${rule} — expected ${expectedLevel || 'clean'}, got ${actualLevel || 'clean'}`);
      failed++;
      failures.push({ slide: c.slide, rule, expected: expectedLevel, got: actualLevel });
    }
  }
}

// ── Phase 2: VP checks (convert → validate) ─────────────────────────────
const vpCases = manifest.cases.filter(c =>
  Object.keys(c.expect).some(k => k.startsWith('VP-'))
);

if (vpCases.length > 0) {
  console.log('\nPhase 2: PPTX conversion + VP checks');
  console.log('-'.repeat(40));

  const pptxPath = path.join(testDir, 'stress-test.pptx');
  let vpOutput = '';
  try {
    vpOutput = execSync(
      `node scripts/convert-native.mjs --slides-dir "${testDir}" --output "${pptxPath}"`,
      { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 120000 }
    );
  } catch (e) {
    vpOutput = (e.stdout || '') + (e.stderr || '');
  }

  for (const c of vpCases) {
    // Find slide number from filename
    const slideNum = parseInt(c.slide.match(/\d+/)?.[0] || '0');
    const vpExpects = Object.entries(c.expect).filter(([k]) => k.startsWith('VP-'));

    for (const [rule, expectedLevel] of vpExpects) {
      const slidePattern = new RegExp(`\\[slide ${slideNum}\\].*${rule}`, 'gi');
      const slideMatches = vpOutput.match(slidePattern);
      const hasRule = !!slideMatches;

      let actualLevel = null;
      if (hasRule) {
        const errorMatch = slideMatches.some(m => /ERROR/i.test(m));
        const warnMatch = slideMatches.some(m => /WARN/i.test(m));
        actualLevel = errorMatch ? 'ERROR' : (warnMatch ? 'WARN' : 'DETECTED');
      }

      if (expectedLevel === null && !hasRule) {
        console.log(`  ✓ ${c.slide} [VP slide ${slideNum}]: ${rule} — expected clean, got clean`);
        passed++;
      } else if (expectedLevel && actualLevel) {
        if (actualLevel.toUpperCase() === expectedLevel.toUpperCase()) {
          console.log(`  ✓ ${c.slide} [VP slide ${slideNum}]: ${rule} — expected ${expectedLevel}, got ${actualLevel}`);
        } else {
          console.log(`  ✓ ${c.slide} [VP slide ${slideNum}]: ${rule} — expected ${expectedLevel}, got ${actualLevel} (detected)`);
        }
        passed++;
      } else {
        console.log(`  ✗ ${c.slide} [VP slide ${slideNum}]: ${rule} — expected ${expectedLevel || 'clean'}, got ${actualLevel || 'clean'}`);
        failed++;
        failures.push({ slide: c.slide, rule, expected: expectedLevel, got: actualLevel });
      }
    }
  }

  // Cleanup
  try { fs.unlinkSync(pptxPath); } catch {}
}

// ── Phase 3: enhancePrompt checks ────────────────────────────────────────
const promptCases = manifest.cases.filter(c => c.expect.PROMPT_CONTAINS || c.expect.PROMPT_NOT_CONTAINS);

if (promptCases.length > 0) {
  console.log('\nPhase 3: enhancePrompt composition checks');
  console.log('-'.repeat(40));

  // Run the dedicated test
  try {
    const out = execSync(
      'node tests/test-enhance-prompt-split.mjs',
      { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 15000 }
    );
    const testPassed = out.includes('0 failed');
    if (testPassed) {
      console.log(`  ✓ enhancePrompt unit tests — all passed`);
      passed++;
    } else {
      console.log(`  ✗ enhancePrompt unit tests — some failed`);
      console.log(out);
      failed++;
    }
  } catch (e) {
    console.log(`  ✗ enhancePrompt unit tests — error: ${e.message}`);
    failed++;
  }
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`);
console.log(`${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ${f.slide}: ${f.rule} — expected ${f.expected || 'clean'}, got ${f.got || 'clean'}`);
  }
}
console.log();
process.exit(failed > 0 ? 1 : 0);
