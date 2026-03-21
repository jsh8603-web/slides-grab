/**
 * validate-pptx-com.mjs — Vision-based COM comparison (VV: Vision Validation)
 *
 * Compares HTML slide screenshots with PPTX renderings using Gemini Vision
 * to detect visual fidelity issues that PF/VP cannot catch structurally.
 *
 * Called by convert-native.mjs Phase 4 (--full mode).
 *
 * Usage (standalone):
 *   node scripts/validate-pptx-com.mjs <pptx-path> [--slides-dir <dir>] [--verbose]
 *
 * Programmatic:
 *   import { validatePptxCom } from './validate-pptx-com.mjs';
 *   const result = await validatePptxCom(pptxPath, { pfFindings, vpFindings, contrastFindings });
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { createScreenshotBrowser, createScreenshotPage, captureSlideScreenshot }
  from '../src/editor/screenshot.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// VC code mapping
const VC_CODES = {
  layout_match: 'VC-01',
  text_fidelity: 'VC-02',
  content_completeness: 'VC-03',
  color_accuracy: 'VC-04',
  overall_fidelity: 'VC-05',
  total_error: 'VC-06',
  total_warn: 'VC-07',
};

// Criterion weights (v2: CA downweighted due to high FP rate, CC upweighted as most critical)
const WEIGHTS = {
  content_completeness: 2.0,
  text_fidelity: 1.5,
  layout_match: 1.0,
  color_accuracy: 0.5,
  overall_fidelity: 1.0,
};

// Critical criteria: <=2 → ERROR. Secondary: <=2 → WARN only
const CRITICAL_CRITERIA = new Set(['content_completeness', 'text_fidelity']);

// Criterion labels for messages
const LABELS = {
  layout_match: 'layout',
  content_completeness: 'content completeness',
  text_fidelity: 'text fidelity',
  color_accuracy: 'color accuracy',
  overall_fidelity: 'overall fidelity',
};

/**
 * Call Gemini Vision to compare HTML vs PPTX rendering of a single slide.
 * When runs > 1, performs multi-run consensus (median per criterion).
 */
async function compareSlideWithVision(htmlImageBuffer, pptxImageBuffer, slideNum, pfVpContext = '', { runs = 1 } = {}) {
  if (runs > 1) {
    const results = await Promise.all(
      Array.from({ length: runs }, () =>
        singleVisionCall(htmlImageBuffer, pptxImageBuffer, slideNum, pfVpContext))
    );
    const valid = results.filter(Boolean);
    if (valid.length === 0) return null;

    const criteria = ['layout_match', 'content_completeness', 'text_fidelity', 'color_accuracy', 'overall_fidelity'];
    const median = {};
    for (const key of criteria) {
      const vals = valid.map(r => r[key]).sort((a, b) => a - b);
      median[key] = vals[Math.floor(vals.length / 2)];
      // Use reason from the lowest-scoring run
      const lowest = valid.reduce((min, r) => r[key] < min[key] ? r : min);
      median[`${key}_reason`] = lowest[`${key}_reason`] || '';
    }
    median.differences = [...new Set(valid.flatMap(r => r.differences || []))];
    median._runs = valid.length;
    median._spread = {};
    for (const key of criteria) {
      const vals = valid.map(r => r[key]);
      median._spread[key] = Math.max(...vals) - Math.min(...vals);
    }
    return median;
  }
  return singleVisionCall(htmlImageBuffer, pptxImageBuffer, slideNum, pfVpContext);
}

/**
 * Single Gemini Vision API call for slide comparison.
 */
async function singleVisionCall(htmlImageBuffer, pptxImageBuffer, slideNum, pfVpContext = '') {
  if (!GEMINI_API_KEY) return null;

  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  let contextBlock = '';
  if (pfVpContext) {
    contextBlock = `\nIMPORTANT: Pre-conversion validators flagged these issues on this slide.
Pay EXTRA attention to these areas and verify if visible:
${pfVpContext}`;
  }

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
List confirmed differences in "differences" array.
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
    } catch (err) {
      if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

/**
 * Calculate weighted total score (max 30.0).
 */
function calcWeightedTotal(scores) {
  let total = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    total += (scores[key] || 0) * weight;
  }
  return total;
}

/**
 * Convert Vision scores into VC issue objects.
 */
