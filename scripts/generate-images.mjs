#!/usr/bin/env node
/**
 * generate-images.mjs
 *
 * Parse NanoBanana: tags from slide-outline.md and generate images via Gemini API.
 *
 * Usage:
 *   node scripts/generate-images.mjs --outline slide-outline.md --output slides/my-pres/assets
 *   node scripts/generate-images.mjs --outline slide-outline.md --output slides/my-pres/assets --model gemini-2.0-flash-exp
 *   node scripts/generate-images.mjs --outline slide-outline.md --output slides/my-pres/assets --chain
 *   node scripts/generate-images.mjs --outline slide-outline.md --output slides/my-pres/assets --force
 *   node scripts/generate-images.mjs --outline slide-outline.md --output slides/my-pres/assets --regenerate 3,5,8
 *   node scripts/generate-images.mjs --outline slide-outline.md --dry
 *
 * Environment:
 *   GEMINI_API_KEY — required (Paid tier only; Free tier blocks image generation)
 */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------
// Auto-load .env (lightweight, no dotenv dependency)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const { values: args } = parseArgs({
  options: {
    outline: { type: "string" },
    output: { type: "string" },
    model: { type: "string", default: "gemini-2.5-flash-image" },
    size: { type: "string", default: "2K" },
    concurrency: { type: "string", default: "2" },
    dry: { type: "boolean", default: false },
    chain: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    regenerate: { type: "string", default: "" },
    optimize: { type: "boolean", default: true },
    // Single image mode
    prompt: { type: "string" },
    "output-file": { type: "string" },
    "aspect-ratio": { type: "string", default: "16:9" },
  },
});

