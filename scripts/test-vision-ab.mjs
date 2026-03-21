#!/usr/bin/env node
/**
 * test-vision-ab.mjs — A/B test: Gemini Flash vs Claude Opus for Vision comparison
 *
 * Generates images once, then runs both models on the same image pairs.
 * Compares detection accuracy, false positive rate, and cost.
 *
 * Usage:
 *   node scripts/test-vision-ab.mjs \
 *     --slides-dir slides/ai-infra-investment \
 *     --pptx slides/ai-infra-investment/ai-infra-investment.pptx
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { createScreenshotBrowser, createScreenshotPage, captureSlideScreenshot }
  from '../src/editor/screenshot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const VISION_PROMPT = (slideNum) => `You are a strict visual fidelity reviewer for presentation slides.
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

Respond in JSON with these fields:
- layout_match (integer 1-5)
- layout_reason (string, only if layout_match <= 3)
- content_completeness (integer 1-5)
- content_reason (string, only if content_completeness <= 3)
- text_fidelity (integer 1-5)
- text_reason (string, only if text_fidelity <= 3)
- color_accuracy (integer 1-5)
- color_reason (string, only if color_accuracy <= 3)
- overall_fidelity (integer 1-5)
- overall_reason (string, only if overall_fidelity <= 3)
- differences (array of strings, one line each)`;

// --- Gemini API ---
async function callGemini(htmlBuf, pptxBuf, slideNum) {
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: 'image/png', data: htmlBuf.toString('base64') } },
        { inline_data: { mime_type: 'image/png', data: pptxBuf.toString('base64') } },
        { text: VISION_PROMPT(slideNum) },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          layout_match: { type: 'integer' }, layout_reason: { type: 'string' },
          content_completeness: { type: 'integer' }, content_reason: { type: 'string' },
          text_fidelity: { type: 'integer' }, text_reason: { type: 'string' },
          color_accuracy: { type: 'integer' }, color_reason: { type: 'string' },
          overall_fidelity: { type: 'integer' }, overall_reason: { type: 'string' },
          differences: { type: 'array', items: { type: 'string' } },
        },
        required: ['layout_match', 'content_completeness', 'text_fidelity', 'color_accuracy', 'overall_fidelity'],
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
      if (res.status === 429) { await new Promise(r => setTimeout(r, Math.pow(2, attempt + 1) * 2000)); continue; }
      if (!res.ok) return null;
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;
      return JSON.parse(text);
    } catch (err) {
      if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

// --- Claude Opus API ---
async function callOpus(htmlBuf, pptxBuf, slideNum) {
  const url = 'https://api.anthropic.com/v1/messages';

  const body = {
    model: 'claude-opus-4-20250514',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: htmlBuf.toString('base64') } },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pptxBuf.toString('base64') } },
        { type: 'text', text: VISION_PROMPT(slideNum) + '\n\nRespond ONLY with the JSON object, no markdown fences.' },
      ],
    }],
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      if (res.status === 429 || res.status === 529) {
        await new Promise(r => setTimeout(r, Math.pow(2, attempt + 1) * 3000));
        continue;
      }
      if (!res.ok) {
        const errText = await res.text();
        console.error(`  Opus API error (${res.status}): ${errText.slice(0, 200)}`);
        return null;
      }
      const data = await res.json();
      const text = data.content?.[0]?.text;
      if (!text) return null;
      // Extract JSON from potential markdown fences
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.warn(`  Opus attempt ${attempt + 1} error: ${err.message}`);
      if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
    }
  }
  return null;
}

function calcScore(scores) {
  return (scores.content_completeness || 0) * 1.5
       + (scores.text_fidelity || 0) * 1.5
       + (scores.layout_match || 0)
       + (scores.color_accuracy || 0)
       + (scores.overall_fidelity || 0);
}

function classifyScore(scores) {
  const total = calcScore(scores);
  const vals = [scores.layout_match, scores.content_completeness,
                scores.text_fidelity, scores.color_accuracy, scores.overall_fidelity];
  const minVal = Math.min(...vals);
  if (total < 18 || minVal <= 2) return 'ERROR';
  if (total < 24 || minVal === 3) return 'WARN';
  return 'PASS';
}

function printSlideResult(slideNum, scores, modelName) {
  if (!scores) { console.log(`  [${modelName}] Slide ${slideNum}: FAILED`); return; }
  const total = calcScore(scores);
  const level = classifyScore(scores);
  const icon = level === 'ERROR' ? 'ERROR' : level === 'WARN' ? 'WARN ' : 'PASS ';
  console.log(`  [${modelName}] Slide ${slideNum}: ${icon} (${total.toFixed(1)}/30) L=${scores.layout_match} C=${scores.content_completeness} T=${scores.text_fidelity} Co=${scores.color_accuracy} O=${scores.overall_fidelity}`);
  if (level !== 'PASS' && scores.differences?.length > 0) {
    for (const d of scores.differences) console.log(`    - ${d}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  let slidesDir = null, pptxPath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--slides-dir' && args[i + 1]) slidesDir = args[++i];
    if (args[i] === '--pptx' && args[i + 1]) pptxPath = args[++i];
  }

  if (!slidesDir || !pptxPath) {
    console.error('Usage: node scripts/test-vision-ab.mjs --slides-dir <dir> --pptx <file>');
    process.exit(1);
  }
  if (!GEMINI_API_KEY) { console.error('GEMINI_API_KEY required'); process.exit(1); }
  if (!ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY required'); process.exit(1); }

  slidesDir = path.resolve(slidesDir);
  pptxPath = path.resolve(pptxPath);

  const htmlFiles = fs.readdirSync(slidesDir).filter(f => /^slide-\d+\.html$/.test(f)).sort();
  console.log(`\n=== A/B Vision Test: Gemini Flash vs Claude Opus ===`);
  console.log(`Slides: ${htmlFiles.length}\n`);

  // Generate images once
  const tmpDir = path.join(slidesDir, '.vision-ab');
  const htmlDir = path.join(tmpDir, 'html');
  const pptxDir = path.join(tmpDir, 'pptx');
  fs.mkdirSync(htmlDir, { recursive: true });
  fs.mkdirSync(pptxDir, { recursive: true });

  console.log('Generating HTML screenshots...');
  const { browser } = await createScreenshotBrowser();
  const { context, page } = await createScreenshotPage(browser);
  for (const file of htmlFiles) {
    await captureSlideScreenshot(page, file, path.join(htmlDir, file.replace('.html', '.png')), slidesDir);
  }
  await context.close();
  await browser.close();

  console.log('Exporting PPTX as PNG...');
  const psResult = spawnSync('powershell', [
    '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'export-slides-png.ps1'),
    '-PptxPath', pptxPath, '-OutputDir', pptxDir, '-Width', '1600', '-Height', '900',
  ], { encoding: 'utf8', timeout: 120000 });
  if (psResult.status !== 0) { console.error('PowerPoint export failed'); process.exit(1); }

  // Run both models
  const geminiResults = [];
  const opusResults = [];

  console.log('\n--- Running comparisons ---\n');

  for (const file of htmlFiles) {
    const slideNum = parseInt(file.match(/\d+/)[0], 10);
    const htmlBuf = fs.readFileSync(path.join(htmlDir, file.replace('.html', '.png')));
    const pptxBuf = fs.readFileSync(path.join(pptxDir, `slide_${String(slideNum).padStart(2, '0')}.png`));

    console.log(`Slide ${slideNum}:`);

    // Gemini
    const gScores = await callGemini(htmlBuf, pptxBuf, slideNum);
    printSlideResult(slideNum, gScores, 'Gemini');
    geminiResults.push({ slide: slideNum, scores: gScores, total: gScores ? calcScore(gScores) : null, level: gScores ? classifyScore(gScores) : null });

    await new Promise(r => setTimeout(r, 500));

    // Opus
    const oScores = await callOpus(htmlBuf, pptxBuf, slideNum);
    printSlideResult(slideNum, oScores, 'Opus  ');
    opusResults.push({ slide: slideNum, scores: oScores, total: oScores ? calcScore(oScores) : null, level: oScores ? classifyScore(oScores) : null });

    await new Promise(r => setTimeout(r, 1000));
    console.log('');
  }

  // Summary comparison
  console.log('=== A/B Summary ===\n');
  console.log('Slide | Gemini          | Opus');
  console.log('------|-----------------|----------------');

  for (let i = 0; i < htmlFiles.length; i++) {
    const g = geminiResults[i];
    const o = opusResults[i];
    const gStr = g.scores ? `${g.level.padEnd(5)} ${g.total.toFixed(1)}` : 'FAIL';
    const oStr = o.scores ? `${o.level.padEnd(5)} ${o.total.toFixed(1)}` : 'FAIL';
    const match = g.level === o.level ? '  ' : ' *';
    console.log(`  ${String(g.slide).padStart(2)}  | ${gStr.padEnd(15)} | ${oStr}${match}`);
  }

  const gValid = geminiResults.filter(r => r.scores);
  const oValid = opusResults.filter(r => r.scores);
  const gAvg = gValid.length > 0 ? gValid.reduce((s, r) => s + r.total, 0) / gValid.length : 0;
  const oAvg = oValid.length > 0 ? oValid.reduce((s, r) => s + r.total, 0) / oValid.length : 0;

  console.log(`\nGemini: avg ${gAvg.toFixed(1)}/30 | PASS ${gValid.filter(r=>r.level==='PASS').length} WARN ${gValid.filter(r=>r.level==='WARN').length} ERROR ${gValid.filter(r=>r.level==='ERROR').length}`);
  console.log(`Opus:   avg ${oAvg.toFixed(1)}/30 | PASS ${oValid.filter(r=>r.level==='PASS').length} WARN ${oValid.filter(r=>r.level==='WARN').length} ERROR ${oValid.filter(r=>r.level==='ERROR').length}`);
  console.log(`\n* = different classification`);

  // Save results
  const outPath = path.join(tmpDir, 'ab-results.json');
  fs.writeFileSync(outPath, JSON.stringify({ gemini: geminiResults, opus: opusResults }, null, 2));
  console.log(`\nResults: ${outPath}`);
  console.log(`Cleanup: rm -rf "${tmpDir}"`);
}

main().catch(err => { console.error(err); process.exit(1); });
