#!/usr/bin/env node

/**
 * Post-PPTX XML validator — parses the ZIP/XML inside a .pptx file
 * and checks for layout issues (overflow, alignment, empty text, contrast).
 *
 * Usage:
 *   node scripts/validate-pptx.js --input slides/presentation/output.pptx
 *
 * Exit code 1 if any ERROR, 0 otherwise.
 *
 * Programmatic API:
 *   import { validatePptx } from './validate-pptx.js';
 *   const { errors, warnings, passed } = await validatePptx('path/to.pptx');
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ── Constants ──────────────────────────────────────────────────────────────

const EMU_PER_INCH = 914400;
const EMU_PER_PT = 12700;

// Default 16:9 slide dimensions (10" x 5.625")
const DEFAULT_SLIDE_W = 9144000;
const DEFAULT_SLIDE_H = 5143500;

// Column alignment tolerance (~3pt)
const COL_TOLERANCE = 36000;

// WCAG contrast thresholds
const CONTRAST_ERROR = 1.5;
const CONTRAST_WARN = 4.5;

// ── Helpers ────────────────────────────────────────────────────────────────

function emuToInches(emu) {
  return (emu / EMU_PER_INCH).toFixed(2);
}

/**
 * Parse sRGB hex (6-char) into linear-light components for contrast calc.
 */
