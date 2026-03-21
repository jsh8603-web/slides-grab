#!/usr/bin/env node

/**
 * draft-marp.mjs — Quick draft PPTX from slide-outline.md via Marp CLI
 *
 * Usage:
 *   node scripts/draft-marp.mjs --outline <path> --output <path> [--open]
 *
 * Parses a slide-outline.md, converts to Marp Markdown, and produces a PPTX.
 */

import { readFile, writeFile, unlink, access, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { execSync, exec } from "node:child_process";
import { platform } from "node:os";

// ── CLI argument parsing ────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { outline: null, output: null, open: false };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--outline":
        args.outline = argv[++i];
        break;
      case "--output":
        args.output = argv[++i];
        break;
      case "--open":
        args.open = true;
        break;
      default:
        console.error(`Unknown option: ${argv[i]}`);
        printUsage();
        process.exit(1);
    }
  }
  if (!args.outline || !args.output) {
    printUsage();
    process.exit(1);
  }
  return args;
}

function printUsage() {
  console.log(`
Usage: node scripts/draft-marp.mjs --outline <path> --output <path> [--open]

Options:
  --outline   Path to slide-outline.md (required)
  --output    Output PPTX path (required)
  --open      Auto-open after conversion
`);
}

// ── Outline parser ──────────────────────────────────────────────────────────

function parseMeta(text) {
  const meta = {};
  const metaMatch = text.match(/## Meta\r?\n([\s\S]*?)(?=\r?\n## )/);
  if (!metaMatch) return meta;

  const lines = metaMatch[1].split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^-\s+\*\*(.+?)\*\*:\s*(.+)/);
    if (m) {
      meta[m[1].trim()] = m[2].trim();
    }
  }
  return meta;
}

