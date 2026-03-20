#!/usr/bin/env node
/**
 * auto-production-test.mjs
 *
 * Automated production pipeline test runner.
 * Runs the full pipeline (PF → convert-native → VP) on fixture slides
 * and collects timing + quality metrics for baseline/comparison analysis.
 *
 * Usage:
 *   node scripts/auto-production-test.mjs --slides 10 --baseline
 *   node scripts/auto-production-test.mjs --slides 10 --baseline --runs 3
 *   node scripts/auto-production-test.mjs --slides 10 --compare tests/production-runs/baseline-10.json
 *   node scripts/auto-production-test.mjs --slides 10 --images   # include image generation
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Parse args
// ---------------------------------------------------------------------------
const rawArgs = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = rawArgs.indexOf(`--${name}`);
  if (idx === -1) return defaultVal;
  if (typeof defaultVal === "boolean") return true;
  return rawArgs[idx + 1] || defaultVal;
}

const slideCount = parseInt(getArg("slides", "10"));
const runs = parseInt(getArg("runs", "1"));
const isBaseline = getArg("baseline", false);
const comparePath = getArg("compare", null);
const includeImages = getArg("images", false);
const skipCom = getArg("skip-com", false);

const fixtureDir = path.join(ROOT, "tests", "production-fixtures");
const outlineFile = path.join(fixtureDir, `outline-${slideCount}.md`);
const slidesFixtureDir = path.join(fixtureDir, `slides-${slideCount}`);
const runsDir = path.join(ROOT, "tests", "production-runs");

if (!fs.existsSync(outlineFile)) {
  console.error(`Outline fixture not found: ${outlineFile}`);
  process.exit(1);
}
if (!fs.existsSync(slidesFixtureDir)) {
  console.error(`Slides fixture not found: ${slidesFixtureDir}`);
  process.exit(1);
}

fs.mkdirSync(runsDir, { recursive: true });

// ---------------------------------------------------------------------------
// Timing helper
// ---------------------------------------------------------------------------
function timeExec(cmd, opts = {}) {
  const start = Date.now();
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    stdout = execSync(cmd, {
      cwd: ROOT,
      encoding: "utf8",
      timeout: opts.timeout || 300000,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
  } catch (e) {
    stdout = e.stdout || "";
    stderr = e.stderr || "";
    exitCode = e.status || 1;
  }
  return { ms: Date.now() - start, stdout, stderr, exitCode };
}

// ---------------------------------------------------------------------------
// Parse PF/VP output for quality metrics
// ---------------------------------------------------------------------------
function parsePfOutput(out) {
  const errors = (out.match(/ERROR/gi) || []).length;
  const warnings = (out.match(/⚠️\s*WARN/g) || []).length;
  return { errors, warnings };
}

function parseVpOutput(out) {
  const errors = (out.match(/ERROR\(s\)/gi) || []).length > 0
    ? parseInt((out.match(/(\d+) ERROR/i) || [0, 0])[1])
    : 0;
  const warnings = (out.match(/(\d+) warning/i) || [0, 0])[1];
  return { errors, warnings: parseInt(warnings) || 0 };
}

function parseVqaOutput(out) {
  const scores = [];
  const scoreRe = /(\d+\.?\d*)\/27\.5/g;
  let m;
  while ((m = scoreRe.exec(out)) !== null) {
    scores.push(parseFloat(m[1]));
  }
  if (scores.length === 0) return { avg: 0, min: 0, count: 0 };
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return {
    avg: Math.round(avg * 10) / 10,
    min: Math.min(...scores),
    count: scores.length,
  };
}

// ---------------------------------------------------------------------------
// Single run
// ---------------------------------------------------------------------------
function runOnce(runIdx) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Run ${runIdx + 1}/${runs} (${slideCount} slides)`);
  console.log("=".repeat(60));

  const runDir = path.join(runsDir, `run-${Date.now()}`);
  fs.mkdirSync(runDir, { recursive: true });

  // Copy fixture slides to temp work dir
  const workDir = path.join(runDir, "slides");
  fs.mkdirSync(workDir, { recursive: true });
  const assetsDir = path.join(workDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  // Copy HTML files
  for (const f of fs.readdirSync(slidesFixtureDir)) {
    if (f.endsWith(".html")) {
      fs.copyFileSync(path.join(slidesFixtureDir, f), path.join(workDir, f));
    }
  }
  // Copy assets
  const fixtureAssets = path.join(slidesFixtureDir, "assets");
  if (fs.existsSync(fixtureAssets)) {
    for (const f of fs.readdirSync(fixtureAssets)) {
      fs.copyFileSync(path.join(fixtureAssets, f), path.join(assetsDir, f));
    }
  }

  const metrics = {
    run: runIdx + 1,
    slides: slideCount,
    timestamp: new Date().toISOString(),
    timing: {},
    quality: {},
    api: {},
    output: {},
  };

  // ── Phase 1: Image generation (optional) ──────────────────────────────
  if (includeImages) {
    console.log("\nPhase 1: Image generation...");
    const imgResult = timeExec(
      `node scripts/generate-images.mjs --outline "${outlineFile}" --output "${assetsDir}" --vqa`,
      { timeout: 600000 }
    );
    metrics.timing.image_generation_ms = imgResult.ms;
    console.log(`  Done in ${(imgResult.ms / 1000).toFixed(1)}s`);

    // Parse VQA scores
    const vqa = parseVqaOutput(imgResult.stdout);
    metrics.quality.vqa_avg = vqa.avg;
    metrics.quality.vqa_min = vqa.min;
    metrics.quality.vqa_count = vqa.count;

    // Count API calls (approximate)
    const apiCalls = (imgResult.stdout.match(/생성 중\.\.\./g) || []).length;
    const retries = (imgResult.stdout.match(/재시도/g) || []).length;
    metrics.api.gemini_image = apiCalls;
    metrics.api.gemini_vqa = vqa.count;
    metrics.api.retries = retries;
  }

  // ── Phase 2: Preflight (static only, timed separately) ────────────────
  console.log("\nPhase 2: Preflight static check...");
  const pfResult = timeExec(
    `node scripts/preflight-html.js --slides-dir "${workDir}"`
  );
  metrics.timing.preflight_static_ms = pfResult.ms;
  const pfQuality = parsePfOutput(pfResult.stdout + pfResult.stderr);
  metrics.quality.pf_errors = pfQuality.errors;
  metrics.quality.pf_warnings = pfQuality.warnings;
  console.log(`  Done in ${(pfResult.ms / 1000).toFixed(1)}s (${pfQuality.errors}E, ${pfQuality.warnings}W)`);

  // ── Phase 3: PPTX conversion + VP validation ─────────────────────────
  console.log("\nPhase 3: PPTX conversion + VP validation...");
  const pptxPath = path.join(runDir, "output.pptx");
  const convertResult = timeExec(
    `node scripts/convert-native.mjs --slides-dir "${workDir}" --output "${pptxPath}" --skip-preflight`
  );
  metrics.timing.conversion_ms = convertResult.ms;
  console.log(`  Done in ${(convertResult.ms / 1000).toFixed(1)}s`);

  // Parse VP from convert output
  const vpQuality = parseVpOutput(convertResult.stdout + convertResult.stderr);
  metrics.quality.vp_errors = vpQuality.errors;
  metrics.quality.vp_warnings = vpQuality.warnings;

  // Output file size
  if (fs.existsSync(pptxPath)) {
    metrics.output.pptx_kb = Math.round(fs.statSync(pptxPath).size / 1024);
  }

  // ── Phase 4: COM validation (optional, Windows only) ──────────────────
  if (!skipCom) {
    console.log("\nPhase 4: COM validation...");
    const comResult = timeExec(
      `node scripts/convert-native.mjs --slides-dir "${workDir}" --output "${pptxPath}" --skip-preflight --full`,
      { timeout: 600000 }
    );
    metrics.timing.com_export_ms = comResult.ms;
    // Count COM diff slides
    const comDiffs = (comResult.stdout.match(/VC-\d+/g) || []).length;
    metrics.quality.com_diff_issues = comDiffs;
    console.log(`  Done in ${(comResult.ms / 1000).toFixed(1)}s (${comDiffs} issues)`);
  }

  // ── Cleanup large files ───────────────────────────────────────────────
  try { fs.unlinkSync(pptxPath); } catch { /* ok */ }
  // Remove copied slides (keep metrics only)
  fs.rmSync(workDir, { recursive: true, force: true });

  // ── Save metrics ──────────────────────────────────────────────────────
  const metricsPath = path.join(runDir, "metrics.json");
  fs.writeFileSync(metricsPath, JSON.stringify(metrics, null, 2));
  console.log(`\nMetrics saved: ${metricsPath}`);

  return metrics;
}