function hexToLuminance(hex) {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const toLinear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrastRatio(hex1, hex2) {
  const l1 = hexToLuminance(hex1);
  const l2 = hexToLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ── Minimal regex-based XML helpers ────────────────────────────────────────

/**
 * Extract all matches of a regex pattern, returning an array of match objects.
 */
function matchAll(xml, pattern) {
  const re = new RegExp(pattern, 'gs');
  const results = [];
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m);
  return results;
}

/**
 * Get attribute value from an XML tag string.
 */
function attr(tagStr, name) {
  const re = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i');
  const m = tagStr.match(re);
  return m ? m[1] : null;
}

// ── Slide size extraction ──────────────────────────────────────────────────

function parseSlideDimensions(presentationXml) {
  // <p:sldSz cx="9144000" cy="5143500" .../>
  const m = presentationXml.match(/<p:sldSz[^>]*>/i);
  if (!m) return { width: DEFAULT_SLIDE_W, height: DEFAULT_SLIDE_H };
  const cx = attr(m[0], 'cx');
  const cy = attr(m[0], 'cy');
  return {
    width: cx ? parseInt(cx, 10) : DEFAULT_SLIDE_W,
    height: cy ? parseInt(cy, 10) : DEFAULT_SLIDE_H,
  };
}

// ── Shape extraction from slide XML ────────────────────────────────────────

/**
 * Extract shape info from a slide XML string.
 * Returns array of { name, x, y, w, h, fillColor, textRuns: [{ text, color }] }
 */
function extractShapes(slideXml) {
  const shapes = [];

  // Match each <p:sp>...</p:sp> block
  const spBlocks = matchAll(slideXml, '<p:sp\\b[^>]*>([\\s\\S]*?)</p:sp>');

  for (const block of spBlocks) {
    const inner = block[1];
    const shape = { name: '', x: 0, y: 0, w: 0, h: 0, fillColor: null, textRuns: [] };

    // Shape name from <p:nvSpPr><p:cNvPr ... name="..."/>
    const cNvPr = inner.match(/<p:cNvPr[^>]*>/i);
    if (cNvPr) {
      shape.name = attr(cNvPr[0], 'name') || '';
    }

    // Position: <a:off x="..." y="..."/>
    const off = inner.match(/<a:off[^>]*>/i);
    if (off) {
      shape.x = parseInt(attr(off[0], 'x') || '0', 10);
      shape.y = parseInt(attr(off[0], 'y') || '0', 10);
    }

    // Extent: <a:ext cx="..." cy="..."/>
    const ext = inner.match(/<a:ext[^>]*>/i);
    if (ext) {
      shape.w = parseInt(attr(ext[0], 'cx') || '0', 10);
      shape.h = parseInt(attr(ext[0], 'cy') || '0', 10);
    }

    // Shape fill: look for <a:solidFill> inside <p:spPr> but outside <p:txBody>
    // Split at <p:txBody> to isolate shape properties
    const txBodyStart = inner.indexOf('<p:txBody');
    const spPrSection = txBodyStart >= 0 ? inner.slice(0, txBodyStart) : inner;
    const spFill = spPrSection.match(/<a:solidFill>\s*<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/i);
    if (spFill) {
      shape.fillColor = spFill[1].toUpperCase();
    }

    // Text runs from <p:txBody>
    const txBody = inner.match(/<p:txBody>([\s\S]*?)<\/p:txBody>/i);
    if (txBody) {
      const runs = matchAll(txBody[1], '<a:r>([\s\S]*?)<\\/a:r>');
      for (const run of runs) {
        const runInner = run[1];

        // Text content: <a:t>...</a:t>
        const tMatch = runInner.match(/<a:t>([\s\S]*?)<\/a:t>/i);
        const text = tMatch ? tMatch[1] : '';

        // Text color: <a:rPr ...><a:solidFill><a:srgbClr val="..."/>
        let color = null;
        const rPr = runInner.match(/<a:rPr[^>]*>([\s\S]*?)<\/a:rPr>/i);
        if (rPr) {
          const textFill = rPr[1].match(/<a:solidFill>\s*<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/i);
          if (textFill) color = textFill[1].toUpperCase();
        }
        // Also check rPr self-closing with nested solidFill via broader search
        if (!color) {
          const rPrBroad = runInner.match(/<a:rPr[\s\S]*?<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/i);
          if (rPrBroad) color = rPrBroad[1].toUpperCase();
        }

        shape.textRuns.push({ text, color });
      }
    }

    shapes.push(shape);
  }

  return shapes;
}

// ── Validation checks ──────────────────────────────────────────────────────

function checkOverflow(shapes, slideW, slideH, slideNum) {
  const issues = [];
  for (const s of shapes) {
    if (s.w === 0 && s.h === 0) continue; // skip zero-size placeholders

    const right = s.x + s.w;
    const bottom = s.y + s.h;
    const name = s.name || 'unnamed';

    if (right > slideW + COL_TOLERANCE) {
      issues.push({
        level: 'ERROR',
        code: 'VP-01',
        slide: slideNum,
        message: `Shape "${name}" extends beyond slide right edge (x+w = ${emuToInches(right)}" > ${emuToInches(slideW)}")`,
      });
    }
    if (bottom > slideH + COL_TOLERANCE) {
      issues.push({
        level: 'ERROR',
        code: 'VP-01',
        slide: slideNum,
        message: `Shape "${name}" extends beyond slide bottom edge (y+h = ${emuToInches(bottom)}" > ${emuToInches(slideH)}")`,
      });
    }
    if (s.x < -COL_TOLERANCE) {
      issues.push({
        level: 'WARN',
        code: 'VP-01',
        slide: slideNum,
        message: `Shape "${name}" extends beyond slide left edge (x = ${emuToInches(s.x)}")`,
      });
    }
    if (s.y < -COL_TOLERANCE) {
      issues.push({
        level: 'WARN',
        code: 'VP-01',
        slide: slideNum,
        message: `Shape "${name}" extends beyond slide top edge (y = ${emuToInches(s.y)}")`,
      });
    }
  }
  return issues;
}

function checkColumnAlignment(shapes, slideNum) {
  const issues = [];

  // Filter to shapes with non-trivial size and not full-width (> 80% slide width)
  const candidates = shapes.filter((s) => {
    if (s.w === 0 && s.h === 0) return false;
    if (s.w > DEFAULT_SLIDE_W * 0.8) return false; // skip full-width elements
    if (s.h > DEFAULT_SLIDE_H * 0.8) return false; // skip full-height elements
    return true;
  });

  // Group shapes by x position AND similar width (within tolerance)
  const columns = [];
  for (const s of candidates) {
    let found = false;
    for (const col of columns) {
      const xClose = Math.abs(col.x - s.x) <= COL_TOLERANCE;
      // Width must be within 50% of median to belong to the same column group
      const medianW = col.shapes[0].w;
      const wClose = medianW > 0
        ? Math.abs(s.w - medianW) / medianW < 0.5
        : s.w < COL_TOLERANCE;
      if (xClose && wClose) {
        col.shapes.push(s);
        found = true;
        break;
      }
    }
    if (!found) {
      columns.push({ x: s.x, shapes: [s] });
    }
  }

  // For columns with 3+ shapes at different y positions, check width consistency
  for (const col of columns) {
    if (col.shapes.length < 3) continue;

    const uniqueY = new Set(col.shapes.map((s) => Math.round(s.y / COL_TOLERANCE)));
    if (uniqueY.size < 2) continue; // all at same y = row, not column

    const widths = col.shapes.map((s) => s.w);
    const minW = Math.min(...widths);
    const maxW = Math.max(...widths);

    // If width variance exceeds ~5pt (63500 EMU), flag it
    if (maxW - minW > 63500) {
      const widthStrs = widths.map((w) => emuToInches(w) + '"').join(', ');
      issues.push({
        level: 'WARN',
        code: 'VP-02',
        slide: slideNum,
        message: `Column at x=${emuToInches(col.x)}" has inconsistent widths (${widthStrs})`,
      });
    }

    // Check x alignment within the column
    const xs = col.shapes.map((s) => s.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    if (maxX - minX > COL_TOLERANCE) {
      issues.push({
        level: 'WARN',
        code: 'VP-02',
        slide: slideNum,
        message: `Column at x~${emuToInches(col.x)}" has x-offset variance (${emuToInches(maxX - minX)}" spread)`,
      });
    }
  }

  return issues;
}

function checkEmptyText(shapes, slideNum) {
  const issues = [];
  for (const s of shapes) {
    // Only check shapes that have a txBody (textRuns array exists and has entries)
    // but all runs are empty
    if (s.textRuns.length > 0) {
      const allEmpty = s.textRuns.every((r) => r.text.trim() === '');
      if (allEmpty) {
        const name = s.name || 'unnamed';
        issues.push({
          level: 'WARN',
          code: 'VP-03',
          slide: slideNum,
          message: `Shape "${name}" has a text frame but all text runs are empty`,
        });
      }
    }
  }
  return issues;
}

function checkContrast(shapes, slideNum) {
  const issues = [];
  for (const s of shapes) {
    if (s.textRuns.length === 0) continue;

    // Determine background color: shape fill, or assume white slide background
    const bgColor = s.fillColor || 'FFFFFF';

    for (const run of s.textRuns) {
      if (!run.text.trim()) continue;
      // Default text color is black if not specified
      const fgColor = run.color || '000000';

      const ratio = contrastRatio(fgColor, bgColor);
      const ratioStr = ratio.toFixed(1);
      const name = s.name || 'unnamed';
      const textPreview = run.text.trim().slice(0, 30);

      if (ratio < CONTRAST_ERROR) {
        issues.push({
          level: 'ERROR',
          code: 'VP-04',
          slide: slideNum,
          message: `Text "#${fgColor}" on "#${bgColor}" in "${name}" — invisible (ratio: ${ratioStr}:1) — "${textPreview}"`,
        });
      } else if (ratio < CONTRAST_WARN) {
        issues.push({
          level: 'WARN',
          code: 'VP-04',
          slide: slideNum,
          message: `Text "#${fgColor}" on "#${bgColor}" in "${name}" — low contrast (ratio: ${ratioStr}:1) — "${textPreview}"`,
        });
      }
    }
  }
  return issues;
}

// ── PPTX extraction & orchestration ────────────────────────────────────────

function extractPptx(pptxPath) {
  const tmpDir = path.join(os.tmpdir(), `validate-pptx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const absPptx = path.resolve(pptxPath);

  try {
    // Use PowerShell Expand-Archive (available on Windows 10+)
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -Path '${absPptx.replace(/'/g, "''")}' -DestinationPath '${tmpDir.replace(/'/g, "''")}' -Force"`,
      { stdio: 'pipe', timeout: 30000 }
    );
  } catch (err) {
    // Fallback: try unzip command (Git Bash / MSYS2 / WSL)
    try {
      execSync(`unzip -o -q "${absPptx}" -d "${tmpDir}"`, { stdio: 'pipe', timeout: 30000 });
    } catch {
      throw new Error(`Failed to extract PPTX. PowerShell error: ${err.message}`);
    }
  }

  return tmpDir;
}

function cleanupDir(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Main validation function.
 * @param {string} pptxPath - Path to the .pptx file
 * @returns {{ errors: Array, warnings: Array, passed: boolean }}
 */
export async function validatePptx(pptxPath) {
  if (!fs.existsSync(pptxPath)) {
    throw new Error(`File not found: ${pptxPath}`);
  }

  const tmpDir = extractPptx(pptxPath);
  const errors = [];
  const warnings = [];

  try {
    // Read slide dimensions from presentation.xml
    const presXmlPath = path.join(tmpDir, 'ppt', 'presentation.xml');
    let slideW = DEFAULT_SLIDE_W;
    let slideH = DEFAULT_SLIDE_H;
    if (fs.existsSync(presXmlPath)) {
      const presXml = fs.readFileSync(presXmlPath, 'utf8');
      const dims = parseSlideDimensions(presXml);
      slideW = dims.width;
      slideH = dims.height;
    }

    // Find all slide XML files
    const slidesDir = path.join(tmpDir, 'ppt', 'slides');
    if (!fs.existsSync(slidesDir)) {
      throw new Error('No ppt/slides directory found in PPTX');
    }

    const slideFiles = fs.readdirSync(slidesDir)
      .filter((f) => /^slide\d+\.xml$/i.test(f))
      .sort((a, b) => {
        const na = parseInt(a.match(/\d+/)[0], 10);
        const nb = parseInt(b.match(/\d+/)[0], 10);
        return na - nb;
      });

    console.log(`\nValidating ${path.basename(pptxPath)}`);
    console.log(`Slide size: ${emuToInches(slideW)}" x ${emuToInches(slideH)}" (${slideFiles.length} slides)\n`);

    for (const slideFile of slideFiles) {
      const slideNum = parseInt(slideFile.match(/\d+/)[0], 10);
      const slideXml = fs.readFileSync(path.join(slidesDir, slideFile), 'utf8');
      const shapes = extractShapes(slideXml);

      const slideIssues = [
        ...checkOverflow(shapes, slideW, slideH, slideNum),
        ...checkColumnAlignment(shapes, slideNum),
        ...checkEmptyText(shapes, slideNum),
        ...checkContrast(shapes, slideNum),
      ];

      for (const issue of slideIssues) {
        if (issue.level === 'ERROR') {
          errors.push(issue);
        } else {
          warnings.push(issue);
        }
      }
    }
  } finally {
    cleanupDir(tmpDir);
  }

  return { errors, warnings, passed: errors.length === 0 };
}

// ── CLI ────────────────────────────────────────────────────────────────────

function formatIssue(issue) {
  const icon = issue.level === 'ERROR' ? '❌ ERROR' : '⚠️  WARN ';
  return `${icon} [slide ${issue.slide}] ${issue.code}: ${issue.message}`;
}

function parseCliArgs(argv) {
  const args = { input: null };
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--input' || argv[i] === '-i') && argv[i + 1]) {
      args.input = argv[++i];
    }
  }
  return args;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (!args.input) {
    console.error('Usage: node scripts/validate-pptx.js --input <path-to.pptx>');
    process.exit(1);
  }

  try {
    const { errors, warnings, passed } = await validatePptx(args.input);

    // Print all issues
    for (const w of warnings) console.log(formatIssue(w));
    for (const e of errors) console.log(formatIssue(e));

    // Summary
    console.log(`\n${'─'.repeat(60)}`);
    if (passed && warnings.length === 0) {
      console.log(`✅ All checks passed — no issues found`);
    } else {
      console.log(`Results: ${errors.length} error(s), ${warnings.length} warning(s)`);
      if (!passed) {
        console.log(`❌ Validation FAILED`);
      } else {
        console.log(`✅ Passed (warnings only)`);
      }
    }

    process.exit(passed ? 0 : 1);
  } catch (err) {
    console.error(`Fatal: ${err.message}`);
    process.exit(2);
  }
}

// Run CLI if invoked directly
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
if (isMain) {
  main();
}
