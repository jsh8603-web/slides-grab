#!/usr/bin/env node
/**
 * VP Regression Test Runner
 *
 * Tests VP-01 through VP-16 detection logic against known true-positive
 * and false-positive cases from the regression DB.
 *
 * Usage: node tests/detection-regression/run-vp-regression.mjs
 *
 * Exit code 0 = all pass, 1 = regression found
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Constants (must match validate-pptx.js) ──

const EMU_PER_PT = 12700;
const EMU_PER_INCH = 914400;
const DEFAULT_SLIDE_W = 9144000;  // 720pt
const DEFAULT_SLIDE_H = 5143500;  // ~405pt
const COL_TOLERANCE = 36000;      // ~2.83pt
const CONTRAST_ERROR = 1.5;
const CONTRAST_WARN = 4.5;
const CJK_CHAR_RE = /[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/g;

// ── Helper: convert pt shape to EMU shape ──

function toEmu(shape) {
  return {
    ...shape,
    x: (shape.x || 0) * EMU_PER_PT,
    y: (shape.y || 0) * EMU_PER_PT,
    w: (shape.w || 0) * EMU_PER_PT,
    h: (shape.h || 0) * EMU_PER_PT,
  };
}

function toEmuElements(elements) {
  return elements.map(el => ({
    ...el,
    x: (el.x || 0) * EMU_PER_PT,
    y: (el.y || 0) * EMU_PER_PT,
    w: (el.w || 0) * EMU_PER_PT,
    h: (el.h || 0) * EMU_PER_PT,
  }));
}

// ── Contrast helpers (must match validate-pptx.js) ──

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

// ── VP-01: Shape boundary overflow ──

function checkOverflow(tc) {
  const slideW = (tc.slideW || 720) * EMU_PER_PT;
  const slideH = (tc.slideH || 405) * EMU_PER_PT;
  let maxLevel = null;

  for (const raw of tc.shapes) {
    const s = toEmu(raw);
    if (s.w === 0 && s.h === 0) continue;

    const right = s.x + s.w;
    const bottom = s.y + s.h;

    if (right > slideW + COL_TOLERANCE) maxLevel = 'ERROR';
    if (bottom > slideH + COL_TOLERANCE) maxLevel = 'ERROR';
    if (s.x < -COL_TOLERANCE && maxLevel !== 'ERROR') maxLevel = maxLevel || 'WARN';
    if (s.y < -COL_TOLERANCE && maxLevel !== 'ERROR') maxLevel = maxLevel || 'WARN';
  }
  return maxLevel;
}

// ── VP-02: Column alignment ──

function checkColumnAlignment(tc) {
  const shapes = tc.shapes.map(toEmu);
  // Filter: non-trivial, not full-width/height
  const candidates = shapes.filter(s => {
    if (s.w === 0 && s.h === 0) return false;
    if (s.w > DEFAULT_SLIDE_W * 0.8) return false;
    if (s.h > DEFAULT_SLIDE_H * 0.8) return false;
    return true;
  });

  const columns = [];
  for (const s of candidates) {
    let found = false;
    for (const col of columns) {
      const xClose = Math.abs(col.x - s.x) <= COL_TOLERANCE;
      const medianW = col.shapes[0].w;
      const wClose = medianW > 0 ? Math.abs(s.w - medianW) / medianW < 0.5 : s.w < COL_TOLERANCE;
      if (xClose && wClose) {
        col.shapes.push(s);
        found = true;
        break;
      }
    }
    if (!found) columns.push({ x: s.x, shapes: [s] });
  }

  let detected = false;
  for (const col of columns) {
    if (col.shapes.length < 3) continue;
    const uniqueY = new Set(col.shapes.map(s => Math.round(s.y / COL_TOLERANCE)));
    if (uniqueY.size < 2) continue;

    const widths = col.shapes.map(s => s.w);
    if (Math.max(...widths) - Math.min(...widths) > 63500) detected = true;

    const xs = col.shapes.map(s => s.x);
    if (Math.max(...xs) - Math.min(...xs) > COL_TOLERANCE) detected = true;
  }
  return detected ? 'WARN' : null;
}

// ── VP-03: Empty text shapes ──

function hasOverlappingSibling(shape, allShapes, siblingFilter) {
  const sx = shape.x, sy = shape.y, sw = shape.w, sh = shape.h;
  const sCx = sx + sw / 2, sCy = sy + sh / 2;
  for (const other of allShapes) {
    if (other === shape) continue;
    if (!siblingFilter(other)) continue;
    const ox = other.x, oy = other.y, ow = other.w, oh = other.h;
    const oCx = ox + ow / 2, oCy = oy + oh / 2;
    const otherCenterInShape = oCx >= sx && oCx <= sx + sw && oCy >= sy && oCy <= sy + sh;
    const shapeCenterInOther = sCx >= ox && sCx <= ox + ow && sCy >= oy && sCy <= oy + oh;
    if (otherCenterInShape || shapeCenterInOther) return true;
  }
  return false;
}

function checkEmptyText(tc) {
  const shapes = tc.shapes.map(toEmu);
  let detected = false;
  for (const s of shapes) {
    if (s.hasTxBody) {
      const allEmpty = !s.textRuns || s.textRuns.length === 0 || s.textRuns.every(r => (r.text || '').trim() === '');
      if (allEmpty) {
        if (s.fillColor && hasOverlappingSibling(s, shapes,
          o => o.textRuns && o.textRuns.length > 0 && o.textRuns.some(r => (r.text || '').trim()))) {
          continue;
        }
        detected = true;
      }
    }
  }
  return detected ? 'WARN' : null;
}

// ── VP-04: Low contrast ──

function checkContrast(tc) {
  const shapes = tc.shapes.map(toEmu);
  const slideBgColor = tc.slideBgColor || null;
  let maxLevel = null;

  for (const s of shapes) {
    if (!s.textRuns || s.textRuns.length === 0) continue;
    let bgColor = s.fillColor ? s.fillColor.replace('#', '') : (slideBgColor || 'FFFFFF');

    for (const run of s.textRuns) {
      if (!(run.text || '').trim()) continue;
      const fgColor = run.color || '000000';
      const ratio = contrastRatio(fgColor, bgColor);

      if (ratio < CONTRAST_ERROR) {
        maxLevel = 'ERROR';
      } else if (ratio < CONTRAST_WARN && maxLevel !== 'ERROR') {
        maxLevel = 'WARN';
      }
    }
  }
  return maxLevel;
}

// ── VP-05: Empty table cells ──

function checkTableEmptyCells(tc) {
  let maxLevel = null;
  for (const t of tc.tables) {
    if (t.rows.length < 2) continue;
    for (let rowIdx = 1; rowIdx < t.rows.length; rowIdx++) {
      const row = t.rows[rowIdx];
      // Individual empty cells → WARN
      for (const cell of row) {
        if (cell.merged) continue;
        if (cell.text === '' && maxLevel !== 'ERROR') maxLevel = 'WARN';
      }
      // Entire row empty → ERROR
      const nonMerged = row.filter(c => !c.merged);
      if (nonMerged.length > 0 && nonMerged.every(c => c.text === '')) {
        maxLevel = 'ERROR';
      }
    }
  }
  return maxLevel;
}

// ── VP-06: Table consistency ──

function checkTableConsistency(tc) {
  let maxLevel = null;
  for (const t of tc.tables) {
    if (t.rows.length < 2) continue;
    const headerColCount = t.rows[0].length;

    for (let rowIdx = 1; rowIdx < t.rows.length; rowIdx++) {
      if (t.rows[rowIdx].length !== headerColCount) maxLevel = 'ERROR';
    }

    let totalData = 0, emptyData = 0;
    for (let rowIdx = 1; rowIdx < t.rows.length; rowIdx++) {
      for (const cell of t.rows[rowIdx]) {
        if (cell.merged) continue;
        totalData++;
        if (cell.text === '') emptyData++;
      }
    }
    if (totalData > 0 && emptyData / totalData > 0.5) maxLevel = 'ERROR';
  }
  return maxLevel;
}

// ── VP-07: Grid empty cells ──

function checkShapeGridEmptyCells(tc) {
  const shapes = tc.shapes.map(toEmu);
  const hasText = s => s.textRuns && s.textRuns.length > 0 && s.textRuns.some(r => (r.text || '').trim() !== '');

  // Filter filled shapes, exclude bg siblings
  const filledShapes = shapes.filter(s => s.w > 0 && s.fillColor && !hasOverlappingSibling(s, shapes,
    o => o.textRuns && o.textRuns.length > 0 && o.textRuns.some(r => (r.text || '').trim())));
  if (filledShapes.length < 6) return null;

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

  let maxLevel = null;
  for (const group of widthGroups) {
    if (group.length < 6) continue;
    const xSet = new Set(group.map(s => Math.round(s.x / COL_TOLERANCE)));
    const ySet = new Set(group.map(s => Math.round(s.y / COL_TOLERANCE)));
    if (xSet.size < 2 || ySet.size < 2) continue;

    const withText = group.filter(hasText);
    const withoutText = group.filter(s => !hasText(s));
    if (withText.length === 0 || withoutText.length === 0) continue;

    // Per-column WARN
    if (maxLevel !== 'ERROR') maxLevel = 'WARN';

    const emptyRatio = withoutText.length / group.length;
    if (emptyRatio > 0.4) maxLevel = 'ERROR';
  }
  return maxLevel;
}

// ── VP-08: Filled empty shapes (empty card) ──

function checkFilledEmptyShapes(tc) {
  const shapes = tc.shapes.map(toEmu);
  const MIN_AREA = 635000 * 635000;
  let detected = false;

  for (const s of shapes) {
    if (!s.fillColor) continue;
    if (s.w * s.h < MIN_AREA) continue;
    const hasText = s.textRuns && s.textRuns.length > 0 && s.textRuns.some(r => (r.text || '').trim() !== '');
    if (!hasText) {
      if (hasOverlappingSibling(s, shapes,
        o => o.textRuns && o.textRuns.length > 0 && o.textRuns.some(r => (r.text || '').trim()))) {
        continue;
      }
      detected = true;
    }
  }
  return detected ? 'WARN' : null;
}

// ── VP-09: Shrink-to-fit text density ──

function checkShrinkReliability(tc) {
  const shapes = tc.shapes.map(toEmu);
  let detected = false;

  for (const s of shapes) {
    if (!s.textRuns || s.textRuns.length === 0 || s.w === 0 || s.h === 0) continue;
    const totalText = s.textRuns.map(r => r.text || '').join('');
    if (totalText.length < 10) continue;

    const avgCharWidthPt = 7;
    const avgLineHeightPt = 16;
    const shapWidthPt = s.w / EMU_PER_PT;
    const shapHeightPt = s.h / EMU_PER_PT;

    const charsPerLine = Math.max(1, Math.floor(shapWidthPt / avgCharWidthPt));
    const lines = Math.ceil(totalText.length / charsPerLine);
    const neededHeight = lines * avgLineHeightPt;

    if (neededHeight > shapHeightPt * 1.5) detected = true;
  }
  return detected ? 'WARN' : null;
}

// ── VP-10: Shape spacing consistency ──

function checkGapConsistency(tc) {
  const shapes = tc.shapes.map(toEmu);
  const meaningful = shapes.filter(s => s.w > 0 && s.h > 0 && s.w < DEFAULT_SLIDE_W * 0.8);
  if (meaningful.length < 3) return null;

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

  let detected = false;
  for (const row of rows) {
    if (row.shapes.length < 3) continue;
    const sorted = row.shapes.sort((a, b) => a.x - b.x);
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(sorted[i].x - (sorted[i - 1].x + sorted[i - 1].w));
    }
    if (gaps.length < 2) continue;
    const gapMean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const gapStdDev = Math.sqrt(gaps.reduce((sum, g) => sum + (g - gapMean) ** 2, 0) / gaps.length);
    if (gapStdDev > 5 * EMU_PER_PT) detected = true;
  }
  return detected ? 'WARN' : null;
}

// ── VP-11: Reading order vs visual order ──

function checkReadingOrder(tc) {
  const shapes = tc.shapes.map(toEmu);
  const meaningful = shapes.filter(s => s.w > 0 && s.h > 0 && s.textRuns && s.textRuns.some(r => (r.text || '').trim()));
  if (meaningful.length < 3) return null;

  const visualOrder = [...meaningful].sort((a, b) => {
    const yDiff = a.y - b.y;
    if (Math.abs(yDiff) > 20 * EMU_PER_PT) return yDiff;
    return a.x - b.x;
  });

  let mismatches = 0;
  for (let i = 0; i < meaningful.length; i++) {
    if (meaningful[i] !== visualOrder[i]) mismatches++;
  }

  return (mismatches / meaningful.length) > 0.3 ? 'WARN' : null;
}

// ── VP-12: Empty slide ──

function checkEmptySlide(tc) {
  const shapes = tc.shapes || [];
  const tables = tc.tables || [];
  const totalShapes = shapes.length + tables.length;

  if (totalShapes < 2) return 'ERROR';

  const hasAnyText = shapes.some(s => s.textRuns && s.textRuns.some(r => (r.text || '').trim() !== ''));
  const hasTableText = tables.some(t => t.rows && t.rows.some(row => row.some(cell => (cell.text || '').trim() !== '')));
  if (!hasAnyText && !hasTableText) return 'ERROR';

  return null;
}

// ── VP-13: Media file size ──

function checkMediaSize(tc) {
  const files = tc.mediaFiles || [];
  let maxLevel = null;
  let totalSize = 0;

  for (const f of files) {
    totalSize += f.sizeBytes;
    if (f.sizeBytes > 5 * 1024 * 1024) maxLevel = 'WARN';
  }
  if (totalSize > 20 * 1024 * 1024) maxLevel = 'WARN';

  return maxLevel;
}

// ── VP-14: Shape overlap (existing) ──

function checkOverlapPair(a, b) {
  const MIN_SIZE = 20 * EMU_PER_PT;
  const ax = a.x * EMU_PER_PT, ay = a.y * EMU_PER_PT;
  const aw = a.w * EMU_PER_PT, ah = a.h * EMU_PER_PT;
  const bx = b.x * EMU_PER_PT, by = b.y * EMU_PER_PT;
  const bw = b.w * EMU_PER_PT, bh = b.h * EMU_PER_PT;

  if (aw < MIN_SIZE || ah < MIN_SIZE || bw < MIN_SIZE || bh < MIN_SIZE) return null;

  const aRight = ax + aw, aBottom = ay + ah;
  const bRight = bx + bw, bBottom = by + bh;

  const aContainsB = ax <= bx && aRight >= bRight && ay <= by && aBottom >= bBottom;
  const bContainsA = bx <= ax && bRight >= aRight && by <= ay && bBottom >= aBottom;
  if (aContainsB || bContainsA) return null;

  const aHasText = (a.text || '').length > 0;
  const bHasText = (b.text || '').length > 0;
  if ((!aHasText && a.fillColor && bHasText) || (!bHasText && b.fillColor && aHasText)) return null;

  const overlapW = Math.min(aRight, bRight) - Math.max(ax, bx);
  const overlapH = Math.min(aBottom, bBottom) - Math.max(ay, by);

  if (overlapW > 0 && overlapH > 0) {
    const overlapArea = overlapW * overlapH;
    const aArea = aw * ah;
    const bArea = bw * bh;
    const smallerArea = Math.min(aArea, bArea);
    const pct = Math.round(overlapArea / smallerArea * 100);

    if (pct >= 20) return 'ERROR';
    if (pct >= 5) return 'WARN';
  }
  return null;
}

// ── VP-15: Picture z-order reversal ──

function checkPictureZOrder(tc) {
  const allElements = toEmuElements(tc.allElements);
  const MIN_SIZE = 30 * EMU_PER_PT;

  const pictures = allElements.filter(e => e.type === 'picture' && e.w > MIN_SIZE && e.h > MIN_SIZE);
  const textShapes = allElements.filter(e => {
    if (e.type !== 'shape') return false;
    const text = (e.textRuns || []).map(r => r.text || '').join('').trim();
    return text.length > 0 && e.w > MIN_SIZE && e.h > MIN_SIZE;
  });

  let detected = false;
  for (const pic of pictures) {
    for (const shape of textShapes) {
      const overlapW = Math.min(pic.x + pic.w, shape.x + shape.w) - Math.max(pic.x, shape.x);
      const overlapH = Math.min(pic.y + pic.h, shape.y + shape.h) - Math.max(pic.y, shape.y);
      if (overlapW <= 0 || overlapH <= 0) continue;

      const overlapArea = overlapW * overlapH;
      const picArea = pic.w * pic.h;
      const pct = Math.round(overlapArea / picArea * 100);
      if (pct < 10) continue;

      if (pic.xmlOrder > shape.xmlOrder) detected = true;
    }
  }
  return detected ? 'WARN' : null;
}

// ── VP-16: CJK text overflow (existing) ──

function checkCjkOverflow(shape) {
  const text = shape.text || '';
  if (text.length < 2) return null;

  const cjkMatches = text.match(CJK_CHAR_RE);
  if (!cjkMatches || cjkMatches.length === 0) return null;

  const cjkCount = cjkMatches.length;
  const latinCount = text.length - cjkCount;
  const cjkRatio = cjkCount / text.length;
  if (cjkRatio < 0.2) return null;

  const estimatedFontPt = shape.fontSize || 12;
  const fontEmu = estimatedFontPt * EMU_PER_PT;

  const estimatedWidth = (cjkCount * fontEmu * 1.0) + (latinCount * fontEmu * 0.55);
  const availableWidth = (shape.w * EMU_PER_PT) - (10 * EMU_PER_PT);
  if (availableWidth <= 0) return null;

  const ratio = estimatedWidth / availableWidth;
  const linesNeeded = Math.ceil(estimatedWidth / availableWidth);
  const lineHeightEmu = fontEmu * 1.2;
  const heightNeeded = linesNeeded * lineHeightEmu;
  const availableHeight = (shape.h * EMU_PER_PT) - (10 * EMU_PER_PT);
  const verticalOverflow = heightNeeded > availableHeight;

  const isShortText = text.length <= 5;
  const isMinorOverflow = linesNeeded <= 2 && estimatedFontPt <= 12;
  const overflowRatio = availableHeight > 0 ? heightNeeded / availableHeight : Infinity;
  const isBorderlineOverflow = overflowRatio < 1.5;

  if (ratio > 1.2 && verticalOverflow && !isShortText && !isMinorOverflow && !isBorderlineOverflow) {
    return 'ERROR';
  } else if (ratio > 1.2 && (isShortText || isMinorOverflow || isBorderlineOverflow || !verticalOverflow)) {
    return 'WARN';
  } else if (ratio > 0.95) {
    return 'WARN';
  }
  return null;
}

// ── Test dispatch ──

function dispatch(tc) {
  switch (tc.rule) {
    case 'VP-01':
      return tc.shapes ? checkOverflow(tc) : null;
    case 'VP-02':
      return tc.shapes ? checkColumnAlignment(tc) : null;
    case 'VP-03':
      return tc.shapes ? checkEmptyText(tc) : null;
    case 'VP-04':
      return tc.shapes ? checkContrast(tc) : null;
    case 'VP-05':
      return tc.tables ? checkTableEmptyCells(tc) : null;
    case 'VP-06':
      return tc.tables ? checkTableConsistency(tc) : null;
    case 'VP-07':
      return tc.shapes ? checkShapeGridEmptyCells(tc) : null;
    case 'VP-08':
      return tc.shapes ? checkFilledEmptyShapes(tc) : null;
    case 'VP-09':
      return tc.shapes ? checkShrinkReliability(tc) : null;
    case 'VP-10':
      return tc.shapes ? checkGapConsistency(tc) : null;
    case 'VP-11':
      return tc.shapes ? checkReadingOrder(tc) : null;
    case 'VP-12':
      return checkEmptySlide(tc);
    case 'VP-13':
      return tc.mediaFiles ? checkMediaSize(tc) : null;
    case 'VP-14':
      return tc.shapes ? checkOverlapPair(tc.shapes[0], tc.shapes[1]) : null;
    case 'VP-15':
      return tc.allElements ? checkPictureZOrder(tc) : null;
    case 'VP-16':
      return tc.shape ? checkCjkOverflow(tc.shape) : null;
    default:
      return undefined; // unknown rule — skip
  }
}

// ── Test runner ──

function runTests() {
  const casesFile = join(__dirname, 'vp-cases.json');
  const data = JSON.parse(readFileSync(casesFile, 'utf8'));
  const cases = data.cases;

  let passed = 0, failed = 0, skipped = 0, knownIssues = 0;
  const failures = [];

  for (const tc of cases) {
    // Skip comment-only entries
    if (tc._comment && !tc.rule) { continue; }

    const actual = dispatch(tc);

    if (actual === undefined) {
      skipped++;
      continue;
    }

    // Known issues: verify the code still produces the ACTUAL (not desired) level
    if (tc.status === 'known_issue') {
      const actualLevel = tc.actualLevel ?? null;
      if (actual === actualLevel) {
        knownIssues++;
        console.log(`  ⚠ ${tc.id}: KNOWN ISSUE — want ${tc.expectedLevel ?? 'null'}, code gives ${actual ?? 'null'} (tracked)`);
      } else {
        if (actual === tc.expectedLevel || (tc.type === 'true_positive' && actual != null && tc.expectedLevel != null)) {
          passed++;
          console.log(`  🎉 ${tc.id}: FIXED — now gives ${actual ?? 'null'} (was ${actualLevel ?? 'null'}, wanted ${tc.expectedLevel ?? 'null'})`);
        } else {
          failed++;
          console.log(`  ✗ ${tc.id}: CHANGED — was ${actualLevel ?? 'null'}, now ${actual ?? 'null'} (wanted ${tc.expectedLevel ?? 'null'})`);
          failures.push({ id: tc.id, expected: actualLevel, actual, description: tc.description });
        }
      }
      continue;
    }

    let pass;
    if (tc.type === 'true_positive') {
      if (tc.expectedLevel === 'ERROR') {
        pass = actual === 'ERROR';
      } else if (tc.expectedLevel === 'WARN') {
        pass = actual === 'WARN' || actual === 'ERROR';
      } else {
        pass = actual != null;
      }
    } else {
      if (tc.expectedLevel === null) {
        pass = actual === null;
      } else if (tc.expectedLevel === 'WARN') {
        pass = actual === null || actual === 'WARN';
      } else {
        pass = actual === tc.expectedLevel;
      }
    }

    if (pass) {
      passed++;
      console.log(`  ✓ ${tc.id}: ${tc.type === 'true_positive' ? 'TP' : 'FP'} — expected ${tc.expectedLevel ?? 'null'}, got ${actual ?? 'null'}`);
    } else {
      failed++;
      const msg = `  ✗ ${tc.id}: REGRESSION — expected ${tc.expectedLevel ?? 'null'}, got ${actual ?? 'null'} (${tc.description})`;
      console.log(msg);
      failures.push({ id: tc.id, expected: tc.expectedLevel, actual, description: tc.description });
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${knownIssues} known issues, ${skipped} skipped`);

  if (failures.length > 0) {
    console.log('\n❌ REGRESSIONS FOUND:');
    for (const f of failures) {
      console.log(`  ${f.id}: expected ${f.expected ?? 'null'} but got ${f.actual ?? 'null'}`);
      console.log(`    ${f.description}`);
    }
    process.exit(1);
  } else {
    console.log('\n✅ All VP regression tests passed');
    if (knownIssues > 0) console.log(`   (${knownIssues} known issues tracked for future fix)`);
    process.exit(0);
  }
}

console.log('VP Regression Tests');
console.log('===================\n');
runTests();
