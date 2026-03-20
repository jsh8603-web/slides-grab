#!/usr/bin/env node
/**
 * extract-keywords.mjs
 * Reads nanoBanana-prompt-scores.json and outputs formatted keyword injection text
 * for use in plan-skill's organizer-agent call.
 *
 * Usage:
 *   node scripts/extract-keywords.mjs                  # stdout (for piping)
 *   node scripts/extract-keywords.mjs --output file    # write to file
 *   node scripts/extract-keywords.mjs --json            # JSON output
 *
 * Output: formatted text block ready to replace [KEYWORD_INJECTION] in prompts.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", ".claude", "docs", "nanoBanana-prompt-scores.json");

const CATEGORIES = ["cover", "frame", "icon", "background", "metaphor"];
const TOP_N = 5;
const MIN_COUNT_RECOMMEND = 3;
const MIN_COUNT_BLOCK = 5;
const LOW_AVG_THRESHOLD = 18;

// Category-to-slide-type mapping + usage examples
const CATEGORY_GUIDE = {
  cover: {
    slideTypes: "Cover, Closing",
    exampleUsage: "...creating a sophisticated atmosphere of trust..., ...tall glass towers...",
  },
  frame: {
    slideTypes: "Agenda, Timeline, Process, Framework (인포그래픽 프레임)",
    exampleUsage: "...5 rounded rectangles connected by arrows..., ...subtle gradient accents...",
  },
  icon: {
    slideTypes: "Content slides with icon sets (1:1 비율)",
    exampleUsage: "...shield silhouette icon..., ...forest green fill...",
  },
  background: {
    slideTypes: "Data/Statistics slides (배경 텍스처)",
    exampleUsage: "...warm paper texture with fine fiber pattern...",
  },
  metaphor: {
    slideTypes: "Insight, Analysis, Content (사진/메타포 이미지)",
    exampleUsage: "...moody directional light..., ...wooden surface with visible grain...",
  },
};

function loadDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}

function extractKeywords(db) {
  const result = { recommended: {}, blocked: [], categoryStats: {} };

  for (const cat of CATEGORIES) {
    const catData = db[cat];
    if (!catData) continue;

    const entries = [];
    const lowEntries = [];

    for (const [kw, data] of Object.entries(catData)) {
      if (kw.startsWith("_")) continue;
      if (data.count >= MIN_COUNT_RECOMMEND) {
        entries.push({ keyword: kw, ...data });
      }
      if (data.count >= MIN_COUNT_BLOCK && data.avg < LOW_AVG_THRESHOLD) {
        lowEntries.push({ keyword: kw, category: cat, ...data });
      }
    }

    entries.sort((a, b) => (b.ucb_score || 0) - (a.ucb_score || 0));
    result.recommended[cat] = entries.slice(0, TOP_N).map(e => ({
      keyword: e.keyword,
      ucb: e.ucb_score?.toFixed(1),
      avg: e.avg?.toFixed(1),
      count: e.count,
    }));

    result.blocked.push(...lowEntries);
  }

  if (db._category_stats) {
    result.categoryStats = db._category_stats;
  }

  return result;
}

function formatText(data) {
  const lines = [];

  lines.push("=== 카테고리별 슬라이드 매핑 + 추천 키워드 ===");
  lines.push("각 NanoBanana 프롬프트에 해당 카테고리의 추천 키워드를 2~4개 포함하세요 (5개 이상 금지 — 과밀 키워드는 VQA 점수를 낮춤).");
  lines.push("");

  for (const cat of CATEGORIES) {
    const guide = CATEGORY_GUIDE[cat];
    const recs = data.recommended[cat];
    lines.push(`【${cat}】 → 슬라이드 유형: ${guide.slideTypes}`);

    if (!recs || recs.length === 0) {
      lines.push(`  추천: (데이터 부족)`);
    } else {
      const kwList = recs.map(r => r.keyword).join(", ");
      lines.push(`  추천 키워드: ${kwList}`);
    }
    lines.push(`  사용 예시: ${guide.exampleUsage}`);
    lines.push("");
  }

  lines.push("=== 비추천 키워드 (프롬프트에서 피할 것) ===");
  if (data.blocked.length === 0) {
    lines.push("(현재 없음)");
  } else {
    for (const b of data.blocked.slice(0, 10)) {
      lines.push(`  ${b.category}/${b.keyword} (avg=${b.avg?.toFixed(1)}, n=${b.count})`);
    }
  }

  lines.push("");
  lines.push("=== 필수 규칙 ===");
  lines.push("1. 각 NanoBanana 프롬프트에 해당 카테고리 추천 키워드 2~4개 포함 (5개 이상 금지)");
  lines.push("2. 키워드를 자연스러운 영어 문장 안에 녹여서 사용 (단순 나열 금지)");
  lines.push("3. 비추천 키워드가 있으면 동의어로 대체");
  lines.push("4. 프롬프트 길이 450자 이내 (enhancePrompt가 ~150자 추가)");

  return lines.join("\n");
}

// --- Main ---
const args = process.argv.slice(2);
const jsonMode = args.includes("--json");
const outputIdx = args.indexOf("--output");
const outputFile = outputIdx >= 0 ? args[outputIdx + 1] : null;

const db = loadDB();
const data = extractKeywords(db);

let output;
if (jsonMode) {
  output = JSON.stringify(data, null, 2);
} else {
  output = formatText(data);
}

if (outputFile) {
  fs.writeFileSync(outputFile, output, "utf-8");
  console.log(`Written to ${outputFile}`);
} else {
  console.log(output);
}