function scoresToIssues(slideNum, scores) {
  const issues = [];
  const total = calcWeightedTotal(scores);
  const criteria = ['layout_match', 'content_completeness', 'text_fidelity',
                     'color_accuracy', 'overall_fidelity'];

  for (const key of criteria) {
    const val = scores[key] || 0;
    const reason = scores[`${key}_reason`] || '';
    const code = VC_CODES[key];
    const label = LABELS[key];

    if (val <= 2) {
      // Critical criteria (CC, TF) → ERROR; Secondary (LM, CA, OF) → WARN
      const level = CRITICAL_CRITERIA.has(key) ? 'ERROR' : 'WARN';
      issues.push({
        slide: slideNum, code, level,
        shape: label, message: `${label} score ${val}/5${reason ? ': ' + reason : ''}`,
      });
    } else if (val === 3) {
      issues.push({
        slide: slideNum, code, level: 'WARN',
        shape: label, message: `${label} score ${val}/5${reason ? ': ' + reason : ''}`,
      });
    }
  }

  // Total-based + critical minimum codes
  const critMin = Math.min(scores.content_completeness || 0, scores.text_fidelity || 0);
  const secMin = Math.min(scores.color_accuracy || 0, scores.overall_fidelity || 0);

  if (total < 18 || critMin <= 2) {
    issues.push({
      slide: slideNum, code: VC_CODES.total_error, level: 'ERROR',
      shape: 'total', message: `weighted total ${total.toFixed(1)}/30.0, critMin=${critMin}, secMin=${secMin} (ERROR: total<18 or critMin<=2)`,
    });
  } else if (total < 24 || critMin === 3 || secMin <= 3) {
    issues.push({
      slide: slideNum, code: VC_CODES.total_warn, level: 'WARN',
      shape: 'total', message: `weighted total ${total.toFixed(1)}/30.0, critMin=${critMin}, secMin=${secMin} (WARN: total<24 or critMin=3 or secMin<=3)`,
    });
  }

  // Add differences as informational
  if (scores.differences?.length > 0) {
    for (const diff of scores.differences) {
      issues.push({
        slide: slideNum, code: 'VC-08', level: 'INFO',
        shape: 'diff', message: diff,
      });
    }
  }

  return issues;
}

/**
 * Extract PF/VP findings relevant to a specific slide number.
 */
function findingsForSlide(findings, slideNum) {
  const padded = String(slideNum).padStart(2, '0');
  return findings.filter(f => {
    const m = f.match(/slide[- _]?(\d+)/i);
    return m && m[1].padStart(2, '0') === padded;
  });
}

/**
 * Main validation function.
 *
 * @param {string} pptxPath - Path to the PPTX file
 * @param {object} [opts]
 * @param {string[]} [opts.pfFindings] - PF warning/error strings
 * @param {string[]} [opts.vpFindings] - VP warning/error strings
 * @param {string[]} [opts.contrastFindings] - CONTRAST issue strings
 * @param {string|null} [opts.slidesDir] - Override slides directory
 * @param {boolean} [opts.verbose] - Verbose output
 * @returns {{ slideCount: number, errors: number, warnings: number, passed: boolean, issues: object[] }}
 */
