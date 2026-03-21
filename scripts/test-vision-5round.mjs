#!/usr/bin/env node
/**
 * test-vision-5round.mjs — 5-round A/B/C test across 3 models
 *
 * Models: Gemini Flash, Gemini Pro, Claude Opus
 * 5 rounds with different prompt focus areas to test detection across error categories.
 *
 * Usage:
 *   node scripts/test-vision-5round.mjs \
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

// --- 5 Prompt Variants ---
const PROMPTS = {
  R1_general: (n) => `You are a strict visual fidelity reviewer for presentation slides.
Compare these two images of the SAME slide (slide ${n}):
[IMAGE 1] Original HTML rendering (source of truth)
[IMAGE 2] Exported PPTX rendering (being evaluated)

Rate PPTX fidelity on each criterion (1-5, where 5=identical):
- layout_match: Element positioning, spacing, proportions
- content_completeness: Are ALL visual elements present? (charts, images, shapes, decorations). Missing element = score 1
- text_fidelity: Text content accuracy, line wrapping, spacing between words
- color_accuracy: Backgrounds, text colors, gradients preserved?
- overall_fidelity: Holistic — would a presenter notice?

ACCEPTABLE (score 4+): subtle font weight/antialiasing, 1-2px border variation, minor saturation shift
UNACCEPTABLE (score <=3): missing/added spaces, wrong line breaks, missing elements, text size change, content shift

For criterion <=3, provide {criterion}_reason. List differences in "differences" array.`,

  R2_text: (n) => `You are a text fidelity specialist reviewing slide conversions.
Compare these two images of slide ${n}:
[IMAGE 1] Original HTML (source of truth)
[IMAGE 2] Exported PPTX (being evaluated)

FOCUS ON TEXT ISSUES — rate each 1-5 (5=identical):
- layout_match: Are text blocks in the same position?
- content_completeness: Is any text content missing entirely?
- text_fidelity: THIS IS YOUR PRIMARY FOCUS.
  Check carefully for:
  * Missing or added SPACES between characters/words (e.g. "AI인프라" vs "AI 인프라")
  * Wrong line breaks that split words (e.g. "중심축이\\n다" vs "중심축이다")
  * Text truncation or overflow
  * Font size noticeably different
  Score 1-2 for any space/break issue. Score 4 for minor font rendering differences.
- color_accuracy: Text color preserved?
- overall_fidelity: Overall text readability impact

For criterion <=3, provide {criterion}_reason. List differences in "differences" array.`,

  R3_visual: (n) => `You are a visual element specialist reviewing slide conversions.
Compare these two images of slide ${n}:
[IMAGE 1] Original HTML (source of truth)
[IMAGE 2] Exported PPTX (being evaluated)

FOCUS ON VISUAL ELEMENTS — rate each 1-5 (5=identical):
- layout_match: Element positioning and spacing
- content_completeness: THIS IS YOUR PRIMARY FOCUS.
  Check carefully for:
  * Missing shapes, icons, decorative elements
  * Missing underlines, borders, dividers
  * Missing or broken charts/graphs
  * Missing background patterns or gradients
  * Images not rendering or wrong size
  Score 1 if any element is completely missing.
- text_fidelity: Text content present and readable?
- color_accuracy: Colors of visual elements preserved?
- overall_fidelity: Would missing elements confuse the audience?

For criterion <=3, provide {criterion}_reason. List differences in "differences" array.`,

  R4_color: (n) => `You are a color accuracy specialist reviewing slide conversions.
Compare these two images of slide ${n}:
[IMAGE 1] Original HTML (source of truth)
[IMAGE 2] Exported PPTX (being evaluated)

FOCUS ON COLOR AND STYLING — rate each 1-5 (5=identical):
- layout_match: Positioning preserved?
- content_completeness: All elements present?
- text_fidelity: Text readable and correct?
- color_accuracy: THIS IS YOUR PRIMARY FOCUS.
  Check carefully for:
  * Text color changes (e.g. blue text becoming black)
  * Background color shifts beyond minor saturation
  * Accent/highlight colors wrong or missing
  * Gradient direction or stops changed
  * Colored borders/underlines changed or removed
  Score 1-2 if colored text becomes a different color. Score 4 for minor saturation shifts only.
- overall_fidelity: Would color changes mislead the audience?

For criterion <=3, provide {criterion}_reason. List differences in "differences" array.`,

  R5_strict: (n) => `You are an extremely strict visual QA reviewer. Your job is to find ANY difference.
Compare these two images of slide ${n}:
[IMAGE 1] Original HTML (source of truth)
[IMAGE 2] Exported PPTX (being evaluated)

Be VERY strict. Rate each 1-5 (5=pixel-perfect identical):
- layout_match: ANY positioning difference = score 3 or below
- content_completeness: ANY missing element = score 1
- text_fidelity: ANY text difference (spacing, wrapping, size) = score 2 or below
- color_accuracy: ANY color change = score 3 or below
- overall_fidelity: Would you approve this for a CEO presentation?

You MUST find at least one difference — these are different rendering engines so there will always be some.
For criterion <=3, provide {criterion}_reason. List ALL differences in "differences" array, no matter how small.`,
};

const ROUND_NAMES = ['R1_general', 'R2_text', 'R3_visual', 'R4_color', 'R5_strict'];
const ROUND_LABELS = {
  R1_general: 'General baseline',
  R2_text: 'Text focus',
  R3_visual: 'Visual elements focus',
  R4_color: 'Color/styling focus',
  R5_strict: 'Ultra-strict',
};

const JSON_SUFFIX = `

Respond in JSON with these exact fields:
- layout_match (integer 1-5)
- layout_reason (string, only if <= 3)
- content_completeness (integer 1-5)
- content_reason (string, only if <= 3)
- text_fidelity (integer 1-5)
- text_reason (string, only if <= 3)
- color_accuracy (integer 1-5)
- color_reason (string, only if <= 3)
- overall_fidelity (integer 1-5)
- overall_reason (string, only if <= 3)
- differences (array of short strings)`;

// --- API Callers ---
async function callGemini(model, htmlBuf, pptxBuf, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{ parts: [
      { inline_data: { mime_type: 'image/png', data: htmlBuf.toString('base64') } },
      { inline_data: { mime_type: 'image/png', data: pptxBuf.toString('base64') } },
      { text: prompt + JSON_SUFFIX },
    ]}],
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
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.status === 429) { await new Promise(r => setTimeout(r, Math.pow(2, attempt + 1) * 2000)); continue; }
      if (!res.ok) return null;
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      return text ? JSON.parse(text) : null;
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 2000)); }
  }
  return null;
}

async function callOpus(htmlBuf, pptxBuf, prompt) {
  const body = {
    model: 'claude-opus-4-20250514',
    max_tokens: 2048,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: htmlBuf.toString('base64') } },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pptxBuf.toString('base64') } },
      { type: 'text', text: prompt + JSON_SUFFIX + '\n\nRespond ONLY with the JSON object, no markdown.' },
    ]}],
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
      });
      if (res.status === 429 || res.status === 529) { await new Promise(r => setTimeout(r, Math.pow(2, attempt + 1) * 3000)); continue; }
      if (!res.ok) { console.error(`  Opus ${res.status}: ${(await res.text()).slice(0, 100)}`); return null; }
      const data = await res.json();
      const text = data.content?.[0]?.text;
      if (!text) return null;
      const m = text.match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) : null;
    } catch (err) { console.warn(`  Opus err: ${err.message}`); if (attempt < 2) await new Promise(r => setTimeout(r, 3000)); }
  }
  return null;
}

// --- Scoring ---
function calcScore(s) {
  return (s.content_completeness||0)*1.5 + (s.text_fidelity||0)*1.5 + (s.layout_match||0) + (s.color_accuracy||0) + (s.overall_fidelity||0);
}
function classify(s) {
  const t = calcScore(s);
  const min = Math.min(s.layout_match, s.content_completeness, s.text_fidelity, s.color_accuracy, s.overall_fidelity);
  if (t < 18 || min <= 2) return 'ERROR';
  if (t < 24 || min === 3) return 'WARN';
  return 'PASS';
}

async function main() {
  const args = process.argv.slice(2);
  let slidesDir = null, pptxPath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--slides-dir' && args[i+1]) slidesDir = args[++i];
    if (args[i] === '--pptx' && args[i+1]) pptxPath = args[++i];
  }
  if (!slidesDir || !pptxPath) { console.error('Usage: --slides-dir <dir> --pptx <file>'); process.exit(1); }
  if (!GEMINI_API_KEY || !ANTHROPIC_API_KEY) { console.error('GEMINI_API_KEY and ANTHROPIC_API_KEY required'); process.exit(1); }

  slidesDir = path.resolve(slidesDir);
  pptxPath = path.resolve(pptxPath);
  const htmlFiles = fs.readdirSync(slidesDir).filter(f => /^slide-\d+\.html$/.test(f)).sort();

  console.log(`\n=== 5-Round Vision Test: Flash vs Pro vs Opus ===`);
  console.log(`Slides: ${htmlFiles.length}, Rounds: 5, Total calls: ${htmlFiles.length * 5 * 3}\n`);

  // Generate images once
  const tmpDir = path.join(slidesDir, '.vision-5round');
  const htmlDir = path.join(tmpDir, 'html');
  const pptxDir = path.join(tmpDir, 'pptx');
  fs.mkdirSync(htmlDir, { recursive: true });
  fs.mkdirSync(pptxDir, { recursive: true });

  console.log('Generating images (one-time)...');
  const { browser } = await createScreenshotBrowser();
  const { context, page } = await createScreenshotPage(browser);
  for (const f of htmlFiles) await captureSlideScreenshot(page, f, path.join(htmlDir, f.replace('.html', '.png')), slidesDir);
  await context.close();
  await browser.close();

  const psR = spawnSync('powershell', ['-ExecutionPolicy','Bypass','-File',path.join(__dirname,'export-slides-png.ps1'),
    '-PptxPath',pptxPath,'-OutputDir',pptxDir,'-Width','1600','-Height','900'], { encoding:'utf8', timeout:120000 });
  if (psR.status !== 0) { console.error('PPT export failed'); process.exit(1); }
  console.log('Images ready.\n');

  // Load all image buffers
  const images = htmlFiles.map(f => {
    const n = parseInt(f.match(/\d+/)[0], 10);
    return {
      slideNum: n,
      html: fs.readFileSync(path.join(htmlDir, f.replace('.html', '.png'))),
      pptx: fs.readFileSync(path.join(pptxDir, `slide_${String(n).padStart(2,'0')}.png`)),
    };
  });

  // Run 5 rounds × 3 models
  const allResults = {}; // { roundName: { modelName: [{slide, scores, total, level}] } }

  for (const round of ROUND_NAMES) {
    console.log(`\n--- ${round}: ${ROUND_LABELS[round]} ---\n`);
    allResults[round] = { Flash: [], Pro: [], Opus: [] };

    for (const img of images) {
      const prompt = PROMPTS[round](img.slideNum);
      process.stdout.write(`  Slide ${String(img.slideNum).padStart(2)}: `);

      // Flash
      const fScores = await callGemini('gemini-2.5-flash', img.html, img.pptx, prompt);
      const fLevel = fScores ? classify(fScores) : 'FAIL';
      const fTotal = fScores ? calcScore(fScores) : 0;
      allResults[round].Flash.push({ slide: img.slideNum, scores: fScores, total: fTotal, level: fLevel });
      process.stdout.write(`F=${fLevel === 'FAIL' ? '--' : fTotal.toFixed(0).padStart(2)} `);

      await new Promise(r => setTimeout(r, 300));

      // Pro
      const pScores = await callGemini('gemini-2.5-pro', img.html, img.pptx, prompt);
      const pLevel = pScores ? classify(pScores) : 'FAIL';
      const pTotal = pScores ? calcScore(pScores) : 0;
      allResults[round].Pro.push({ slide: img.slideNum, scores: pScores, total: pTotal, level: pLevel });
      process.stdout.write(`P=${pLevel === 'FAIL' ? '--' : pTotal.toFixed(0).padStart(2)} `);

      await new Promise(r => setTimeout(r, 300));

      // Opus
      const oScores = await callOpus(img.html, img.pptx, prompt);
      const oLevel = oScores ? classify(oScores) : 'FAIL';
      const oTotal = oScores ? calcScore(oScores) : 0;
      allResults[round].Opus.push({ slide: img.slideNum, scores: oScores, total: oTotal, level: oLevel });
      process.stdout.write(`O=${oLevel === 'FAIL' ? '--' : oTotal.toFixed(0).padStart(2)}`);

      console.log(fLevel !== pLevel || pLevel !== oLevel ? '  *' : '');

      await new Promise(r => setTimeout(r, 500));
    }
  }

  // --- Grand Summary ---
  console.log('\n\n========== GRAND SUMMARY ==========\n');

  const models = ['Flash', 'Pro', 'Opus'];

  // Per-round summary
  for (const round of ROUND_NAMES) {
    console.log(`${round} (${ROUND_LABELS[round]}):`);
    for (const model of models) {
      const data = allResults[round][model].filter(r => r.scores);
      const avg = data.length > 0 ? data.reduce((s,r) => s + r.total, 0) / data.length : 0;
      const e = data.filter(r => r.level === 'ERROR').length;
      const w = data.filter(r => r.level === 'WARN').length;
      const p = data.filter(r => r.level === 'PASS').length;
      console.log(`  ${model.padEnd(6)}: avg ${avg.toFixed(1)} | P=${p} W=${w} E=${e}`);
    }
    console.log('');
  }

  // Cross-round average per model
  console.log('--- Overall (5-round average) ---');
  for (const model of models) {
    let totalScore = 0, count = 0;
    let totalE = 0, totalW = 0, totalP = 0;
    for (const round of ROUND_NAMES) {
      for (const r of allResults[round][model]) {
        if (r.scores) { totalScore += r.total; count++; }
        if (r.level === 'ERROR') totalE++;
        if (r.level === 'WARN') totalW++;
        if (r.level === 'PASS') totalP++;
      }
    }
    const avg = count > 0 ? totalScore / count : 0;
    console.log(`  ${model.padEnd(6)}: avg ${avg.toFixed(1)}/30 | PASS ${totalP}/${count} WARN ${totalW} ERROR ${totalE} (across ${ROUND_NAMES.length} rounds × ${htmlFiles.length} slides)`);
  }

  // Per-slide disagreement matrix
  console.log('\n--- Slide-level disagreements (any round where models differ) ---');
  let disagreeCount = 0;
  for (const img of images) {
    const slideDisagrees = [];
    for (const round of ROUND_NAMES) {
      const levels = models.map(m => {
        const r = allResults[round][m].find(x => x.slide === img.slideNum);
        return r?.level || 'FAIL';
      });
      if (new Set(levels).size > 1) {
        slideDisagrees.push(`${round}: F=${levels[0]} P=${levels[1]} O=${levels[2]}`);
        disagreeCount++;
      }
    }
    if (slideDisagrees.length > 0) {
      console.log(`  Slide ${img.slideNum}: ${slideDisagrees.join(' | ')}`);
    }
  }
  if (disagreeCount === 0) console.log('  None — all models agree on all slides in all rounds.');
  console.log(`\n  Total disagreements: ${disagreeCount} / ${ROUND_NAMES.length * htmlFiles.length}`);

  // Save full results
  const outPath = path.join(tmpDir, 'results-5round.json');
  fs.writeFileSync(outPath, JSON.stringify(allResults, null, 2));
  console.log(`\nFull results: ${outPath}`);
  console.log(`Cleanup: rm -rf "${tmpDir}"`);
}

main().catch(err => { console.error(err); process.exit(1); });
