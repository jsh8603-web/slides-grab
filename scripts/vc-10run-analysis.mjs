#!/usr/bin/env node
/**
 * vc-10run-analysis.mjs — Run VC 10 times, analyze co-firing patterns
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CRITERIA = ['layout_match','content_completeness','text_fidelity','color_accuracy','overall_fidelity'];
const SHORT = { layout_match:'LM', content_completeness:'CC', text_fidelity:'TF', color_accuracy:'CA', overall_fidelity:'OF' };
const RUNS = parseInt(process.argv[2] || '10', 10);

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
  3 = Noticeable difference that a presenter would spot
  1-2 = Critical: missing element, text truncated, semantic color lost

IMPORTANT:
- HTML and PPTX use DIFFERENT rendering engines. Font weight, antialiasing, and minor saturation shifts are EXPECTED and should score 4-5.
- If you cannot clearly see a difference at normal viewing distance, it is NOT an issue.
- Color accuracy: only score <=3 if a SEMANTIC color distinction is lost.

Provide brief {criterion}_reason for EVERY score. List confirmed differences in "differences" array.`;

  const body = {
    contents: [{ parts: [
      { inline_data: { mime_type: 'image/png', data: htmlBuf.toString('base64') } },
      { inline_data: { mime_type: 'image/png', data: pptxBuf.toString('base64') } },
      { text: systemPrompt },
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
        required: ['layout_match','layout_reason','content_completeness','content_reason',
                    'text_fidelity','text_reason','color_accuracy','color_reason',
                    'overall_fidelity','overall_reason','differences'],
      },
    },
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (res.status === 429) { await new Promise(r => setTimeout(r, Math.pow(2, attempt+1) * 2000)); continue; }
      if (!res.ok) return null;
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;
      return JSON.parse(text);
    } catch { if (attempt < 2) await new Promise(r => setTimeout(r, 2000)); }
  }
  return null;
}

async function main() {
  const slidesDir = path.resolve(PROJECT_ROOT, 'slides/ai-infra-investment');
  const pptxPath = path.resolve(PROJECT_ROOT, 'slides/ai-infra-investment/ai-infra-investment.pptx');

  // Prepare images once
  const tmpDir = path.join(slidesDir, '.vc-10run');
  const htmlImgDir = path.join(tmpDir, 'html');
  const pptxImgDir = path.join(tmpDir, 'pptx');
  fs.mkdirSync(htmlImgDir, { recursive: true });
  fs.mkdirSync(pptxImgDir, { recursive: true });

  const mod = await import('../src/editor/screenshot.js');
  const { browser } = await mod.createScreenshotBrowser();
  const { context, page } = await mod.createScreenshotPage(browser);
  const htmlFiles = fs.readdirSync(slidesDir).filter(f => /^slide-\d+\.html$/.test(f)).sort();
  for (const file of htmlFiles) {
    await (await import('../src/editor/screenshot.js')).captureSlideScreenshot(
      page, file, path.join(htmlImgDir, file.replace('.html', '.png')), slidesDir
    );
  }
  await context.close();
  await browser.close();

  const psResult = spawnSync('powershell', [
    '-ExecutionPolicy', 'Bypass', '-File', path.join(PROJECT_ROOT, 'scripts/export-slides-png.ps1'),
    '-PptxPath', pptxPath, '-OutputDir', pptxImgDir, '-Width', '1600', '-Height', '900',
  ], { encoding: 'utf8', timeout: 120000 });
  if (psResult.status !== 0) throw new Error('PPTX export failed');

  // Load all image buffers
  const imgBufs = {};
  for (const file of htmlFiles) {
    const slideKey = file.replace('.html', '');
    const slideNum = parseInt(file.match(/\d+/)[0], 10);
    const htmlPng = path.join(htmlImgDir, file.replace('.html', '.png'));
    const pptxPng = path.join(pptxImgDir, `slide_${String(slideNum).padStart(2, '0')}.png`);
    if (fs.existsSync(htmlPng) && fs.existsSync(pptxPng)) {
      imgBufs[slideKey] = { html: fs.readFileSync(htmlPng), pptx: fs.readFileSync(pptxPng), num: slideNum };
    }
  }

  const allResults = {};
  for (const key of Object.keys(imgBufs)) allResults[key] = [];

  console.log(`Running ${RUNS} VC runs on ${Object.keys(imgBufs).length} slides...`);

  for (let run = 0; run < RUNS; run++) {
    process.stdout.write(`Run ${run+1}/${RUNS}: `);
    for (const [slideKey, bufs] of Object.entries(imgBufs)) {
      const scores = await callVision(bufs.html, bufs.pptx, bufs.num);
      if (scores) allResults[slideKey].push(scores);
      process.stdout.write('.');
      await new Promise(r => setTimeout(r, 300));
    }
    console.log(' done');
  }

  // === Analysis ===

  console.log(`\n=== Per-slide score distributions (${RUNS} runs) ===`);
  for (const [slideKey, runs] of Object.entries(allResults).sort()) {
    const stats = {};
    for (const c of CRITERIA) {
      const vals = runs.map(r => r[c]).filter(v => v != null);
      stats[c] = { vals, mean: vals.reduce((a,b)=>a+b,0)/vals.length, min: Math.min(...vals), max: Math.max(...vals) };
    }
    const line = CRITERIA.map(c => `${SHORT[c]}=${stats[c].mean.toFixed(1)}[${stats[c].min}-${stats[c].max}]`).join(' ');
    console.log(`  ${slideKey}: ${line}`);
  }

  // Co-firing: both <=3 on same slide-run
  console.log(`\n=== Co-firing: both ≤3 on same slide-run ===`);
  const pairCounts = {};
  let totalObs = 0;
  for (const runs of Object.values(allResults)) {
    for (const scores of runs) {
      totalObs++;
      const low = CRITERIA.filter(c => (scores[c] || 5) <= 3);
      for (let i = 0; i < low.length; i++) {
        for (let j = i+1; j < low.length; j++) {
          const pair = [SHORT[low[i]], SHORT[low[j]]].sort().join('+');
          pairCounts[pair] = (pairCounts[pair] || 0) + 1;
        }
      }
    }
  }
  const sorted = Object.entries(pairCounts).sort((a,b) => b[1]-a[1]);
  for (const [pair, count] of sorted) {
    console.log(`  ${pair}: ${count}/${totalObs} (${(count/totalObs*100).toFixed(0)}%)`);
  }

  // Solo-firing: criterion <=3 alone
  console.log(`\n=== Solo-firing: criterion ≤3 with no other ≤3 ===`);
  const soloCounts = {};
  for (const c of CRITERIA) soloCounts[SHORT[c]] = 0;
  for (const runs of Object.values(allResults)) {
    for (const scores of runs) {
      const low = CRITERIA.filter(c => (scores[c] || 5) <= 3);
      if (low.length === 1) soloCounts[SHORT[low[0]]]++;
    }
  }
  for (const [k, v] of Object.entries(soloCounts)) {
    console.log(`  ${k}: ${v}/${totalObs} (${(v/totalObs*100).toFixed(0)}%)`);
  }

  // Conditional co-firing: when X<=3, what % of time is Y also <=3?
  console.log(`\n=== Conditional co-firing: P(Y≤3 | X≤3) ===`);
  for (const cx of CRITERIA) {
    const xLow = [];
    for (const runs of Object.values(allResults)) {
      for (const scores of runs) {
        if ((scores[cx] || 5) <= 3) xLow.push(scores);
      }
    }
    if (xLow.length === 0) continue;
    const row = CRITERIA.filter(c => c !== cx).map(cy => {
      const both = xLow.filter(s => (s[cy] || 5) <= 3).length;
      return `${SHORT[cy]}=${(both/xLow.length*100).toFixed(0)}%`;
    }).join(' ');
    console.log(`  Given ${SHORT[cx]}≤3 (n=${xLow.length}): ${row}`);
  }

  // Verdict distribution
  console.log(`\n=== Verdict distribution per slide ===`);
  const WEIGHTS = { content_completeness:2.0, text_fidelity:1.5, layout_match:1.0, color_accuracy:0.5, overall_fidelity:1.0 };
  for (const [slideKey, runs] of Object.entries(allResults).sort()) {
    const verdicts = { PASS:0, WARN:0, ERROR:0 };
    for (const scores of runs) {
      let total = 0;
      for (const [k,w] of Object.entries(WEIGHTS)) total += (scores[k]||0)*w;
      const critMin = Math.min(scores.content_completeness||0, scores.text_fidelity||0);
      const secMin = Math.min(scores.color_accuracy||0, scores.overall_fidelity||0);
      if (total < 18 || critMin <= 2) verdicts.ERROR++;
      else if (total < 24 || critMin === 3 || secMin <= 3) verdicts.WARN++;
      else verdicts.PASS++;
    }
    console.log(`  ${slideKey}: PASS=${verdicts.PASS} WARN=${verdicts.WARN} ERROR=${verdicts.ERROR}`);
  }

  // Pairwise Pearson correlations
  console.log(`\n=== Pairwise Pearson correlations (all runs pooled) ===`);
  const allScores = [];
  for (const runs of Object.values(allResults)) for (const s of runs) allScores.push(s);
  function mean(a) { return a.reduce((s,v)=>s+v,0)/a.length; }
  function pearson(a, b) {
    const ma = mean(a), mb = mean(b);
    const num = a.reduce((s,x,i) => s+(x-ma)*(b[i]-mb), 0);
    const den = Math.sqrt(a.reduce((s,x)=>s+(x-ma)**2,0) * b.reduce((s,x)=>s+(x-mb)**2,0));
    return den === 0 ? 0 : num/den;
  }
  console.log('     ' + CRITERIA.map(c => SHORT[c].padStart(6)).join(''));
  for (const c1 of CRITERIA) {
    const v1 = allScores.map(s => s[c1] || 0);
    const row = CRITERIA.map(c2 => pearson(v1, allScores.map(s => s[c2] || 0)).toFixed(2).padStart(6)).join('');
    console.log(SHORT[c1].padEnd(5) + row);
  }

  // Cleanup
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

main().catch(e => { console.error(e); process.exit(1); });