// ---------------------------------------------------------------------------
// Aggregate multiple runs
// ---------------------------------------------------------------------------
function aggregate(allMetrics) {
  const agg = {
    config: { slides: slideCount, runs, mode: isBaseline ? "baseline" : "comparison" },
    timestamp: new Date().toISOString(),
    timing: {},
    quality: {},
    api: {},
    output: {},
  };

  // Timing: compute avg/min/max
  const timingKeys = new Set();
  for (const m of allMetrics) {
    for (const k of Object.keys(m.timing)) timingKeys.add(k);
  }
  for (const k of timingKeys) {
    const vals = allMetrics.map((m) => m.timing[k]).filter((v) => v != null);
    if (vals.length === 0) continue;
    agg.timing[k] = {
      avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
      min: Math.min(...vals),
      max: Math.max(...vals),
    };
  }

  // Quality: use worst case
  const qKeys = new Set();
  for (const m of allMetrics) {
    for (const k of Object.keys(m.quality)) qKeys.add(k);
  }
  for (const k of qKeys) {
    const vals = allMetrics.map((m) => m.quality[k]).filter((v) => v != null);
    if (vals.length === 0) continue;
    if (k.includes("avg")) {
      agg.quality[k] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    } else if (k.includes("min")) {
      agg.quality[k] = Math.min(...vals);
    } else {
      agg.quality[k] = Math.max(...vals); // worst case for errors/warnings
    }
  }

  // API: sum
  for (const k of ["gemini_image", "gemini_vqa", "retries"]) {
    const vals = allMetrics.map((m) => m.api[k]).filter((v) => v != null);
    if (vals.length > 0) agg.api[k] = vals.reduce((a, b) => a + b, 0);
  }

  // Output: avg
  const pptxSizes = allMetrics.map((m) => m.output.pptx_kb).filter((v) => v != null);
  if (pptxSizes.length > 0) {
    agg.output.pptx_kb = Math.round(pptxSizes.reduce((a, b) => a + b, 0) / pptxSizes.length);
  }

  return agg;
}

