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

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');

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

/**
 * Extract slide background color from <p:bg> element.
 * Returns 6-char hex string or null if no solid fill background.
 */
function extractSlideBgColor(slideXml) {
  const bgMatch = slideXml.match(/<p:bg>[\s\S]*?<a:solidFill>\s*<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/i);
  return bgMatch ? bgMatch[1].toUpperCase() : null;
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
    const shape = { name: '', x: 0, y: 0, w: 0, h: 0, fillColor: null, hasTxBody: false, textRuns: [] };

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
      shape.hasTxBody = true;
      const runs = matchAll(txBody[1], '<a:r>([\\s\\S]*?)<\\/a:r>');
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

        // Font size: <a:rPr sz="1200"/> = 12pt (hundredths of point)
        let fontSize = null;
        const szSource = rPr ? rPr[0] : runInner;
        const szMatch = szSource.match(/\bsz="(\d+)"/i);
        if (szMatch) fontSize = parseInt(szMatch[1]) / 100;

        shape.textRuns.push({ text, color, fontSize });
      }
    }

    shapes.push(shape);
  }

  return shapes;
}

// ── Table extraction from slide XML ─────────────────────────────────────────

/**
 * Extract table info from <p:graphicFrame> blocks containing <a:tbl>.
 * Returns array of { name, x, y, w, h, rows: [[{text, merged}]] }
 */