export async function validatePptxCom(pptxPath, {
  pfFindings = [],
  vpFindings = [],
  contrastFindings = [],
  slidesDir = null,
  verbose = false,
  consensus = 1,
} = {}) {
  pptxPath = path.resolve(pptxPath);

  // Resolve slidesDir from pptxPath parent
  if (!slidesDir) {
    slidesDir = path.dirname(pptxPath);
  }
  slidesDir = path.resolve(slidesDir);

  // Collect HTML slide files
  const htmlFiles = fs.readdirSync(slidesDir)
    .filter(f => /^slide-\d+\.html$/.test(f))
    .sort();

  if (htmlFiles.length === 0) {
    return { slideCount: 0, errors: 0, warnings: 0, passed: true, issues: [] };
  }

  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable required for Vision validation');
  }

  // Create temp directories for comparison images
  const tmpDir = path.join(slidesDir, '.vision-compare');
  const htmlImgDir = path.join(tmpDir, 'html');
  const pptxImgDir = path.join(tmpDir, 'pptx');
  fs.mkdirSync(htmlImgDir, { recursive: true });
  fs.mkdirSync(pptxImgDir, { recursive: true });

  try {
    // Step 1: HTML screenshots
    const { browser } = await createScreenshotBrowser();
    const { context, page } = await createScreenshotPage(browser);

    for (const file of htmlFiles) {
      const outPath = path.join(htmlImgDir, file.replace('.html', '.png'));
      await captureSlideScreenshot(page, file, outPath, slidesDir);
    }
    await context.close();
    await browser.close();

    // Step 2: PPTX → PNG via PowerPoint COM
    const ps1Path = path.join(__dirname, 'export-slides-png.ps1');
    const psResult = spawnSync('powershell', [
      '-ExecutionPolicy', 'Bypass',
      '-File', ps1Path,
      '-PptxPath', pptxPath,
      '-OutputDir', pptxImgDir,
      '-Width', '1600',
      '-Height', '900',
    ], { encoding: 'utf8', timeout: 120000 });

    if (psResult.status !== 0) {
      throw new Error(`PowerPoint export failed: ${(psResult.stderr || psResult.stdout || '').slice(0, 300)}`);
    }

    // Step 3: Vision comparison per slide
    const allFindings = [...pfFindings, ...vpFindings, ...contrastFindings];
    const allIssues = [];

    for (const file of htmlFiles) {
      const slideNum = parseInt(file.match(/\d+/)[0], 10);
      const htmlPng = path.join(htmlImgDir, file.replace('.html', '.png'));
      const pptxPng = path.join(pptxImgDir, `slide_${String(slideNum).padStart(2, '0')}.png`);

      if (!fs.existsSync(htmlPng) || !fs.existsSync(pptxPng)) {
        if (verbose) console.warn(`  Skipping slide ${slideNum}: missing images`);
        continue;
      }

      const htmlBuf = fs.readFileSync(htmlPng);
      const pptxBuf = fs.readFileSync(pptxPng);

      // Build PF/VP context for this slide
      const slideFindings = findingsForSlide(allFindings, slideNum);
      const pfVpContext = slideFindings.length > 0
        ? slideFindings.map(f => `- ${f}`).join('\n')
        : '';

      const scores = await compareSlideWithVision(htmlBuf, pptxBuf, slideNum, pfVpContext, { runs: consensus });
      if (!scores) {
        if (verbose) console.warn(`  Slide ${slideNum}: Vision API failed, skipping`);
        continue;
      }

      if (verbose && scores._runs) {
        console.log(`  Slide ${slideNum}: consensus ${scores._runs} runs, spread: ${JSON.stringify(scores._spread)}`);
      }

      const issues = scoresToIssues(slideNum, scores);
      allIssues.push(...issues);

      // Rate limit
      await new Promise(r => setTimeout(r, 500));
    }

    const errorCount = allIssues.filter(i => i.level === 'ERROR').length;
    const warnCount = allIssues.filter(i => i.level === 'WARN').length;

    return {
      slideCount: htmlFiles.length,
      errors: errorCount,
      warnings: warnCount,
      passed: errorCount === 0,
      issues: allIssues,
    };
  } finally {
    // Cleanup temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
  }
}

// CLI mode
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  let pptxPath = null;
  let slidesDir = null;
  let verbose = false;
  let consensus = 1;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--slides-dir' && args[i + 1]) slidesDir = args[++i];
    else if (args[i] === '--verbose') verbose = true;
    else if (args[i] === '--consensus' && args[i + 1]) consensus = parseInt(args[++i], 10) || 1;
    else if (!args[i].startsWith('-')) pptxPath = args[i];
  }

  if (!pptxPath) {
    console.error('Usage: node scripts/validate-pptx-com.mjs <pptx-path> [--slides-dir <dir>] [--verbose] [--consensus N]');
    process.exit(1);
  }

  const result = await validatePptxCom(pptxPath, { slidesDir, verbose, consensus });
  const fmtIssue = (i) => `[slide ${i.slide}] ${i.code} "${i.shape}": ${i.message}`;

  if (result.errors > 0) {
    console.error(`\nVision validation: ${result.errors} ERROR(s):\n`);
    for (const e of result.issues.filter(i => i.level === 'ERROR')) {
      console.error(`  ${fmtIssue(e)}`);
    }
  }
  if (result.warnings > 0) {
    console.warn(`\nVision validation: ${result.warnings} warning(s):\n`);
    for (const w of result.issues.filter(i => i.level === 'WARN')) {
      console.warn(`  ${fmtIssue(w)}`);
    }
  }
  if (result.passed) {
    console.log(`\nVision validation: ${result.slideCount} slides, all passed`);
  }

  process.exit(result.passed ? 0 : 1);
}