// ---------------------------------------------------------------------------
// Single image mode: --prompt "..." --output-file <path>
// ---------------------------------------------------------------------------
if (args.prompt) {
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    console.error("Error: GEMINI_API_KEY 환경변수가 필요합니다.");
    process.exit(1);
  }
  if (!args["output-file"]) {
    console.error("Error: --output-file <path> 가 필요합니다.");
    process.exit(1);
  }

  const outFile = path.resolve(args["output-file"]);
  const model = args.model;
  let prompt = args.prompt;
  const aspectRatio = args["aspect-ratio"];

  // Parse ratio hint from prompt if present
  let ar = aspectRatio;
  const ratioHint = prompt.match(/\[(\d+:\d+)\]/);
  if (ratioHint) {
    ar = ratioHint[1];
    prompt = prompt.replace(/\[\d+:\d+\]/, "").trim();
  }

  console.log(`🎨 단일 이미지 생성`);
  console.log(`   모델: ${model}`);
  console.log(`   비율: ${ar}`);
  console.log(`   출력: ${outFile}`);
  console.log(`   프롬프트: ${prompt.slice(0, 100)}...`);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: ar, imageSize: args.size },
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`Gemini API ${res.status}: ${err}`);
      process.exit(1);
    }

    const data = await res.json();
    const imgPart = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!imgPart) {
      console.error("API가 이미지를 반환하지 않았습니다.");
      process.exit(1);
    }

    let buffer = Buffer.from(imgPart.inlineData.data, "base64");

    // Optimize if enabled
    if (args.optimize) {
      try {
        const sharp = (await import("sharp")).default;
        const dims = {
          "16:9": { w: 1920, h: 1080 }, "4:3": { w: 1440, h: 1080 },
          "1:1": { w: 1080, h: 1080 }, "3:2": { w: 1620, h: 1080 },
          "9:16": { w: 1080, h: 1920 }, "21:9": { w: 2520, h: 1080 },
        };
        const t = dims[ar] || dims["16:9"];
        buffer = await sharp(buffer)
          .resize(t.w, t.h, { fit: "cover", position: "centre", kernel: "lanczos3" })
          .png({ compressionLevel: 9, quality: 85 })
          .toBuffer();
      } catch { /* sharp unavailable */ }
    }

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, buffer);
    console.log(`✅ 저장 완료: ${outFile} (${(buffer.length / 1024).toFixed(0)}KB)`);
  } catch (err) {
    console.error(`❌ 실패: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

if (!args.outline) {
  console.error(`Usage: node scripts/generate-images.mjs --outline <path> --output <dir> [options]

Options:
  --model <id>         Gemini model (default: gemini-2.0-flash-exp)
  --size <size>        Image size: 1K, 2K, 4K (default: 2K)
  --concurrency <n>    Parallel API calls (default: 2)
  --chain              Use first image as style reference for subsequent images
  --force              Regenerate all images (overwrite existing)
  --regenerate <n,...>  Regenerate specific slides (e.g. --regenerate 3,5,8)
  --optimize           Sharp post-processing: resize to 1920x1080 + compress (default: true)
  --no-optimize        Skip post-processing
  --dry                Parse only, no API calls`);
  process.exit(1);
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY && !args.dry) {
  console.error(`Error: GEMINI_API_KEY 환경변수가 필요합니다.

  1. https://aistudio.google.com/apikey 에서 API 키 발급
  2. 결제 활성화 필수 (Free Tier에서는 이미지 생성 차단됨)
  3. export GEMINI_API_KEY=your-api-key`);
  process.exit(1);
}

const regenerateSlides = new Set(
  args.regenerate ? args.regenerate.split(",").map((n) => parseInt(n.trim(), 10)) : []
);

// ---------------------------------------------------------------------------
// Parse outline — Meta section + NanoBanana tags
// ---------------------------------------------------------------------------
function parseOutline(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  // Parse Meta section for style anchor
  const meta = { colorPalette: "", toneMood: "", topic: "" };
  let inMeta = false;
  for (const line of lines) {
    if (/^##\s+Meta/i.test(line)) { inMeta = true; continue; }
    if (inMeta && /^##\s/.test(line)) { inMeta = false; break; }
    if (inMeta) {
      const palMatch = line.match(/\*\*Color Palette\*\*:\s*(.+)/i);
      if (palMatch) meta.colorPalette = palMatch[1].trim();
      const toneMatch = line.match(/\*\*Tone\/Mood\*\*:\s*(.+)/i);
      if (toneMatch) meta.toneMood = toneMatch[1].trim();
      const topicMatch = line.match(/\*\*Topic\*\*:\s*(.+)/i);
      if (topicMatch) meta.topic = topicMatch[1].trim();
    }
  }

  // Build style anchor prefix from Meta
  const anchorParts = [];
  if (meta.toneMood) anchorParts.push(`Style: ${meta.toneMood}.`);
  if (meta.colorPalette) anchorParts.push(`Color palette: ${meta.colorPalette}.`);
  const styleAnchor = anchorParts.join(" ");

  // Parse NanoBanana tags
  const images = [];
  let currentSlide = null;
  const slideImageCount = {};

  for (const line of lines) {
    const slideMatch = line.match(/^###\s+(?:Slide|슬라이드)\s+(\d+)\s*[-–—]\s*(.+)/i);
    if (slideMatch) {
      currentSlide = {
        number: parseInt(slideMatch[1], 10),
        title: slideMatch[2].trim(),
      };
      continue;
    }

    const nbMatch = line.match(/^[-*]\s*NanoBanana:\s*(.+)/i);
    if (nbMatch && currentSlide) {
      const tagContent = nbMatch[1].trim();
      const pipeIndex = tagContent.indexOf("|");

      let description, prompt;
      if (pipeIndex !== -1) {
        description = tagContent.slice(0, pipeIndex).trim();
        prompt = tagContent.slice(pipeIndex + 1).trim();
      } else {
        description = tagContent;
        prompt = tagContent;
      }

      // Parse per-image aspect ratio hint: [1:1], [4:3], etc.
      let aspectRatio = "16:9"; // default
      const ratioMatch = prompt.match(/\[(\d+:\d+)\]/);
      if (ratioMatch) {
        aspectRatio = ratioMatch[1];
        prompt = prompt.replace(/\[\d+:\d+\]/, "").trim();
      }

      // Prepend style anchor (#6)
      if (styleAnchor) {
        prompt = `${styleAnchor} ${prompt}`;
      }

      // Generate slug and handle multiple images per slide (#10)
      const slideNum = currentSlide.number;
      slideImageCount[slideNum] = (slideImageCount[slideNum] || 0) + 1;
      const count = slideImageCount[slideNum];

      const slug = currentSlide.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 30);

      const nn = String(slideNum).padStart(2, "0");
      const suffix = count > 1 ? `-${String.fromCharCode(96 + count)}` : ""; // -b, -c, ...
      const filename = `slide-${nn}-${slug || "image"}${suffix}.png`;

      images.push({
        slideNumber: slideNum,
        slideTitle: currentSlide.title,
        description,
        prompt,
        aspectRatio,
        filename,
      });
    }
  }

  return { images, styleAnchor, meta };
}

// ---------------------------------------------------------------------------
// Safety filter handling (#2)
// ---------------------------------------------------------------------------
const SAFETY_MESSAGES = {
  SAFETY: "안전 필터에 의해 차단됨. 프롬프트에서 민감한 표현을 순화하세요.",
  IMAGE_SAFETY: "생성된 이미지가 안전 기준 미달. 프롬프트를 더 구체적/순화된 표현으로 수정하세요.",
  PROHIBITED_CONTENT: "저작권/IP 보호 콘텐츠 감지. 실존 브랜드/캐릭터/인물 대신 일반적 묘사를 사용하세요.",
  OTHER: "알 수 없는 이유로 차단됨. 프롬프트를 단순화하거나 묘사를 일반화하세요.",
  RECITATION: "기존 저작물과 유사도가 높아 차단됨. 독창적 묘사로 재작성하세요.",
};

function parseFinishReason(data) {
  const candidate = data.candidates?.[0];
  if (!candidate) {
    // Check for prompt-level block
    const blockReason = data.promptFeedback?.blockReason;
    if (blockReason) {
      return { blocked: true, reason: blockReason, message: SAFETY_MESSAGES[blockReason] || `차단 사유: ${blockReason}` };
    }
    return { blocked: true, reason: "NO_CANDIDATE", message: "API가 후보를 반환하지 않았습니다." };
  }

  const reason = candidate.finishReason;
  if (reason && reason !== "STOP" && reason !== "MAX_TOKENS") {
    return { blocked: true, reason, message: SAFETY_MESSAGES[reason] || `차단 사유: ${reason}` };
  }

  return { blocked: false };
}

// ---------------------------------------------------------------------------
// Gemini API call with retry (#1) and safety handling (#2)
// ---------------------------------------------------------------------------
async function generateImage(prompt, model, aspectRatio, imageSize, referenceImageBase64) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  // Build content parts
  const parts = [{ text: prompt }];

  // Chain mode: attach reference image (#5)
  if (referenceImageBase64) {
    parts.unshift({
      inline_data: {
        mime_type: "image/png",
        data: referenceImageBase64,
      },
    });
    parts[1].text = `Maintain the same visual style, color palette, and artistic approach as the reference image. ${parts[1].text}`;
  }

  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio, imageSize },
    },
  };

  // Retry with exponential backoff (#1)
  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      const delay = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : Math.pow(2, attempt + 1) * 1000 + Math.random() * 1000;
      console.log(`    ⏳ Rate limit (429) — ${(delay / 1000).toFixed(1)}초 대기 후 재시도 (${attempt + 1}/${maxRetries})`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    if (res.status === 403) {
      const err = await res.text();
      if (err.includes("PERMISSION_DENIED") || err.includes("billing")) {
        throw new Error("결제 활성화 필수: Free Tier에서는 이미지 생성이 차단됩니다. https://aistudio.google.com 에서 결제를 설정하세요.");
      }
      throw new Error(`Gemini API 403: ${err}`);
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API ${res.status}: ${err}`);
    }

    const data = await res.json();

    // Safety filter check (#2)
    const safety = parseFinishReason(data);
    if (safety.blocked) {
      throw new Error(`[${safety.reason}] ${safety.message}`);
    }

    const parts2 = data.candidates?.[0]?.content?.parts || [];
    for (const part of parts2) {
      if (part.inlineData) {
        return Buffer.from(part.inlineData.data, "base64");
      }
    }

    throw new Error("Gemini API가 이미지 데이터를 반환하지 않았습니다. 모델이 이미지 생성을 지원하는지 확인하세요.");
  }

  throw new Error(`Rate limit: ${maxRetries}회 재시도 후에도 429 에러. 잠시 후 다시 시도하세요.`);
}

