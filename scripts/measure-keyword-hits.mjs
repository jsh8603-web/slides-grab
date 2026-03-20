#!/usr/bin/env node
/**
 * measure-keyword-hits.mjs
 * Measures how many VQA-recommended keywords appear in NanoBanana prompts.
 *
 * Usage:
 *   node scripts/measure-keyword-hits.mjs slides/keyword-test-T1/slide-outline.md
 *   node scripts/measure-keyword-hits.mjs slides/keyword-test-T1 slides/keyword-test-T2 slides/keyword-test-T3
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", ".claude", "docs", "nanoBanana-prompt-scores.json");

const CATEGORIES = ["cover", "frame", "icon", "background", "metaphor"];
const TOP_N = 10; // check top 10 keywords per category
const MIN_COUNT = 3;

function loadDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}

function getTopKeywords(db) {
  const result = {};
  for (const cat of CATEGORIES) {
    const catData = db[cat];
    if (!catData) continue;
    const entries = [];
    for (const [kw, data] of Object.entries(catData)) {
      if (kw.startsWith("_")) continue;
      if (data.count >= MIN_COUNT) {
        entries.push({ keyword: kw, ucb: data.ucb_score || 0, avg: data.avg || 0 });
      }
    }
    entries.sort((a, b) => b.ucb - a.ucb);
    result[cat] = entries.slice(0, TOP_N);
  }
  return result;
}

function extractNanoBananaPrompts(outlinePath) {
  let filePath = outlinePath;
  if (fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "slide-outline.md");
  }
  const content = fs.readFileSync(filePath, "utf-8");
  const prompts = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const match = line.match(/NanoBanana:.*?\|\s*(.+)/);
    if (match) {
      prompts.push(match[1].trim());
    }
  }
  return prompts;
}

function measureHits(prompts, topKeywords) {
  const allKeywords = new Set();
  const hitKeywords = new Set();
  let totalHits = 0;
  let totalChecked = 0;

  const perPrompt = [];

  for (const prompt of prompts) {
    const lower = prompt.toLowerCase();
    let hits = 0;
    let checked = 0;
    const matched = [];

    for (const cat of CATEGORIES) {
      for (const kw of (topKeywords[cat] || [])) {
        allKeywords.add(`${cat}/${kw.keyword}`);
        checked++;
        totalChecked++;
        if (lower.includes(kw.keyword.toLowerCase())) {
          hits++;
          totalHits++;
          hitKeywords.add(`${cat}/${kw.keyword}`);
          matched.push(`${cat}/${kw.keyword}`);
        }
      }
    }

    perPrompt.push({
      prompt: prompt.substring(0, 60) + "...",
      hits,
      checked,
      rate: (hits / checked * 100).toFixed(1),
      matched,
    });
  }

  return {
    totalPrompts: prompts.length,
    totalHits,
    totalChecked,
    hitRate: (totalHits / totalChecked * 100).toFixed(1),
    avgHitsPerPrompt: (totalHits / prompts.length).toFixed(1),
    uniqueKeywordsHit: hitKeywords.size,
    totalUniqueKeywords: allKeywords.size,
    perPrompt,
  };
}

// --- Main ---
const db = loadDB();
const topKeywords = getTopKeywords(db);

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: node scripts/measure-keyword-hits.mjs <outline1> [outline2] ...");
  process.exit(1);
}

console.log("=== VQA Keyword Hit Rate Comparison ===\n");
console.log(`Top ${TOP_N} keywords per category (count >= ${MIN_COUNT}):`);
for (const cat of CATEGORIES) {
  const kws = (topKeywords[cat] || []).map(k => k.keyword).join(", ");
  console.log(`  ${cat}: ${kws || "(none)"}`);
}
console.log("");

for (const arg of args) {
  const label = path.basename(arg).replace(/\.md$/, "").replace("slide-outline", path.basename(path.dirname(arg)));
  const prompts = extractNanoBananaPrompts(arg);
  const result = measureHits(prompts, topKeywords);

  console.log(`--- ${label} ---`);
  console.log(`  Prompts: ${result.totalPrompts}`);
  console.log(`  Total hits: ${result.totalHits} / ${result.totalChecked} checks (${result.hitRate}%)`);
  console.log(`  Avg hits/prompt: ${result.avgHitsPerPrompt}`);
  console.log(`  Unique keywords hit: ${result.uniqueKeywordsHit} / ${result.totalUniqueKeywords}`);
  console.log(`  Per-prompt:`);
  for (const p of result.perPrompt) {
    console.log(`    ${p.hits} hits (${p.rate}%) — ${p.prompt}`);
    if (p.matched.length > 0) {
      console.log(`      matched: ${p.matched.join(", ")}`);
    }
  }
  console.log("");
}
