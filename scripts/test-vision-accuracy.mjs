#!/usr/bin/env node
/**
 * test-vision-accuracy.mjs — Automated accuracy evaluation for Vision Validation (VV)
 *
 * Compares VV results against ground truth to measure false positives / false negatives.
 *
 * Usage:
 *   node scripts/test-vision-accuracy.mjs --ground-truth tests/vision-ground-truth.json [options]
 *
 * Options:
 *   --consensus N      Multi-run consensus (default: 1)
 *   --verbose          Show per-slide details
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { createScreenshotBrowser, createScreenshotPage, captureSlideScreenshot }
  from '../src/editor/screenshot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ── Scoring ──

const WEIGHTS = {
  content_completeness: 2.0,
  text_fidelity: 1.5,
  layout_match: 1.0,
  color_accuracy: 0.5,
  overall_fidelity: 1.0,
};

const CRITERIA = ['layout_match', 'content_completeness', 'text_fidelity', 'color_accuracy', 'overall_fidelity'];

function classifySlide(scores) {
  let total = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    total += (scores[key] || 0) * weight;
  }
  const critMin = Math.min(scores.content_completeness || 0, scores.text_fidelity || 0);
  const secMin = Math.min(scores.color_accuracy || 0, scores.overall_fidelity || 0);

  if (total < 18 || critMin <= 2) return 'ERROR';
  if (total < 24 || critMin === 3 || secMin <= 3) return 'WARN';
  return 'PASS';
}

// ── Vision API call ──

async function callVision(htmlBuf, pptxBuf, slideNum) {
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  const systemPrompt = `You are a visual fidelity reviewer for HTML-to-PPTX slide conversion.
Compare these two images of slide ${slideNum}:
[IMAGE 1] Original HTML (source of truth)
[IMAGE 2] Exported PPTX (being evaluated)

STEP 1 — List all VISIBLE differences you can clearly see. Be specific.
STEP 2 — Rate each criterion 1-5 based ONLY on the differences you listed in Step 1.

Criteria:
- layout_match: Element positioning, spacing, proportions
- content_completeness: ALL visual elements present? Missing element = 1
- text_fidelity: Text content, spacing, line breaks, readability
- color_accuracy: Background, text, accent colors preserved?
- overall_fidelity: Would a presenter notice at normal viewing distance?

Score guide:
  5 = Identical or indistinguishable at normal distance
  4 = Minor rendering difference (font weight, antialiasing, 1-2px shift, subtle saturation)
  3 = Noticeable difference that a presenter would spot (wrong line break, shifted element, changed emphasis)
  1-2 = Critical: missing element, text truncated, semantic color lost, content unreadable

IMPORTANT:
- HTML and PPTX use DIFFERENT rendering engines. Font weight, antialiasing, and minor saturation shifts are EXPECTED and should score 4-5.
- If you cannot clearly see a difference at normal viewing distance, it is NOT an issue. Do NOT imagine or infer differences.
- Color accuracy: only score <=3 if a SEMANTIC color distinction is lost (e.g., highlighted text becomes same color as regular text, color-coded categories lose their coding).

Provide brief {criterion}_reason for EVERY score (even 4-5, one sentence).
List confirmed differences in "differences" array.`;

  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: 'image/png', data: htmlBuf.toString('base64') } },
        { inline_data: { mime_type: 'image/png', data: pptxBuf.toString('base64') } },
        { text: systemPrompt },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          layout_match: { type: 'integer' },
          layout_reason: { type: 'string' },
          content_completeness: { type: 'integer' },
          content_reason: { type: 'string' },
          text_fidelity: { type: 'integer' },
          text_reason: { type: 'string' },
          color_accuracy: { type: 'integer' },
          color_reason: { type: 'string' },
          overall_fidelity: { type: 'integer' },
          overall_reason: { type: 'string' },
          differences: { type: 'array', items: { type: 'string' } },
        },
        required: ['layout_match', 'layout_reason', 'content_completeness', 'content_reason',
                    'text_fidelity', 'text_reason', 'color_accuracy', 'color_reason',
                    'overall_fidelity', 'overall_reason', 'differences'],
      },
    },
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt + 1) * 2000));
        continue;
      }
      if (!res.ok) return null;
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;
      return JSON.parse(text);
    } catch {
      if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

// ── Image preparation ──

async function prepareImages(slidesDir, pptxPath) {
  const tmpDir = path.join(slidesDir, '.accuracy-test');
  const htmlImgDir = path.join(tmpDir, 'html');
  const pptxImgDir = path.join(tmpDir, 'pptx');
  fs.mkdirSync(htmlImgDir, { recursive: true });
  fs.mkdirSync(pptxImgDir, { recursive: true });

  const { browser } = await (await import('../src/editor/screenshot.js')).createScreenshotBrowser();
  const { context, page } = await (await import('../src/editor/screenshot.js')).createScreenshotPage(browser);
  const htmlFiles = fs.readdirSync(slidesDir).filter(f => /^slide-\d+\.html$/.test(f)).sort();
  for (const file of htmlFiles) {
    await captureSlideScreenshot(page, file, path.join(htmlImgDir, file.replace('.html', '.png')), slidesDir);
  }
  await context.close();
  await browser.close();

  const ps1Path = path.join(__dirname, 'export-slides-png.ps1');
  const psResult = spawnSync('powershell', [
    '-ExecutionPolicy', 'Bypass', '-File', ps1Path,
    '-PptxPath', path.resolve(pptxPath),
    '-OutputDir', pptxImgDir, '-Width', '1600', '-Height', '900',
  ], { encoding: 'utf8', timeout: 120000 });

  if (psResult.status !== 0) {
    throw new Error(`PowerPoint export failed: ${(psResult.stderr || psResult.stdout || '').slice(0, 300)}`);
  }

  return { tmpDir, htmlImgDir, pptxImgDir, htmlFiles };
}

// ── Consensus helper ──

function computeConsensus(results) {
  const valid = results.filter(Boolean);
  if (valid.length === 0) return null;

  const scores = {};
  for (const key of CRITERIA) {
    const vals = valid.map(r => r[key]).sort((a, b) => a - b);
    scores[key] = vals[Math.floor(vals.length / 2)];
    const lowest = valid.reduce((min, r) => r[key] < min[key] ? r : min);
    scores[`${key}_reason`] = lowest[`${key}_reason`] || '';
  }
  scores.differences = [...new Set(valid.flatMap(r => r.differences || []))];

  // Spread per criterion
  scores._spread = {};
  for (const key of CRITERIA) {
    const vals = valid.map(r => r[key]);
    scores._spread[key] = Math.max(...vals) - Math.min(...vals);
  }
  scores._runs = valid.length;
  // Raw scores per run for analysis
  scores._raw = valid.map(r => {
    const obj = {};
    for (const key of CRITERIA) obj[key] = r[key];
    return obj;
  });
  return scores;
}

// ── Accuracy test ──

async function runAccuracyTest(groundTruth, opts) {
  const { consensus, verbose } = opts;

  console.log('=== Vision Accuracy Test ===');
  console.log(`Config: consensus=${consensus}\n`);

  if (!GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY required for Vision accuracy test');
    process.exit(1);
  }

  let totalSlides = 0;
  let correct = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  const allSpreads = [];

  for (const [presName, pres] of Object.entries(groundTruth)) {
    const slidesDir = path.resolve(PROJECT_ROOT, pres.slidesDir);
    const pptxPath = path.resolve(PROJECT_ROOT, pres.pptx);
    console.log(`Presentation: ${presName}`);

    const { tmpDir, htmlImgDir, pptxImgDir, htmlFiles } = await prepareImages(slidesDir, pptxPath);

    console.log('\nPer-slide results:');
    for (const file of htmlFiles) {
      const slideKey = file.replace('.html', '');
      const slideNum = parseInt(file.match(/\d+/)[0], 10);
      const gt = pres.slides[slideKey];
      if (!gt) continue;
      totalSlides++;

      const htmlPng = path.join(htmlImgDir, file.replace('.html', '.png'));
      const pptxPng = path.join(pptxImgDir, `slide_${String(slideNum).padStart(2, '0')}.png`);
      if (!fs.existsSync(htmlPng) || !fs.existsSync(pptxPng)) {
        console.log(`  ${slideKey}: SKIP (missing images)`);
        continue;
      }

      const htmlBuf = fs.readFileSync(htmlPng);
      const pptxBuf = fs.readFileSync(pptxPng);

      // Vision API (with optional consensus)
      let scores;
      if (consensus > 1) {
        const results = await Promise.all(
          Array.from({ length: consensus }, () => callVision(htmlBuf, pptxBuf, slideNum))
        );
        scores = computeConsensus(results);
        if (!scores) { console.log(`  ${slideKey}: SKIP (Vision failed)`); continue; }
        for (const key of CRITERIA) {
          if (scores._spread[key] > 0) allSpreads.push(scores._spread[key]);
        }
      } else {
        scores = await callVision(htmlBuf, pptxBuf, slideNum);
        if (!scores) { console.log(`  ${slideKey}: SKIP (Vision failed)`); continue; }
      }

      const got = classifySlide(scores);
      const ok = isMatch(gt.expected, got, gt.tolerance);
      if (ok) correct++;
      else if (isFalsePositive(gt.expected, got, gt.tolerance)) falsePositives++;
      else if (isFalseNegative(gt.expected, got)) falseNegatives++;

      const tag = ok ? 'OK' : (isFalsePositive(gt.expected, got, gt.tolerance) ? 'FP' : 'FN');
      const scoreStr = `LM=${scores.layout_match} CC=${scores.content_completeness} TF=${scores.text_fidelity} CA=${scores.color_accuracy} OF=${scores.overall_fidelity}`;
      console.log(`  ${slideKey}: expected=${gt.expected}  got=${got}  [${tag}] (${scoreStr})`);

      // mustDetect / mustNotFlag checks
      if (gt.mustDetect && got === 'PASS') {
        console.log(`    MISS: expected to detect ${gt.mustDetect.join(', ')}`);
      }
      if (gt.mustNotFlag) {
        for (const key of gt.mustNotFlag) {
          if ((scores[key] || 5) <= 3) {
            console.log(`    FALSE FLAG: ${key}=${scores[key]} but mustNotFlag`);
          }
        }
      }

      if (verbose) {
        for (const key of CRITERIA) {
          const reason = scores[`${key}_reason`] || '';
          if (reason) console.log(`    ${key}=${scores[key]}: ${reason}`);
        }
        if (scores.differences?.length > 0) {
          console.log(`    differences: ${scores.differences.join('; ')}`);
        }
        if (scores._raw) {
          console.log(`    raw runs: ${scores._raw.map(r => `[${CRITERIA.map(k => r[k]).join(',')}]`).join(' ')}`);
        }
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 500));
    }

    // Cleanup
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }

  // Summary
  const precision = (correct + falsePositives) > 0 ? correct / (correct + falsePositives) : 1;
  const recall = (correct + falseNegatives) > 0 ? correct / (correct + falseNegatives) : 1;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

  console.log(`\nSummary:`);
  console.log(`  Accuracy: ${correct}/${totalSlides} (${(correct / totalSlides * 100).toFixed(0)}%)`);
  console.log(`  False Positives: ${falsePositives} (expected PASS/WARN, got ERROR)`);
  console.log(`  False Negatives: ${falseNegatives} (expected problem, got less severe)`);
  console.log(`  Precision: ${precision.toFixed(2)}  Recall: ${recall.toFixed(2)}  F1: ${f1.toFixed(2)}`);

  if (allSpreads.length > 0) {
    const avgSpread = allSpreads.reduce((a, b) => a + b, 0) / allSpreads.length;
    const maxSpread = Math.max(...allSpreads);
    console.log(`  Consensus spread: avg ${avgSpread.toFixed(1)}, max ${maxSpread} (low = stable)`);
  }
}

// ── Helpers ──

function isMatch(expected, got, tolerance) {
  if (expected === got) return true;
  if (tolerance === 'WARN' && expected === 'PASS' && got === 'WARN') return true;
  return false;
}

function isFalsePositive(expected, got, tolerance) {
  if (expected === 'PASS' && (got === 'ERROR' || got === 'WARN')) {
    if (tolerance === 'WARN' && got === 'WARN') return false;
    return true;
  }
  return false;
}

function isFalseNegative(expected, got) {
  if (expected === 'ERROR' && (got === 'PASS' || got === 'WARN')) return true;
  if (expected === 'WARN' && got === 'PASS') return true;
  return false;
}

// ── CLI ──

const args = process.argv.slice(2);
let groundTruthPath = null;
let consensus = 1;
let verbose = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ground-truth' && args[i + 1]) groundTruthPath = args[++i];
  else if (args[i] === '--consensus' && args[i + 1]) consensus = parseInt(args[++i], 10) || 1;
  else if (args[i] === '--verbose') verbose = true;
}

if (!groundTruthPath) {
  console.error('Usage: node scripts/test-vision-accuracy.mjs --ground-truth <path> [--consensus N] [--verbose]');
  process.exit(1);
}

const groundTruth = JSON.parse(fs.readFileSync(groundTruthPath, 'utf8'));
await runAccuracyTest(groundTruth, { consensus, verbose });
