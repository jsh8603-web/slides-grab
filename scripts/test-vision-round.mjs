#!/usr/bin/env node
/**
 * test-vision-round.mjs — Run a single round of 3-model vision test
 *
 * Reuses pre-generated images from .vision-5round/ directory.
 * Designed to run multiple instances in parallel (one per round).
 *
 * Usage:
 *   node scripts/test-vision-round.mjs --slides-dir slides/ai-infra-investment --round R3_visual
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// --- Prompt Variants ---
const PROMPTS = {
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

const ROUND_LABELS = {
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
      if (!res.ok) { console.error(`  [${round}] Opus ${res.status}: ${(await res.text()).slice(0, 100)}`); return null; }
      const data = await res.json();
      const text = data.content?.[0]?.text;
      if (!text) return null;
      const m = text.match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) : null;
    } catch (err) { console.warn(`  Opus err: ${err.message}`); if (attempt < 2) await new Promise(r => setTimeout(r, 3000)); }
  }
  return null;
}

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

// --- Main ---
const args = process.argv.slice(2);
let slidesDir = null, round = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--slides-dir' && args[i+1]) slidesDir = args[++i];
  if (args[i] === '--round' && args[i+1]) round = args[++i];
}
if (!slidesDir || !round || !PROMPTS[round]) {
  console.error(`Usage: --slides-dir <dir> --round <${Object.keys(PROMPTS).join('|')}>`);
  process.exit(1);
}
if (!GEMINI_API_KEY || !ANTHROPIC_API_KEY) { console.error('GEMINI_API_KEY and ANTHROPIC_API_KEY required'); process.exit(1); }

slidesDir = path.resolve(slidesDir);
const tmpDir = path.join(slidesDir, '.vision-5round');
const htmlDir = path.join(tmpDir, 'html');
const pptxDir = path.join(tmpDir, 'pptx');

if (!fs.existsSync(htmlDir) || !fs.existsSync(pptxDir)) {
  console.error(`Images not found in ${tmpDir}. Run test-vision-5round.mjs first to generate images, or generate manually.`);
  process.exit(1);
}

const htmlFiles = fs.readdirSync(slidesDir).filter(f => /^slide-\d+\.html$/.test(f)).sort();
const images = htmlFiles.map(f => {
  const n = parseInt(f.match(/\d+/)[0], 10);
  return {
    slideNum: n,
    html: fs.readFileSync(path.join(htmlDir, f.replace('.html', '.png'))),
    pptx: fs.readFileSync(path.join(pptxDir, `slide_${String(n).padStart(2,'0')}.png`)),
  };
});

console.log(`\n--- ${round}: ${ROUND_LABELS[round]} (${images.length} slides × 3 models) ---\n`);

const results = { Flash: [], Pro: [], Opus: [] };

for (const img of images) {
  const prompt = PROMPTS[round](img.slideNum);
  process.stdout.write(`  Slide ${String(img.slideNum).padStart(2)}: `);

  // Run 3 models in parallel per slide
  const [fScores, pScores, oScores] = await Promise.all([
    callGemini('gemini-2.5-flash', img.html, img.pptx, prompt),
    callGemini('gemini-2.5-pro', img.html, img.pptx, prompt),
    callOpus(img.html, img.pptx, prompt),
  ]);

  const fmt = (scores, label) => {
    const level = scores ? classify(scores) : 'FAIL';
    const total = scores ? calcScore(scores) : 0;
    results[label].push({ slide: img.slideNum, scores, total, level });
    return `${label[0]}=${level === 'FAIL' ? '--' : total.toFixed(0).padStart(2)}`;
  };

  const fStr = fmt(fScores, 'Flash');
  const pStr = fmt(pScores, 'Pro');
  const oStr = fmt(oScores, 'Opus');

  const levels = [results.Flash.at(-1).level, results.Pro.at(-1).level, results.Opus.at(-1).level];
  console.log(`${fStr} ${pStr} ${oStr}${new Set(levels).size > 1 ? '  *' : ''}`);

  await new Promise(r => setTimeout(r, 300));
}

// Summary
console.log(`\n--- ${round} Summary ---`);
for (const model of ['Flash', 'Pro', 'Opus']) {
  const data = results[model].filter(r => r.scores);
  const avg = data.length > 0 ? data.reduce((s,r) => s + r.total, 0) / data.length : 0;
  const e = data.filter(r => r.level === 'ERROR').length;
  const w = data.filter(r => r.level === 'WARN').length;
  const p = data.filter(r => r.level === 'PASS').length;
  console.log(`  ${model.padEnd(6)}: avg ${avg.toFixed(1)} | P=${p} W=${w} E=${e}`);
}

// Save results
const outPath = path.join(tmpDir, `results-${round}.json`);
fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`\nResults saved: ${outPath}`);
