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
// Aspect ratio → pixel dimensions (single source of truth)
// ---------------------------------------------------------------------------
const ASPECT_DIMENSIONS = {
  "16:9": { w: 1920, h: 1080 },
  "4:3": { w: 1440, h: 1080 },
  "3:4": { w: 1080, h: 1440 },
  "1:1": { w: 1080, h: 1080 },
  "3:2": { w: 1620, h: 1080 },
  "2:3": { w: 1080, h: 1620 },
  "9:16": { w: 1080, h: 1920 },
  "21:9": { w: 2520, h: 1080 },
};

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
    concurrency: { type: "string", default: "3" },
    dry: { type: "boolean", default: false },
    chain: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    regenerate: { type: "string", default: "" },
    optimize: { type: "boolean", default: true },
    vqa: { type: "boolean", default: false },
    "vqa-only": { type: "boolean", default: false },
    "update-scores": { type: "boolean", default: false },
    "check-outline": { type: "boolean", default: false },
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

    // Optimize if enabled (reuse optimizeImage to avoid duplication)
    if (args.optimize) {
      const optimized = await optimizeImage(buffer, ar);
      buffer = optimized.buffer;
      if (optimized.width > 0) {
        console.log(`   해상도: ${optimized.width}×${optimized.height} (${ar})`);
      }
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
  --concurrency <n>    Parallel API calls (default: 3)
  --chain              Use first image as style reference for subsequent images
  --force              Regenerate all images (overwrite existing)
  --regenerate <n,...>  Regenerate specific slides (e.g. --regenerate 3,5,8)
  --optimize           Sharp post-processing: resize to 1920x1080 + compress (default: true)
  --no-optimize        Skip post-processing
  --dry                Parse only, no API calls
  --vqa                Enable Gemini Vision VQA scoring (5-criteria quality assessment)
  --vqa-only           Run VQA on existing images without regenerating (reads assets/ + meta.json)
  --update-scores      Merge VQA keyword scores into .claude/docs/nanoBanana-prompt-scores.json
  --check-outline      Validate outline prompts against cumulative keyword DB (no generation)`);
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
  // Strip hex codes from palette before injecting into prompt (Gemini renders them as text in images)
  // Skip non-Latin Tone/Mood (Korean etc.) — IP-01 would reject the prompt
  const anchorParts = [];
  if (meta.toneMood) {
    if (/[\uAC00-\uD7AF\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(meta.toneMood))
      console.warn(`⚠️  Tone/Mood에 CJK 문자 감지 ("${meta.toneMood}") — 영어로 작성하세요. 스타일 앵커에서 제외됩니다.`);
    else
      anchorParts.push(`Style: ${meta.toneMood}.`);
  }
  if (meta.colorPalette) {
    const paletteNoHex = meta.colorPalette.replace(/#[0-9A-Fa-f]{3,8}/g, "").replace(/\s{2,}/g, " ").trim();
    anchorParts.push(`Color palette: ${paletteNoHex}.`);
  }
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
      // Skip "없음" (no image) tags
      if (/^없음$/i.test(tagContent)) continue;
      const pipeIndex = tagContent.indexOf("|");

      let description, prompt;
      if (pipeIndex !== -1) {
        const beforePipe = tagContent.slice(0, pipeIndex).trim();
        const afterPipe = tagContent.slice(pipeIndex + 1).trim();
        // Auto-detect pipe direction: if afterPipe has CJK (Korean/Japanese/Chinese),
        // the author likely wrote "English prompt | Korean layout hint" — swap them
        const afterHasCJK = /[\uAC00-\uD7AF\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(afterPipe);
        const beforeHasCJK = /[\uAC00-\uD7AF\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/.test(beforePipe);
        if (afterHasCJK && !beforeHasCJK) {
          // Swap: English before pipe is the prompt, Korean after pipe is the label
          description = afterPipe;
          prompt = beforePipe;
        } else {
          description = beforePipe;
          prompt = afterPipe;
        }
      } else {
        description = tagContent;
        prompt = tagContent;
      }

      // Parse optional tier hint: | tier:N
      let tier = null;
      const tierMatch = prompt.match(/\|\s*tier:(\d)/);
      if (tierMatch) {
        tier = parseInt(tierMatch[1], 10);
        prompt = prompt.replace(/\|\s*tier:\d/, "").trim();
      }

      // Parse per-image aspect ratio hint: [1:1], [4:3], etc.
      let aspectRatio = "16:9"; // default
      const ratioMatch = prompt.match(/\[(\d+:\d+)\]/);
      if (ratioMatch) {
        aspectRatio = ratioMatch[1];
        prompt = prompt.replace(/\[\d+:\d+\]/, "").trim();
      }

      // Parse icon-set hint: icon-set:NxM
      let iconSet = null;
      const iconSetMatch = prompt.match(/icon-set:(\d)x(\d)/);
      if (iconSetMatch) {
        iconSet = { rows: parseInt(iconSetMatch[1], 10), cols: parseInt(iconSetMatch[2], 10) };
        prompt = prompt.replace(/icon-set:\d+x\d+/, "").trim();
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
        tier,
        iconSet,
      });
    }
  }

  // Parse palette colors for IV-09 compliance checking
  const paletteColors = parsePaletteFromMeta(meta);
  if (paletteColors.length > 0) {
    for (const img of images) {
      img._paletteColors = paletteColors;
    }
  }

  // D3: Extract paletteHexMap (name→hex) for hex injection into frame/icon prompts
  const paletteHexMap = {};
  if (meta.colorPalette) {
    // Match patterns like "Navy (#1E3A5F)" or "Navy #1E3A5F" or "navy(#1E3A5F)"
    const pairMatches = meta.colorPalette.matchAll(/(\w[\w\s]*?)\s*[\(:]?\s*(#[0-9A-Fa-f]{6})\s*\)?/g);
    for (const m of pairMatches) {
      const name = m[1].trim().replace(/\s+/g, " ");
      paletteHexMap[name] = m[2].toUpperCase();
    }
  }

  return { images, styleAnchor, meta, paletteHexMap };
}

// ---------------------------------------------------------------------------
// Low-pf shape word substitution map (Gemini Flash confuses these words' counts)
// When a shape noun has consistently low prompt_fidelity in the keyword DB,
// we replace it with a clearer synonym that Flash handles better.
// ---------------------------------------------------------------------------
const SHAPE_WORD_SYNONYMS = {
  segments: "sections",
  segment: "section",
  tiers: "layers",
  tier: "layer",
  nodes: "dots",
  node: "dot",
  points: "circles",
  point: "circle",
  stages: "levels",
  stage: "level",
  steps: "levels",
  step: "level",
  wedges: "slices",
  wedge: "slice",
};

// Load keyword DB for pf-score lookup (lazy, cached)
let _kwDbCache;
function getKeywordDB() {
  if (_kwDbCache !== undefined) return _kwDbCache;
  try {
    const dbPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", ".claude", "docs", "nanoBanana-prompt-scores.json");
    _kwDbCache = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
  } catch {
    _kwDbCache = null;
  }
  return _kwDbCache;
}

/**
 * Check if a shape noun has low prompt_fidelity in the keyword DB (frame category).
 * Returns true if the word has pf < 3.0 with count >= 3.
 */
function isLowPfShapeWord(word) {
  const db = getKeywordDB();
  if (!db?.frame) return false;
  const entry = db.frame[word];
  return entry && entry.count >= 3 && (entry.pf || entry.avg) < 3.0;
}

// ---------------------------------------------------------------------------
// Prompt auto-enhancement (#11)
// ---------------------------------------------------------------------------
function enhancePrompt(prompt, img, paletteHexMap = {}) {
  let enhanced = prompt;

  // Strip hex codes from prompt body (Gemini renders them as text — Round 3 lesson)
  enhanced = enhanced.replace(/#[0-9A-Fa-f]{3,8}/g, "").replace(/\s{2,}/g, " ");

  // Auto-add "no text" if missing
  if (!/no text/i.test(enhanced)) {
    enhanced += " No text whatsoever.";
  }

  // Auto-add aspect ratio mention if missing
  if (img.aspectRatio && !new RegExp(img.aspectRatio.replace(":", "\\s*[:/]\\s*")).test(enhanced)) {
    enhanced += ` ${img.aspectRatio} aspect ratio.`;
  }

  // Frame/diagram: "white background" → "light gray background" to prevent IV-03 brightness FAIL (Round 3 lesson)
  const isFrameOrDiagram = /\b(frame|timeline|process|funnel|pyramid|comparison|matrix|diagram|radial|venn|staircase|hub|flowchart|chevron|org\s*chart|bar\s*chart|donut|scatter|gauge|ring|progress)\b/i.test(enhanced);
  if (isFrameOrDiagram) {
    enhanced = enhanced.replace(/\bwhite background\b/gi, "light gray background");
    if (!/flat vector|clean vector/i.test(enhanced)) {
      enhanced += " Clean flat vector style.";
    }
    // Strip evocative style words that cause Flash to render physical objects instead of abstract diagrams
    enhanced = enhanced.replace(/\b(regal|luxurious|organic|artisan|rustic|vintage|antique|ornate|opulent|classical)\b/gi, "");
    // Reinforce abstract nature — prevent Flash from interpreting diagrams as physical objects
    enhanced += " Abstract vector graphic.";
    // A1: Composition offset — centered diagrams leave no space for text overlay
    if (/\b(hub|spoke|pyramid|radial|venn|donut|pie|ring|gauge)\b/i.test(enhanced)) {
      enhanced += " Main element offset left.";
    }
    // C2: Frame/diagram anti-label — prevent Flash from adding annotations to diagrams
    enhanced += " No labels or annotations.";
    // D3: Hex color injection for frame/icon — Gemini ignores "Accent orange" but respects hex codes
    // Max 2 colors, hex-only format to stay within IP-08 600-char limit
    if (Object.keys(paletteHexMap).length > 0) {
      const hexes = Object.values(paletteHexMap).slice(0, 2);
      enhanced += ` Colors: ${hexes.join(", ")}.`;
      console.log(`  🎨 Hex injection: ${hexes.join(", ")}`);
    }
    // D1: Chevron rewrite: "arrow-shaped" → "pointed" (R46-R55: "arrow-shaped sections" consistently lowest PF)
    if (/\bchevron\b/i.test(enhanced)) {
      enhanced = enhanced.replace(/\barrow-shaped\b/gi, "pointed");
      console.log(`  🔄 Chevron rewrite: "arrow-shaped" → "pointed"`);
    }
    // D5: Hub-spoke rewrite: explicit radial layout description (R46-R55: node count unstable, PF avg 21-23)
    if (/\bhub[- ]?spoke\b/i.test(enhanced)) {
      enhanced = enhanced.replace(/\bhub[- ]?spoke\s+diagram\b/gi, "radial connection diagram");
      const nodeMatch = enhanced.match(/\b(\d+)\s+(?:small\s+)?(?:circles?|nodes?|dots?)\b/i);
      if (nodeMatch) {
        const n = nodeMatch[1];
        enhanced += ` One large circle in center, ${n} small circles evenly spaced around it, connected by lines.`;
      }
      console.log(`  🔄 Hub-spoke rewrite: → "radial connection diagram" with explicit layout`);
    }
    // Staircase rewrite v2: replace with bar chart vocabulary (R56: "stepped/stairs/taller" flagged 비추천)
    if (/\bstaircase\b/i.test(enhanced)) {
      enhanced = enhanced.replace(/\bstaircase\b/gi, "bar chart");
      enhanced = enhanced.replace(/\b(\d+)\s+ascending\s+(?:steps?|blocks?)\b/gi, "$1 bars of increasing height");
      enhanced = enhanced.replace(/\bsteps?\b/gi, "bars");
      console.log(`  🔄 Staircase rewrite v2: → "bar chart / bars of increasing height"`);
    }
    // Low-pf shape word substitution: replace words Gemini consistently miscounts
    for (const [bad, good] of Object.entries(SHAPE_WORD_SYNONYMS)) {
      if (new RegExp(`\\b${bad}\\b`, "i").test(enhanced) && isLowPfShapeWord(bad)) {
        enhanced = enhanced.replace(new RegExp(`\\b${bad}\\b`, "gi"), good);
        console.log(`  🔄 Shape word substitution: "${bad}" → "${good}" (low pf in keyword DB)`);
      }
    }
    // Reinforce element count — Flash often adds extra elements (Round 9: slides 5,20 had wrong counts)
    const shapeNouns = "bars?|segments?|circles?|sections?|layers?|chevrons?|nodes?|wedges?|steps?|blocks?|pairs?|lines?|axes?|diamonds?|hexagons?|squares?|rectangles?|points?|arrows?|dots?|slices?|levels?";
    const countMatch = enhanced.match(new RegExp(`\\b(\\d+)\\s+(?:[\\w-]+\\s+){0,2}(${shapeNouns})\\b`, "i"));
    if (countMatch) {
      const n = parseInt(countMatch[1]);
      const shape = countMatch[2];
      // Count compensation: shapes with low pf in DB get N-1 request (Gemini adds +1)
      const shapeBase = shape.replace(/s$/, "");
      const dbEntry = getKeywordDB()?.frame?.[shapeBase] || getKeywordDB()?.frame?.[shape];
      // A4: Hardcode N-1 for 3-element hub-spoke only (R41-R45: 33% accuracy at count=3)
      // R64: donut/ring removed — Gemini respects donut count accurately
      // R65: chevron/pointed removed — compensation makes it worse (generates exactly N-1, not N)
      const hardcodeCompensation = n === 3 && /\b(hub|spoke)\b/i.test(enhanced);
      const needsCompensation = hardcodeCompensation || (dbEntry && dbEntry.pf !== undefined && dbEntry.pf < 2.5 && dbEntry.count >= 5);
      const adjustedN = needsCompensation && n > 2 ? n - 1 : n;
      if (needsCompensation && n > 2) {
        console.log(`  🔢 Count compensation: ${n} → ${adjustedN} ${shape} (pf=${dbEntry.pf}, Gemini tends to add +1)`);
      }
      enhanced += ` Exactly ${adjustedN} ${shape}, no more no less.`;
    }
  }

  // D3: Hex injection for icon category (not caught by isFrameOrDiagram above)
  const isIconCategory = img.iconSet || (img.aspectRatio === "1:1" && /icon/i.test(enhanced));
  if (isIconCategory && !isFrameOrDiagram && Object.keys(paletteHexMap).length > 0) {
    const hexes = Object.values(paletteHexMap).slice(0, 2);
    enhanced += ` Colors: ${hexes.join(", ")}.`;
    console.log(`  🎨 Hex injection (icon): ${hexes.join(", ")}`);
  }

  // Cover: reinforce gradient/texture simplicity
  const isCover = /\bcover\b/i.test(img.slideTitle || "");
  if (isCover && !/negative space/i.test(enhanced)) {
    enhanced += " Large empty area for text overlay.";
  }

  // Photographic: reinforce sharpness and cinematic quality
  const isPhoto = /\b(cinematic|photograph|photo|aerial|drone|macro|close-up)\b/i.test(enhanced);
  if (isPhoto && !/sharp|focus/i.test(enhanced)) {
    enhanced += " Sharp focus, high quality.";
  }

  // Metaphor/photo: composition depends on layout context
  // Split layout (4:3, 3:4): text is in a separate column, NOT overlaid on image
  //   → subject must fill the frame; negative space wastes the small image area
  // Full-width (16:9): text may overlay the image
  //   → negative space needed for readability
  const isSplitLayout = /^(4:3|3:4|1:1)$/.test(img.aspectRatio || "");
  if (isPhoto && !isCover && !isFrameOrDiagram) {
    if (isSplitLayout && !/fills? the frame|centered composition/i.test(enhanced)) {
      enhanced += " Subject fills the frame with centered composition, no large empty areas.";
    } else if (!isSplitLayout && !/negative space|empty area|text overlay/i.test(enhanced)) {
      enhanced += " Ample negative space on one side for text overlay.";
    }
  }

  // IP-11 subjects with inherent text: reinforce "no text" to improve text_absence score
  if (/\b(compass|clock|watch|gauge|meter|speedometer|thermometer|calendar|keyboard|calculator|scoreboard|dashboard)\b/i.test(enhanced)) {
    enhanced += " Absolutely no text, no letters, no numbers, no markings.";
  }

  // Metaphor/photo with natural subjects: palette colors conflict with natural lighting (Round 9: slides 9,13)
  // Don't inject palette colors into prompts for subjects that have inherent natural colors
  if (isPhoto && !isCover && /\b(cherry|blossom|flower|sunset|sunrise|rainbow|prism|aurora|lava|fire|autumn|leaves|ocean|coral)\b/i.test(enhanced)) {
    enhanced += " Use natural realistic colors appropriate to the subject, not artificial color palette.";
  }

  // Tier-based adjustment: Tier 1 = simpler, Tier 2+ = can be more detailed
  if (img.tier === 1) {
    // Tier 1: ensure prompt stays under 80 words for Flash
    const words = enhanced.split(/\s+/);
    if (words.length > 80) {
      enhanced = words.slice(0, 75).join(" ") + ". No text.";
    }
  }

  // Icon set: reinforce consistency parameters
  if (img.iconSet) {
    if (!/\bstroke\b/i.test(enhanced)) {
      enhanced += " Uniform 2px stroke weight, rounded corners.";
    }
    if (!/\bgrid\b/i.test(enhanced)) {
      enhanced += ` ${img.iconSet.rows}x${img.iconSet.cols} grid layout.`;
    }
  }

  // Texture/pattern backgrounds: reinforce subtlety
  if (/\b(texture|pattern|grain|linen|paper|fabric|marble|concrete|wood)\b/i.test(enhanced) && /background/i.test(img.slideTitle || "")) {
    if (!/subtle|understated|faint/i.test(enhanced)) {
      enhanced += " Very subtle, understated texture.";
    }
  }

  return enhanced;
}

// ---------------------------------------------------------------------------
// Retry prompt mutation (#13)
// ---------------------------------------------------------------------------
function mutatePromptForRetry(prompt, attempt, vqaFeedback = null) {
  // VQA-guided retry: use specific reason feedback to improve prompt
  if (vqaFeedback && vqaFeedback.scores) {
    const s = vqaFeedback.scores;
    const r = vqaFeedback.reasons || {};

    // Start from original prompt, apply targeted fixes
    let mutated = prompt;

    // Low prompt fidelity → use reason to guide correction
    if (s.prompt_fidelity <= 2) {
      // Simplify to core 2 sentences to reduce confusion
      const sentences = mutated.split(/\.\s+/);
      mutated = sentences.slice(0, 2).join(". ") + ".";
      if (r.pf_reason) {
        // Inject correction based on VQA reason
        mutated += ` Important: ${r.pf_reason.replace(/^(shows?|generated?|created?)\s+/i, "avoid ")}. `;
      }
    }

    // Text detected → concise no-text boost
    if (s.text_absence <= 3) {
      mutated += " No text, no watermarks, no symbols.";
    }

    // Low color harmony → use reason or generic fix
    if (s.color_harmony <= 2) {
      mutated += r.ch_reason ? ` Fix: ${r.ch_reason}.` : " Cool blue tones.";
    }

    // Low composition → use reason or generic fix
    if (s.composition <= 2) {
      mutated += r.co_reason ? ` Fix: ${r.co_reason}.` : " Clear focal point, negative space.";
    }

    // A3: Preserve count phrase before truncation
    const countPhrase = mutated.match(/Exactly \d+ \w+, no more no less\./)?.[0] || "";
    // A2: Enforce max length to prevent NO_IMAGE (Gemini rejects overly long prompts)
    if (mutated.length > 600) {
      const sentences = mutated.split(/\.\s+/);
      mutated = "";
      for (const s of sentences) {
        if ((mutated + s).length > 580) break;
        mutated += (mutated ? ". " : "") + s;
      }
      mutated += ". No text.";
      // A3: Re-inject count phrase if lost during truncation
      if (countPhrase && !mutated.includes("Exactly")) mutated += " " + countPhrase;
    }

    return mutated;
  }

  // B3: Drastic simplification on attempt ≥ 2 — reduce to core description only
  if (attempt >= 2 && !vqaFeedback) {
    const sentences = prompt.split(/\.\s+/).filter(s => s.length > 10);
    return sentences.slice(0, 2).join(". ") + ". Simple flat illustration, clean design. No text, no labels.";
  }

  // Fallback: blind mutation (for IV failures without VQA data)
  if (attempt === 1) {
    return prompt
      .replace(/\b(soft|warm|ambient)\b/gi, "dramatic")
      .replace(/\b(wide-angle|bird's-eye)\b/gi, "elevated 45-degree")
      + " High contrast, cinematic lighting.";
  }
  if (attempt === 2) {
    return prompt
      .replace(/\b(cinematic|dramatic|elaborate|intricate)\b/gi, "clean")
      .replace(/\b(complex|detailed)\b/gi, "simple")
      + " Simple composition, bold colors.";
  }
  const sentences = prompt.split(/\.\s+/);
  return sentences.slice(0, 2).join(". ") + ". Minimal flat design, clean vector style. No text.";
}

// ---------------------------------------------------------------------------
// Tier auto-estimation (#16)
// ---------------------------------------------------------------------------
function estimateTier(prompt) {
  const conceptIndicators = [
    /\b(chart|graph|table|data|statistic|comparison|matrix|versus|vs)\b/gi,
    /\b(process|flow|step|stage|pipeline|workflow|timeline)\b/gi,
    /\b(icon|symbol|badge|logo)\b/gi,
  ];
  let conceptCount = 0;
  for (const pattern of conceptIndicators) {
    const matches = prompt.match(pattern);
    if (matches) conceptCount += matches.length;
  }
  if (conceptCount >= 6) return 3;
  if (conceptCount >= 3) return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// IP (Image Preflight) — pre-generation prompt validation
// ---------------------------------------------------------------------------
function checkImagePreflight(img) {
  const issues = [];
  if (/[\uAC00-\uD7AF]/.test(img.prompt))
    issues.push({ rule: "IP-01", level: "ERROR", msg: "Korean text in prompt" });
  if (img.tier >= 3)
    issues.push({ rule: "IP-02", level: "WARN", msg: "Tier 3 — HTML chart recommended" });
  if (img.aspectRatio === "1:1" && !/icon/i.test(img.prompt))
    issues.push({ rule: "IP-03", level: "WARN", msg: "1:1 ratio without icon keyword" });
  if (/\d+%|\$\d+/.test(img.prompt))
    issues.push({ rule: "IP-04", level: "ERROR", msg: "Numeric data in prompt — fake data risk" });
  if (/\b(text:|labeled|with caption|with text|showing text|infographic with)\b/i.test(img.prompt))
    issues.push({ rule: "IP-05", level: "ERROR", msg: "Text rendering keywords detected — Flash will generate fake data" });
  if (/"[^"]{2,}"/.test(img.prompt))
    issues.push({ rule: "IP-07", level: "ERROR", msg: "Quoted text in prompt — will render as fake label" });
  if (img.prompt.length < 20)
    issues.push({ rule: "IP-06", level: "WARN", msg: "Prompt too short for quality output" });
  // IP-08: Prompt length cap (#6)
  if (img.prompt.length > 600)
    issues.push({ rule: "IP-08", level: "WARN", msg: `Prompt too long (${img.prompt.length} chars > 600) — Flash may ignore parts` });
  // IP-09: Prompt-ratio mismatch (#7)
  if (img.aspectRatio && /^(3:4|2:3|9:16)$/.test(img.aspectRatio) && /\b(panoramic|wide-angle|ultrawide|cinematic wide)\b/i.test(img.prompt))
    issues.push({ rule: "IP-09", level: "WARN", msg: `Portrait ratio ${img.aspectRatio} with wide-angle keywords — mismatch` });
  // B2: "vertical bar chart" — vertical describes bar direction, not image orientation
  const verticalPrompt = img.prompt || "";
  const hasVerticalMismatch = /\b(tall|towering|portrait)\b/i.test(verticalPrompt) ||
    (/\bvertical\b/i.test(verticalPrompt) && !/\bvertical\s+(bar|column|chart)\b/i.test(verticalPrompt));
  if (img.aspectRatio && /^(16:9|21:9|3:2)$/.test(img.aspectRatio) && hasVerticalMismatch)
    issues.push({ rule: "IP-09", level: "WARN", msg: `Landscape ratio ${img.aspectRatio} with vertical keywords — mismatch` });
  // IP-11: Inherent-text subject warning — objects that naturally contain text/numbers
  if (/\b(compass|clock|watch|gauge|meter|speedometer|thermometer|calendar|keyboard|calculator|scoreboard|license\s*plate|sign|billboard|newspaper|book\s+cover|magazine|receipt|ticket|passport|diploma|certificate|barcode|qr\s*code|price\s*tag|menu|remote\s*control|phone\s*screen|laptop\s*screen|monitor|dashboard|control\s*panel)\b/i.test(img.prompt))
    issues.push({ rule: "IP-11", level: "WARN", msg: "Subject inherently contains text/numbers — VQA text_absence score may be low" });
  // IP-14: Color tone conflict detection — warm keywords + cool palette (or vice versa)
  // Requires: ≥2 warm/cool keyword matches AND majority of palette colors (>50%) conflict
  const warmKeywords = /\b(warm|golden|amber|sunset|sunrise|orange|red|fire|flame|autumn|candle|copper|brass|terracotta)\b/gi;
  const coolKeywords = /\b(cool|icy|frozen|arctic|winter|blue|navy|teal|cyan|cold|steel|silver|frost)\b/gi;
  const warmMatches = (img.prompt.match(warmKeywords) || []).length;
  const coolMatches = (img.prompt.match(coolKeywords) || []).length;
  const colors = img._paletteColors || [];
  const warmColors = colors.filter(c => c.r > c.b + 60).length;  // stricter: +60 (was +40)
  const coolColors = colors.filter(c => c.b > c.r + 60).length;
  const majority = Math.ceil(colors.length / 2);
  if (warmMatches >= 2 && coolColors >= majority)
    issues.push({ rule: "IP-14", level: "WARN", msg: `Warm keywords (${warmMatches}) conflict with cool-dominant palette (${coolColors}/${colors.length}) — IV-09 may flag` });
  if (coolMatches >= 2 && warmColors >= majority && warmMatches < 2)
    issues.push({ rule: "IP-14", level: "WARN", msg: `Cool keywords (${coolMatches}) conflict with warm-dominant palette (${warmColors}/${colors.length}) — IV-09 may flag` });
  // IP-13: Staircase element count — Gemini consistently miscounts (PF avg 2-3)
  if (/\bstaircase\b/i.test(img.prompt))
    issues.push({ rule: "IP-13", level: "WARN", msg: "Staircase element count unreliable — consider HTML chart" });
  // IP-16: Excessive hex color codes — Gemini can't match specific hex tones (T4 lesson: PF drops)
  {
    const hexMatches = (img.prompt || "").match(/#[0-9A-Fa-f]{6}/g) || [];
    if (hexMatches.length >= 3)
      issues.push({ rule: "IP-16", level: "WARN", msg: `${hexMatches.length} hex color codes in prompt — Gemini ignores specific hex tones, use natural color names instead` });
  }
  // IP-15: VQA keyword compliance — check if prompt uses recommended keywords (target 2-4 per category)
  {
    const db = getKeywordDB();
    if (db) {
      const promptLower = (img.prompt || "").toLowerCase();
      // Detect prompt category
      const isIcon = img.iconSet || (img.aspectRatio === "1:1" && /icon/i.test(img.prompt));
      const isFrame = /\b(frame|timeline|process|funnel|pyramid|comparison|flowchart|chevron|donut|bar\s*chart)\b/i.test(img.prompt);
      const isCover = /\b(cover|presentation cover)\b/i.test(img.prompt) || /\b(cover|closing)\b/i.test(img.slideTitle || "");
      const isBg = /\b(slide background|presentation background|background for|paper texture|fiber pattern|linen texture)\b/i.test(img.prompt);
      const cat = isIcon ? "icon" : isFrame ? "frame" : isCover ? "cover" : isBg ? "background" : "metaphor";
      const catData = db[cat];
      if (catData) {
        const top5 = Object.entries(catData)
          .filter(([k, v]) => !k.startsWith("_") && v.count >= 3)
          .sort((a, b) => (b[1].ucb_score || 0) - (a[1].ucb_score || 0))
          .slice(0, 10);
        const hits = top5.filter(([kw]) => promptLower.includes(kw.toLowerCase()));
        if (hits.length === 0)
          issues.push({ rule: "IP-15", level: "WARN", msg: `No VQA-recommended ${cat} keywords found — add 2-4 for better quality` });
        else if (hits.length === 1)
          issues.push({ rule: "IP-15", level: "INFO", msg: `Only 1 ${cat} keyword hit (${hits[0][0]}) — target 2-4` });
        else if (hits.length > 6)
          issues.push({ rule: "IP-15", level: "WARN", msg: `Excessive ${cat} keyword density (${hits.length} hits) — keep 2-4 for natural prompts` });
      }
    }
  }
  // Tier auto-estimation warning (#16)
  if (img.tier) {
    const estimated = estimateTier(img.prompt);
    if (Math.abs(estimated - img.tier) >= 2)
      issues.push({ rule: "IP-10", level: "WARN", msg: `Tier mismatch: specified ${img.tier}, estimated ${estimated} from prompt keywords` });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// IV (Image Validate) — post-generation metadata validation
// ---------------------------------------------------------------------------
function validateImage(img, buffer, finishReason, brightness, sharpStats) {
  const issues = [];
  if (finishReason === "SAFETY")
    issues.push({ rule: "IV-01", level: "FAIL", msg: "Safety filter blocked" });

  // IV-03: White design exception (#8)
  const isIconType = img.iconSet || (img.aspectRatio === "1:1" && /icon/i.test(img.prompt));
  const isFrameType = /\b(frame|timeline|process|funnel|pyramid|comparison|matrix|cover|minimalist|diagram|radial|venn|staircase|hub|flowchart|org\s*chart|gauge|meter)\b/i.test(img.prompt);
  const isWhiteDesign = /\bwhite\b/i.test(img.prompt) && /\b(minimalist|minimal)\b/i.test(img.prompt);

  let brightThreshold;
  if (isWhiteDesign) {
    brightThreshold = 255; // effectively disabled
    issues.push({ rule: "IV-03", level: "WARN", msg: "White minimalist design — brightness check relaxed" });
  } else if (isIconType || isFrameType) {
    brightThreshold = 252;
  } else {
    brightThreshold = 240;
  }

  if (brightness > brightThreshold)
    issues.push({ rule: "IV-03", level: "FAIL", msg: `Near-white image (brightness ${Math.round(brightness)} > ${brightThreshold})` });

  // IV-05: File size check — relaxed for icon/frame (minimal vector designs are legitimately small)
  const minFileSize = (isIconType || isFrameType) ? 5120 : 10240;
  if (buffer.length < minFileSize)
    issues.push({ rule: "IV-05", level: "FAIL", msg: `File too small (<${minFileSize / 1024}KB)` });
  const isDarkSubject = /\b(cover|night|dark|midnight|starry|neon|표지|야경)\b/i.test(img.slideTitle || img.prompt || "");
  if (brightness < 30 && !isDarkSubject)
    issues.push({ rule: "IV-02", level: "WARN", msg: "Very dark image" });

  // Shared: detect photographic content (used by IV-09 and IV-10)
  const isPhotographic = /\b(cinematic|photograph|photo|aerial|drone|macro|close-up|silhouette|long exposure|portrait|landscape)\b/i.test(img.prompt || "");

  // IV-09: Color palette compliance (#9) — requires sharpStats
  // Check if ANY of the top-3 dominant colors is close to ANY palette color
  if (sharpStats && sharpStats.dominantColors && img._paletteColors && img._paletteColors.length > 0) {
    const bestDist = Math.min(
      ...sharpStats.dominantColors.flatMap((dc) => img._paletteColors.map((pc) => colorDistance(dc, pc))),
    );
    // B1: Natural subject photos (cherry blossom, sunset, etc.) have inherent colors — extra relaxation
    const isNaturalSubject = /\b(cherry|blossom|flower|sunset|sunrise|rainbow|aurora|lava|fire|autumn|leaves|ocean|coral|forest|garden|mountain|beach|sky|cloud)\b/i.test(img.prompt || "");
    const paletteThreshold = (isPhotographic && isNaturalSubject) ? 200 : isPhotographic ? 120 : 80;
    if (bestDist > paletteThreshold)
      issues.push({ rule: "IV-09", level: "WARN", msg: `No dominant color near palette (min dist=${Math.round(bestDist)}, threshold=${paletteThreshold})` });
  }

  // IV-10: Complexity-tier match (#10) — requires sharpStats
  // Cover/background: low edge density normal. Photos: high edge density normal.
  if (sharpStats && sharpStats.edgeDensity != null && img.tier) {
    const ed = sharpStats.edgeDensity;
    const isCoverOrBg = /\b(cover|background|배경|표지)\b/i.test(img.slideTitle || "");
    const isFrame = /\b(frame|timeline|process|funnel|pyramid|comparison|matrix|diagram|radial|venn|staircase|hub|flowchart|org\s*chart|chevron|donut|scatter|gauge|bar\s*chart|pie|ring|progress)\b/i.test(img.prompt || "");
    const tierRanges = (isCoverOrBg)
      ? { 1: [0.0, 0.25], 2: [0.0, 0.35], 3: [0.01, 0.45] }
      : isFrame  // vector diagrams — naturally low edge density
        ? { 1: [0.0, 0.40], 2: [0.0, 0.50], 3: [0.01, 0.60] }
      : isPhotographic  // cinematic, aerial, macro, etc. — naturally high edge density
        ? { 1: [0.02, 0.50], 2: [0.05, 0.60], 3: [0.10, 0.70] }
        : { 1: [0.02, 0.25], 2: [0.05, 0.40], 3: [0.10, 0.60] };
    const range = tierRanges[img.tier] || tierRanges[2];
    if (ed < range[0])
      issues.push({ rule: "IV-10", level: "WARN", msg: `Edge density ${ed.toFixed(3)} too low for Tier ${img.tier} (min ${range[0]})` });
    if (ed > range[1])
      issues.push({ rule: "IV-10", level: "WARN", msg: `Edge density ${ed.toFixed(3)} too high for Tier ${img.tier} (max ${range[1]})` });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Weighted RGB color distance (IV-09) — perceptually weighted Euclidean
// ---------------------------------------------------------------------------
function colorDistance(rgb1, rgb2) {
  const rMean = (rgb1.r + rgb2.r) / 2;
  const dr = rgb1.r - rgb2.r;
  const dg = rgb1.g - rgb2.g;
  const db = rgb1.b - rgb2.b;
  return Math.sqrt((2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db);
}

// ---------------------------------------------------------------------------
// Parse hex color to {r, g, b}
// ---------------------------------------------------------------------------
function parseHexColor(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// ---------------------------------------------------------------------------
// Extract palette colors from outline Meta section
// ---------------------------------------------------------------------------
function parsePaletteFromMeta(meta) {
  if (!meta.colorPalette) return [];
  const hexMatches = meta.colorPalette.match(/#[0-9A-Fa-f]{6}/g);
  return hexMatches ? hexMatches.map(parseHexColor) : [];
}

// ---------------------------------------------------------------------------
// Compute edge density using Sharp (IV-10)
// ---------------------------------------------------------------------------
async function computeEdgeDensity(buffer) {
  try {
    const sharp = (await import("sharp")).default;
    // Downscale for performance, convert to greyscale, detect edges via Laplacian-like
    const { data, info } = await sharp(buffer)
      .resize(256, 256, { fit: "fill" })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const w = info.width;
    const h = info.height;
    let edgePixels = 0;
    const threshold = 30;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const gx = Math.abs(data[idx + 1] - data[idx - 1]);
        const gy = Math.abs(data[idx + w] - data[idx - w]);
        if (gx + gy > threshold) edgePixels++;
      }
    }
    return edgePixels / ((w - 2) * (h - 2));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Extract top-3 dominant colors using histogram binning (IV-09)
// Divides RGB space into 4x4x4 bins, returns the 3 most frequent bin centers
// ---------------------------------------------------------------------------
async function extractDominantColors(buffer) {
  try {
    const sharp = (await import("sharp")).default;
    const { data } = await sharp(buffer)
      .resize(64, 64, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // 4x4x4 = 64 bins (each bin = 64 RGB values)
    const binSize = 64;
    const bins = new Map();
    for (let i = 0; i < data.length; i += 3) {
      const br = Math.floor(data[i] / binSize);
      const bg = Math.floor(data[i + 1] / binSize);
      const bb = Math.floor(data[i + 2] / binSize);
      const key = (br << 8) | (bg << 4) | bb;
      const entry = bins.get(key);
      if (entry) {
        entry.count++;
        entry.sumR += data[i];
        entry.sumG += data[i + 1];
        entry.sumB += data[i + 2];
      } else {
        bins.set(key, { count: 1, sumR: data[i], sumG: data[i + 1], sumB: data[i + 2] });
      }
    }

    // Sort by frequency, return top 3 average colors
    const sorted = [...bins.values()].sort((a, b) => b.count - a.count);
    return sorted.slice(0, 3).map((b) => ({
      r: Math.round(b.sumR / b.count),
      g: Math.round(b.sumG / b.count),
      b: Math.round(b.sumB / b.count),
    }));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// VQA scoring via Gemini Vision (#1)
// ---------------------------------------------------------------------------
async function scoreImageWithVQA(imageBuffer, originalPrompt, category, tier) {
  if (!GEMINI_API_KEY) return null;

  const vqaModel = "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${vqaModel}:generateContent?key=${GEMINI_API_KEY}`;

  const systemPrompt = `You are a strict image quality reviewer for presentation slides.
Rate this AI-generated image on each criterion (1-5):
1=poor, 2=below average, 3=adequate, 4=good, 5=excellent.

- prompt_fidelity: Does the image match this description? "${originalPrompt.slice(0, 300)}"
  → If score ≤ 3, explain what differs in "pf_reason" (e.g. "shows tulips instead of lavender")
- text_absence: Are there ANY text, letters, numbers, symbols visible? (5=none, 1=prominent)
- composition: Framing, balance, negative space for text overlay
  → If score ≤ 3, explain in "co_reason" (e.g. "subject too centered, no space for title")
- color_harmony: Do colors work together? Match professional presentation style?
  → If score ≤ 3, explain in "ch_reason" (e.g. "warm orange clashes with cool palette")
- presentation_fit: Would this work as a slide ${category || "background"}/illustration?

Scoring guide: 3=adequate (most images), 4=good (clear quality), 5=excellent (rare).
Category: ${category || "general"}, Tier: ${tier || 2}
Also list any visible text/symbols in "detected_text" array.`;

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
          pf_reason: { type: "string" },
          text_absence: { type: "integer" },
          composition: { type: "integer" },
          co_reason: { type: "string" },
          color_harmony: { type: "integer" },
          ch_reason: { type: "string" },
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
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt + 1) * 2000));
        continue;
      }
      if (!res.ok) return null;

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;

      const scores = JSON.parse(text);
      // C1: PF weighted 1.5x — prompt fidelity is the most important criterion
      // Max total: 5*1.5 + 5 + 5 + 5 + 5 = 27.5 (was 25)
      const total = (scores.prompt_fidelity || 0) * 1.5 + (scores.text_absence || 0) +
        (scores.composition || 0) + (scores.color_harmony || 0) + (scores.presentation_fit || 0);

      // Collect reasons for low scores (used by VQA-guided retry)
      const reasons = {};
      if (scores.pf_reason) reasons.pf_reason = scores.pf_reason;
      if (scores.co_reason) reasons.co_reason = scores.co_reason;
      if (scores.ch_reason) reasons.ch_reason = scores.ch_reason;

      return { scores, total, detected_text: scores.detected_text || [], reasons };
    } catch (err) {
      if (args.verbose) console.warn(`    ⚠️ VQA attempt ${attempt + 1} error: ${err.message}`);
      if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Keyword-score mapping engine (#2)
// ---------------------------------------------------------------------------
const STOPWORDS = new Set([
  // General English
  "a", "an", "the", "in", "on", "at", "for", "to", "of", "and", "or", "with",
  "is", "are", "this", "that", "from", "its", "very", "any", "all", "each",
  // Prompt structure
  "no", "text", "absolutely", "image", "aspect", "ratio", "style", "design",
  "slide", "presentation", "background", "without",
  // Style anchor / meta
  "color", "palette", "primary", "accent", "dark", "light", "off-white",
  "tone", "mood", "professional", "resolution", "high",
  // Aspect ratio fragments
  "portrait", "landscape", "square", "wide", "vertical", "horizontal",
  "ultrawide", "format",
  // Positional / structural
  "left", "right", "top", "bottom", "center", "upper", "lower",
  "top-left", "top-right", "bottom-left", "bottom-right", "top-center",
  // Icon template noise (negation clauses + grid position)
  "currency", "symbols", "mathematical", "punctuation", "marks",
  "pure", "only", "shapes", "geometric", "letters", "numbers",
  "matching", "arranged", "consistent", "set",
  // Size/count words
  "16", "9", "1", "2", "3", "4", "5", "6", "7", "8",
  "one", "two", "three", "four", "five", "six", "seven", "eight",
  // Filler/action verbs
  "creating", "showing", "forming", "giving", "making", "looking",
  "transforming", "having", "using", "placed", "surrounded",
  // Count/size adjectives
  "single", "multiple", "several", "small", "many", "few", "large",
  "entire", "various", "ample", "generous", "vast", "slight", "slightly",
  // Common boilerplate fragments
  "into", "across", "through", "between", "along", "around", "toward",
  "towards", "above", "below", "against", "onto", "within",
  // Layout/structure noise
  "space", "negative", "central", "section", "area", "portion",
  "third", "half", "quarter",
  // enhancePrompt boilerplate (Sharp focus, high quality / clean flat vector)
  "sharp", "focus", "quality", "clean", "flat", "vector",
  // Category names (prevent leak into keyword DB)
  "metaphor", "cover", "icon", "frame",
  // Common palette/style descriptors that appear in every prompt
  "gray", "navy", "teal", "white", "black", "deep",
  // Shot/composition boilerplate
  "shot",
  // Count-emphasis boilerplate (used in frame prompts to force counts)
  "exactly", "total",
  // Ordinal/positional words (describe element order, not visual quality)
  "first", "second", "fourth", "fifth", "sixth",
  // Structural description noise
  "connected", "covering", "roughly", "remaining",
  // Background prompt boilerplate (appears in every background prompt)
  "barely", "visible", "extremely", "minimal",
  // Count reinforcement boilerplate ("Exactly N, no more no less")
  "important", "not", "more", "fewer", "critical", "count", "must", "precisely", "add", "remove", "less",
  // Chart/diagram structural noise
  "chart", "diagram", "ring",
  // Direction/motion boilerplate in frame prompts
  "clockwise", "going", "pointing", "stacked",
  // D2 staircase rewrite residuals (R56/R58 비추천)
  "stepped", "stairs", "progressively", "taller", "increasing", "height",
  // D3 hex injection residuals
  "colors",
  // enhancePrompt injected phrases
  "abstract", "digital", "graphic", "photograph", "physical", "object",
  // Prompt template boilerplate (shared across all prompts in category)
  "consistent", "overlay", "scheme", "accents", "side",
  "complete", "evenly", "centered", "spaced", "medium", "longest",
  "matching", "outline", "outlines", "refined", "mood",
]);

// Hex code pattern: 6-char hex like "0c4a6e", "fafaf9"
const HEX_PATTERN = /^[0-9a-f]{6}$/;

function tokenizePrompt(prompt) {
  // Strip style anchor prefix: "Style: ... Color palette: ..." (up to last sentence that starts with a known meta key)
  let cleaned = prompt;
  const metaKeys = /^(Style:|Color palette:|Tone:|Mood:|Resolution:)/i;
  if (metaKeys.test(cleaned)) {
    // Find the end of the last meta-key sentence
    const sentences = cleaned.split(/\.\s+/);
    let lastMetaIdx = -1;
    for (let i = 0; i < sentences.length; i++) {
      if (metaKeys.test(sentences[i].trim())) lastMetaIdx = i;
    }
    if (lastMetaIdx >= 0 && lastMetaIdx < sentences.length - 1) {
      cleaned = sentences.slice(lastMetaIdx + 1).join(". ").trim();
    }
  }

  // Strip trailing boilerplate sentences ("No text.", "16:9 aspect ratio.", etc.)
  cleaned = cleaned.replace(/\b(Absolutely\s+)?[Nn]o\s+text\b[^.]*\./g, "");
  cleaned = cleaned.replace(/\b\d+:\d+\s*(aspect\s*ratio|format)[^.]*\./gi, "");
  cleaned = cleaned.replace(/\bhigh\s+resolution\b[^.]*\./gi, "");
  // enhancePrompt boilerplate sentences
  cleaned = cleaned.replace(/\bSharp focus,?\s*high quality\.?/gi, "");
  cleaned = cleaned.replace(/\bClean flat vector\b[^.]*\./gi, "");
  cleaned = cleaned.replace(/\bLarge empty area for text overlay\.?/gi, "");
  cleaned = cleaned.replace(/\bVery subtle,?\s*understated texture\.?/gi, "");
  cleaned = cleaned.replace(/\bCRITICAL: exactly \d+[^.]*\./gi, "");
  cleaned = cleaned.replace(/\bDo not add or remove any\.?/gi, "");
  cleaned = cleaned.replace(/\bExactly \d+[^.]*no more no less\.?/gi, "");
  cleaned = cleaned.replace(/\bUse natural realistic colors[^.]*\./gi, "");
  cleaned = cleaned.replace(/\bUniform \dpx stroke weight[^.]*\.?/gi, "");

  const words = cleaned.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
  const tokens = new Set();

  // 1-grams (skip stopwords, hex codes, short words)
  for (const w of words) {
    if (!STOPWORDS.has(w) && w.length > 2 && !HEX_PATTERN.test(w)) tokens.add(w);
  }

  // 2-grams (skip if either word is stopword — stricter than before to reduce noise bigrams)
  for (let i = 0; i < words.length - 1; i++) {
    const w1 = words[i], w2 = words[i + 1];
    if (STOPWORDS.has(w1) || STOPWORDS.has(w2)) continue;
    if (HEX_PATTERN.test(w1) || HEX_PATTERN.test(w2)) continue;
    if (w1.length <= 1 || w2.length <= 1) continue;
    const bigram = `${w1} ${w2}`;
    if (bigram.length > 5) tokens.add(bigram);
  }

  // 3-grams (only if all three are non-stopword)
  for (let i = 0; i < words.length - 2; i++) {
    const w1 = words[i], w2 = words[i + 1], w3 = words[i + 2];
    if (STOPWORDS.has(w1) || STOPWORDS.has(w2) || STOPWORDS.has(w3)) continue;
    if (HEX_PATTERN.test(w1) || HEX_PATTERN.test(w2) || HEX_PATTERN.test(w3)) continue;
    const trigram = `${w1} ${w2} ${w3}`;
    if (trigram.length > 8) tokens.add(trigram);
  }

  return [...tokens];
}

/**
 * Analyze VQA results and generate pipeline improvement recommendations.
 * Called after each batch — recommendations appear in nanoBanana-report.json
 * and are printed to console for the agent to act on per rule C (25-image checkpoint).
 */
function generateVQARecommendations(vqaResults) {
  const recommendations = [];
  if (vqaResults.length < 3) return recommendations;

  // Aggregate per-criterion averages
  const criteria = ["prompt_fidelity", "text_absence", "composition", "color_harmony", "presentation_fit"];
  const criteriaKeys = ["PF", "TA", "CO", "CH", "PF2"]; // display keys
  const sums = [0, 0, 0, 0, 0];
  let count = 0;
  for (const r of vqaResults) {
    if (!r.vqa || !r.vqa.scores) continue;
    const s = r.vqa.scores;
    sums[0] += s.prompt_fidelity || 0;
    sums[1] += s.text_absence || 0;
    sums[2] += s.composition || 0;
    sums[3] += s.color_harmony || 0;
    sums[4] += s.presentation_fit || 0;
    count++;
  }
  if (count === 0) return recommendations;
  const avgs = sums.map((s) => Math.round(s / count * 10) / 10);

  // Threshold: avg < 3.5 means systemic issue
  const THRESHOLD = 3.5;

  if (avgs[1] < THRESHOLD) {
    // text_absence low → Gemini rendering text in images
    const textFailSlides = vqaResults.filter((r) => r.vqa?.scores?.text_absence <= 2);
    recommendations.push({
      criterion: "text_absence",
      avg: avgs[1],
      severity: "HIGH",
      action: "Check IP-11 subjects (compass, clock, etc). Verify 'Absolutely no text' is present in all prompts. Consider adding 'no words, no letters, no characters' reinforcement.",
      affected_slides: textFailSlides.map((r) => r.slide || r.slideNumber),
    });
  }
  if (avgs[0] < THRESHOLD) {
    recommendations.push({
      criterion: "prompt_fidelity",
      avg: avgs[0],
      severity: "MEDIUM",
      action: "Prompts may be too complex for Flash. Check IP-08 (length > 500). Simplify descriptions or split into key visual elements.",
    });
  }
  if (avgs[2] < THRESHOLD) {
    recommendations.push({
      criterion: "composition",
      avg: avgs[2],
      severity: "MEDIUM",
      action: "Add 'generous negative space for text overlay' to prompts. Check if frame/diagram prompts specify clear layout.",
    });
  }
  if (avgs[3] < THRESHOLD) {
    recommendations.push({
      criterion: "color_harmony",
      avg: avgs[3],
      severity: "LOW",
      action: "Review IV-09 palette threshold. Photographic images may need higher threshold. Check if style anchor colors conflict with subject matter.",
    });
  }
  if (avgs[4] < THRESHOLD) {
    recommendations.push({
      criterion: "presentation_fit",
      avg: avgs[4],
      severity: "MEDIUM",
      action: "Images may not suit slide use. Review category assignments. Ensure prompts include 'presentation slide' context.",
    });
  }

  // Cross-criterion analysis: high TA failures correlate with specific subjects
  // Adjusted threshold: small batches (n<10) need higher tolerance (1 fail in 5 = 20%)
  const failCount = vqaResults.filter((r) => r.vqa?.total < 22).length;
  const failThreshold = count < 10 ? 0.4 : 0.3;
  const failRate = failCount / count;
  if (failRate > failThreshold) {
    recommendations.push({
      criterion: "overall_fail_rate",
      avg: Math.round(failRate * 100),
      severity: "HIGH",
      action: `FAIL rate ${Math.round(failRate * 100)}% exceeds ${Math.round(failThreshold * 100)}% (${failCount}/${count} images). Review VQA gate threshold (current: 22) or VQA prompt strictness. See docs/vqa-pipeline-maintenance.md §2.`,
    });
  }

  // Keyword analysis: extract top/bottom keywords from this batch
  // Only use first-attempt prompts (attempt === 0) to avoid VQA feedback contamination
  const kwScores = {};
  for (const r of vqaResults) {
    if (!r.vqa || !r.vqa.total) continue;
    if (r.attempt > 0) continue; // Skip retried prompts — they contain VQA feedback text
    const prompt = r.prompt || "";
    if (!prompt) continue;
    const tokens = tokenizePrompt(prompt);
    for (const t of tokens) {
      if (!kwScores[t]) kwScores[t] = { sum: 0, count: 0 };
      kwScores[t].sum += r.vqa.total;
      kwScores[t].count++;
    }
  }
  const kwEntries = Object.entries(kwScores)
    .filter(([, v]) => v.count >= 2)
    .map(([kw, v]) => ({ keyword: kw, avg: Math.round(v.sum / v.count * 10) / 10, count: v.count }));

  if (kwEntries.length > 0) {
    kwEntries.sort((a, b) => b.avg - a.avg);
    const top5 = kwEntries.slice(0, 5);
    const bottom5 = kwEntries.sort((a, b) => a.avg - b.avg).slice(0, 5);
    recommendations.push({
      criterion: "keyword_analysis",
      severity: "INFO",
      top_keywords: top5.map((k) => `${k.keyword} (avg ${k.avg}, n=${k.count})`),
      bottom_keywords: bottom5.map((k) => `${k.keyword} (avg ${k.avg}, n=${k.count})`),
      action: "Top keywords: include in future prompts. Bottom keywords: consider replacing or removing.",
    });
  }

  // Cross-round analysis using cumulative _category_stats (if available)
  try {
    const dbPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..", ".claude", "docs", "nanoBanana-prompt-scores.json");
    const db = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
    const catStats = db._category_stats || {};
    for (const [cat, stats] of Object.entries(catStats)) {
      if (stats.count < 10) continue; // Need sufficient data
      // Flag categories with consistently low item-level scores
      if (stats.pf_avg < 3.5) {
        recommendations.push({
          criterion: `cumulative_${cat}_pf`,
          avg: stats.pf_avg,
          severity: "MEDIUM",
          action: `Category '${cat}' has low cumulative prompt_fidelity (${stats.pf_avg}/5, n=${stats.count}). Simplify prompts or adjust expectations for this category.`,
        });
      }
      if (stats.co_avg < 4.0) {
        recommendations.push({
          criterion: `cumulative_${cat}_co`,
          avg: stats.co_avg,
          severity: "LOW",
          action: `Category '${cat}' has low cumulative composition (${stats.co_avg}/5, n=${stats.count}). Add 'negative space for text overlay' to prompts.`,
        });
      }
      if (stats.ta_avg < 4.0) {
        recommendations.push({
          criterion: `cumulative_${cat}_ta`,
          avg: stats.ta_avg,
          severity: "HIGH",
          action: `Category '${cat}' has low cumulative text_absence (${stats.ta_avg}/5, n=${stats.count}). Reinforce 'no text' in prompts or add IP-11 subjects to blocklist.`,
        });
      }
    }

    // Cumulative keyword-level recommendations (cross-round)
    for (const [cat, keywords] of Object.entries(db)) {
      if (cat.startsWith("_")) continue;
      const topKws = [];
      const bottomKws = [];
      const blockedKws = [];
      for (const [kw, data] of Object.entries(keywords)) {
        if (data.count < 5) continue; // Need sufficient data
        if (data.blocked) { blockedKws.push({ kw, ...data }); continue; }
        if (data.avg >= 24) topKws.push({ kw, ...data });
        if (data.avg < 20) bottomKws.push({ kw, ...data });
      }
      if (topKws.length > 0 || bottomKws.length > 0 || blockedKws.length > 0) {
        topKws.sort((a, b) => b.avg - a.avg);
        bottomKws.sort((a, b) => a.avg - b.avg);
        recommendations.push({
          criterion: `cumulative_keywords_${cat}`,
          severity: blockedKws.length > 0 ? "MEDIUM" : "INFO",
          top_keywords: topKws.slice(0, 5).map(k => `${k.kw} (avg ${k.avg}, n=${k.count})`),
          bottom_keywords: bottomKws.slice(0, 5).map(k => `${k.kw} (avg ${k.avg}, n=${k.count})`),
          blocked_keywords: blockedKws.map(k => `${k.kw} (avg ${k.avg}, n=${k.count})`),
          action: `Category '${cat}': ${topKws.length} proven keywords, ${bottomKws.length} weak keywords, ${blockedKws.length} blocked.`,
        });
      }
    }
  } catch { /* cumulative DB not available — skip */ }

  return recommendations;
}

function buildKeywordScores(results) {
  const categories = {};

  for (const r of results) {
    if (!r.vqa || !r.prompt) continue;
    // Skip retried results — their prompts contain VQA feedback text that contaminates keyword DB
    if (r.attempts > 1) continue;
    const cat = r.category || "general";
    if (!categories[cat]) categories[cat] = {};

    const tokens = tokenizePrompt(r.prompt);
    const pf = r.vqa.scores?.prompt_fidelity || 0;
    for (const token of tokens) {
      if (!categories[cat][token]) categories[cat][token] = { sum: 0, count: 0, pf_sum: 0 };
      categories[cat][token].sum += r.vqa.total;
      categories[cat][token].pf_sum += pf;
      categories[cat][token].count++;
    }
  }

  // Filter: count >= 1 (cumulative DB handles quality via UCB + decay), compute avg, sort descending
  const output = {};
  for (const [cat, keywords] of Object.entries(categories)) {
    output[cat] = {};
    for (const [kw, data] of Object.entries(keywords)) {
      if (data.count >= 1) {
        output[cat][kw] = {
          avg: Math.round((data.sum / data.count) * 10) / 10,
          count: data.count,
          pf: Math.round((data.pf_sum / data.count) * 10) / 10,
        };
      }
    }
    // Sort by avg descending
    const sorted = Object.entries(output[cat]).sort((a, b) => b[1].avg - a[1].avg);
    output[cat] = Object.fromEntries(sorted);
  }

  return output;
}

// ---------------------------------------------------------------------------
// Merge keyword scores into cumulative DB (#3)
// ---------------------------------------------------------------------------
function mergeKeywordScores(existing, newScores) {
  const merged = JSON.parse(JSON.stringify(existing));

  // Apply count decay to existing entries (0.9x per merge session)
  // This prevents old high-count keywords from dominating forever
  for (const cat of Object.keys(merged)) {
    if (cat.startsWith("_")) continue; // Skip meta entries like _category_stats
    for (const kw of Object.keys(merged[cat])) {
      merged[cat][kw].count = Math.max(1, Math.round(merged[cat][kw].count * 0.9));
    }
  }

  for (const [cat, keywords] of Object.entries(newScores)) {
    if (!merged[cat]) merged[cat] = {};
    for (const [kw, data] of Object.entries(keywords)) {
      if (merged[cat][kw]) {
        const old = merged[cat][kw];
        const totalCount = old.count + data.count;
        const totalSum = old.avg * old.count + data.avg * data.count;
        old.avg = Math.round((totalSum / totalCount) * 10) / 10;
        old.count = totalCount;
        // Merge pf (prompt_fidelity) score if present
        if (data.pf !== undefined) {
          const oldPf = old.pf || old.avg; // fallback to avg for legacy entries
          const oldPfCount = old.pf !== undefined ? (old.count - data.count) : 0;
          if (oldPfCount > 0) {
            old.pf = Math.round(((oldPf * oldPfCount) + (data.pf * data.count)) / totalCount * 10) / 10;
          } else {
            old.pf = data.pf;
          }
        }
        // Mark as blocked if avg < 15 after 5+ samples
        if (old.count >= 5 && old.avg < 15) old.blocked = true;
        // Remove blocked if avg recovered
        if (old.blocked && old.avg >= 18) delete old.blocked;
      } else {
        merged[cat][kw] = { ...data };
      }
    }
  }

  // Compute UCB score for each keyword (for plan-skill consumption)
  for (const cat of Object.keys(merged)) {
    for (const [kw, data] of Object.entries(merged[cat])) {
      // UCB1: avg + exploration_bonus / sqrt(count)
      // exploration_bonus = 5 → low-count keywords get significant boost
      data.ucb_score = Math.round((data.avg + 5 / Math.sqrt(Math.max(1, data.count))) * 10) / 10;
    }
    // Re-sort by ucb_score descending
    const sorted = Object.entries(merged[cat]).sort((a, b) => (b[1].ucb_score || 0) - (a[1].ucb_score || 0));
    merged[cat] = Object.fromEntries(sorted);
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Detect image category from prompt/context
// ---------------------------------------------------------------------------
function detectCategory(img) {
  const p = img.prompt.toLowerCase();
  const t = (img.slideTitle || "").toLowerCase();
  if (/\bicon\b/.test(p) || img.iconSet || (img.aspectRatio === "1:1" && /icon|isometric|illustration/i.test(p))) return "icon";
  if (/\b(frame|timeline|process|flow|diagram|chart|graph|matrix|pyramid|funnel|comparison|scatter|ring|progress|org\s*chart|venn|hub|flowchart|staircase|donut|gauge|chevron)\b/.test(p)) return "frame";
  if (/\bcover\b/.test(t) || /\b(cover|표지)\b/.test(p)) return "cover";
  if (/\b(texture|pattern|wave|gradient|mesh|linen|paper)\b/.test(t) || /\b(background|배경|texture|pattern)\b/.test(t)) return "background";
  if (/\b(background|muted|subtle|desaturated)\b/.test(p) && !/cinematic|photograph|aerial/i.test(p)) return "background";
  return "metaphor";
}

// ---------------------------------------------------------------------------
// Design mode IV profiles (#15)
// ---------------------------------------------------------------------------
const DESIGN_MODE_PROFILES = {
  Professional: { minBrightness: 40, maxBrightness: 230, minSaturation: 0.05 },
  Creative: { minBrightness: 20, maxBrightness: 250, minSaturation: 0.10 },
  Education: { minBrightness: 60, maxBrightness: 240, minSaturation: 0.15 },
  Academic: { minBrightness: 50, maxBrightness: 245, minSaturation: 0.0 },
  Minimal: { minBrightness: 40, maxBrightness: 240, minSaturation: 0.0 },
};

// ---------------------------------------------------------------------------
// Safety filter handling (#2)
// ---------------------------------------------------------------------------
const SAFETY_MESSAGES = {
  SAFETY: "안전 필터에 의해 차단됨. 프롬프트에서 민감한 표현을 순화하세요.",
  IMAGE_SAFETY: "생성된 이미지가 안전 기준 미달. 프롬프트를 더 구체적/순화된 표현으로 수정하세요.",
  OTHER: "알 수 없는 이유로 차단됨. 프롬프트를 단순화하거나 묘사를 일반화하세요.",
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
    return { buffer, width: 0, height: 0 };
  }

  const target = ASPECT_DIMENSIONS[aspectRatio];

  // Get metadata before processing to avoid double-decode
  const meta = await sharp(buffer).metadata();

  let result, width, height;
  if (!target) {
    console.warn(`    ⚠️  미등록 비율 "${aspectRatio}" — 원본 비율 유지 (16:9 폴백 없음)`);
    result = await sharp(buffer)
      .png({ compressionLevel: 9, quality: 85 })
      .toBuffer();
    width = meta.width;
    height = meta.height;
  } else {
    result = await sharp(buffer)
      .resize(target.w, target.h, {
        fit: "cover",
        position: "centre",
        kernel: "lanczos3",
      })
      .png({ compressionLevel: 9, quality: 85 })
      .toBuffer();
    width = target.w;
    height = target.h;
  }

  // Brightness analysis — detect overly bright images that may cause text readability issues
  try {
    const stats = await sharp(result).stats();
    const channels = stats.channels;
    // Weighted perceived brightness (ITU-R BT.601)
    const brightness = channels[0].mean * 0.299 + channels[1].mean * 0.587 + channels[2].mean * 0.114;

    // Analyze top 1/3 region (common text overlay area)
    const topThirdH = Math.round(height / 3);
    if (topThirdH > 0) {
      const topStats = await sharp(result)
        .extract({ left: 0, top: 0, width, height: topThirdH })
        .stats();
      const topChannels = topStats.channels;
      const topBrightness = topChannels[0].mean * 0.299 + topChannels[1].mean * 0.587 + topChannels[2].mean * 0.114;

      if (topBrightness > 200) {
        console.warn(`    ⚠️  BRIGHT: top region brightness=${topBrightness.toFixed(0)}/255 — text overlay may be unreadable`);
      }
    }
    if (brightness > 220) {
      console.warn(`    ⚠️  BRIGHT: overall brightness=${brightness.toFixed(0)}/255 — consider darker tones`);
    }
  } catch {
    // Brightness analysis is non-critical — skip on error
  }

  return { buffer: result, width, height };
}

// ---------------------------------------------------------------------------
// Adaptive concurrency (#17)
// ---------------------------------------------------------------------------
class AdaptiveConcurrency {
  constructor(initial) {
    this.limit = initial;
    this.min = 1;
    this.max = initial;
    this.consecutiveSuccess = 0;
    this.recentErrors = 0;
  }

  on429() {
    this.recentErrors++;
    this.consecutiveSuccess = 0;
    if (this.limit > this.min) {
      this.limit = Math.max(this.min, Math.floor(this.limit * 0.5));
      console.log(`    📉 Adaptive: concurrency reduced to ${this.limit}`);
    }
  }

  onSuccess() {
    this.consecutiveSuccess++;
    this.recentErrors = Math.max(0, this.recentErrors - 1);
    // Recover after 5 consecutive successes
    if (this.consecutiveSuccess >= 5 && this.limit < this.max) {
      this.limit = Math.min(this.max, this.limit + 1);
      this.consecutiveSuccess = 0;
      console.log(`    📈 Adaptive: concurrency recovered to ${this.limit}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Concurrency limiter
// ---------------------------------------------------------------------------
async function runSequentialOrConcurrent(tasks, adaptiveLimiter, sequential) {
  if (sequential) {
    const results = [];
    for (const task of tasks) {
      const prev = results.length > 0 ? results[results.length - 1] : null;
      const r = await task(prev);
      results.push(r);
    }
    return results.map((value) => ({ status: "fulfilled", value }));
  }

  // Concurrent mode with adaptive limit
  const results = [];
  const executing = new Set();

  for (const task of tasks) {
    const p = task(null).then((r) => {
      executing.delete(p);
      return r;
    });
    executing.add(p);
    results.push(p);

    if (executing.size >= adaptiveLimiter.limit) {
      await Promise.race(executing);
    }
  }

  return Promise.allSettled(results);
}

// ---------------------------------------------------------------------------
// VQA-only mode: score existing images
// ---------------------------------------------------------------------------
async function runVqaOnly(images, outputDir, meta) {
  console.log(`\n🔬 VQA-only 모드: 기존 이미지 ${images.length}개 스코어링`);
  console.log(`   디렉토리: ${outputDir}\n`);

  const allResults = [];
  let scored = 0;
  let skipped = 0;
  let errors = 0;

  // Pre-filter: skip missing files and already-scored images
  const toScore = [];
  for (const img of images) {
    const imgPath = path.join(outputDir, img.filename);
    const metaPath = imgPath.replace(/\.png$/, "-meta.json");

    if (!fs.existsSync(imgPath)) {
      console.log(`  ⏭  Slide ${img.slideNumber}: ${img.filename} (파일 없음, 건너뜀)`);
      skipped++;
      continue;
    }

    let existingMeta = {};
    if (fs.existsSync(metaPath)) {
      try { existingMeta = JSON.parse(fs.readFileSync(metaPath, "utf-8")); } catch { /* ignore */ }
    }

    if (existingMeta.vqa && !args.force) {
      console.log(`  ⏭  Slide ${img.slideNumber}: ${img.filename} (VQA 점수 있음: ${existingMeta.vqa.total}/27.5, 건너뜀)`);
      allResults.push({
        slide: img.slideNumber, status: "ok",
        prompt: existingMeta.prompt || img.prompt,
        category: existingMeta.category || detectCategory(img),
        vqa: existingMeta.vqa,
      });
      skipped++;
      continue;
    }

    toScore.push({ img, imgPath, metaPath, existingMeta });
  }

  // Parallel VQA scoring with adaptive concurrency (no fixed delay)
  const vqaLimiter = new AdaptiveConcurrency(2);
  const tasks = toScore.map(({ img, imgPath, metaPath, existingMeta }) => async () => {
    try {
      const buffer = fs.readFileSync(imgPath);
      const category = existingMeta.category || detectCategory(img);
      const prompt = existingMeta.prompt || img.prompt;

      console.log(`  🔬 Slide ${img.slideNumber}: VQA 스코어링 중...`);
      const vqaResult = await scoreImageWithVQA(buffer, prompt, category, img.tier);

      if (vqaResult) {
        vqaLimiter.onSuccess();
        const grade = vqaResult.total >= 25 ? "PASS" : vqaResult.total >= 22 ? "WARN" : "FAIL";
        const gradeIcon = grade === "PASS" ? "✅" : grade === "WARN" ? "⚠️" : "❌";
        console.log(`  ${gradeIcon} Slide ${img.slideNumber}: ${vqaResult.total}/27.5 [${grade}] (PF:${vqaResult.scores.prompt_fidelity} TA:${vqaResult.scores.text_absence} CO:${vqaResult.scores.composition} CH:${vqaResult.scores.color_harmony} PF:${vqaResult.scores.presentation_fit})`);
        if (vqaResult.detected_text?.length > 0) {
          console.warn(`    🔤 Detected text: ${vqaResult.detected_text.join(", ")}`);
        }

        existingMeta.vqa = vqaResult;
        existingMeta.category = category;
        fs.writeFileSync(metaPath, JSON.stringify(existingMeta, null, 2));

        return { slide: img.slideNumber, status: "ok", prompt, category, vqa: vqaResult };
      } else {
        console.warn(`  ⚠️  Slide ${img.slideNumber}: VQA 응답 없음`);
        return { slide: img.slideNumber, status: "error" };
      }
    } catch (err) {
      if (err.message?.includes("429") || err.message?.includes("RESOURCE_EXHAUSTED")) {
        vqaLimiter.on429();
        await new Promise((r) => setTimeout(r, 2000));
      }
      console.error(`  ❌ Slide ${img.slideNumber}: ${err.message}`);
      return { slide: img.slideNumber, status: "error" };
    }
  });

  const settled = await runSequentialOrConcurrent(tasks, vqaLimiter, false);
  for (const s of settled) {
    const r = s.status === "fulfilled" ? s.value : s.reason;
    if (r?.status === "ok") { allResults.push(r); scored++; }
    else { errors++; }
  }

  // Summary
  console.log(`\n📊 VQA-only 결과: 스코어링 ${scored}, 건너뜀 ${skipped}, 에러 ${errors}`);

  // Generate report + keyword scores
  if (allResults.length > 0) {
    const vqaResults = allResults.filter((r) => r.vqa);
    const vqaScores = vqaResults.map((r) => r.vqa.total);

    const byCategory = {};
    for (const r of allResults) {
      const cat = r.category || "general";
      if (!byCategory[cat]) byCategory[cat] = { scores: [], count: 0 };
      if (r.vqa) byCategory[cat].scores.push(r.vqa.total);
      byCategory[cat].count++;
    }

    const categoryAvgs = {};
    for (const [cat, data] of Object.entries(byCategory)) {
      categoryAvgs[cat] = {
        avg: data.scores.length > 0 ? Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length * 10) / 10 : null,
        count: data.count,
      };
    }

    const report = {
      timestamp: new Date().toISOString(),
      mode: "vqa-only",
      summary: { total: images.length, scored, skipped, errors },
      vqa: vqaScores.length > 0 ? {
        avg: Math.round(vqaScores.reduce((a, b) => a + b, 0) / vqaScores.length * 10) / 10,
        min: Math.min(...vqaScores), max: Math.max(...vqaScores),
        distribution: {
          "27.5": vqaScores.filter((s) => s === 27.5).length,
          "25-27": vqaScores.filter((s) => s >= 25 && s < 27.5).length,
          "22-24": vqaScores.filter((s) => s >= 22 && s < 25).length,
          "17-21": vqaScores.filter((s) => s >= 17 && s < 22).length,
          "<17": vqaScores.filter((s) => s < 17).length,
        },
      } : null,
      by_category: categoryAvgs,
      weakest_slides: vqaResults
        .sort((a, b) => a.vqa.total - b.vqa.total)
        .slice(0, 5)
        .map((r) => ({ slide: r.slide, total: r.vqa.total, scores: r.vqa.scores })),
      recommendations: generateVQARecommendations(vqaResults),
    };

    const reportPath = path.join(outputDir, "nanoBanana-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📊 VQA 리포트: ${reportPath}`);
    if (report.vqa) {
      console.log(`   평균: ${report.vqa.avg}/27.5, 최저: ${report.vqa.min}, 최고: ${report.vqa.max}`);
      console.log(`   분포: 25+: ${report.vqa.distribution["27.5"] + report.vqa.distribution["25-27"]}, 22-24: ${report.vqa.distribution["22-24"]}, <22: ${report.vqa.distribution["17-21"] + report.vqa.distribution["<17"]}`);
    }
    if (report.recommendations && report.recommendations.length > 0) {
      console.log(`\n⚠️  파이프라인 개선 권고 ${report.recommendations.length}건:`);
      for (const rec of report.recommendations) {
        if (rec.criterion === "keyword_analysis" || rec.criterion?.startsWith("cumulative_keywords_")) {
          console.log(`   [${rec.severity}] ${rec.criterion}: 추천: ${rec.top_keywords?.join(", ") || "(없음)"}`);
          console.log(`   [${rec.severity}] ${rec.criterion}: 비추천: ${rec.bottom_keywords?.join(", ") || "(없음)"}`);
          if (rec.blocked_keywords?.length > 0) {
            console.log(`   [${rec.severity}] ${rec.criterion}: ❌ 차단: ${rec.blocked_keywords.join(", ")}`);
          }
        } else {
          console.log(`   [${rec.severity}] ${rec.criterion} (avg ${rec.avg}): ${rec.action}`);
        }
      }
    }

    // Keyword scores
    const keywordScores = buildKeywordScores(allResults);
    const keywordPath = path.join(outputDir, "prompt-keyword-scores.json");
    fs.writeFileSync(keywordPath, JSON.stringify(keywordScores, null, 2));
    console.log(`📊 키워드 점수: ${keywordPath}`);

    // Merge into cumulative DB
    if (args["update-scores"]) {
      const dbPath = path.resolve("D:/projects/slides-grab/.claude/docs/nanoBanana-prompt-scores.json");
      let existing = {};
      try { existing = JSON.parse(fs.readFileSync(dbPath, "utf-8")); } catch { /* first run */ }
      const merged = mergeKeywordScores(existing, keywordScores);
      fs.writeFileSync(dbPath, JSON.stringify(merged, null, 2));
      console.log(`📊 누적 DB 갱신: ${dbPath}`);
    }
  }
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

  const { images, styleAnchor, meta, paletteHexMap } = parseOutline(outlinePath);
  if (images.length === 0) {
    console.log("NanoBanana: 태그가 없습니다. 이미지 생성을 건너뜁니다.");
    return;
  }

  // --check-outline: validate prompts against cumulative keyword DB
  if (args["check-outline"]) {
    const dbPath = path.resolve("D:/projects/slides-grab/.claude/docs/nanoBanana-prompt-scores.json");
    let db;
    try { db = JSON.parse(fs.readFileSync(dbPath, "utf-8")); } catch {
      console.error("❌ 누적 키워드 DB를 찾을 수 없습니다:", dbPath);
      process.exit(1);
    }

    console.log(`\n🔍 아웃라인 키워드 검증 (${images.length}장)`);
    let totalUsed = 0, totalTop = 0, totalBottom = 0, totalBlocked = 0;

    for (const img of images) {
      const category = detectCategory(img);
      const catDb = db[category] || {};
      const tokens = tokenizePrompt(img.prompt);
      const used = [], topHits = [], bottomHits = [], blockedHits = [];

      for (const t of tokens) {
        const entry = catDb[t];
        if (!entry) continue;
        used.push(t);
        if (entry.blocked) blockedHits.push(`${t} (avg=${entry.avg})`);
        else if (entry.count >= 5 && entry.avg >= 24) topHits.push(`${t} (avg=${entry.avg})`);
        else if (entry.count >= 5 && entry.avg < 20) bottomHits.push(`${t} (avg=${entry.avg})`);
      }

      const status = blockedHits.length > 0 ? "❌" : bottomHits.length > 0 ? "⚠️" : "✅";
      console.log(`  ${status} Slide ${img.slideNumber} [${category}]: DB 매칭 ${used.length}/${tokens.length} 토큰`);
      if (topHits.length > 0) console.log(`     👍 고점수: ${topHits.join(", ")}`);
      if (bottomHits.length > 0) console.log(`     👎 저점수: ${bottomHits.join(", ")}`);
      if (blockedHits.length > 0) console.log(`     ❌ 차단됨: ${blockedHits.join(", ")}`);

      totalUsed += used.length;
      totalTop += topHits.length;
      totalBottom += bottomHits.length;
      totalBlocked += blockedHits.length;
    }

    console.log(`\n📊 검증 요약:`);
    console.log(`   DB 매칭 토큰: ${totalUsed}, 고점수: ${totalTop}, 저점수: ${totalBottom}, 차단: ${totalBlocked}`);
    if (totalBlocked > 0) console.log(`   ⚠️ 차단 키워드 ${totalBlocked}건 발견 — 프롬프트 수정 필요`);
    if (totalBottom > 0) console.log(`   ⚠️ 저점수 키워드 ${totalBottom}건 — 대체 키워드 권장`);
    const coverage = totalUsed > 0 ? Math.round(totalTop / totalUsed * 100) : 0;
    console.log(`   고점수 활용률: ${coverage}% (목표 80%)`);
    process.exit(0);
  }

  console.log(`\n📋 ${images.length}개 이미지 발견:`);
  if (styleAnchor) console.log(`🎨 스타일 앵커: ${styleAnchor}`);
  if (args.vqa) console.log(`🔬 VQA 스코어링 활성화`);
  console.log();

  for (const img of images) {
    const ratio = img.aspectRatio !== "16:9" ? ` [${img.aspectRatio}]` : "";
    const tierLabel = img.tier ? ` (Tier ${img.tier})` : "";
    console.log(`  Slide ${img.slideNumber}: ${img.description}${ratio}${tierLabel}`);
    console.log(`    → ${img.filename}`);
    if (img.tier >= 3) {
      console.warn(`    ⚠️  Tier ${img.tier} — 복잡 주제. HTML 차트 권장.`);
    }
    if (img.iconSet) {
      console.log(`    📌 Icon set ${img.iconSet.rows}×${img.iconSet.cols} — 생성 후 sharp로 분할 필요`);
    }
    if (args.dry) {
      // Show enhanced prompt in dry mode
      const enhanced = enhancePrompt(img.prompt, img, paletteHexMap);
      console.log(`    prompt: ${enhanced.slice(0, 120)}...`);
      const ipIssues = checkImagePreflight(img);
      for (const issue of ipIssues) {
        const icon = issue.level === "ERROR" ? "❌" : "⚠️";
        console.log(`    ${icon} ${issue.rule}: ${issue.msg}`);
      }
    }
  }

  if (args.dry) {
    console.log("\n--dry 모드: 실제 API 호출 없이 종료합니다.");
    return;
  }

  // Ensure output directory
  const outputDir = path.resolve(args.output || path.join(path.dirname(outlinePath), "assets"));

  // --vqa-only mode: score existing images without regenerating
  if (args["vqa-only"]) {
    await runVqaOnly(images, outputDir, meta);
    return;
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const concurrency = parseInt(args.concurrency, 10) || 3;
  const chainMode = args.chain;
  const adaptiveLimiter = new AdaptiveConcurrency(concurrency);

  console.log(`\n🎨 이미지 생성 시작`);
  console.log(`   모델: ${args.model}`);
  console.log(`   모드: ${chainMode ? "체인 (순차, 참조 이미지 연결)" : `병렬 (동시 ${concurrency}개, adaptive)`}`);
  console.log(`   후처리: ${args.optimize ? "Sharp 리사이즈+압축" : "없음"}`);
  console.log();

  let firstImageBase64 = null;
  const allResults = []; // Collect for VQA/report
  const allVQAAttempts = []; // ALL VQA scores including retried failures (for recommendations)

  // Load cumulative category stats for dynamic VQA gate
  let categoryStats = {};
  try {
    const dbPath = path.resolve("D:/projects/slides-grab/.claude/docs/nanoBanana-prompt-scores.json");
    const db = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
    categoryStats = db._category_stats || {};
  } catch { /* first run or no DB */ }

  const tasks = images.map((img) => async (prevResult) => {
    const outPath = path.join(outputDir, img.filename);

    // Skip logic
    const shouldRegenerate = args.force || regenerateSlides.has(img.slideNumber);
    if (fs.existsSync(outPath) && !shouldRegenerate) {
      console.log(`  ⏭  Slide ${img.slideNumber}: ${img.filename} (이미 존재, 건너뜀)`);
      if (chainMode && !firstImageBase64) {
        firstImageBase64 = fs.readFileSync(outPath).toString("base64");
      }
      return { slide: img.slideNumber, status: "skipped" };
    }

    // Apply prompt enhancement (#11)
    const enhancedPrompt = enhancePrompt(img.prompt, img, paletteHexMap);

    // IP (Image Preflight) — pre-generation check
    const ipIssues = checkImagePreflight({ ...img, prompt: enhancedPrompt });
    const ipErrors = ipIssues.filter((i) => i.level === "ERROR");
    if (ipErrors.length > 0) {
      for (const issue of ipErrors) {
        console.error(`  ❌ Slide ${img.slideNumber} [${issue.rule}]: ${issue.msg}`);
      }
      console.error(`  ⏭  Slide ${img.slideNumber}: IP ERROR — 생성 건너뜀`);
      return { slide: img.slideNumber, status: "ip-error", ip: ipIssues };
    }
    for (const issue of ipIssues.filter((i) => i.level === "WARN")) {
      console.warn(`  ⚠️  Slide ${img.slideNumber} [${issue.rule}]: ${issue.msg}`);
    }

    // Retry loop with prompt mutation (#13)
    const maxAttempts = 3;
    let lastError = null;
    let lastVQAFeedback = null; // VQA-guided retry: pass failure scores to mutatePromptForRetry

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const currentPrompt = attempt === 0
          ? enhancedPrompt
          : mutatePromptForRetry(enhancedPrompt, attempt, lastVQAFeedback);
        if (attempt > 0) {
          const guideTag = lastVQAFeedback ? "VQA 피드백 반영" : "프롬프트 변이";
          console.log(`  🔄 Slide ${img.slideNumber}: 재시도 ${attempt}/${maxAttempts} (${guideTag})`);
        } else {
          console.log(`  🔄 Slide ${img.slideNumber}: 생성 중...`);
        }

        const refImage = chainMode ? firstImageBase64 : null;
        const buffer = await generateImage(currentPrompt, args.model, img.aspectRatio, args.size, refImage);
        adaptiveLimiter.onSuccess();

        // Post-processing
        let finalBuffer = buffer;
        let resLog = "";
        let brightness = -1;
        if (args.optimize) {
          const optimized = await optimizeImage(buffer, img.aspectRatio);
          finalBuffer = optimized.buffer;
          resLog = ` ${optimized.width}×${optimized.height} (${img.aspectRatio})`;
        }

        // Compute brightness + advanced stats for IV
        let sharpStats = null;
        try {
          const sharp = (await import("sharp")).default;
          const stats = await sharp(finalBuffer).stats();
          const ch = stats.channels;
          brightness = ch[0].mean * 0.299 + ch[1].mean * 0.587 + ch[2].mean * 0.114;

          // IV-09: top-3 dominant colors
          const dominantColors = await extractDominantColors(finalBuffer);
          // IV-10: edge density
          const edgeDensity = await computeEdgeDensity(finalBuffer);

          sharpStats = { dominantColors, edgeDensity };
        } catch {
          // Sharp unavailable
        }

        const ivIssues = validateImage(img, finalBuffer, "STOP", brightness, sharpStats);
        const ivFails = ivIssues.filter((i) => i.level === "FAIL");
        for (const issue of ivIssues) {
          const icon = issue.level === "FAIL" ? "❌" : "⚠️";
          console.log(`  ${icon} Slide ${img.slideNumber} [${issue.rule}]: ${issue.msg}`);
        }

        if (ivFails.length > 0) {
          if (attempt < maxAttempts - 1) {
            lastVQAFeedback = null; // IV failure — no VQA data, use blind mutation
            console.warn(`  ⚠️  Slide ${img.slideNumber}: IV FAIL — 프롬프트 변이 후 재시도...`);
            continue; // retry with mutated prompt
          }
          console.error(`  ⏭  Slide ${img.slideNumber}: IV FAIL (${maxAttempts}회 시도) — 재생성 필요`);
          return { slide: img.slideNumber, status: "iv-fail", ip: ipIssues, iv: ivIssues, attempts: attempt + 1 };
        }

        fs.writeFileSync(outPath, finalBuffer);

        // VQA scoring (#1) — after save, before metadata
        const category = detectCategory(img);
        let vqaResult = null;
        if (args.vqa) {
          console.log(`  🔬 Slide ${img.slideNumber}: VQA 스코어링 중...`);
          vqaResult = await scoreImageWithVQA(finalBuffer, img.prompt, category, img.tier);
          if (vqaResult) {
            const grade = vqaResult.total >= 25 ? "PASS" : vqaResult.total >= 22 ? "WARN" : "FAIL";
            const gradeIcon = grade === "PASS" ? "✅" : grade === "WARN" ? "⚠️" : "❌";
            console.log(`  ${gradeIcon} Slide ${img.slideNumber} VQA: ${vqaResult.total}/27.5 [${grade}] (PF:${vqaResult.scores.prompt_fidelity} TA:${vqaResult.scores.text_absence} CO:${vqaResult.scores.composition} CH:${vqaResult.scores.color_harmony} PF:${vqaResult.scores.presentation_fit})`);
            if (vqaResult.detected_text?.length > 0) {
              console.warn(`    🔤 Detected text: ${vqaResult.detected_text.join(", ")}`);
            }
            // Show VQA reasons for low scores
            if (vqaResult.reasons) {
              for (const [key, reason] of Object.entries(vqaResult.reasons)) {
                if (reason) console.warn(`    💡 ${key}: ${reason}`);
              }
            }
            // Track ALL VQA attempts (including failures) for recommendations analysis
            allVQAAttempts.push({ slide: img.slideNumber, vqa: vqaResult, attempt, category, prompt: currentPrompt });
            // D4: Absolute floor gate — total derailment prevention (R53-R55: autumn forest→business slide)
            const ABSOLUTE_FLOOR = 15;
            if (vqaResult.total < ABSOLUTE_FLOOR && attempt < maxAttempts - 1) {
              lastVQAFeedback = vqaResult;
              console.warn(`  🚫 Slide ${img.slideNumber}: VQA ABSOLUTE FLOOR (${vqaResult.total}/27.5 < ${ABSOLUTE_FLOOR}) — 완전 이탈, 재시도...`);
              fs.unlinkSync(outPath);
              continue;
            }
            // VQA FAIL gate: dynamic threshold from cumulative category stats
            // gate = max(floor, categoryAvg × 0.85) — rises as prompts improve
            // C1: Gate floors adjusted for PF 1.5x weighting (max 27.5 instead of 25)
            const GATE_FLOORS = { cover: 17.5, icon: 20, frame: 20, metaphor: 18.5, background: 18.5 };
            const floor = GATE_FLOORS[category] || 18.5;
            const catAvg = categoryStats[category]?.avg || 0;
            const vqaGate = Math.max(floor, Math.round(catAvg * 0.85));
            if (vqaResult.total < vqaGate && attempt < maxAttempts - 1) {
              lastVQAFeedback = vqaResult; // Pass VQA scores to guide next retry
              console.warn(`  ⚠️  Slide ${img.slideNumber}: VQA FAIL (${vqaResult.total}/27.5, gate=${vqaGate}) — 재시도...`);
              fs.unlinkSync(outPath); // remove failed image
              continue;
            }
          }
        }

        // Write metadata JSON
        const metaPath = outPath.replace(/\.png$/, "-meta.json");
        const metaData = {
          slide: img.slideNumber, tier: img.tier,
          type: img.iconSet ? "icon-set" : (img.aspectRatio === "1:1" ? "icon" : "photo"),
          category,
          prompt: currentPrompt.slice(0, 500), attempt: attempt + 1,
          finishReason: "STOP", brightness: Math.round(brightness),
          ip: ipIssues, iv: ivIssues,
          ...(vqaResult && { vqa: vqaResult }),
        };
        fs.writeFileSync(metaPath, JSON.stringify(metaData, null, 2));

        // Store first successful image for chain mode
        if (chainMode && !firstImageBase64) {
          firstImageBase64 = buffer.toString("base64");
        }

        const sizeKB = (finalBuffer.length / 1024).toFixed(0);
        console.log(`  ✅ Slide ${img.slideNumber}: ${img.filename} (${sizeKB}KB)${resLog}`);

        const result = {
          slide: img.slideNumber, status: "ok", size: finalBuffer.length,
          ip: ipIssues, iv: ivIssues, attempts: attempt + 1,
          prompt: currentPrompt, category,
          ...(vqaResult && { vqa: vqaResult }),
        };
        allResults.push(result);
        return result;
      } catch (err) {
        lastError = err;
        // Track 429 for adaptive concurrency
        if (err.message.includes("429") || err.message.includes("Rate limit")) {
          adaptiveLimiter.on429();
        }
        // NO_IMAGE after VQA-guided retry → clear feedback, fall back to blind mutation
        if (lastVQAFeedback && (err.message.includes("NO_IMAGE") || err.message.includes("SAFETY"))) {
          lastVQAFeedback = null;
        }
        if (attempt < maxAttempts - 1) {
          console.warn(`  ⚠️  Slide ${img.slideNumber}: ${err.message} — 재시도...`);
          continue;
        }
      }
    }

    console.error(`  ❌ Slide ${img.slideNumber}: ${lastError?.message || "Unknown error"}`);
    return { slide: img.slideNumber, status: "error", error: lastError?.message, attempts: maxAttempts };
  });

  // A-03: Chain mode optimization — run first task sequentially (to get reference image),
  // then run remaining tasks concurrently (they all reference the same first image).
  let results;
  if (chainMode && tasks.length > 1) {
    // Run first task to establish reference image
    const firstResult = await tasks[0](null);
    const firstSettled = [{ status: "fulfilled", value: firstResult }];
    // Run remaining tasks concurrently
    const restResults = await runSequentialOrConcurrent(tasks.slice(1), adaptiveLimiter, false);
    results = [...firstSettled, ...restResults];
  } else {
    results = await runSequentialOrConcurrent(tasks, adaptiveLimiter, chainMode);
  }

  // Summary
  const ok = results.filter((r) => r.value?.status === "ok").length;
  const skipped = results.filter((r) => r.value?.status === "skipped").length;
  const failed = results.filter((r) => r.value?.status === "error").length;
  const ipBlocked = results.filter((r) => r.value?.status === "ip-error").length;
  const ivFailed = results.filter((r) => r.value?.status === "iv-fail").length;

  console.log(`\n📊 결과: 성공 ${ok}, 건너뜀 ${skipped}, 실패 ${failed}${ipBlocked ? `, IP차단 ${ipBlocked}` : ""}${ivFailed ? `, IV실패 ${ivFailed}` : ""}`);
  console.log(`📁 저장 위치: ${outputDir}`);

  // Generate report (#5)
  if (args.vqa && allResults.length > 0) {
    const vqaResults = allResults.filter((r) => r.vqa);
    const vqaScores = vqaResults.map((r) => r.vqa.total);
    const byCategory = {};
    const byRule = {};

    for (const r of allResults) {
      const cat = r.category || "general";
      if (!byCategory[cat]) byCategory[cat] = { scores: [], count: 0 };
      if (r.vqa) {
        byCategory[cat].scores.push(r.vqa.total);
      }
      byCategory[cat].count++;

      for (const issue of [...(r.ip || []), ...(r.iv || [])]) {
        byRule[issue.rule] = (byRule[issue.rule] || 0) + 1;
      }
    }

    const categoryAvgs = {};
    for (const [cat, data] of Object.entries(byCategory)) {
      categoryAvgs[cat] = {
        avg: data.scores.length > 0 ? Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length * 10) / 10 : null,
        count: data.count,
      };
    }

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total: images.length, pass: ok, warn: vqaResults.filter((r) => r.vqa.total >= 22 && r.vqa.total < 25).length,
        fail: failed + ivFailed + vqaResults.filter((r) => r.vqa.total < 22).length,
        skipped,
      },
      vqa: vqaScores.length > 0 ? {
        avg: Math.round(vqaScores.reduce((a, b) => a + b, 0) / vqaScores.length * 10) / 10,
        min: Math.min(...vqaScores), max: Math.max(...vqaScores),
        distribution: {
          "27.5": vqaScores.filter((s) => s === 27.5).length,
          "25-27": vqaScores.filter((s) => s >= 25 && s < 27.5).length,
          "22-24": vqaScores.filter((s) => s >= 22 && s < 25).length,
          "17-21": vqaScores.filter((s) => s >= 17 && s < 22).length,
          "<17": vqaScores.filter((s) => s < 17).length,
        },
      } : null,
      by_category: categoryAvgs,
      by_rule: byRule,
      weakest_slides: vqaResults.sort((a, b) => a.vqa.total - b.vqa.total).slice(0, 5).map((r) => ({
        slide: r.slide, total: r.vqa.total, scores: r.vqa.scores,
      })),
      // Use allVQAAttempts (includes retried failures) for accurate weakness detection
      recommendations: generateVQARecommendations(allVQAAttempts.length > 0 ? allVQAAttempts : vqaResults),
      vqa_attempts: { total: allVQAAttempts.length, retried: allVQAAttempts.length - vqaResults.length },
    };

    const reportPath = path.join(outputDir, "nanoBanana-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n📊 VQA 리포트: ${reportPath}`);
    console.log(`   평균 VQA: ${report.vqa?.avg || "N/A"}/27.5, 최저: ${report.vqa?.min || "N/A"}, 최고: ${report.vqa?.max || "N/A"}`);
    if (report.vqa_attempts.retried > 0) {
      console.log(`   VQA 시도: ${report.vqa_attempts.total}회 (재시도 ${report.vqa_attempts.retried}회 포함)`);
    }
    if (report.recommendations && report.recommendations.length > 0) {
      console.log(`\n⚠️  파이프라인 개선 권고 ${report.recommendations.length}건:`);
      for (const rec of report.recommendations) {
        if (rec.criterion === "keyword_analysis" || rec.criterion?.startsWith("cumulative_keywords_")) {
          console.log(`   [${rec.severity}] ${rec.criterion}: 추천: ${rec.top_keywords?.join(", ") || "(없음)"}`);
          console.log(`   [${rec.severity}] ${rec.criterion}: 비추천: ${rec.bottom_keywords?.join(", ") || "(없음)"}`);
          if (rec.blocked_keywords?.length > 0) {
            console.log(`   [${rec.severity}] ${rec.criterion}: ❌ 차단: ${rec.blocked_keywords.join(", ")}`);
          }
        } else {
          console.log(`   [${rec.severity}] ${rec.criterion} (avg ${rec.avg}): ${rec.action}`);
        }
      }
    }

    // Build keyword scores (#2)
    const keywordScores = buildKeywordScores(allResults);
    const keywordPath = path.join(outputDir, "prompt-keyword-scores.json");
    fs.writeFileSync(keywordPath, JSON.stringify(keywordScores, null, 2));
    console.log(`📊 키워드 점수: ${keywordPath}`);

    // Merge into cumulative DB (#3)
    if (args["update-scores"]) {
      const dbPath = path.resolve("D:/projects/slides-grab/.claude/docs/nanoBanana-prompt-scores.json");
      let existing = {};
      try { existing = JSON.parse(fs.readFileSync(dbPath, "utf-8")); } catch { /* first run */ }
      const merged = mergeKeywordScores(existing, keywordScores);

      // Update cumulative category VQA stats (for dynamic gate + item-level tracking)
      const catStats = merged._category_stats || {};
      // Aggregate item-level scores from this batch's VQA results
      const batchItemScores = {};
      for (const r of allResults) {
        if (!r.vqa?.scores) continue;
        const cat = r.category || "general";
        if (!batchItemScores[cat]) batchItemScores[cat] = { pf: [], ta: [], co: [], ch: [], pfit: [] };
        const s = r.vqa.scores;
        batchItemScores[cat].pf.push(s.prompt_fidelity || 0);
        batchItemScores[cat].ta.push(s.text_absence || 0);
        batchItemScores[cat].co.push(s.composition || 0);
        batchItemScores[cat].ch.push(s.color_harmony || 0);
        batchItemScores[cat].pfit.push(s.presentation_fit || 0);
      }
      for (const [cat, data] of Object.entries(report.by_category || {})) {
        const prev = catStats[cat] || { avg: 0, count: 0 };
        // C1: Migrate old 25-scale avg to 27.5-scale if needed (one-time transition)
        // Old avg max=25, new max=27.5. If prev has pf_avg we can recompute; otherwise scale×1.1
        if (prev.avg > 0 && prev.avg <= 25 && prev.count > 0 && !prev._migrated) {
          if (prev.pf_avg != null) {
            prev.avg = Math.round((prev.pf_avg * 1.5 + prev.ta_avg + prev.co_avg + prev.ch_avg + prev.pfit_avg) * 10) / 10;
          } else {
            prev.avg = Math.round(prev.avg * 1.1 * 10) / 10;
          }
          prev._migrated = true;
        }
        const totalCount = prev.count + data.count;
        const newStat = {
          avg: Math.round(((prev.avg * prev.count) + (data.avg * data.count)) / totalCount * 10) / 10,
          count: totalCount,
        };
        // Item-level averages (weighted merge with previous)
        const items = batchItemScores[cat];
        if (items) {
          const batchN = items.pf.length;
          const calcAvg = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
          const mergeItem = (key, batchArr) => {
            const prevVal = prev[key];
            // Only merge if previous value exists; otherwise use batch-only average
            if (prevVal != null && prev.count > 0) {
              const prevN = prev.count;
              const batchVal = calcAvg(batchArr);
              return Math.round(((prevVal * prevN) + (batchVal * batchN)) / (prevN + batchN) * 10) / 10;
            }
            return Math.round(calcAvg(batchArr) * 10) / 10;
          };
          newStat.pf_avg = mergeItem("pf_avg", items.pf);
          newStat.ta_avg = mergeItem("ta_avg", items.ta);
          newStat.co_avg = mergeItem("co_avg", items.co);
          newStat.ch_avg = mergeItem("ch_avg", items.ch);
          newStat.pfit_avg = mergeItem("pfit_avg", items.pfit);
        }
        catStats[cat] = newStat;
      }
      merged._category_stats = catStats;

      fs.writeFileSync(dbPath, JSON.stringify(merged, null, 2));
      console.log(`📊 누적 DB 갱신: ${dbPath}`);
    }
  }

  const allFailed = results
    .filter((r) => ["error", "ip-error", "iv-fail"].includes(r.value?.status))
    .map((r) => r.value.slide);

  if (allFailed.length > 0) {
    console.log("\n💡 실패한 이미지만 재생성하려면:");
    console.log(`   node scripts/generate-images.mjs --outline ${args.outline} --output ${args.output || outputDir} --regenerate ${allFailed.join(",")}`);
    if (ipBlocked > 0) {
      console.log(`   ⚠️  IP ERROR ${ipBlocked}건 — 프롬프트를 수정한 후 재생성하세요.`);
    }
    if (ivFailed > 0) {
      console.log(`   ⚠️  IV FAIL ${ivFailed}건 — 프롬프트를 수정하거나 유형을 전환하세요.`);
    }
    process.exit(1);
  }
}

main();