// ---------------------------------------------------------------------------
// Compare baseline vs current
// ---------------------------------------------------------------------------
function compareResults(baseline, current) {
  console.log("\n" + "=".repeat(60));
  console.log("=== Production Test Comparison ===");
  console.log(`Config: ${slideCount} slides, ${runs} runs each`);
  console.log("=".repeat(60));

  // Timing comparison
  console.log("\nTIMING (avg ms):");
  for (const k of Object.keys(current.timing)) {
    const base = baseline.timing[k]?.avg;
    const curr = current.timing[k]?.avg;
    if (base == null || curr == null) continue;
    const pct = Math.round(((curr - base) / base) * 100);
    const arrow = pct < 0 ? `\x1b[32m${pct}%\x1b[0m` : pct > 0 ? `\x1b[31m+${pct}%\x1b[0m` : "0%";
    console.log(`  ${k.padEnd(25)} ${base} → ${curr}  (${arrow})`);
  }

  // Quality comparison + gates
  console.log("\nQUALITY (must match or improve):");
  let qualityPass = true;
  for (const k of Object.keys(current.quality)) {
    const base = baseline.quality[k];
    const curr = current.quality[k];
    if (base == null || curr == null) continue;

    let status = "OK";
    if (k.includes("error") || k === "com_diff_issues") {
      if (curr > base) { status = "FAIL"; qualityPass = false; }
    } else if (k === "vqa_avg") {
      if (curr < base - 0.5) { status = "FAIL"; qualityPass = false; }
      else if (curr < base) { status = `WARN (-${(base - curr).toFixed(1)})`; }
    } else if (k === "vqa_min") {
      if (curr < base - 1.0) { status = "FAIL"; qualityPass = false; }
      else if (curr < base) { status = `WARN (-${(base - curr).toFixed(1)})`; }
    }

    const icon = status === "OK" ? "  " : status === "FAIL" ? "FAIL" : "WARN";
    console.log(`  ${icon} ${k.padEnd(25)} ${base} → ${curr}  (${status})`);
  }

  console.log(`\nVERDICT: ${qualityPass ? "\x1b[32mPASS\x1b[0m (speed improved, quality maintained)" : "\x1b[31mFAIL\x1b[0m (quality degraded)"}`);
  return qualityPass;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log(`\nAuto Production Test`);
console.log(`  Slides: ${slideCount}`);
console.log(`  Runs: ${runs}`);
console.log(`  Mode: ${isBaseline ? "BASELINE" : comparePath ? "COMPARE" : "SINGLE"}`);
console.log(`  Images: ${includeImages ? "YES" : "NO (fixture only)"}`);
console.log(`  COM: ${skipCom ? "SKIP" : "YES"}`);

const allMetrics = [];
for (let i = 0; i < runs; i++) {
  allMetrics.push(runOnce(i));
}

const aggregated = aggregate(allMetrics);

// Save aggregated result
if (isBaseline) {
  const baselinePath = path.join(runsDir, `baseline-${slideCount}.json`);
  fs.writeFileSync(baselinePath, JSON.stringify(aggregated, null, 2));
  console.log(`\nBaseline saved: ${baselinePath}`);
} else {
  const resultPath = path.join(runsDir, `result-${slideCount}-${Date.now()}.json`);
  fs.writeFileSync(resultPath, JSON.stringify(aggregated, null, 2));
  console.log(`\nResult saved: ${resultPath}`);
}

// Compare if requested
if (comparePath) {
  const absCompare = path.resolve(comparePath);
  if (!fs.existsSync(absCompare)) {
    console.error(`Baseline file not found: ${absCompare}`);
    process.exit(1);
  }
  const baseline = JSON.parse(fs.readFileSync(absCompare, "utf8"));
  const passed = compareResults(baseline, aggregated);
  process.exit(passed ? 0 : 1);
}

// Print summary
console.log("\n" + "=".repeat(60));
console.log("Summary:");
for (const [k, v] of Object.entries(aggregated.timing)) {
  console.log(`  ${k.padEnd(25)} ${v.avg}ms avg (${v.min}-${v.max})`);
}
console.log("\nQuality:");
for (const [k, v] of Object.entries(aggregated.quality)) {
  console.log(`  ${k.padEnd(25)} ${v}`);
}
console.log();
