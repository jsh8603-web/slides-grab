#!/usr/bin/env node
// vqa-batch.mjs — Batch VQA scoring for images without outlines
// Scans all slides directories for PNGs and scores them with Gemini Vision.
// Usage:
//   node scripts/vqa-batch.mjs --all
//   node scripts/vqa-batch.mjs --dir slides/mesozoic-dinosaurs/assets
//   node scripts/vqa-batch.mjs --all --force
//   node scripts/vqa-batch.mjs --all --update-scores

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

// Auto-load .env
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

const { values: args } = parseArgs({
  options: {
    dir: { type: "string" },
    all: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    "update-scores": { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
  },
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY 환경변수가 필요합니다.");
  process.exit(1);
}

// Import shared functions from generate-images.mjs via dynamic import workaround
// We duplicate the minimal VQA logic here to keep it standalone.

async function scoreImageWithVQA(imageBuffer, prompt, category) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  const systemPrompt = `You are a strict image quality reviewer for presentation slides.
Rate this AI-generated image on each criterion (1-5, where 5 is exceptional and rare):
- prompt_fidelity: Does the image match this description? "${(prompt || "Professional presentation image").slice(0, 300)}"
- text_absence: Are there ANY text, letters, numbers, symbols visible? (5=none at all, 1=prominent text)
- composition: Quality of framing, balance, negative space for text overlay
- color_harmony: Do colors work well together? Match corporate presentation style?
- presentation_fit: Would this work well as a slide ${category || "background"}/illustration?

Be strict: 4+ should be rare. Most images should score 3.
Also list any visible text/symbols you detect (even partial/garbled) in "detected_text" array.`;

  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: "image/png", data: imageBuffer.toString("base64") } },
        { text: systemPrompt },
      ],
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          prompt_fidelity: { type: "integer" },
          text_absence: { type: "integer" },
          composition: { type: "integer" },
          color_harmony: { type: "integer" },
          presentation_fit: { type: "integer" },
          detected_text: { type: "array", items: { type: "string" } },
        },
        required: ["prompt_fidelity", "text_absence", "composition", "color_harmony", "presentation_fit"],
      },
    },
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 429) {
        const wait = Math.pow(2, attempt + 1) * 2000;
        console.log(`    ⏳ Rate limit, ${wait / 1000}s 대기...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) return null;

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;

      const scores = JSON.parse(text);
      const total = (scores.prompt_fidelity || 0) + (scores.text_absence || 0) +
        (scores.composition || 0) + (scores.color_harmony || 0) + (scores.presentation_fit || 0);

      return { scores, total, detected_text: scores.detected_text || [] };
    } catch {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return null;
}

function findAssetDirs() {
  const slidesRoot = path.resolve("slides");
  if (!fs.existsSync(slidesRoot)) return [];

  return fs.readdirSync(slidesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(slidesRoot, d.name, "assets"))
    .filter((p) => fs.existsSync(p));
}

async function processDirectory(assetsDir) {
  const presName = path.basename(path.dirname(assetsDir));
  const pngs = fs.readdirSync(assetsDir)
    .filter((f) => f.startsWith("slide-") && f.endsWith(".png"))
    .sort();

  if (pngs.length === 0) return null;

  console.log(`\n📁 ${presName} (${pngs.length} images)`);

  const results = [];
  let scored = 0, skipped = 0, errors = 0;

  for (const png of pngs) {
    const pngPath = path.join(assetsDir, png);
    const metaPath = pngPath.replace(/\.png$/, "-meta.json");

    // Read existing meta
    let meta = {};
    if (fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")); } catch { /* ignore */ }
    }

    // Skip if already scored
    if (meta.vqa && !args.force) {
      if (args.verbose) console.log(`  ⏭  ${png} (VQA ${meta.vqa.total}/25)`);
      results.push({ file: png, vqa: meta.vqa, prompt: meta.prompt, category: meta.category || "background", skipped: true });
      skipped++;
      continue;
    }

    try {
      const buffer = fs.readFileSync(pngPath);
      const prompt = meta.prompt || `Professional presentation slide image for ${presName}`;
      const category = meta.category || "background";

      console.log(`  🔬 ${png}...`);
      const vqaResult = await scoreImageWithVQA(buffer, prompt, category);

      if (vqaResult) {
        const grade = vqaResult.total >= 23 ? "PASS" : vqaResult.total >= 20 ? "WARN" : "FAIL";
        const icon = grade === "PASS" ? "✅" : grade === "WARN" ? "⚠️" : "❌";
        console.log(`  ${icon} ${png}: ${vqaResult.total}/25 [${grade}] (PF:${vqaResult.scores.prompt_fidelity} TA:${vqaResult.scores.text_absence} CO:${vqaResult.scores.composition} CH:${vqaResult.scores.color_harmony} PF:${vqaResult.scores.presentation_fit})`);
        if (vqaResult.detected_text?.length > 0) {
          console.log(`    🔤 ${vqaResult.detected_text.join(", ")}`);
        }

        // Save to meta.json
        meta.vqa = vqaResult;
        meta.category = category;
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

        results.push({ file: png, vqa: vqaResult, prompt, category, skipped: false });
        scored++;
      } else {
        console.log(`  ⚠️  ${png}: VQA 응답 없음`);
        errors++;
      }

      // Rate limit protection
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      console.log(`  ❌ ${png}: ${err.message}`);
      errors++;
    }
  }

  // Summary for this directory
  const vqaScores = results.filter((r) => r.vqa).map((r) => r.vqa.total);
  const avg = vqaScores.length > 0 ? (vqaScores.reduce((a, b) => a + b, 0) / vqaScores.length).toFixed(1) : "N/A";
  const min = vqaScores.length > 0 ? Math.min(...vqaScores) : "N/A";
  const max = vqaScores.length > 0 ? Math.max(...vqaScores) : "N/A";

  console.log(`  📊 ${presName}: avg ${avg}/25, min ${min}, max ${max} (scored: ${scored}, skipped: ${skipped}, errors: ${errors})`);

  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    presentation: presName,
    mode: "vqa-batch",
    summary: { total: pngs.length, scored, skipped, errors },
    vqa: {
      avg: parseFloat(avg) || 0,
      min: typeof min === "number" ? min : 0,
      max: typeof max === "number" ? max : 0,
    },
    results: results.map((r) => ({
      file: r.file,
      total: r.vqa?.total,
      scores: r.vqa?.scores,
      detected_text: r.vqa?.detected_text,
      had_prompt: !!r.prompt && !r.prompt.startsWith("Professional presentation"),
    })),
  };

  fs.writeFileSync(
    path.join(assetsDir, "nanoBanana-report.json"),
    JSON.stringify(report, null, 2),
  );

  return report;
}

async function main() {
  const dirs = args.all ? findAssetDirs() : args.dir ? [path.resolve(args.dir)] : [];

  if (dirs.length === 0) {
    console.error("Usage: node scripts/vqa-batch.mjs --all  OR  --dir <assets-dir>");
    process.exit(1);
  }

  console.log(`🔬 VQA Batch Scoring`);
  console.log(`   대상: ${dirs.length}개 디렉토리${args.force ? " (force re-score)" : ""}`);

  const allReports = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const report = await processDirectory(dir);
    if (report) allReports.push(report);
  }

  // Grand summary
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📊 전체 VQA Batch 결과`);

  let totalImages = 0, totalScored = 0;
  const allScores = [];
  for (const r of allReports) {
    totalImages += r.summary.total;
    totalScored += r.summary.scored + r.summary.skipped;
    r.results.forEach((res) => { if (res.total) allScores.push(res.total); });
    console.log(`   ${r.presentation}: ${r.vqa.avg}/25 (${r.summary.total} images)`);
  }

  if (allScores.length > 0) {
    const grandAvg = (allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(1);
    const dist = { "25": 0, "23-24": 0, "20-22": 0, "15-19": 0, "<15": 0 };
    for (const s of allScores) {
      if (s === 25) dist["25"]++;
      else if (s >= 23) dist["23-24"]++;
      else if (s >= 20) dist["20-22"]++;
      else if (s >= 15) dist["15-19"]++;
      else dist["<15"]++;
    }

    console.log(`\n   전체 평균: ${grandAvg}/25 (${allScores.length}장)`);
    console.log(`   분포: 25점: ${dist["25"]}, 23-24: ${dist["23-24"]}, 20-22: ${dist["20-22"]}, 15-19: ${dist["15-19"]}, <15: ${dist["<15"]}`);
  }
}

main();
