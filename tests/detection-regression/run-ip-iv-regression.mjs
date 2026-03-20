#!/usr/bin/env node
/**
 * IP/IV Regression Test Runner
 *
 * Tests IP (Image Preflight) and IV (Image Validate) detection logic
 * against known true-positive and false-positive cases from the regression DB.
 *
 * Usage: node tests/detection-regression/run-ip-iv-regression.mjs
 *
 * Exit code 0 = all pass, 1 = regression found
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Tier auto-estimation — mirrors generate-images.mjs estimateTier() ──

function estimateTier(prompt) {
  const conceptIndicators = [
    /\b(chart|graph|table|data|statistic|comparison|matrix|versus|vs)\b/gi,
    /\b(process|flow|step|stage|pipeline|workflow|timeline)\b/gi,
    /\b(icon|symbol|badge|logo)\b/gi,
  ];
  let conceptCount = 0;
  for (const pattern of conceptIndicators) {
    const matches = prompt.match(pattern);
    if (matches) conceptCount += matches.length;
  }
  if (conceptCount >= 6) return 3;
  if (conceptCount >= 3) return 2;
  return 1;
}

// ── IP (Image Preflight) rules — mirrors generate-images.mjs checkImagePreflight() ──

function checkIP(rule, input) {
  const prompt = input.prompt || '';

  switch (rule) {
    case 'IP-01':
      return /[\uAC00-\uD7AF]/.test(prompt) ? 'ERROR' : null;

    case 'IP-02':
      return (input.tier >= 3) ? 'WARN' : null;

    case 'IP-03':
      return (input.aspectRatio === '1:1' && !/icon/i.test(prompt)) ? 'WARN' : null;

    case 'IP-04':
      return /\d+%|\$\d+/.test(prompt) ? 'ERROR' : null;

    case 'IP-05':
      return /\b(text:|labeled|with caption|with text|showing text|infographic with)\b/i.test(prompt) ? 'ERROR' : null;

    case 'IP-06':
      return prompt.length < 20 ? 'WARN' : null;

    case 'IP-07':
      return /"[^"]{2,}"/.test(prompt) ? 'ERROR' : null;

    case 'IP-08':
      return prompt.length > 600 ? 'WARN' : null;

    case 'IP-09': {
      // Portrait ratio + wide-angle keywords
      if (input.aspectRatio && /^(3:4|2:3|9:16)$/.test(input.aspectRatio) &&
          /\b(panoramic|wide-angle|ultrawide|cinematic wide)\b/i.test(prompt))
        return 'WARN';
      // Landscape ratio + vertical keywords (with "vertical bar/column/chart" exception)
      const hasVerticalMismatch = /\b(tall|towering|portrait)\b/i.test(prompt) ||
        (/\bvertical\b/i.test(prompt) && !/\bvertical\s+(bar|column|chart)\b/i.test(prompt));
      if (input.aspectRatio && /^(16:9|21:9|3:2)$/.test(input.aspectRatio) && hasVerticalMismatch)
        return 'WARN';
      return null;
    }

    case 'IP-10': {
      if (!input.tier) return null;
      const estimated = estimateTier(prompt);
      return Math.abs(estimated - input.tier) >= 2 ? 'WARN' : null;
    }

    case 'IP-11':
      return /\b(compass|clock|watch|gauge|meter|speedometer|thermometer|calendar|keyboard|calculator|scoreboard|license\s*plate|sign|billboard|newspaper|book\s+cover|magazine|receipt|ticket|passport|diploma|certificate|barcode|qr\s*code|price\s*tag|menu|remote\s*control|phone\s*screen|laptop\s*screen|monitor|dashboard|control\s*panel)\b/i.test(prompt) ? 'WARN' : null;

    case 'IP-13':
      return /\bstaircase\b/i.test(prompt) ? 'WARN' : null;

    case 'IP-14': {
      const warmKeywords = /\b(warm|golden|amber|sunset|sunrise|orange|red|fire|flame|autumn|candle|copper|brass|terracotta)\b/gi;
      const coolKeywords = /\b(cool|icy|frozen|arctic|winter|blue|navy|teal|cyan|cold|steel|silver|frost)\b/gi;
      const warmMatches = (prompt.match(warmKeywords) || []).length;
      const coolMatches = (prompt.match(coolKeywords) || []).length;
      const colors = input._paletteColors || [];
      if (colors.length === 0) return null;
      const warmColors = colors.filter(c => c.r > c.b + 60).length;
      const coolColors = colors.filter(c => c.b > c.r + 60).length;
      const majority = Math.ceil(colors.length / 2);
      if (warmMatches >= 2 && coolColors >= majority) return 'WARN';
      if (coolMatches >= 2 && warmColors >= majority && warmMatches < 2) return 'WARN';
      return null;
    }

    case 'IP-15':
      // IP-15 requires VQA keyword DB — cannot be tested in regression runner
      return undefined;

    case 'IP-16': {
      const hexMatches = prompt.match(/#[0-9A-Fa-f]{6}/g) || [];
      return hexMatches.length >= 3 ? 'WARN' : null;
    }

    default:
      return undefined; // Unknown rule — skip
  }
}

// ── IV (Image Validate) rules — mirrors generate-images.mjs validateImage() ──

function checkIV(rule, input) {
  switch (rule) {
    case 'IV-01':
      return input.finishReason === 'SAFETY' ? 'FAIL' : null;

    case 'IV-02': {
      const isDarkSubject = /\b(cover|night|dark|midnight|starry|neon|표지|야경)\b/i.test(input.slideTitle || input.prompt || '');
      return (input.avgBrightness < 30 && !isDarkSubject) ? 'WARN' : null;
    }

    case 'IV-03': {
      const prompt = input.prompt || '';
      const isIconType = input.isIconType || (input.aspectRatio === '1:1' && /icon/i.test(prompt));
      const isFrameType = /\b(frame|timeline|process|funnel|pyramid|comparison|matrix|cover|minimalist|diagram|radial|venn|staircase|hub|flowchart|org\s*chart|gauge|meter)\b/i.test(prompt);
      const isWhiteDesign = /\bwhite\b/i.test(prompt) && /\b(minimalist|minimal)\b/i.test(prompt);

      let brightThreshold;
      if (isWhiteDesign) {
        brightThreshold = 255;
      } else if (isIconType || isFrameType) {
        brightThreshold = 252;
      } else {
        brightThreshold = 240;
      }

      return input.avgBrightness > brightThreshold ? 'FAIL' : null;
    }

    case 'IV-05': {
      const prompt = input.prompt || '';
      const isIconType = input.isIconType || (input.aspectRatio === '1:1' && /icon/i.test(prompt));
      const isFrameType = /\b(frame|timeline|process|funnel|pyramid|comparison|matrix|diagram|radial|venn|staircase|hub|flowchart|org\s*chart|chevron|donut|scatter|gauge|bar\s*chart|pie|ring|progress)\b/i.test(prompt);
      const minFileSize = (isIconType || isFrameType) ? 5120 : 10240;
      return input.fileSize < minFileSize ? 'FAIL' : null;
    }

    case 'IV-09': {
      // IV-09 requires sharpStats dominant colors — simplified for regression test
      // Only test the threshold logic, not the full color distance pipeline
      if (input.minColorDistance == null) return undefined;
      const isPhotographic = /\b(cinematic|photograph|photo|aerial|drone|macro|close-up|silhouette|long exposure|portrait|landscape)\b/i.test(input.category || '');
      const isNaturalSubject = input.isNaturalSubject || false;
      const paletteThreshold = (isPhotographic && isNaturalSubject) ? 200
        : isPhotographic ? 120 : 80;
      return input.minColorDistance > paletteThreshold ? 'WARN' : null;
    }

    case 'IV-10': {
      const ed = input.edgeDensity;
      if (ed == null || !input.tier) return null;
      const prompt = input.prompt || '';
      const isCoverOrBg = /\b(cover|background|배경|표지)\b/i.test(input.slideTitle || '');
      const isFrame = /\b(frame|timeline|process|funnel|pyramid|comparison|matrix|diagram|radial|venn|staircase|hub|flowchart|org\s*chart|chevron|donut|scatter|gauge|bar\s*chart|pie|ring|progress)\b/i.test(prompt);
      const isPhotographic = /\b(cinematic|photograph|photo|aerial|drone|macro|close-up|silhouette|long exposure|portrait|landscape)\b/i.test(prompt);
      const tierRanges = isCoverOrBg
        ? { 1: [0.0, 0.25], 2: [0.0, 0.35], 3: [0.01, 0.45] }
        : isFrame
          ? { 1: [0.0, 0.40], 2: [0.0, 0.50], 3: [0.01, 0.60] }
          : isPhotographic
            ? { 1: [0.02, 0.50], 2: [0.05, 0.60], 3: [0.10, 0.70] }
            : { 1: [0.02, 0.25], 2: [0.05, 0.40], 3: [0.10, 0.60] };
      const range = tierRanges[input.tier] || tierRanges[2];
      if (ed < range[0]) return 'WARN';
      if (ed > range[1]) return 'WARN';
      return null;
    }

    default:
      return undefined;
  }
}

// ── Test runner ──

function runTests() {
  const casesFile = join(__dirname, 'ip-iv-cases.json');
  const data = JSON.parse(readFileSync(casesFile, 'utf8'));
  const cases = data.cases;

  let passed = 0, failed = 0, skipped = 0, knownIssues = 0;
  const failures = [];

  for (const tc of cases) {
    const isIP = tc.rule.startsWith('IP-');
    const isIV = tc.rule.startsWith('IV-');

    let actual;
    if (isIP) {
      actual = checkIP(tc.rule, tc.input);
    } else if (isIV) {
      actual = checkIV(tc.rule, tc.input);
    }

    if (actual === undefined) {
      skipped++;
      console.log(`  - ${tc.id}: SKIPPED (rule ${tc.rule} not implemented in runner)`);
      continue;
    }

    // Known issues
    if (tc.status === 'known_issue') {
      const actualLevel = tc.actualLevel ?? null;
      if (actual === actualLevel) {
        knownIssues++;
        console.log(`  ⚠ ${tc.id}: KNOWN ISSUE — want ${tc.expectedLevel ?? 'null'}, code gives ${actual ?? 'null'} (tracked)`);
      } else if (actual === tc.expectedLevel || (tc.type === 'true_positive' && actual != null && tc.expectedLevel != null)) {
        passed++;
        console.log(`  🎉 ${tc.id}: FIXED — now gives ${actual ?? 'null'} (was ${actualLevel ?? 'null'}, wanted ${tc.expectedLevel ?? 'null'})`);
      } else {
        failed++;
        console.log(`  ✗ ${tc.id}: CHANGED — was ${actualLevel ?? 'null'}, now ${actual ?? 'null'} (wanted ${tc.expectedLevel ?? 'null'})`);
        failures.push({ id: tc.id, expected: actualLevel, actual, description: tc.description });
      }
      continue;
    }

    let pass;
    if (tc.type === 'true_positive') {
      if (tc.expectedLevel === 'ERROR' || tc.expectedLevel === 'FAIL') {
        pass = actual === tc.expectedLevel;
      } else if (tc.expectedLevel === 'WARN') {
        pass = actual === 'WARN' || actual === 'ERROR' || actual === 'FAIL';
      } else {
        pass = actual != null;
      }
    } else {
      // false_positive
      if (tc.expectedLevel === null) {
        pass = actual === null;
      } else if (tc.expectedLevel === 'WARN') {
        pass = actual === null || actual === 'WARN';
      } else {
        pass = actual === tc.expectedLevel;
      }
    }

    const tag = tc.type === 'true_positive' ? 'TP' : 'FP';
    if (pass) {
      passed++;
      console.log(`  ✓ ${tc.id}: ${tag} — expected ${tc.expectedLevel ?? 'null'}, got ${actual ?? 'null'}`);
    } else {
      failed++;
      const msg = `  ✗ ${tc.id}: REGRESSION — expected ${tc.expectedLevel ?? 'null'}, got ${actual ?? 'null'} (${tc.description})`;
      console.log(msg);
      failures.push({ id: tc.id, expected: tc.expectedLevel, actual, description: tc.description });
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${knownIssues} known issues, ${skipped} skipped`);

  if (failures.length > 0) {
    console.log('\n❌ REGRESSIONS FOUND:');
    for (const f of failures) {
      console.log(`  ${f.id}: expected ${f.expected ?? 'null'} but got ${f.actual ?? 'null'}`);
      console.log(`    ${f.description}`);
    }
    process.exit(1);
  } else {
    console.log('\n✅ All IP/IV regression tests passed');
    if (knownIssues > 0) console.log(`   (${knownIssues} known issues tracked for future fix)`);
    process.exit(0);
  }
}

console.log('IP/IV Regression Tests');
console.log('======================\n');
runTests();