function parseSlides(text) {
  const slides = [];
  // Normalize line endings for consistent regex matching
  const normalized = text.replace(/\r\n/g, "\n");
  // Split by ### Slide N or ## 슬라이드 N headings
  const slideBlocks = normalized.split(/(?=(?:### Slide|## 슬라이드) \d+)/);

  for (const block of slideBlocks) {
    // Match English "### Slide N - Title" or Korean "## 슬라이드 N: Title"
    const headerMatch = block.match(
      /^(?:### Slide|## 슬라이드) (\d+)\s*[-:]\s*(.+?)$/m
    );
    if (!headerMatch) continue;

    const slide = {
      number: parseInt(headerMatch[1], 10),
      headerTitle: headerMatch[2].trim(),
      type: null,
      title: null,
      subtitle: null,
      keyMessage: null,
      details: [],
      items: [],
      quote: null,
      attribution: null,
      context: null,
      message: null,
      closingMessage: null,
      keyTakeaways: [],
      followUp: null,
      funFact: null,
      timelineData: [],
      hasImage: false,
      imageFile: null,
    };

    // Type (also match **슬라이드 유형**: Korean format)
    const typeMatch = block.match(/^-\s+\*\*Type\*\*:\s*(.+)/m);
    if (typeMatch) slide.type = typeMatch[1].trim();
    if (!slide.type) {
      const korTypeMatch = block.match(/^\*\*슬라이드 유형\*\*:\s*(.+)/m);
      if (korTypeMatch) {
        const raw = korTypeMatch[1].trim();
        // Map Korean type names to English for Marp class matching
        const typeMap = { '표지': 'Cover', '클로징': 'Closing', '목차': 'Contents' };
        const parenthetical = raw.match(/\(([^)]+)\)/);
        slide.type = parenthetical ? parenthetical[1].trim() : (typeMap[raw] || raw);
      }
    }

    // Title (also match **헤드라인**: and **헤드라인**:\n as fallback)
    const titleMatch = block.match(/^-\s+\*\*Title\*\*:\s*(.+)/m);
    if (titleMatch) slide.title = titleMatch[1].trim();
    if (!slide.title) {
      const headlineMatch = block.match(/^\*\*헤드라인\*\*:\s*\n?(.+)/m);
      if (headlineMatch) slide.title = headlineMatch[1].trim();
    }
    // Last resort: use headerTitle from ### Slide N - Title
    if (!slide.title && slide.headerTitle) {
      slide.title = slide.headerTitle;
    }

    // Subtitle (also match **서브헤드라인**:)
    const subtitleMatch = block.match(/^-\s+\*\*Subtitle\*\*:\s*(.+)/m);
    if (subtitleMatch) slide.subtitle = subtitleMatch[1].trim();
    if (!slide.subtitle) {
      const subHeadMatch = block.match(/^\*\*서브헤드라인\*\*:\s*\n?(.+)/m);
      if (subHeadMatch) slide.subtitle = subHeadMatch[1].trim();
    }

    // Key Message (also match **핵심 메시지**: with blockquote)
    const keyMsgMatch = block.match(/^-\s+\*\*Key Message\*\*:\s*(.+)/m);
    if (keyMsgMatch) slide.keyMessage = keyMsgMatch[1].trim();
    if (!slide.keyMessage) {
      const korMsgMatch = block.match(/^\*\*핵심 메시지\*\*:\s*\n>\s*(.+)/m);
      if (korMsgMatch) slide.keyMessage = korMsgMatch[1].trim();
    }

    // Quote
    const quoteMatch = block.match(/^-\s+\*\*Quote\*\*:\s*(.+)/m);
    if (quoteMatch) slide.quote = quoteMatch[1].trim();

    // Attribution
    const attrMatch = block.match(/^-\s+\*\*Attribution\*\*:\s*(.+)/m);
    if (attrMatch) slide.attribution = attrMatch[1].trim();

    // Context
    const ctxMatch = block.match(/^-\s+\*\*Context\*\*:\s*(.+)/m);
    if (ctxMatch) slide.context = ctxMatch[1].trim();

    // Message (for Closing slides)
    const msgMatch = block.match(/^-\s+\*\*Message\*\*:\s*(.+)/m);
    if (msgMatch) slide.message = msgMatch[1].trim();

    // Closing Message
    const closingMatch = block.match(/^-\s+\*\*Closing Message\*\*:\s*(.+)/m);
    if (closingMatch) slide.closingMessage = closingMatch[1].trim();

    // Follow-up Message
    const followMatch = block.match(/^-\s+\*\*Follow-up Message\*\*:\s*(.+)/m);
    if (followMatch) slide.followUp = followMatch[1].trim();

    // Fun Fact
    const funMatch = block.match(/^-\s+\*\*Fun Fact\*\*:\s*(.+)/m);
    if (funMatch) slide.funFact = funMatch[1].trim();

    // Items (for Table of Contents)
    const itemsMatch = block.match(
      /^-\s+\*\*Items\*\*:\s*\n((?:\s+\d+\..+\n?)+)/m
    );
    if (itemsMatch) {
      slide.items = itemsMatch[1]
        .split("\n")
        .map((l) => l.replace(/^\s+\d+\.\s*/, "").trim())
        .filter(Boolean);
    }

    // Details (bullet points under **Details**)
    const detailsMatch = block.match(
      /^-\s+\*\*Details\*\*:\s*\n((?:\s+-\s+.+\n?)+)/m
    );
    if (detailsMatch) {
      slide.details = detailsMatch[1]
        .split("\n")
        .map((l) => l.replace(/^\s+-\s*/, "").trim())
        .filter(Boolean);
    }

    // Key Takeaways
    const takeawaysMatch = block.match(
      /^-\s+\*\*Key Takeaways\*\*:\s*\n((?:\s+\d+\..+\n?)+)/m
    );
    if (takeawaysMatch) {
      slide.keyTakeaways = takeawaysMatch[1]
        .split("\n")
        .map((l) => l.replace(/^\s+\d+\.\s*/, "").trim())
        .filter(Boolean);
    }

    // Right/Left text (for Split Layout)
    const rightTextMatch = block.match(
      /^-\s+\*\*Right \(Text\)\*\*:\s*\n((?:\s+-\s+.+\n?)+)/m
    );
    if (rightTextMatch) {
      slide.details = rightTextMatch[1]
        .split("\n")
        .map((l) => l.replace(/^\s+-\s*/, "").trim())
        .filter(Boolean);
    }

    const leftTextMatch = block.match(
      /^-\s+\*\*Left \(Text\)\*\*:\s*\n((?:\s+-\s+.+\n?)+)/m
    );
    if (leftTextMatch) {
      slide.details = leftTextMatch[1]
        .split("\n")
        .map((l) => l.replace(/^\s+-\s*/, "").trim())
        .filter(Boolean);
    }

    // Timeline Data (from code block)
    const timelineMatch = block.match(
      /^-\s+\*\*Timeline Data\*\*.*:\s*\n\s*```\n?([\s\S]*?)```/m
    );
    if (timelineMatch) {
      slide.timelineData = timelineMatch[1]
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    }

    // NanoBanana tag → check for image file
    const nanoMatch = block.match(/^-\s+NanoBanana:/m);
    if (nanoMatch) {
      slide.hasImage = true;
    }

    // ── Generic body content extractor (Korean outline fallback) ──
    // If structured fields are empty, extract content from the block
    if (slide.details.length === 0 && slide.items.length === 0 && slide.timelineData.length === 0) {
      const bodyLines = [];

      // Extract tables (markdown format)
      const tableRegex = /^\|.+\|$/gm;
      const tableMatches = block.match(tableRegex);
      if (tableMatches) {
        for (const row of tableMatches) {
          // Skip separator rows
          if (/^\|[\s-:|]+\|$/.test(row)) continue;
          bodyLines.push(row);
        }
      }

      // Extract code blocks (formulas)
      const codeBlocks = block.match(/```[\s\S]*?```/g);
      if (codeBlocks) {
        for (const cb of codeBlocks) {
          const inner = cb.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim();
          if (inner) {
            // Take first 4 lines of each code block to avoid overflow
            const codeLines = inner.split('\n').slice(0, 4);
            bodyLines.push('```');
            bodyLines.push(...codeLines);
            bodyLines.push('```');
          }
        }
      }

      // Extract bullet points (Korean format: • or - prefixed, not metadata fields)
      const bulletRegex = /^[•]\s+\*\*(.+?)\*\*[：:]\s*(.+)/gm;
      let bulletMatch;
      while ((bulletMatch = bulletRegex.exec(block)) !== null) {
        bodyLines.push(`- **${bulletMatch[1]}**: ${bulletMatch[2].substring(0, 80)}`);
      }

      // Extract Hero Number
      const heroMatch = block.match(/\*\*Hero Number\*\*:\s*(.+)/);
      if (heroMatch) {
        bodyLines.push(`### ${heroMatch[1].replace(/`/g, '')}`);
      }

      // Extract 분석 결론
      const conclusionMatch = block.match(/\*\*분석 결론\*\*:\s*(.+)/);
      if (conclusionMatch) {
        bodyLines.push(`> ${conclusionMatch[1]}`);
      }

      // Extract 사례 결론
      const caseMatch = block.match(/\*\*사례 결론\*\*:\s*(.+)/);
      if (caseMatch) {
        bodyLines.push(`> ${caseMatch[1]}`);
      }

      if (bodyLines.length > 0) {
        slide._rawBody = bodyLines.join('\n');
      }
    }

    slides.push(slide);
  }

  return slides;
}

// ── Marp Markdown generator ─────────────────────────────────────────────────

function slideToMarp(slide, assetsDir) {
  const lines = [];
  const type = (slide.type || "").toLowerCase();

  // Check for existing image (resolved during build, not here)
  let imageRef = null;
  if (slide.hasImage && assetsDir && slide._imageFile) {
    imageRef = `assets/${slide._imageFile}`;
  }

  // Lead class for cover/section/closing
  const isLead =
    type === "cover" ||
    type === "section divider" ||
    type === "closing" ||
    type === "quote";

  if (isLead) {
    lines.push("<!-- _class: lead -->");
    lines.push("");
  }

  // Background image for split layouts
  if (imageRef && (type === "split layout" || type === "split")) {
    lines.push(`![bg right](${imageRef})`);
    lines.push("");
  } else if (imageRef && isLead) {
    lines.push(`![bg opacity:0.3](${imageRef})`);
    lines.push("");
  }

  // Title
  if (slide.title) {
    lines.push(`# ${slide.title}`);
    lines.push("");
  }

  // Subtitle (Cover)
  if (slide.subtitle) {
    lines.push(`## ${slide.subtitle}`);
    lines.push("");
  }

  // Key message (skip for statistics — shown as heading below)
  if (slide.keyMessage && !isLead && type !== "statistics") {
    lines.push(`> ${slide.keyMessage}`);
    lines.push("");
  }

  // Quote slide
  if (type === "quote" && slide.quote) {
    lines.push(`> ${slide.quote}`);
    lines.push("");
    if (slide.attribution) {
      lines.push(`*— ${slide.attribution}*`);
      lines.push("");
    }
    if (slide.context) {
      lines.push(slide.context);
      lines.push("");
    }
    if (slide.followUp) {
      lines.push(`**${slide.followUp}**`);
      lines.push("");
    }
  }

  // Items (Table of Contents)
  if (slide.items.length > 0) {
    for (let i = 0; i < slide.items.length; i++) {
      lines.push(`${i + 1}. ${slide.items[i]}`);
    }
    lines.push("");
  }

  // Details (bullet points)
  if (slide.details.length > 0 && type !== "quote") {
    for (const d of slide.details) {
      lines.push(`- ${d}`);
    }
    lines.push("");
  }

  // Timeline
  if (slide.timelineData.length > 0) {
    for (let i = 0; i < slide.timelineData.length; i++) {
      lines.push(`${i + 1}. ${slide.timelineData[i]}`);
    }
    lines.push("");
  }

  // Statistics type: key message as big text
  if (type === "statistics" && slide.keyMessage) {
    lines.push(`### ${slide.keyMessage}`);
    lines.push("");
  }

  // Raw body content (Korean outline fallback)
  if (slide._rawBody) {
    lines.push(slide._rawBody);
    lines.push("");
  }

  // Fun fact
  if (slide.funFact) {
    lines.push(`> 💡 ${slide.funFact}`);
    lines.push("");
  }

  // Inline image for content slides
  if (imageRef && !isLead && type !== "split layout" && type !== "split") {
    lines.push(`![w:400](${imageRef})`);
    lines.push("");
  }

  // Closing specifics
  if (type === "closing") {
    if (slide.message) {
      lines.push(slide.message);
      lines.push("");
    }
    if (slide.keyTakeaways.length > 0) {
      for (let i = 0; i < slide.keyTakeaways.length; i++) {
        lines.push(`${i + 1}. ${slide.keyTakeaways[i]}`);
      }
      lines.push("");
    }
    if (slide.closingMessage) {
      lines.push(`**${slide.closingMessage}**`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function buildMarpMarkdown(meta, slides, assetsDir) {
  const parts = [];

  // Frontmatter
  parts.push("---");
  parts.push("marp: true");
  parts.push("theme: default");
  parts.push("paginate: true");
  if (meta["Color Palette"]) {
    // Extract primary color for theme
    const colorMatch = meta["Color Palette"].match(/#[0-9A-Fa-f]{6}/);
    if (colorMatch) {
      parts.push("style: |");
      parts.push(`  section { font-family: sans-serif; }`);
      parts.push(`  h1 { color: ${colorMatch[0]}; }`);
    }
  }
  parts.push("---");
  parts.push("");

  for (let i = 0; i < slides.length; i++) {
    if (i > 0) {
      parts.push("---");
      parts.push("");
    }
    parts.push(slideToMarp(slides[i], assetsDir));
  }

  return parts.join("\n");
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  const outlinePath = resolve(args.outline);
  const outputPath = resolve(args.output);

  // Read outline
  let outlineText;
  try {
    outlineText = await readFile(outlinePath, "utf-8");
  } catch (err) {
    console.error(`Error: Cannot read outline file: ${outlinePath}`);
    console.error(err.message);
    process.exit(1);
  }

  // Parse
  const meta = parseMeta(outlineText);
  const slides = parseSlides(outlineText);

  if (slides.length === 0) {
    console.error("Error: No slides found in the outline file.");
    process.exit(1);
  }

  console.log(
    `Parsed ${slides.length} slides from outline (topic: ${meta["Topic"] || "unknown"})`
  );

  // Determine assets dir relative to output and resolve actual image files
  const outputDir = dirname(outputPath);
  let assetsDir = null;
  try {
    await access(resolve(outputDir, "assets"));
    assetsDir = "assets";

    // Resolve actual image files for each slide
    const assetFiles = await readdir(resolve(outputDir, "assets"));
    for (const slide of slides) {
      const nn = String(slide.number).padStart(2, "0");
      const match = assetFiles.find(
        (f) => f.startsWith(`slide-${nn}`) && /\.(png|jpe?g|webp)$/i.test(f)
      );
      if (match) {
        slide._imageFile = match;
        slide.hasImage = true;
      }
    }
  } catch {
    // No assets directory — skip image references
  }

  // Generate Marp markdown
  const marpMd = buildMarpMarkdown(meta, slides, assetsDir);

  // Write temp file next to output
  const tempMdPath = outputPath.replace(/\.pptx$/i, ".draft.md");
  await writeFile(tempMdPath, marpMd, "utf-8");
  console.log(`Generated Marp markdown: ${tempMdPath}`);

  // Run Marp CLI
  try {
    console.log("Converting to PPTX via Marp CLI...");
    execSync(
      `npx @marp-team/marp-cli "${tempMdPath}" --pptx -o "${outputPath}"`,
      { stdio: "inherit", timeout: 120_000 }
    );
    console.log(`\nDraft PPTX created: ${outputPath}`);
  } catch (err) {
    console.error("Error: Marp CLI conversion failed.");
    console.error(
      "Make sure @marp-team/marp-cli is installed: npm install -D @marp-team/marp-cli"
    );
    process.exit(1);
  }

  // Clean up temp file
  try {
    await unlink(tempMdPath);
  } catch {
    // Ignore cleanup errors
  }

  // Auto-open if requested
  if (args.open) {
    const os = platform();
    let cmd;
    if (os === "win32") {
      cmd = `start "" "${outputPath}"`;
    } else if (os === "darwin") {
      cmd = `open "${outputPath}"`;
    } else {
      cmd = `xdg-open "${outputPath}"`;
    }
    exec(cmd, (err) => {
      if (err) console.error("Could not auto-open file:", err.message);
    });
  }
}

main();