function extractTables(slideXml) {
  const tables = [];

  const gfBlocks = matchAll(slideXml, '<p:graphicFrame\\b[^>]*>([\\s\\S]*?)</p:graphicFrame>');

  for (const block of gfBlocks) {
    const inner = block[1];

    // Must contain a table
    if (!/<a:tbl\b/i.test(inner)) continue;

    const table = { name: '', x: 0, y: 0, w: 0, h: 0, rows: [] };

    // Name
    const cNvPr = inner.match(/<p:cNvPr[^>]*>/i);
    if (cNvPr) {
      table.name = attr(cNvPr[0], 'name') || '';
    }

    // Position
    const off = inner.match(/<a:off[^>]*>/i);
    if (off) {
      table.x = parseInt(attr(off[0], 'x') || '0', 10);
      table.y = parseInt(attr(off[0], 'y') || '0', 10);
    }
    const ext = inner.match(/<a:ext[^>]*>/i);
    if (ext) {
      table.w = parseInt(attr(ext[0], 'cx') || '0', 10);
      table.h = parseInt(attr(ext[0], 'cy') || '0', 10);
    }

    // Extract rows: <a:tr>...</a:tr>
    const rowBlocks = matchAll(inner, '<a:tr\\b[^>]*>([\\s\\S]*?)</a:tr>');
    for (const rowBlock of rowBlocks) {
      const rowInner = rowBlock[1];
      const cells = [];

      // Extract cells: <a:tc>...</a:tc>
      const cellBlocks = matchAll(rowInner, '<a:tc\\b([^>]*)>([\\s\\S]*?)</a:tc>');
      for (const cellBlock of cellBlocks) {
        const cellAttrs = cellBlock[1];
        const cellInner = cellBlock[2];

        // Check for merge spans (hMerge, vMerge, gridSpan, rowSpan)
        const hMerge = /hMerge\s*=\s*"1"/i.test(cellAttrs);
        const vMerge = /vMerge\s*=\s*"1"/i.test(cellAttrs);

        // Extract all text content from <a:t> tags
        const textParts = matchAll(cellInner, '<a:t>([\\s\\S]*?)<\\/a:t>');
        const text = textParts.map((t) => t[1]).join('').trim();

        cells.push({ text, merged: hMerge || vMerge });
      }

      table.rows.push(cells);
    }

    tables.push(table);
  }

  return tables;
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

/**
 * Check if a shape has a sibling that overlaps it (containment or significant overlap).
 * html2pptx splits background fill and text into separate shapes — the fill shape
 * contains the text shape (text is inset by padding).
 * @param {object} shape - shape to check
 * @param {object[]} allShapes - all shapes on the slide
 * @param {function} siblingFilter - predicate for qualifying siblings
 * @returns {boolean}
 */
function hasOverlappingSibling(shape, allShapes, siblingFilter) {
  const sx = shape.x, sy = shape.y, sw = shape.w, sh = shape.h;
  const sCx = sx + sw / 2, sCy = sy + sh / 2;
  for (const other of allShapes) {
    if (other === shape) continue;
    if (!siblingFilter(other)) continue;
    // Check if other's center is inside shape, or shape's center is inside other
    const ox = other.x, oy = other.y, ow = other.w, oh = other.h;
    const oCx = ox + ow / 2, oCy = oy + oh / 2;
    const otherCenterInShape = oCx >= sx && oCx <= sx + sw && oCy >= sy && oCy <= sy + sh;
    const shapeCenterInOther = sCx >= ox && sCx <= ox + ow && sCy >= oy && sCy <= oy + oh;
    if (otherCenterInShape || shapeCenterInOther) {
      return true;
    }
  }
  return false;
}

function checkEmptyText(shapes, slideNum) {
  const issues = [];
  for (const s of shapes) {
    // Check shapes with txBody but no meaningful text content
    if (s.hasTxBody) {
      const allEmpty = s.textRuns.length === 0 || s.textRuns.every((r) => r.text.trim() === '');
      if (allEmpty) {
        // Suppress if this is html2pptx's fill-only shape with a text sibling nearby
        if (s.fillColor && hasOverlappingSibling(s, shapes,
          (o) => o.textRuns.length > 0 && o.textRuns.some(r => r.text.trim()))) {
          continue;
        }
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

function checkTableEmptyCells(tables, slideNum) {
  const issues = [];
  for (const t of tables) {
    if (t.rows.length < 2) continue; // Need header + at least 1 data row

    const colCount = t.rows[0].length;

    // Data rows (skip header = row 0)
    for (let rowIdx = 1; rowIdx < t.rows.length; rowIdx++) {
      const row = t.rows[rowIdx];
      for (let colIdx = 0; colIdx < row.length; colIdx++) {
        const cell = row[colIdx];
        if (cell.merged) continue; // Skip merged continuation cells
        if (cell.text === '') {
          const name = t.name || 'unnamed';
          issues.push({
            level: 'WARN',
            code: 'VP-05',
            slide: slideNum,
            message: `Table "${name}" has empty cell at row ${rowIdx + 1}, col ${colIdx + 1}`,
          });
        }
      }
    }

    // Check if entire data row is empty (more severe)
    for (let rowIdx = 1; rowIdx < t.rows.length; rowIdx++) {
      const row = t.rows[rowIdx];
      const nonMergedCells = row.filter((c) => !c.merged);
      if (nonMergedCells.length > 0 && nonMergedCells.every((c) => c.text === '')) {
        const name = t.name || 'unnamed';
        issues.push({
          level: 'ERROR',
          code: 'VP-05',
          slide: slideNum,
          message: `Table "${name}" row ${rowIdx + 1} is entirely empty`,
        });
      }
    }
  }
  return issues;
}

function checkTableConsistency(tables, slideNum) {
  const issues = [];
  for (const t of tables) {
    if (t.rows.length < 2) continue;

    const headerColCount = t.rows[0].length;
    const name = t.name || 'unnamed';

    // Check column count consistency across rows
    for (let rowIdx = 1; rowIdx < t.rows.length; rowIdx++) {
      const rowColCount = t.rows[rowIdx].length;
      if (rowColCount !== headerColCount) {
        issues.push({
          level: 'ERROR',
          code: 'VP-06',
          slide: slideNum,
          message: `Table "${name}" row ${rowIdx + 1} has ${rowColCount} columns, header has ${headerColCount}`,
        });
      }
    }

    // Check if >50% of data cells are empty (suspicious)
    let totalDataCells = 0;
    let emptyDataCells = 0;
    for (let rowIdx = 1; rowIdx < t.rows.length; rowIdx++) {
      for (const cell of t.rows[rowIdx]) {
        if (cell.merged) continue;
        totalDataCells++;
        if (cell.text === '') emptyDataCells++;
      }
    }
    if (totalDataCells > 0 && emptyDataCells / totalDataCells > 0.5) {
      issues.push({
        level: 'ERROR',
        code: 'VP-06',
        slide: slideNum,
        message: `Table "${name}" has ${emptyDataCells}/${totalDataCells} empty data cells (${Math.round(emptyDataCells / totalDataCells * 100)}%)`,
      });
    }
  }
  return issues;
}

/**
 * VP-07: Detect shape-based table grids with empty cells.
 * html2pptx builds tables from individual shapes (not native <a:tbl>).
 * Groups by similar width → checks for grid pattern (2+ columns, 2+ rows)
 * → flags when some cells have text and others don't (= missing data).
 * Note: empty cells often have h=0 (collapsed), so height is NOT used for grouping.
 */
function checkShapeGridEmptyCells(shapes, slideNum) {
  const issues = [];

  const hasText = (s) => s.textRuns.length > 0 && s.textRuns.some((r) => r.text.trim() !== '');

  // Include shapes with fill, even if h=0 (collapsed empty cells)
  // Exclude fill-only shapes that are html2pptx bg siblings (have overlapping text shape)
  const filledShapes = shapes.filter((s) => s.w > 0 && s.fillColor && !hasOverlappingSibling(s, shapes,
    (o) => o.textRuns.length > 0 && o.textRuns.some(r => r.text.trim())));
  if (filledShapes.length < 6) return issues;


  // Group by similar width only (height varies: 0 for empty, ~24pt for filled)
  const widthGroups = [];
  for (const s of filledShapes) {
    let found = false;
    for (const g of widthGroups) {
      const refW = g[0].w;
      if (refW > 0 && Math.abs(s.w - refW) / refW < 0.08) {
        g.push(s);
        found = true;
        break;
      }
    }
    if (!found) widthGroups.push([s]);
  }

  for (const group of widthGroups) {
    if (group.length < 6) continue;

    // Grid check: 2+ distinct x AND 2+ distinct y positions
    const xSet = new Set(group.map((s) => Math.round(s.x / COL_TOLERANCE)));
    const ySet = new Set(group.map((s) => Math.round(s.y / COL_TOLERANCE)));


    if (xSet.size < 2 || ySet.size < 2) continue;

    // Mixed grid: some with text, some without
    const withText = group.filter(hasText);
    const withoutText = group.filter((s) => !hasText(s));
    if (withText.length === 0 || withoutText.length === 0) continue;

    const emptyRatio = withoutText.length / group.length;

    // Per-column WARN for individual empty cells
    const colMap = new Map();
    for (const s of group) {
      const xKey = Math.round(s.x / COL_TOLERANCE);
      if (!colMap.has(xKey)) colMap.set(xKey, []);
      colMap.get(xKey).push(s);
    }

    for (const [, colShapes] of colMap) {
      if (colShapes.length < 2) continue;
      const colWith = colShapes.filter(hasText);
      const colWithout = colShapes.filter((s) => !hasText(s));
      if (colWith.length > 0 && colWithout.length > 0) {
        for (const s of colWithout) {
          const name = s.name || 'unnamed';
          issues.push({
            level: 'WARN',
            code: 'VP-07',
            slide: slideNum,
            message: `Grid cell "${name}" at (${emuToInches(s.x)}", ${emuToInches(s.y)}") has fill but no text — possible empty table cell`,
          });
        }
      }
    }

    // Summary ERROR if >40% empty
    if (emptyRatio > 0.4) {
      issues.push({
        level: 'ERROR',
        code: 'VP-07',
        slide: slideNum,
        message: `Shape grid (${xSet.size}col × ${ySet.size}row) has ${withoutText.length}/${group.length} empty cells (${Math.round(emptyRatio * 100)}%) — likely table with missing data`,
      });
    }
  }

  return issues;
}

/**
 * VP-08: Detect shapes with fill but no text content — possible empty card.
 * Only flags shapes with significant area (> 50pt × 50pt = 635000 × 635000 EMU).
 */
function checkFilledEmptyShapes(shapes, slideNum) {
  const issues = [];
  const MIN_AREA = 635000 * 635000; // ~50pt × 50pt in EMU²

  for (const s of shapes) {
    if (!s.fillColor) continue;
    const area = s.w * s.h;
    if (area < MIN_AREA) continue;

    const hasText = s.textRuns.length > 0 && s.textRuns.some(r => r.text.trim() !== '');
    if (!hasText) {
      // Suppress if this is html2pptx's background-fill shape with a text sibling nearby
      if (hasOverlappingSibling(s, shapes,
        (o) => o.textRuns.length > 0 && o.textRuns.some(r => r.text.trim()))) {
        continue;
      }
      const name = s.name || 'unnamed';
      issues.push({
        level: 'WARN',
        code: 'VP-08',
        slide: slideNum,
        message: `Shape "${name}" (${emuToInches(s.w)}" × ${emuToInches(s.h)}") has fill #${s.fillColor} but no text — possible empty card`,
      });
    }
  }
  return issues;
}

/**
 * Find the best background color for a text shape by looking for
 * overlapping filled shapes (html2pptx splits bg fill and text into separate shapes).
 * Returns the fillColor of the best-matching background shape, or 'FFFFFF' (slide bg).
 */
function findBackgroundColor(textShape, allShapes, slideBgColor, excludeColors = []) {
  const tx = textShape.x, ty = textShape.y;
  const tw = textShape.w, th = textShape.h;
  const tCx = tx + tw / 2, tCy = ty + th / 2; // center of text shape

  let bestFill = null;
  let bestScore = -Infinity;

  for (const bg of allShapes) {
    if (bg === textShape) continue;
    if (!bg.fillColor) continue;
    if (excludeColors.length > 0 && excludeColors.includes(bg.fillColor.toUpperCase())) continue;
    if (bg.w === 0 || bg.h === 0) continue;

    const bx = bg.x, by = bg.y, bw = bg.w, bh = bg.h;

    // Check if bg shape contains or substantially overlaps the text shape center
    const containsCenter = tCx >= bx && tCx <= bx + bw && tCy >= by && tCy <= by + bh;
    if (!containsCenter) continue;

    // Score: prefer shapes that most closely match the text shape bounds (same origin = sibling)
    // Higher score = better match
    const dxOff = Math.abs(bx - tx);
    const dyOff = Math.abs(by - ty);
    const dw = Math.abs(bw - tw);
    const dh = Math.abs(bh - th);
    // Penalize distance; prefer shapes at same position with similar size
    const score = -(dxOff + dyOff + dw + dh);

    if (score > bestScore) {
      bestScore = score;
      bestFill = bg.fillColor;
    }
  }

  return bestFill || slideBgColor || 'FFFFFF';
}

function checkContrast(shapes, slideNum, slideBgColor) {
  const issues = [];
  for (const s of shapes) {
    if (s.textRuns.length === 0) continue;

    // Determine background color: shape fill, nearest overlapping filled shape, slide bg, or white
    let bgColor = s.fillColor || findBackgroundColor(s, shapes, slideBgColor);

    // VP-04 오탐 방지: 텍스트와 동색 배경 감지 시 해당 색 제외하고 재탐색
    if (!s.fillColor) {
      const fgColors = s.textRuns.filter(r => r.color).map(r => r.color.toUpperCase());
      if (fgColors.includes(bgColor.toUpperCase())) {
        const altBg = findBackgroundColor(s, shapes, slideBgColor, [bgColor.toUpperCase()]);
        if (altBg.toUpperCase() !== bgColor.toUpperCase()) bgColor = altBg;
      }
    }

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

/**
 * VP-09: Detect shapes where fit:shrink may not activate.
 * PptxGenJS fit:shrink requires manual edit to take effect.
 * Estimates text density vs shape area — flags when text likely overflows.
 */
function checkShrinkReliability(shapes, slideNum) {
  const issues = [];
  for (const s of shapes) {
    if (s.textRuns.length === 0 || s.w === 0 || s.h === 0) continue;
    // Estimate total text length
    const totalText = s.textRuns.map(r => r.text).join('');
    if (totalText.length < 10) continue;

    // Estimate font size from XML (default ~12pt if not specified)
    const avgCharWidthPt = 7; // rough average for mixed CJK+Latin
    const avgLineHeightPt = 16; // rough average
    const shapWidthPt = s.w / EMU_PER_PT;
    const shapHeightPt = s.h / EMU_PER_PT;

    const charsPerLine = Math.max(1, Math.floor(shapWidthPt / avgCharWidthPt));
    const lines = Math.ceil(totalText.length / charsPerLine);
    const neededHeight = lines * avgLineHeightPt;

    if (neededHeight > shapHeightPt * 1.5) {
      const name = s.name || 'unnamed';
      issues.push({
        level: 'WARN',
        code: 'VP-09',
        slide: slideNum,
        message: `Shape "${name}" text density high (est. ${lines} lines, ~${Math.round(neededHeight)}pt needed, ${Math.round(shapHeightPt)}pt available) — fit:shrink may not activate without manual edit`,
      });
    }
  }
  return issues;
}

/**
 * VP-10: Check gap consistency between shapes in the same row/column.
 */
function checkGapConsistency(shapes, slideNum) {
  const issues = [];

  // Filter to meaningful shapes
  const meaningful = shapes.filter(s => s.w > 0 && s.h > 0 && s.w < DEFAULT_SLIDE_W * 0.8);
  if (meaningful.length < 3) return issues;

  // Group by similar y (same row, within ~10pt tolerance)
  const rowTolerance = 10 * EMU_PER_PT;
  const rows = [];
  for (const s of meaningful) {
    let found = false;
    for (const row of rows) {
      if (Math.abs(row.y - s.y) <= rowTolerance) {
        row.shapes.push(s);
        found = true;
        break;
      }
    }
    if (!found) rows.push({ y: s.y, shapes: [s] });
  }

  for (const row of rows) {
    if (row.shapes.length < 3) continue;
    // Sort by x position
    const sorted = row.shapes.sort((a, b) => a.x - b.x);
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].x - (sorted[i - 1].x + sorted[i - 1].w);
      gaps.push(gap);
    }
    if (gaps.length < 2) continue;
    const gapMean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const gapStdDev = Math.sqrt(gaps.reduce((sum, g) => sum + (g - gapMean) ** 2, 0) / gaps.length);

    // Flag if gap variance > 5pt
    if (gapStdDev > 5 * EMU_PER_PT) {
      const gapsPt = gaps.map(g => (g / EMU_PER_PT).toFixed(1) + 'pt').join(', ');
      issues.push({
        level: 'WARN',
        code: 'VP-10',
        slide: slideNum,
        message: `Row at y=${emuToInches(row.y)}" has inconsistent gaps: [${gapsPt}]`,
      });
    }
  }
  return issues;
}

/**
 * VP-11: Check reading order — shape order in spTree vs visual (y→x) order.
 */
function checkReadingOrder(shapes, slideNum) {
  const issues = [];
  const meaningful = shapes.filter(s => s.w > 0 && s.h > 0 && s.textRuns.some(r => r.text.trim()));
  if (meaningful.length < 3) return issues;

  // Visual order: sort by y then x
  const visualOrder = [...meaningful].sort((a, b) => {
    const yDiff = a.y - b.y;
    if (Math.abs(yDiff) > 20 * EMU_PER_PT) return yDiff;
    return a.x - b.x;
  });

  // Count position mismatches
  let mismatches = 0;
  for (let i = 0; i < meaningful.length; i++) {
    if (meaningful[i] !== visualOrder[i]) mismatches++;
  }

  const mismatchRatio = mismatches / meaningful.length;
  if (mismatchRatio > 0.3) {
    issues.push({
      level: 'WARN',
      code: 'VP-11',
      slide: slideNum,
      message: `Reading order mismatch: ${mismatches}/${meaningful.length} shapes out of visual order (${Math.round(mismatchRatio * 100)}%) — may affect accessibility`,
    });
  }
  return issues;
}

/**
 * VP-12: Detect empty slides (no shapes or no text at all).
 */
function checkEmptySlide(shapes, tables, slideNum) {
  const issues = [];
  const totalShapes = shapes.length + tables.length;

  if (totalShapes < 2) {
    issues.push({
      level: 'ERROR',
      code: 'VP-12',
      slide: slideNum,
      message: `Slide has only ${totalShapes} shape(s) — likely empty or failed conversion`,
    });
    return issues;
  }

  // Check if any shape has text
  const hasAnyText = shapes.some(s => s.textRuns.some(r => r.text.trim() !== ''));
  const hasTableText = tables.some(t => t.rows.some(row => row.some(cell => cell.text.trim() !== '')));
  if (!hasAnyText && !hasTableText) {
    issues.push({
      level: 'ERROR',
      code: 'VP-12',
      slide: slideNum,
      message: `Slide has ${totalShapes} shapes but no text content — possible conversion failure`,
    });
  }
  return issues;
}

/**
 * VP-14: Detect overlapping text shapes on the same slide.
 * Compares bounding boxes of all shapes with text content.
 * Overlap > 20% of the smaller shape's area → ERROR (text unreadable).
 * Overlap 5-20% → WARN.
 * Ignores parent-child containment (one fully containing the other).
 */
function shapeText(s) {
  return (s.textRuns || []).map(r => r.text).join('').trim();
}

function checkShapeOverlap(shapes, slideNum) {
  const issues = [];
  // Filter to shapes with text content or fill and meaningful size (> 20pt × 20pt)
  const MIN_SIZE = 20 * 12700; // 20pt in EMU
  const textShapes = shapes.filter(s => {
    const text = shapeText(s);
    return (text.length > 0 || s.fillColor) && s.w > MIN_SIZE && s.h > MIN_SIZE;
  });

  if (textShapes.length < 2) return issues;

  // Limit pairwise check to first 60 shapes for performance
  const check = textShapes.slice(0, 60);
  const found = new Set();

  for (let i = 0; i < check.length; i++) {
    for (let j = i + 1; j < check.length; j++) {
      const a = check[i];
      const b = check[j];

      const aRight = a.x + a.w;
      const aBottom = a.y + a.h;
      const bRight = b.x + b.w;
      const bBottom = b.y + b.h;

      // Skip if one fully contains the other (parent-child)
      const aContainsB = a.x <= b.x && aRight >= bRight && a.y <= b.y && aBottom >= bBottom;
      const bContainsA = b.x <= a.x && bRight >= aRight && b.y <= a.y && bBottom >= aBottom;
      if (aContainsB || bContainsA) continue;

      // Skip bg+text sibling pairs: one has fill only (no text), other has text
      // html2pptx splits grid/table cells into separate fill and text shapes
      const aHasText = shapeText(a).length > 0;
      const bHasText = shapeText(b).length > 0;
      if ((!aHasText && a.fillColor && bHasText) || (!bHasText && b.fillColor && aHasText)) continue;
      // Skip fill-only pairs: neither shape has text → no readability impact
      if (!aHasText && !bHasText) continue;

      const overlapW = Math.min(aRight, bRight) - Math.max(a.x, b.x);
      const overlapH = Math.min(aBottom, bBottom) - Math.max(a.y, b.y);

      if (overlapW > 0 && overlapH > 0) {
        const overlapArea = overlapW * overlapH;
        const aArea = a.w * a.h;
        const bArea = b.w * b.h;
        const smallerArea = Math.min(aArea, bArea);
        // Skip layout neighbor overlaps: shapes aligned in a row/column with thin overlap strip
        // (html2pptx conversion artifact from flex/grid layouts)
        const yOverlap = Math.min(aBottom, bBottom) - Math.max(a.y, b.y);
        const minH = Math.min(a.h, b.h);
        const xOverlap = Math.min(aRight, bRight) - Math.max(a.x, b.x);
        const minW = Math.min(a.w, b.w);
        // Same row (>50% vertical overlap) with thin horizontal strip, or same column with thin vertical strip
        if ((yOverlap > minH * 0.5 && xOverlap < minW * 0.25) ||
            (xOverlap > minW * 0.5 && yOverlap < minH * 0.25)) continue;
        const pct = Math.round(overlapArea / smallerArea * 100);

        if (pct >= 5) {
          const key = `${i}-${j}`;
          if (found.has(key)) continue;
          found.add(key);

          const aText = shapeText(a).substring(0, 20) || `[${a.name}]`;
          const bText = shapeText(b).substring(0, 20) || `[${b.name}]`;

          if (pct >= 20) {
            issues.push({
              level: 'ERROR',
              code: 'VP-14',
              slide: slideNum,
              message: `Shapes overlap ${pct}%: "${aText}..." ↔ "${bText}..." — text unreadable, fix layout or split slide`,
            });
          } else {
            issues.push({
              level: 'WARN',
              code: 'VP-14',
              slide: slideNum,
              message: `Shapes overlap ${pct}%: "${aText}..." ↔ "${bText}..." — may cause readability issues`,
            });
          }
        }
      }
    }
  }
  return issues;
}

// ── Picture extraction (for z-order check) ─────────────────────────────────

/**
 * Extract picture shapes from <p:pic> blocks.
 * Returns array of { name, x, y, w, h, type: 'picture', xmlOrder }
 */
function extractPictures(slideXml) {
  const pics = [];
  const picBlocks = matchAll(slideXml, '<p:pic\\b[^>]*>([\\s\\S]*?)</p:pic>');

  for (const block of picBlocks) {
    const inner = block[1];
    const pic = { name: '', x: 0, y: 0, w: 0, h: 0, type: 'picture' };

    const cNvPr = inner.match(/<p:cNvPr[^>]*>/i);
    if (cNvPr) {
      pic.name = attr(cNvPr[0], 'name') || '';
    }

    const off = inner.match(/<a:off[^>]*>/i);
    if (off) {
      pic.x = parseInt(attr(off[0], 'x') || '0', 10);
      pic.y = parseInt(attr(off[0], 'y') || '0', 10);
    }

    const ext = inner.match(/<a:ext[^>]*>/i);
    if (ext) {
      pic.w = parseInt(attr(ext[0], 'cx') || '0', 10);
      pic.h = parseInt(attr(ext[0], 'cy') || '0', 10);
    }

    pics.push(pic);
  }
  return pics;
}

/**
 * Get all elements (shapes + pictures) in XML order for z-order analysis.
 * Elements appearing later in XML are rendered on top.
 */
function extractAllElementsOrdered(slideXml) {
  const elements = [];
  // Match both <p:sp> and <p:pic> blocks with their positions in the XML
  const re = /<(p:sp|p:pic)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let m;
  let order = 0;
  while ((m = re.exec(slideXml)) !== null) {
    const type = m[1] === 'p:pic' ? 'picture' : 'shape';
    const inner = m[2];
    const el = { type, name: '', x: 0, y: 0, w: 0, h: 0, xmlOrder: order++, textRuns: [], fillColor: null };

    const cNvPr = inner.match(/<p:cNvPr[^>]*>/i);
    if (cNvPr) el.name = attr(cNvPr[0], 'name') || '';

    const off = inner.match(/<a:off[^>]*>/i);
    if (off) {
      el.x = parseInt(attr(off[0], 'x') || '0', 10);
      el.y = parseInt(attr(off[0], 'y') || '0', 10);
    }

    const ext = inner.match(/<a:ext[^>]*>/i);
    if (ext) {
      el.w = parseInt(attr(ext[0], 'cx') || '0', 10);
      el.h = parseInt(attr(ext[0], 'cy') || '0', 10);
    }

    if (type === 'shape') {
      const txBody = inner.match(/<p:txBody>([\s\S]*?)<\/p:txBody>/i);
      if (txBody) {
        const runs = matchAll(txBody[1], '<a:r>([\\s\\S]*?)<\\/a:r>');
        for (const run of runs) {
          const tMatch = run[1].match(/<a:t>([\s\S]*?)<\/a:t>/i);
          el.textRuns.push({ text: tMatch ? tMatch[1] : '' });
        }
      }
      const txBodyStart = inner.indexOf('<p:txBody');
      const spPrSection = txBodyStart >= 0 ? inner.slice(0, txBodyStart) : inner;
      const spFill = spPrSection.match(/<a:solidFill>\s*<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/i);
      if (spFill) el.fillColor = spFill[1].toUpperCase();
    }

    elements.push(el);
  }
  return elements;
}

// CJK character detection for VP-16
const CJK_CHAR_RE = /[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/g;

/**
 * VP-15: Check if picture shapes are behind overlapping text shapes (z-order issue)
 */
function checkPictureZOrder(allElements, slideNum) {
  const issues = [];
  const MIN_SIZE = 30 * EMU_PER_PT; // 30pt

  const pictures = allElements.filter(e => e.type === 'picture' && e.w > MIN_SIZE && e.h > MIN_SIZE);
  const textShapes = allElements.filter(e => {
    if (e.type !== 'shape') return false;
    const text = (e.textRuns || []).map(r => r.text).join('').trim();
    return text.length > 0 && e.w > MIN_SIZE && e.h > MIN_SIZE;
  });

  for (const pic of pictures) {
    for (const shape of textShapes) {
      // Check overlap
      const overlapW = Math.min(pic.x + pic.w, shape.x + shape.w) - Math.max(pic.x, shape.x);
      const overlapH = Math.min(pic.y + pic.h, shape.y + shape.h) - Math.max(pic.y, shape.y);
      if (overlapW <= 0 || overlapH <= 0) continue;

      const overlapArea = overlapW * overlapH;
      const picArea = pic.w * pic.h;
      const pct = Math.round(overlapArea / picArea * 100);
      if (pct < 10) continue;

      // Picture has HIGHER xmlOrder = rendered ON TOP (OK)
      // Picture has LOWER xmlOrder = rendered BEHIND text (problem)
      if (pic.xmlOrder > shape.xmlOrder) {
        // Picture is on top of text — this obscures text
        const shapeText = (shape.textRuns || []).map(r => r.text).join('').trim().substring(0, 20);
        issues.push({
          level: 'WARN',
          code: 'VP-15',
          slide: slideNum,
          message: `Picture "${pic.name}" overlaps text "${shapeText}..." (${pct}% of picture) and is rendered ON TOP — text may be hidden`,
        });
      }
    }
  }
  return issues;
}

/**
 * VP-16: Estimate CJK text width vs shape width — predict overflow/wrapping
 */
function checkCjkTextOverflow(shapes, slideNum) {
  const issues = [];

  for (const s of shapes) {
    if (s.w === 0 || s.h === 0) continue;
    const text = shapeText(s);
    if (text.length < 2) continue;

    // Count CJK characters
    const cjkMatches = text.match(CJK_CHAR_RE);
    if (!cjkMatches || cjkMatches.length === 0) continue;

    const cjkCount = cjkMatches.length;
    const latinCount = text.length - cjkCount;
    const cjkRatio = cjkCount / text.length;
    if (cjkRatio < 0.2) continue;

    // Use actual font size from textRuns if available, fallback to 12pt
    const fontSizes = s.textRuns.filter(r => r.fontSize).map(r => r.fontSize);
    const estimatedFontPt = fontSizes.length > 0 ? Math.max(...fontSizes) : 12;
    const fontEmu = estimatedFontPt * EMU_PER_PT;

    // Estimate text width: CJK ≈ 1.0 × fontSize, Latin ≈ 0.55 × fontSize
    const estimatedWidth = (cjkCount * fontEmu * 1.0) + (latinCount * fontEmu * 0.55);

    // Compare with shape width (minus estimated padding ~5pt each side)
    const availableWidth = s.w - (10 * EMU_PER_PT);

    if (availableWidth <= 0) continue;

    const ratio = estimatedWidth / availableWidth;

    // Multi-line wrapping check: if shape is tall enough, wrapping is OK
    const linesNeeded = Math.ceil(estimatedWidth / availableWidth);
    const lineHeightEmu = fontEmu * 1.2; // PPTX default single spacing
    const heightNeeded = linesNeeded * lineHeightEmu;
    // Subtract estimated padding (~5pt top + 5pt bottom) from shape height for available height
    const availableHeight = s.h - (10 * EMU_PER_PT);
    const verticalOverflow = heightNeeded > availableHeight;

    // Downgrade to WARN for cases where PPTX shrink-to-fit likely handles it:
    // - Short text (≤5 chars): badge/label text, shrink always works
    // - Small font (≤12pt) needing only 2 lines: minor overflow, PPTX autofit handles it
    // - Height overflow < 50%: borderline cases where PPTX font compression resolves it
    const isShortText = text.length <= 5;
    const isMinorOverflow = linesNeeded <= 2 && estimatedFontPt <= 12;
    const overflowRatio = availableHeight > 0 ? heightNeeded / availableHeight : Infinity;
    const isBorderlineOverflow = overflowRatio < 1.5;

    if (ratio > 1.2 && verticalOverflow && !isShortText && !isMinorOverflow && !isBorderlineOverflow) {
      const availPt = Math.round(availableWidth / EMU_PER_PT);
      const estPt = Math.round(estimatedWidth / EMU_PER_PT);
      issues.push({
        level: 'ERROR',
        code: 'VP-16',
        slide: slideNum,
        message: `CJK text "${text.substring(0, 25)}..." ${estPt}pt > available ${availPt}pt (${estimatedFontPt}pt font, ${linesNeeded} lines needed, shape too short) — will overflow [IL-37]`,
      });
    } else if (ratio > 1.2 && (isShortText || isMinorOverflow || isBorderlineOverflow || !verticalOverflow)) {
      // Wraps but fits vertically — WARN only
      const availPt = Math.round(availableWidth / EMU_PER_PT);
      const estPt = Math.round(estimatedWidth / EMU_PER_PT);
      issues.push({
        level: 'WARN',
        code: 'VP-16',
        slide: slideNum,
        message: `CJK text "${text.substring(0, 25)}..." wraps to ${linesNeeded} lines (${estPt}pt / ${availPt}pt, ${estimatedFontPt}pt font) — fits vertically [IL-37]`,
      });
    } else if (ratio > 0.95) {
      const availPt = Math.round(availableWidth / EMU_PER_PT);
      const estPt = Math.round(estimatedWidth / EMU_PER_PT);
      issues.push({
        level: 'WARN',
        code: 'VP-16',
        slide: slideNum,
        message: `CJK text "${text.substring(0, 25)}..." fills ${Math.round(ratio * 100)}% of available width (${estPt}pt / ${availPt}pt, ${estimatedFontPt}pt font) — may wrap in PPTX [IL-37]`,
      });
    }
  }
  return issues;
}

// ── PPTX extraction & orchestration ────────────────────────────────────────

/**
 * Load PPTX into memory using JSZip (no temp dirs, no exec).
 * Returns a Map<string, string|Buffer> of file paths to contents.
 */
async function loadPptxInMemory(pptxPath) {
  const data = fs.readFileSync(path.resolve(pptxPath));
  const zip = await JSZip.loadAsync(data);
  const files = new Map();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    // XML files as text, media files as Buffer
    if (name.endsWith('.xml') || name.endsWith('.rels')) {
      files.set(name, await entry.async('text'));
    } else {
      files.set(name, await entry.async('nodebuffer'));
    }
  }
  return files;
}

/**
 * Main validation function.
 * @param {string} pptxPath - Path to the .pptx file
 * @returns {{ errors: Array, warnings: Array, passed: boolean }}
 */
export async function validatePptx(pptxPath, options = {}) {
  if (!fs.existsSync(pptxPath)) {
    throw new Error(`File not found: ${pptxPath}`);
  }

  const zipFiles = await loadPptxInMemory(pptxPath);
  const errors = [];
  const warnings = [];

  try {
    // Read slide dimensions from presentation.xml
    let slideW = DEFAULT_SLIDE_W;
    let slideH = DEFAULT_SLIDE_H;
    const presXml = zipFiles.get('ppt/presentation.xml');
    if (presXml) {
      const dims = parseSlideDimensions(presXml);
      slideW = dims.width;
      slideH = dims.height;
    }

    // Find all slide XML files from in-memory map
    const slideEntries = [];
    for (const [name] of zipFiles) {
      const m = name.match(/^ppt\/slides\/slide(\d+)\.xml$/i);
      if (m) slideEntries.push({ name, num: parseInt(m[1], 10) });
    }
    slideEntries.sort((a, b) => a.num - b.num);

    if (slideEntries.length === 0) {
      throw new Error('No ppt/slides directory found in PPTX');
    }

    // VP-13: Check media file sizes
    let totalMediaSize = 0;
    for (const [name, content] of zipFiles) {
      if (!name.startsWith('ppt/media/')) continue;
      const size = Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content);
      totalMediaSize += size;
      if (size > 5 * 1024 * 1024) {
        const mf = name.split('/').pop();
        warnings.push({
          level: 'WARN',
          code: 'VP-13',
          slide: 0,
          message: `Media file "${mf}" is ${(size / 1024 / 1024).toFixed(1)}MB — consider compressing`,
        });
      }
    }
    if (totalMediaSize > 20 * 1024 * 1024) {
      warnings.push({
        level: 'WARN',
        code: 'VP-13',
        slide: 0,
        message: `Total media size ${(totalMediaSize / 1024 / 1024).toFixed(1)}MB exceeds 20MB — may cause sharing issues (Gmail 25MB, Outlook 20MB limit)`,
      });
    }

    if (!options.quiet) {
      console.log(`\nValidating ${path.basename(pptxPath)}`);
      console.log(`Slide size: ${emuToInches(slideW)}" x ${emuToInches(slideH)}" (${slideEntries.length} slides)\n`);
    }

    for (const { name: slidePath, num: slideNum } of slideEntries) {
      const slideXml = zipFiles.get(slidePath);
      const shapes = extractShapes(slideXml);
      const tables = extractTables(slideXml);
      const slideBgColor = extractSlideBgColor(slideXml);

      const allElements = extractAllElementsOrdered(slideXml);

      const slideIssues = [
        ...checkOverflow(shapes, slideW, slideH, slideNum),
        ...checkColumnAlignment(shapes, slideNum),
        ...checkEmptyText(shapes, slideNum),
        ...checkContrast(shapes, slideNum, slideBgColor),
        ...checkFilledEmptyShapes(shapes, slideNum),
        ...checkShrinkReliability(shapes, slideNum),
        ...checkGapConsistency(shapes, slideNum),
        ...checkReadingOrder(shapes, slideNum),
        ...checkEmptySlide(shapes, tables, slideNum),
        ...checkTableEmptyCells(tables, slideNum),
        ...checkTableConsistency(tables, slideNum),
        ...checkShapeGridEmptyCells(shapes, slideNum),
        ...checkShapeOverlap(shapes, slideNum),
        ...checkPictureZOrder(allElements, slideNum),
        ...checkCjkTextOverflow(shapes, slideNum),
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
    // In-memory — no cleanup needed
  }

  return { errors, warnings, passed: errors.length === 0 };
}

// ── CLI ────────────────────────────────────────────────────────────────────

function formatIssue(issue) {
  const icon = issue.level === 'ERROR' ? '❌ ERROR' : '⚠️  WARN ';
  return `${icon} [slide ${issue.slide}] ${issue.code}: ${issue.message}`;
}

function parseCliArgs(argv) {
  const args = { input: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--input' || argv[i] === '-i') && argv[i + 1]) {
      args.input = argv[++i];
    }
    if (argv[i] === '--json') args.json = true;
  }
  return args;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));

  if (!args.input) {
    console.error('Usage: node scripts/validate-pptx.js --input <path-to.pptx> [--json]');
    process.exit(1);
  }

  try {
    const { errors, warnings, passed } = await validatePptx(args.input);

    // --json: output structured JSON and exit
    if (args.json) {
      const all = [...errors, ...warnings];
      console.log(JSON.stringify(all, null, 2));
      process.exit(passed ? 0 : 1);
    }

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
