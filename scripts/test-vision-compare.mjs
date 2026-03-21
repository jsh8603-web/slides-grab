#!/usr/bin/env node
/**
 * test-vision-compare.mjs — Test Vision-based COM comparison
 *
 * Runs Gemini Vision comparison on HTML screenshots vs PPTX renderings.
 * Used to evaluate Vision identification capability before production integration.
 *
 * Usage:
 *   node scripts/test-vision-compare.mjs \
 *     --slides-dir slides/ai-infra-investment \
 *     --pptx slides/ai-infra-investment/ai-infra-investment.pptx \
 *     [--round A|B] [--verbose]
 *
 * Round A: Only PF/VP error slides (requires prior --full run data)
 * Round B: All slides (default)
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { createScreenshotBrowser, createScreenshotPage, captureSlideScreenshot }
  from '../src/editor/screenshot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

function parseArgs(args) {
  const opts = { slidesDir: null, pptx: null, round: 'B', verbose: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--slides-dir' && args[i + 1]) opts.slidesDir = args[++i];
    if (args[i] === '--pptx' && args[i + 1]) opts.pptx = args[++i];
    if (args[i] === '--round' && args[i + 1]) opts.round = args[++i].toUpperCase();
    if (args[i] === '--verbose') opts.verbose = true;
  }
  return opts;
}

/**
 * Call Gemini Vision to compare two images.
 * Returns structured scoring object or null on failure.
 */