// ---------------------------------------------------------------------------
// Sharp post-processing (#7)
// ---------------------------------------------------------------------------
async function optimizeImage(buffer, aspectRatio) {
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    // Sharp not available — skip optimization
    return buffer;
  }

  // Target dimensions based on aspect ratio
  const dimensions = {
    "16:9": { w: 1920, h: 1080 },
    "4:3": { w: 1440, h: 1080 },
    "1:1": { w: 1080, h: 1080 },
    "3:2": { w: 1620, h: 1080 },
    "9:16": { w: 1080, h: 1920 },
    "21:9": { w: 2520, h: 1080 },
  };
  const target = dimensions[aspectRatio] || dimensions["16:9"];

  return sharp(buffer)
    .resize(target.w, target.h, {
      fit: "cover",
      position: "centre",
      kernel: "lanczos3",
    })
    .png({ compressionLevel: 9, quality: 85 })
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Concurrency limiter
// ---------------------------------------------------------------------------
async function runSequentialOrConcurrent(tasks, limit, sequential) {
  if (sequential) {
    // Chain mode: sequential execution, pass results forward
    const results = [];
    for (const task of tasks) {
      const prev = results.length > 0 ? results[results.length - 1] : null;
      const r = await task(prev);
      results.push(r);
    }
    return results.map((value) => ({ status: "fulfilled", value }));
  }

  // Concurrent mode
  const results = [];
  const executing = new Set();

  for (const task of tasks) {
    const p = task(null).then((r) => {
      executing.delete(p);
      return r;
    });
    executing.add(p);
    results.push(p);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.allSettled(results);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const outlinePath = path.resolve(args.outline);
  if (!fs.existsSync(outlinePath)) {
    console.error(`Error: outline 파일을 찾을 수 없습니다: ${outlinePath}`);
    process.exit(1);
  }

  const { images, styleAnchor, meta } = parseOutline(outlinePath);
  if (images.length === 0) {
    console.log("NanoBanana: 태그가 없습니다. 이미지 생성을 건너뜁니다.");
    return;
  }

  console.log(`\n📋 ${images.length}개 이미지 발견:`);
  if (styleAnchor) console.log(`🎨 스타일 앵커: ${styleAnchor}`);
  console.log();

  for (const img of images) {
    const ratio = img.aspectRatio !== "16:9" ? ` [${img.aspectRatio}]` : "";
    console.log(`  Slide ${img.slideNumber}: ${img.description}${ratio}`);
    console.log(`    → ${img.filename}`);
    if (args.dry) {
      console.log(`    prompt: ${img.prompt.slice(0, 120)}...`);
    }
  }

  if (args.dry) {
    console.log("\n--dry 모드: 실제 API 호출 없이 종료합니다.");
    return;
  }

  // Ensure output directory
  const outputDir = path.resolve(args.output || path.join(path.dirname(outlinePath), "assets"));
  fs.mkdirSync(outputDir, { recursive: true });

  const concurrency = parseInt(args.concurrency, 10) || 2;
  const chainMode = args.chain;

  console.log(`\n🎨 이미지 생성 시작`);
  console.log(`   모델: ${args.model}`);
  console.log(`   모드: ${chainMode ? "체인 (순차, 참조 이미지 연결)" : `병렬 (동시 ${concurrency}개)`}`);
  console.log(`   후처리: ${args.optimize ? "Sharp 리사이즈+압축" : "없음"}`);
  console.log();

  let firstImageBase64 = null;

  const tasks = images.map((img) => async (prevResult) => {
    const outPath = path.join(outputDir, img.filename);

    // Skip logic: --force overrides, --regenerate targets specific slides
    const shouldRegenerate = args.force || regenerateSlides.has(img.slideNumber);
    if (fs.existsSync(outPath) && !shouldRegenerate) {
      console.log(`  ⏭  Slide ${img.slideNumber}: ${img.filename} (이미 존재, 건너뜀)`);
      // In chain mode, load existing image as reference
      if (chainMode && !firstImageBase64) {
        firstImageBase64 = fs.readFileSync(outPath).toString("base64");
      }
      return { slide: img.slideNumber, status: "skipped" };
    }

    try {
      console.log(`  🔄 Slide ${img.slideNumber}: 생성 중...`);

      // Chain mode: use first image as reference for subsequent (#5)
      const refImage = chainMode ? firstImageBase64 : null;

      const buffer = await generateImage(img.prompt, args.model, img.aspectRatio, args.size, refImage);

      // Post-processing (#7)
      let finalBuffer = buffer;
      if (args.optimize) {
        finalBuffer = await optimizeImage(buffer, img.aspectRatio);
      }

      fs.writeFileSync(outPath, finalBuffer);

      // Store first successful image for chain mode
      if (chainMode && !firstImageBase64) {
        firstImageBase64 = buffer.toString("base64");
      }

      const sizeKB = (finalBuffer.length / 1024).toFixed(0);
      console.log(`  ✅ Slide ${img.slideNumber}: ${img.filename} (${sizeKB}KB)`);
      return { slide: img.slideNumber, status: "ok", size: finalBuffer.length };
    } catch (err) {
      console.error(`  ❌ Slide ${img.slideNumber}: ${err.message}`);
      return { slide: img.slideNumber, status: "error", error: err.message };
    }
  });

  const results = await runSequentialOrConcurrent(tasks, concurrency, chainMode);

  // Summary
  const ok = results.filter((r) => r.value?.status === "ok").length;
  const skipped = results.filter((r) => r.value?.status === "skipped").length;
  const failed = results.filter((r) => r.value?.status === "error").length;

  console.log(`\n📊 결과: 성공 ${ok}, 건너뜀 ${skipped}, 실패 ${failed}`);
  console.log(`📁 저장 위치: ${outputDir}`);

  if (failed > 0) {
    console.log("\n💡 실패한 이미지만 재생성하려면:");
    const failedSlides = results
      .filter((r) => r.value?.status === "error")
      .map((r) => r.value.slide)
      .join(",");
    console.log(`   node scripts/generate-images.mjs --outline ${args.outline} --output ${args.output || outputDir} --regenerate ${failedSlides}`);
    process.exit(1);
  }
}

main();