async function compareWithVision(htmlImageBuffer, pptxImageBuffer, slideNum, pfVpContext = '') {
  if (!GEMINI_API_KEY) return null;

  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  let contextBlock = '';
  if (pfVpContext) {
    contextBlock = `\nIMPORTANT: Pre-conversion validators flagged these issues on this slide.
Pay EXTRA attention to these areas and verify if visible:
${pfVpContext}`;
  }

  const systemPrompt = `You are a strict visual fidelity reviewer for presentation slides.
Compare these two images of the SAME slide (slide ${slideNum}):
[IMAGE 1] Original HTML rendering (the source of truth)
[IMAGE 2] Exported PPTX rendering (being evaluated)

Rate PPTX fidelity on each criterion (1-5, where 5=identical):

- layout_match: Element positioning, spacing, proportions
- content_completeness: Are ALL visual elements present? (charts, images, shapes, decorations)
  → Most critical: elements completely missing = score 1
- text_fidelity: Text content accuracy, line wrapping, spacing between words, readability
  → CRITICAL issues (score 1-2): missing/added spaces between words, wrong line breaks that change meaning, text truncation
  → Minor issues (score 4): subtle font weight or letter-spacing differences from rendering engine
- color_accuracy: Backgrounds, text colors, gradients preserved?
- overall_fidelity: Holistic assessment — would a presenter notice the difference?

ACCEPTABLE differences (do NOT penalize below 4):
- Subtle font weight/antialiasing differences (HTML vs PowerPoint rendering engines differ)
- Border/line thickness variations within 1-2px
- Minor color saturation shifts in backgrounds

UNACCEPTABLE differences (score 3 or below):
- Missing or added spaces between words/characters
- Wrong line breaks that split words incorrectly
- Missing visual elements (shapes, charts, decorations, underlines)
- Text noticeably smaller or larger than original
- Content shifted significantly from intended position

For any criterion <= 3, provide {criterion}_reason describing the specific difference.
List all noticeable differences in "differences" array (be concise, one line each).
${contextBlock}`;

  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: 'image/png', data: htmlImageBuffer.toString('base64') } },
        { inline_data: { mime_type: 'image/png', data: pptxImageBuffer.toString('base64') } },
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
        required: ['layout_match', 'content_completeness', 'text_fidelity',
                    'color_accuracy', 'overall_fidelity'],
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
      if (!res.ok) {
        const errText = await res.text();
        console.error(`  Vision API error (${res.status}): ${errText.slice(0, 200)}`);
        return null;
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;

      return JSON.parse(text);
    } catch (err) {
      console.warn(`  Vision attempt ${attempt + 1} error: ${err.message}`);
      if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

/**
 * Calculate weighted total score.
 * Weights: content_completeness 1.5x, text_fidelity 1.5x, others 1.0x
 * Max: 5*1.5 + 5*1.5 + 5 + 5 + 5 = 30.0
 */
function calcScore(scores) {
  return (scores.content_completeness || 0) * 1.5
       + (scores.text_fidelity || 0) * 1.5
       + (scores.layout_match || 0)
       + (scores.color_accuracy || 0)
       + (scores.overall_fidelity || 0);
}

/**
 * Determine level from scores.
 */
function classifyScore(scores) {
  const total = calcScore(scores);
  const vals = [scores.layout_match, scores.content_completeness,
                scores.text_fidelity, scores.color_accuracy, scores.overall_fidelity];
  const minVal = Math.min(...vals);

  if (total < 18 || minVal <= 2) return 'ERROR';
  if (total < 24 || minVal === 3) return 'WARN';
  return 'PASS';
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.slidesDir || !opts.pptx) {
    console.error('Usage: node scripts/test-vision-compare.mjs --slides-dir <dir> --pptx <file> [--round A|B]');
    process.exit(1);
  }
  if (!GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY environment variable required.');
    process.exit(1);
  }

  const slidesDir = path.resolve(opts.slidesDir);
  const pptxPath = path.resolve(opts.pptx);

  // Collect HTML slide files
  const htmlFiles = fs.readdirSync(slidesDir)
    .filter(f => /^slide-\d+\.html$/.test(f))
    .sort();

  if (htmlFiles.length === 0) {
    console.error('No slide-*.html files found in', slidesDir);
    process.exit(1);
  }

  console.log(`\n=== Vision Compare Test ===`);
  console.log(`Slides: ${htmlFiles.length} in ${slidesDir}`);
  console.log(`PPTX: ${pptxPath}`);
  console.log(`Round: ${opts.round}\n`);

  // Step 1: Generate HTML screenshots
  const htmlDir = path.join(slidesDir, '.vision-compare', 'html');
  const pptxDir = path.join(slidesDir, '.vision-compare', 'pptx');
  fs.mkdirSync(htmlDir, { recursive: true });
  fs.mkdirSync(pptxDir, { recursive: true });

  console.log('Step 1: Generating HTML screenshots...');
  const { browser } = await createScreenshotBrowser();
  const { context, page } = await createScreenshotPage(browser);

  for (const file of htmlFiles) {
    const outPath = path.join(htmlDir, file.replace('.html', '.png'));
    await captureSlideScreenshot(page, file, outPath, slidesDir);
    process.stdout.write(`  ${file} -> PNG\n`);
  }
  await context.close();
  await browser.close();

  // Step 2: Export PPTX slides as PNG via PowerPoint COM
  console.log('\nStep 2: Exporting PPTX slides as PNG (PowerPoint COM)...');
  const ps1Path = path.join(__dirname, 'export-slides-png.ps1');
  const psResult = spawnSync('powershell', [
    '-ExecutionPolicy', 'Bypass',
    '-File', ps1Path,
    '-PptxPath', pptxPath,
    '-OutputDir', pptxDir,
    '-Width', '1600',
    '-Height', '900',
  ], { encoding: 'utf8', timeout: 120000 });

  if (psResult.status !== 0) {
    console.error('PowerPoint export failed:', psResult.stderr || psResult.stdout);
    process.exit(1);
  }
  console.log(psResult.stdout);

  // Step 3: Run Vision comparison
  console.log('Step 3: Running Gemini Vision comparison...\n');

  const results = [];
  for (const file of htmlFiles) {
    const slideNum = parseInt(file.match(/\d+/)[0], 10);
    const htmlPng = path.join(htmlDir, file.replace('.html', '.png'));
    const pptxPng = path.join(pptxDir, `slide_${String(slideNum).padStart(2, '0')}.png`);

    if (!fs.existsSync(htmlPng) || !fs.existsSync(pptxPng)) {
      console.warn(`  Skipping slide ${slideNum}: missing images`);
      results.push({ slide: slideNum, skipped: true });
      continue;
    }

    process.stdout.write(`  Slide ${slideNum}... `);
    const htmlBuf = fs.readFileSync(htmlPng);
    const pptxBuf = fs.readFileSync(pptxPng);

    const scores = await compareWithVision(htmlBuf, pptxBuf, slideNum);
    if (!scores) {
      console.log('FAILED (API error)');
      results.push({ slide: slideNum, error: true });
      continue;
    }

    const total = calcScore(scores);
    const level = classifyScore(scores);
    const icon = level === 'ERROR' ? 'ERROR' : level === 'WARN' ? 'WARN ' : 'PASS ';
    console.log(`${icon} (${total.toFixed(1)}/30.0)`);

    if (opts.verbose || level !== 'PASS') {
      console.log(`    layout=${scores.layout_match} content=${scores.content_completeness} text=${scores.text_fidelity} color=${scores.color_accuracy} overall=${scores.overall_fidelity}`);
      if (scores.layout_reason) console.log(`    layout: ${scores.layout_reason}`);
      if (scores.content_reason) console.log(`    content: ${scores.content_reason}`);
      if (scores.text_reason) console.log(`    text: ${scores.text_reason}`);
      if (scores.color_reason) console.log(`    color: ${scores.color_reason}`);
      if (scores.overall_reason) console.log(`    overall: ${scores.overall_reason}`);
      if (scores.differences?.length > 0) {
        console.log(`    differences:`);
        for (const d of scores.differences) console.log(`      - ${d}`);
      }
    }

    results.push({ slide: slideNum, scores, total, level });

    // Rate limit between slides
    await new Promise(r => setTimeout(r, 1000));
  }

  // Summary
  console.log('\n=== Summary ===\n');
  const valid = results.filter(r => !r.skipped && !r.error);
  const errors = valid.filter(r => r.level === 'ERROR');
  const warns = valid.filter(r => r.level === 'WARN');
  const passes = valid.filter(r => r.level === 'PASS');

  console.log(`Total: ${htmlFiles.length} slides`);
  console.log(`  PASS:  ${passes.length}`);
  console.log(`  WARN:  ${warns.length}`);
  console.log(`  ERROR: ${errors.length}`);
  console.log(`  Skip:  ${results.filter(r => r.skipped || r.error).length}`);

  if (valid.length > 0) {
    const avg = valid.reduce((s, r) => s + r.total, 0) / valid.length;
    console.log(`  Average score: ${avg.toFixed(1)}/30.0`);
  }

  // Write results JSON
  const outJson = path.join(slidesDir, '.vision-compare', 'results.json');
  fs.writeFileSync(outJson, JSON.stringify(results, null, 2));
  console.log(`\nResults saved: ${outJson}`);

  // Cleanup hint
  console.log(`\nTo clean up: rm -rf "${path.join(slidesDir, '.vision-compare')}"`);
}

main().catch(err => { console.error(err); process.exit(1); });
