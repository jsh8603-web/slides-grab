/**
 * html2pptx - Convert HTML slide to pptxgenjs slide with positioned elements
 *
 * USAGE:
 *   const pptx = new pptxgen();
 *   pptx.layout = 'LAYOUT_16x9';  // Must match HTML body dimensions
 *
 *   const { slide, placeholders } = await html2pptx('slide.html', pptx);
 *   slide.addChart(pptx.charts.LINE, data, placeholders[0]);
 *
 *   await pptx.writeFile('output.pptx');
 *
 * FEATURES:
 *   - Converts HTML to PowerPoint with accurate positioning
 *   - Supports text, images, shapes, and bullet lists
 *   - Extracts placeholder elements (class="placeholder") with positions
 *   - Handles CSS gradients, borders, and margins
 *
 * VALIDATION:
 *   - Uses body width/height from HTML for viewport sizing
 *   - Throws error if HTML dimensions don't match presentation layout
 *   - Throws error if content overflows body (with overflow details)
 *
 * RETURNS:
 *   { slide, placeholders } where placeholders is an array of { id, x, y, w, h }
 */

const { chromium } = require('playwright');
const path = require('path');
const sharp = require('sharp');

const PT_PER_PX = 0.75;
const PX_PER_IN = 96;
const EMU_PER_IN = 914400;

async function launchBrowser(tmpDir) {
  const launchOptions = { env: { TMPDIR: tmpDir } };

  if (process.platform !== 'darwin') {
    return chromium.launch(launchOptions);
  }

  try {
    return await chromium.launch({ ...launchOptions, channel: 'chrome' });
  } catch (error) {
    if (error && typeof error.message === 'string' && error.message.includes("Chromium distribution 'chrome' is not found")) {
      return chromium.launch(launchOptions);
    }
    throw error;
  }
}

async function waitForDynamicLibraryRender(page, timeout = 5000) {
  await page.evaluate(async () => {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  });

  const hasCanvas = await page.evaluate(() => document.querySelector('canvas') !== null);
  if (hasCanvas) {
    await page.evaluate(() => {
      if (!window.Chart || !window.Chart.instances) return;
      const instances = Array.isArray(window.Chart.instances)
        ? window.Chart.instances
        : Object.values(window.Chart.instances);

      for (const chart of instances) {
        if (!chart) continue;
        if (chart.options) chart.options.animation = false;
        if (typeof chart.update === 'function') {
          try {
            chart.update('none');
          } catch (_) {
            // noop
          }
        }
      }
    });

    try {
      await page.waitForFunction(() => {
        const canvases = Array.from(document.querySelectorAll('canvas'));
        if (canvases.length === 0) return true;

        const instances = (window.Chart && window.Chart.instances)
          ? (Array.isArray(window.Chart.instances) ? window.Chart.instances : Object.values(window.Chart.instances))
          : [];

        return canvases.every((canvas) => {
          const rect = canvas.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) return false;

          const matchedChart = instances.find((instance) => instance && instance.canvas === canvas);
          if (!matchedChart) return true;
          return matchedChart.animating === false;
        });
      }, null, { timeout });
    } catch (_) {
      // Keep conversion resilient even when chart animation state is unavailable.
    }
  }

  const hasMermaid = await page.evaluate(() => document.querySelector('.mermaid') !== null);
  if (hasMermaid) {
    await page.evaluate(async () => {
      if (!window.mermaid) return;

      try {
        if (typeof window.mermaid.run === 'function') {
          await window.mermaid.run({ querySelector: '.mermaid' });
          return;
        }

        if (typeof window.mermaid.init === 'function') {
          await window.mermaid.init(undefined, document.querySelectorAll('.mermaid'));
        }
      } catch (_) {
        // noop
      }
    });

    try {
      await page.waitForFunction(() => {
        const blocks = Array.from(document.querySelectorAll('.mermaid'));
        if (blocks.length === 0) return true;
        return blocks.every((block) => block.querySelector('svg') !== null);
      }, null, { timeout });
    } catch (_) {
      // Keep conversion resilient when Mermaid CDN/script is unavailable.
    }
  }
}

async function rasterizeDynamicVisuals(page) {
  await page.evaluate(async () => {
    const waitForImageLoad = (img) => new Promise((resolve) => {
      if (img.complete) {
        resolve();
        return;
      }

      const done = () => resolve();
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });

    const canvasList = Array.from(document.querySelectorAll('canvas'));
    for (const canvas of canvasList) {
      try {
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        const dataUrl = canvas.toDataURL('image/png');
        if (!dataUrl || dataUrl === 'data:,') continue;

        const computed = window.getComputedStyle(canvas);
        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = canvas.getAttribute('aria-label') || 'chart';
        img.style.width = `${rect.width}px`;
        img.style.height = `${rect.height}px`;
        img.style.display = computed.display === 'inline' ? 'inline-block' : computed.display;
        img.style.objectFit = 'contain';
        if (canvas.className) img.className = canvas.className;
        if (canvas.id) img.id = `${canvas.id}-rendered`;

        canvas.replaceWith(img);
        await waitForImageLoad(img);
      } catch (_) {
        // noop
      }
    }

    const svgList = Array.from(document.querySelectorAll('svg'));
    for (const svg of svgList) {
      try {
        const rect = svg.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        const clone = svg.cloneNode(true);
        if (!clone.getAttribute('xmlns')) {
          clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        }
        if (!clone.getAttribute('xmlns:xlink')) {
          clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
        }
        if (!clone.getAttribute('width')) {
          clone.setAttribute('width', `${Math.max(1, Math.round(rect.width))}`);
        }
        if (!clone.getAttribute('height')) {
          clone.setAttribute('height', `${Math.max(1, Math.round(rect.height))}`);
        }

        const serialized = new XMLSerializer().serializeToString(clone);
        const base64Svg = btoa(unescape(encodeURIComponent(serialized)));
        const dataUrl = `data:image/svg+xml;base64,${base64Svg}`;

        const computed = window.getComputedStyle(svg);
        const img = document.createElement('img');
        img.src = dataUrl;
        img.alt = 'diagram';
        img.style.width = `${rect.width}px`;
        img.style.height = `${rect.height}px`;
        img.style.display = computed.display === 'inline' ? 'inline-block' : computed.display;
        img.style.objectFit = 'contain';

        svg.replaceWith(img);
        await waitForImageLoad(img);
      } catch (_) {
        // noop
      }
    }
  });
}

// Helper: Get body dimensions and check for overflow
async function getBodyDimensions(page) {
  const bodyDimensions = await page.evaluate(() => {
    const body = document.body;
    const style = window.getComputedStyle(body);

    return {
      width: parseFloat(style.width),
      height: parseFloat(style.height),
      scrollWidth: body.scrollWidth,
      scrollHeight: body.scrollHeight
    };
  });

  const errors = [];
  // Tolerance: 4px (~3pt) to accommodate sub-pixel rounding from
  // position:relative body + absolute children (scrollHeight artifact)
  const overflowTolerance = 4;
  const widthOverflowPx = Math.max(0, bodyDimensions.scrollWidth - bodyDimensions.width - overflowTolerance);
  const heightOverflowPx = Math.max(0, bodyDimensions.scrollHeight - bodyDimensions.height - overflowTolerance);

  const widthOverflowPt = widthOverflowPx * PT_PER_PX;
  const heightOverflowPt = heightOverflowPx * PT_PER_PX;

  if (widthOverflowPt > 0 || heightOverflowPt > 0) {
    const directions = [];
    if (widthOverflowPt > 0) directions.push(`${widthOverflowPt.toFixed(1)}pt horizontally`);
    if (heightOverflowPt > 0) directions.push(`${heightOverflowPt.toFixed(1)}pt vertically`);
    const reminder = heightOverflowPt > 0 ? ' (Remember: leave 0.5" margin at bottom of slide)' : '';
    errors.push(`HTML content overflows body by ${directions.join(' and ')}${reminder}`);
  }

  return { ...bodyDimensions, errors };
}

// Helper: Validate dimensions match presentation layout
function validateDimensions(bodyDimensions, pres) {
  const errors = [];
  const widthInches = bodyDimensions.width / PX_PER_IN;
  const heightInches = bodyDimensions.height / PX_PER_IN;

  if (pres.presLayout) {
    const layoutWidth = pres.presLayout.width / EMU_PER_IN;
    const layoutHeight = pres.presLayout.height / EMU_PER_IN;

    if (Math.abs(layoutWidth - widthInches) > 0.1 || Math.abs(layoutHeight - heightInches) > 0.1) {
      errors.push(
        `HTML dimensions (${widthInches.toFixed(1)}" × ${heightInches.toFixed(1)}") ` +
        `don't match presentation layout (${layoutWidth.toFixed(1)}" × ${layoutHeight.toFixed(1)}")`
      );
    }
  }
  return errors;
}

function validateTextBoxPosition(slideData, bodyDimensions) {
  const errors = [];
  const slideHeightInches = bodyDimensions.height / PX_PER_IN;
  const minBottomMargin = 0.5; // 0.5 inches from bottom

  for (const el of slideData.elements) {
    // Check text elements (p, h1-h6, list)
    if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'list'].includes(el.type)) {
      const fontSize = el.style?.fontSize || 0;
      const bottomEdge = el.position.y + el.position.h;
      const distanceFromBottom = slideHeightInches - bottomEdge;

      if (fontSize > 12 && distanceFromBottom < minBottomMargin) {
        const getText = () => {
          if (typeof el.text === 'string') return el.text;
          if (Array.isArray(el.text)) return el.text.find(t => t.text)?.text || '';
          if (Array.isArray(el.items)) return el.items.find(item => item.text)?.text || '';
          return '';
        };
        const fullText = getText();
        const textPrefix = fullText.substring(0, 50) + (fullText.length > 50 ? '...' : '');

        errors.push(
          `Text box "${textPrefix}" ends too close to bottom edge ` +
          `(${distanceFromBottom.toFixed(2)}" from bottom, minimum ${minBottomMargin}" required)`
        );
      }
    }
  }

  return errors;
}

// Helper: Add background to slide
async function addBackground(slideData, targetSlide, tmpDir) {
  if (slideData.background.type === 'image' && slideData.background.path) {
    let imagePath = slideData.background.path;
    if (imagePath.startsWith('file:///')) {
      imagePath = imagePath.slice(8);
      if (!imagePath.match(/^[A-Za-z]:/)) imagePath = '/' + imagePath;
    } else if (imagePath.startsWith('file://')) {
      imagePath = imagePath.replace('file://', '');
    }
    targetSlide.background = { path: imagePath };
  } else if (slideData.background.type === 'color' && slideData.background.value) {
    targetSlide.background = { color: slideData.background.value };
  }
}

// Helper: Add elements to slide
function addElements(slideData, targetSlide, pres) {
  const SLIDE_W = 10, SLIDE_H = 5.625;
  function clampToSlide(x, y, w, h) {
    let cx = x, cy = y, cw = w, ch = h;
    if (cx < 0) { cw += cx; cx = 0; }
    if (cy < 0) { ch += cy; cy = 0; }
    if (cx + cw > SLIDE_W) { cw = SLIDE_W - cx; }
    if (cy + ch > SLIDE_H) { ch = SLIDE_H - cy; }
    if (cw < 0.01) cw = 0.01;
    if (ch < 0.01) ch = 0.01;
    const clamped = (cx !== x || cy !== y || cw !== w || ch !== h);
    if (clamped) {
      console.warn(`  CLAMP: element at (${x.toFixed(2)},${y.toFixed(2)}) ${w.toFixed(2)}×${h.toFixed(2)} → (${cx.toFixed(2)},${cy.toFixed(2)}) ${cw.toFixed(2)}×${ch.toFixed(2)}`);
    }
    return { x: cx, y: cy, w: cw, h: ch };
  }

  const pendingText = []; // Collect text elements for column normalization pass
  for (const el of slideData.elements) {
    if (el.type === 'image') {
      if (el.src.startsWith('data:')) {
        targetSlide.addImage({
          data: el.src.replace(/^data:/, ''),
          x: el.position.x,
          y: el.position.y,
          w: el.position.w,
          h: el.position.h,
          sizing: { type: 'contain', w: el.position.w, h: el.position.h }
        });
      } else {
        let imagePath = el.src;
        // file:///D:/path → D:/path (Windows), file:///home/path → /home/path (Linux/Mac)
        if (imagePath.startsWith('file:///')) {
          imagePath = imagePath.slice(8); // remove 'file:///'
          // On Windows, result is like 'D:/path' which is correct
          // On Unix, we need to restore the leading '/'
          if (!imagePath.match(/^[A-Za-z]:/)) {
            imagePath = '/' + imagePath;
          }
        } else if (imagePath.startsWith('file://')) {
          imagePath = imagePath.replace('file://', '');
        }
        targetSlide.addImage({
          path: imagePath,
          x: el.position.x,
          y: el.position.y,
          w: el.position.w,
          h: el.position.h,
          sizing: { type: 'contain', w: el.position.w, h: el.position.h }
        });
      }
    } else if (el.type === 'line') {
      targetSlide.addShape(pres.ShapeType.line, {
        x: el.x1,
        y: el.y1,
        w: el.x2 - el.x1,
        h: el.y2 - el.y1,
        line: { color: el.color, width: el.width }
      });
    } else if (el.type === 'shape') {
      const clamped = clampToSlide(el.position.x, el.position.y, el.position.w, el.position.h);
      // Update el.position so downstream containment checks and column detection use clamped coords
      el.position.x = clamped.x;
      el.position.y = clamped.y;
      el.position.w = clamped.w;
      el.position.h = clamped.h;
      const shapeOptions = {
        x: clamped.x,
        y: clamped.y,
        w: clamped.w,
        h: clamped.h,
        shape: el.shape.rectRadius > 0 ? pres.ShapeType.roundRect : pres.ShapeType.rect
      };

      if (el.shape.fill) {
        shapeOptions.fill = { color: el.shape.fill };
        if (el.shape.transparency != null) shapeOptions.fill.transparency = el.shape.transparency;
      }
      if (el.shape.line) shapeOptions.line = el.shape.line;
      if (el.shape.rectRadius > 0) shapeOptions.rectRadius = el.shape.rectRadius;
      if (el.shape.shadow) shapeOptions.shadow = el.shape.shadow;
      // Apply text alignment for leaf shapes with embedded text
      if (el.shape.textAlign) shapeOptions.align = el.shape.textAlign;
      if (el.shape.textValign) shapeOptions.valign = el.shape.textValign;
      if (el.shape.margin) {
        shapeOptions.margin = el.shape.margin;
      } else if (Array.isArray(el.text) && el.text.length > 0) {
        shapeOptions.margin = [0, 0, 0, 0];  // Tight fit for icon/badge shapes
      }
      if (el.shape.lineSpacing) {
        shapeOptions.lineSpacing = el.shape.lineSpacing;
      }
      targetSlide.addText(el.text || '', shapeOptions);
    } else if (el.type === 'list') {
      const listOptions = {
        x: el.position.x,
        y: el.position.y,
        w: el.position.w,
        h: el.position.h,
        fontSize: el.style.fontSize,
        fontFace: el.style.fontFace,
        color: el.style.color,
        align: el.style.align,
        valign: 'top',
        lineSpacing: el.style.lineSpacing,
        paraSpaceBefore: el.style.paraSpaceBefore,
        paraSpaceAfter: el.style.paraSpaceAfter,
        margin: el.style.margin
      };
      if (el.style.margin) listOptions.margin = el.style.margin;
      targetSlide.addText(el.items, listOptions);
    } else {
      // Check if text is single-line (height suggests one line)
      const lineHeight = el.style.lineSpacing || el.style.fontSize * 1.2;
      const isSingleLine = el.position.h <= lineHeight * 1.5;

      let adjustedX = el.position.x;
      let adjustedW = el.position.w;

      // Detect CJK text (Korean/Chinese/Japanese render wider in PowerPoint than Chrome)
      // Use per-character weighted correction instead of binary CJK threshold
      const textStr = typeof el.text === 'string' ? el.text : (Array.isArray(el.text) ? el.text.map(r => r.text || '').join('') : '');
      const hasCJK = /[\u3000-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/.test(textStr);

      // Weighted width correction: CJK chars ×0.25, Latin ×0.08, digits ×0.05
      // PowerPoint renders CJK glyphs 15-20% wider than Chrome, plus PptxGenJS applies
      // ~3.6pt internal margin per side (7.2pt total) that `inset: 0` cannot override.
      let widthMultiplier = 0;
      if (textStr.length > 0) {
        let cjkCount = 0, latinCount = 0, digitCount = 0, otherCount = 0;
        for (const ch of textStr) {
          const cp = ch.codePointAt(0);
          if ((cp >= 0x3000 && cp <= 0x9FFF) || (cp >= 0xAC00 && cp <= 0xD7AF) || (cp >= 0xF900 && cp <= 0xFAFF)) {
            cjkCount++;
          } else if ((cp >= 0x41 && cp <= 0x5A) || (cp >= 0x61 && cp <= 0x7A)) {
            latinCount++;
          } else if (cp >= 0x30 && cp <= 0x39) {
            digitCount++;
          } else {
            otherCount++;
          }
        }
        const total = textStr.length;
        const singleLineFactor = isSingleLine ? 1.3 : 1.0;
        widthMultiplier = ((cjkCount * 0.25 + latinCount * 0.08 + digitCount * 0.05 + otherCount * 0.06) / total) * singleLineFactor;
      }

      // Badge minimum width: small shapes with ≤3 chars get minimum width guarantee
      const isBadge = el.position.w < (50 / 72) && textStr.length <= 3;

      // Minimum 10pt (0.139") absolute increase to compensate for PptxGenJS internal margin (~7.2pt)
      const minWidthIncrease = 10 / 72; // 10pt in inches
      const widthIncrease = Math.max(el.position.w * widthMultiplier, minWidthIncrease);
      const heightIncrease = isSingleLine ? el.position.h * 0.15 : el.position.h * 0.1;
      const align = el.style.align;

      if (align === 'center') {
        adjustedX = el.position.x - (widthIncrease / 2);
        adjustedW = el.position.w + widthIncrease;
      } else if (align === 'right') {
        adjustedX = el.position.x - widthIncrease;
        adjustedW = el.position.w + widthIncrease;
      } else {
        adjustedW = el.position.w + widthIncrease;
      }

      // Clamp text width to parent container boundary
      // Find the smallest containing shape that encloses this text element
      const textRight = adjustedX + adjustedW;
      const textBottom = el.position.y + el.position.h;
      let parentShape = null;
      let parentArea = Infinity;
      for (const other of slideData.elements) {
        if (other.type !== 'shape') continue;
        const sp = other.position;
        // Check if the text's original position is inside this shape (with small tolerance)
        const tol = 0.01; // ~1pt tolerance
        if (el.position.x >= sp.x - tol && el.position.y >= sp.y - tol &&
            el.position.x + el.position.w <= sp.x + sp.w + tol &&
            el.position.y + el.position.h <= sp.y + sp.h + tol) {
          const area = sp.w * sp.h;
          if (area < parentArea) {
            parentArea = area;
            parentShape = sp;
          }
        }
      }
      if (parentShape) {
        const parentRight = parentShape.x + parentShape.w;
        if (textRight > parentRight) {
          adjustedW = parentRight - adjustedX;
        }
        // Also clamp left edge for center-aligned text
        if (adjustedX < parentShape.x) {
          adjustedW -= (parentShape.x - adjustedX);
          adjustedX = parentShape.x;
        }
      }

      // Badge minimum width: ensure small shapes with ≤3 chars have enough space
      if (isBadge && el.style.fontSize) {
        const minBadgeW = (el.style.fontSize * 2.5) / 72; // fontSize in pt → inches
        if (adjustedW < minBadgeW) {
          const increase = minBadgeW - adjustedW;
          if (align === 'center') {
            adjustedX -= increase / 2;
          }
          adjustedW = minBadgeW;
          // Clamp to slide bounds (10" wide)
          if (adjustedX < 0) { adjustedW += adjustedX; adjustedX = 0; }
          if (adjustedX + adjustedW > 10) { adjustedW = 10 - adjustedX; }
        }
      }

      const textOptions = {
        x: adjustedX,
        y: el.position.y,
        w: adjustedW,
        h: el.position.h + heightIncrease,
        fontSize: el.style.fontSize,
        fontFace: el.style.fontFace,
        color: el.style.color,
        bold: el.style.bold,
        italic: el.style.italic,
        underline: el.style.underline,
        valign: 'top',
        lineSpacing: el.style.lineSpacing,
        paraSpaceBefore: el.style.paraSpaceBefore,
        paraSpaceAfter: el.style.paraSpaceAfter,
        inset: 0,  // Remove default PowerPoint internal padding
        // Apply shrink for all single-line text as safety net (not just CJK)
        // Multi-line text excluded: LibreOffice aggressively shrinks all text with fit:'shrink'
        ...(isSingleLine ? { fit: 'shrink' } : {})
      };

      if (el.style.align) textOptions.align = el.style.align;
      if (el.style.margin) textOptions.margin = el.style.margin;
      if (el.style.rotate !== undefined) textOptions.rotate = el.style.rotate;
      if (el.style.transparency !== null && el.style.transparency !== undefined) textOptions.transparency = el.style.transparency;

      // Defer text element for column normalization (added to slide after loop)
      pendingText.push({ el, textOptions, origX: el.position.x, origW: el.position.w });
    }
  }

  // Table column alignment: fix misalignment between shape-embedded text (bg cells)
  // and standalone text elements (no-bg cells) in grid/table layouts.
  // Shape cells keep their original grid positions, but text cells get CJK width
  // correction that shifts them. Fix: snap text elements to matching shape columns.
  if (pendingText.length > 0) {
    const COL_TOL = 0.04; // ~3pt tolerance for "same column"

    // Phase 1: Collect shape column positions, vertical range, and column depth.
    // A "confirmed table column" has shapes at 2+ distinct Y positions (header + data rows).
    // Single-Y shapes (hero numbers, badges) are not table columns.
    const shapeColumns = []; // { x, w, ySet: Set<roundedY>, yRanges: [{y, h}] }
    for (const el of slideData.elements) {
      if (el.type !== 'shape') continue;
      // Only consider shapes with text (table cells, not decorative shapes)
      if (!el.text || (typeof el.text === 'string' && !el.text.trim()) ||
          (Array.isArray(el.text) && el.text.length === 0)) continue;
      const sx = el.position.x;
      const sw = el.position.w;
      const sy = el.position.y;
      const sh = el.position.h;
      const yKey = Math.round(sy * 20); // ~3.6pt granularity for distinct rows
      // Find or create column entry
      let col = shapeColumns.find(c => Math.abs(c.x - sx) < COL_TOL && Math.abs(c.w - sw) < COL_TOL);
      if (!col) {
        col = { x: sx, w: sw, ySet: new Set(), yRanges: [] };
        shapeColumns.push(col);
      }
      col.ySet.add(yKey);
      col.yRanges.push({ y: sy, h: sh });
    }

    // Confirmed table columns: shapes at 2+ distinct Y positions
    const tableColumns = shapeColumns.filter(c => c.ySet.size >= 2);

    // Compute Y range and max height from CONFIRMED table columns only
    // (not from badges, hero numbers, or other non-table shapes)
    let tableYMin = Infinity, tableYMax = -Infinity;
    let maxShapeH = 0;
    for (const col of tableColumns) {
      for (const { y, h } of col.yRanges) {
        if (y < tableYMin) tableYMin = y;
        if (y + h > tableYMax) tableYMax = y + h;
        if (h > maxShapeH) maxShapeH = h;
      }
    }

    // Phase 2: For each text element, check if it's a TABLE CELL by verifying:
    // 1. Matches a confirmed table column (2+ Y depths)
    // 2. Within vertical range of the table area
    // 3. Width similar to column width (excludes wide titles)
    // 4. Height similar to shape cells (excludes tall hero numbers)
    if (tableColumns.length >= 2) {
      const Y_TOL = 0; // strict: text must be within table shape Y range (no tolerance)
      const W_RATIO = 1.5; // text width must be <= 1.5× column width
      const H_RATIO = 2.0; // text height must be <= 2× max shape cell height
      for (const item of pendingText) {
        const textY = item.el.position.y;
        const textH = item.el.position.h || 0;
        const textBottom = textY + textH;
        // Y range check: text must be within the table area
        if (textY > tableYMax + Y_TOL || textBottom < tableYMin - Y_TOL) continue;
        // Height check: table cells are short, hero numbers are tall
        if (maxShapeH > 0 && textH > maxShapeH * H_RATIO) continue;

        const textCenter = item.origX + item.origW / 2;
        for (const col of tableColumns) {
          // Width check
          if (item.origW > col.w * W_RATIO) continue;
          const colLeft = col.x;
          const colRight = col.x + col.w;
          if (textCenter >= colLeft - COL_TOL && textCenter <= colRight + COL_TOL) {
            // Confirmed table cell — snap to column.
            item.textOptions.x = col.x;
            item.textOptions.w = col.w;
            item.textOptions.fit = 'shrink';
            item.textOptions.margin = [0, 0, 0, 0]; // Match shape margin (zero internal padding)
            item.snapped = true;
            break;
          }
        }
      }
    }

    // Phase 3: For text elements NOT snapped to shapes, do peer normalization.
    // Group by original x. For groups with 3+ elements at different y's, normalize.
    // GUARD: If table columns exist, exclude elements outside table Y range
    //        to prevent hero numbers/labels from being grouped with table cells.
    const unsnapped = pendingText.filter(i => !i.snapped);
    // Phase 3 only runs when a table exists — it aligns unsnapped table cells.
    // Without a table, grouping text by X is harmful (e.g., title + hero + caption
    // get forced to the same width, causing overflow).
    const phase3Candidates = (tableColumns.length >= 2)
      ? unsnapped.filter(i => {
          const ey = i.el.position.y;
          const eh = i.el.position.h || 0;
          const eBottom = ey + eh;
          // Only include elements that overlap with the table Y range
          return !(ey > tableYMax || eBottom < tableYMin);
        })
      : []; // No table → no Phase 3 normalization
    const colGroups = [];
    for (const item of phase3Candidates) {
      let found = false;
      for (const group of colGroups) {
        if (Math.abs(item.origX - group.x) < COL_TOL) {
          group.items.push(item);
          found = true;
          break;
        }
      }
      if (!found) {
        colGroups.push({ x: item.origX, items: [item] });
      }
    }
    for (const group of colGroups) {
      if (group.items.length < 3) continue;
      const uniqueY = new Set(group.items.map(i => Math.round(i.el.position.y * 50)));
      if (uniqueY.size < 2) continue;
      const widths = group.items.map(i => i.origW);
      const avgW = widths.reduce((a, b) => a + b, 0) / widths.length;
      if (!widths.every(w => Math.abs(w - avgW) < COL_TOL)) continue;
      const minX = Math.min(...group.items.map(i => i.textOptions.x));
      const maxRight = Math.max(...group.items.map(i => i.textOptions.x + i.textOptions.w));
      for (const item of group.items) {
        item.textOptions.x = minX;
        item.textOptions.w = maxRight - minX;
      }
    }

    // Add all deferred text elements to slide (preserves z-order: shapes already added)
    for (const { el, textOptions } of pendingText) {
      const tc = clampToSlide(textOptions.x, textOptions.y, textOptions.w, textOptions.h);
      textOptions.x = tc.x;
      textOptions.y = tc.y;
      textOptions.w = tc.w;
      textOptions.h = tc.h;
      targetSlide.addText(el.text, textOptions);
    }
  }
}

// Helper: Extract slide data from HTML page
async function extractSlideData(page) {
  return await page.evaluate(() => {
    const PT_PER_PX = 0.75;
    const PX_PER_IN = 96;

    // Fonts that are single-weight and should not have bold applied
    // (applying bold causes PowerPoint to use faux bold which makes text wider)
    const SINGLE_WEIGHT_FONTS = ['impact'];
    const BLOCK_CHILD_SELECTOR = 'div, p, h1, h2, h3, h4, h5, h6, ul, ol, li, table, img, svg, canvas';

    // Helper: Check if a font should skip bold formatting
    const shouldSkipBold = (fontFamily) => {
      if (!fontFamily) return false;
      const normalizedFont = fontFamily.toLowerCase().replace(/['"]/g, '').split(',')[0].trim();
      return SINGLE_WEIGHT_FONTS.includes(normalizedFont);
    };

    // Unit conversion helpers
    const pxToInch = (px) => px / PX_PER_IN;
    const pxToPoints = (pxStr) => parseFloat(pxStr) * PT_PER_PX;
    const rgbToHex = (rgbStr) => {
      // Handle transparent backgrounds by defaulting to white
      if (rgbStr === 'rgba(0, 0, 0, 0)' || rgbStr === 'transparent') return 'FFFFFF';

      const match = rgbStr.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
      if (!match) return 'FFFFFF';
      return match.slice(1).map(n => parseInt(n).toString(16).padStart(2, '0')).join('').toUpperCase();
    };

    // WCAG contrast ratio helpers (with luminance cache for repeated colors)
    const luminanceCache = new Map();
    const wcagLuminance = (hex) => {
      if (luminanceCache.has(hex)) return luminanceCache.get(hex);
      const r = parseInt(hex.slice(0,2),16)/255;
      const g = parseInt(hex.slice(2,4),16)/255;
      const b = parseInt(hex.slice(4,6),16)/255;
      const f = c => c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
      const L = 0.2126*f(r) + 0.7152*f(g) + 0.0722*f(b);
      luminanceCache.set(hex, L);
      return L;
    };
    const wcagContrast = (h1,h2) => {
      const L1=wcagLuminance(h1), L2=wcagLuminance(h2);
      return (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
    };

    const extractAlpha = (rgbStr) => {
      const match = rgbStr.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
      if (!match || !match[4]) return null;
      const alpha = parseFloat(match[4]);
      return Math.round((1 - alpha) * 100);
    };

    const applyTextTransform = (text, textTransform) => {
      if (textTransform === 'uppercase') return text.toUpperCase();
      if (textTransform === 'lowercase') return text.toLowerCase();
      if (textTransform === 'capitalize') {
        return text.replace(/\b\w/g, c => c.toUpperCase());
      }
      return text;
    };

    // Extract rotation angle from CSS transform and writing-mode
    const getRotation = (transform, writingMode) => {
      let angle = 0;

      // Handle writing-mode first
      // PowerPoint: 90° = text rotated 90° clockwise (reads top to bottom, letters upright)
      // PowerPoint: 270° = text rotated 270° clockwise (reads bottom to top, letters upright)
      if (writingMode === 'vertical-rl') {
        // vertical-rl alone = text reads top to bottom = 90° in PowerPoint
        angle = 90;
      } else if (writingMode === 'vertical-lr') {
        // vertical-lr alone = text reads bottom to top = 270° in PowerPoint
        angle = 270;
      }

      // Then add any transform rotation
      if (transform && transform !== 'none') {
        // Try to match rotate() function
        const rotateMatch = transform.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/);
        if (rotateMatch) {
          angle += parseFloat(rotateMatch[1]);
        } else {
          // Browser may compute as matrix - extract rotation from matrix
          const matrixMatch = transform.match(/matrix\(([^)]+)\)/);
          if (matrixMatch) {
            const values = matrixMatch[1].split(',').map(parseFloat);
            // matrix(a, b, c, d, e, f) where rotation = atan2(b, a)
            const matrixAngle = Math.atan2(values[1], values[0]) * (180 / Math.PI);
            angle += Math.round(matrixAngle);
          }
        }
      }

      // Normalize to 0-359 range
      angle = angle % 360;
      if (angle < 0) angle += 360;

      return angle === 0 ? null : angle;
    };

    // Get position/dimensions accounting for rotation
    const getPositionAndSize = (el, rect, rotation) => {
      if (rotation === null) {
        return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
      }

      // For 90° or 270° rotations, swap width and height
      // because PowerPoint applies rotation to the original (unrotated) box
      const isVertical = rotation === 90 || rotation === 270;

      if (isVertical) {
        // The browser shows us the rotated dimensions (tall box for vertical text)
        // But PowerPoint needs the pre-rotation dimensions (wide box that will be rotated)
        // So we swap: browser's height becomes PPT's width, browser's width becomes PPT's height
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        return {
          x: centerX - rect.height / 2,
          y: centerY - rect.width / 2,
          w: rect.height,
          h: rect.width
        };
      }

      // For other rotations, use element's offset dimensions
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      return {
        x: centerX - el.offsetWidth / 2,
        y: centerY - el.offsetHeight / 2,
        w: el.offsetWidth,
        h: el.offsetHeight
      };
    };

    // Parse CSS box-shadow into PptxGenJS shadow properties
    const parseBoxShadow = (boxShadow) => {
      if (!boxShadow || boxShadow === 'none') return null;

      // Browser computed style format: "rgba(0, 0, 0, 0.3) 2px 2px 8px 0px [inset]"
      // CSS format: "[inset] 2px 2px 8px 0px rgba(0, 0, 0, 0.3)"

      const insetMatch = boxShadow.match(/inset/);

      // IMPORTANT: PptxGenJS/PowerPoint doesn't properly support inset shadows
      // Only process outer shadows to avoid file corruption
      if (insetMatch) return null;

      // Extract color first (rgba or rgb at start)
      const colorMatch = boxShadow.match(/rgba?\([^)]+\)/);

      // Extract numeric values (handles both px and pt units)
      const parts = boxShadow.match(/([-\d.]+)(px|pt)/g);

      if (!parts || parts.length < 2) return null;

      const offsetX = parseFloat(parts[0]);
      const offsetY = parseFloat(parts[1]);
      const blur = parts.length > 2 ? parseFloat(parts[2]) : 0;

      // Calculate angle from offsets (in degrees, 0 = right, 90 = down)
      let angle = 0;
      if (offsetX !== 0 || offsetY !== 0) {
        angle = Math.atan2(offsetY, offsetX) * (180 / Math.PI);
        if (angle < 0) angle += 360;
      }

      // Calculate offset distance (hypotenuse)
      const offset = Math.sqrt(offsetX * offsetX + offsetY * offsetY) * PT_PER_PX;

      // Extract opacity from rgba
      let opacity = 0.5;
      if (colorMatch) {
        const opacityMatch = colorMatch[0].match(/[\d.]+\)$/);
        if (opacityMatch) {
          opacity = parseFloat(opacityMatch[0].replace(')', ''));
        }
      }

      return {
        type: 'outer',
        angle: Math.round(angle),
        blur: blur * 0.75, // Convert to points
        color: colorMatch ? rgbToHex(colorMatch[0]) : '000000',
        offset: offset,
        opacity
      };
    };

    // Parse inline formatting tags (<b>, <i>, <u>, <strong>, <em>, <span>) into text runs
    const parseInlineFormatting = (element, baseOptions = {}, runs = [], baseTextTransform = (x) => x) => {
      let prevNodeIsText = false;

      element.childNodes.forEach((node) => {
        let textTransform = baseTextTransform;

        const isText = node.nodeType === Node.TEXT_NODE || node.tagName === 'BR';
        if (isText) {
          const text = node.tagName === 'BR' ? '\n' : textTransform(node.textContent.replace(/\s+/g, ' '));
          const prevRun = runs[runs.length - 1];
          if (prevNodeIsText && prevRun) {
            prevRun.text += text;
          } else {
            runs.push({ text, options: { ...baseOptions } });
          }

        } else if (node.nodeType === Node.ELEMENT_NODE && node.textContent.trim()) {
          const options = { ...baseOptions };
          const computed = window.getComputedStyle(node);

          // Handle inline elements with computed styles
          if (node.tagName === 'SPAN' || node.tagName === 'B' || node.tagName === 'STRONG' || node.tagName === 'I' || node.tagName === 'EM' || node.tagName === 'U') {
            const isBold = computed.fontWeight === 'bold' || parseInt(computed.fontWeight) >= 600;
            if (isBold && !shouldSkipBold(computed.fontFamily)) options.bold = true;
            if (computed.fontStyle === 'italic') options.italic = true;
            if (computed.textDecoration && computed.textDecoration.includes('underline')) options.underline = true;
            if (computed.color && computed.color !== 'rgb(0, 0, 0)') {
              options.color = rgbToHex(computed.color);
              const transparency = extractAlpha(computed.color);
              if (transparency !== null) options.transparency = transparency;
            }
            if (computed.fontSize) options.fontSize = pxToPoints(computed.fontSize);

            // Apply text-transform on the span element itself
            if (computed.textTransform && computed.textTransform !== 'none') {
              const transformStr = computed.textTransform;
              textTransform = (text) => applyTextTransform(text, transformStr);
            }

            // Validate: Check for margins on inline elements
            if (computed.marginLeft && parseFloat(computed.marginLeft) > 0) {
              errors.push(`Inline element <${node.tagName.toLowerCase()}> has margin-left which is not supported in PowerPoint. Remove margin from inline elements.`);
            }
            if (computed.marginRight && parseFloat(computed.marginRight) > 0) {
              errors.push(`Inline element <${node.tagName.toLowerCase()}> has margin-right which is not supported in PowerPoint. Remove margin from inline elements.`);
            }
            if (computed.marginTop && parseFloat(computed.marginTop) > 0) {
              errors.push(`Inline element <${node.tagName.toLowerCase()}> has margin-top which is not supported in PowerPoint. Remove margin from inline elements.`);
            }
            if (computed.marginBottom && parseFloat(computed.marginBottom) > 0) {
              errors.push(`Inline element <${node.tagName.toLowerCase()}> has margin-bottom which is not supported in PowerPoint. Remove margin from inline elements.`);
            }

            // Recursively process the child node. This will flatten nested spans into multiple runs.
            parseInlineFormatting(node, options, runs, textTransform);
          }
        }

        prevNodeIsText = isText;
      });

      // Trim leading space from first run and trailing space from last run
      if (runs.length > 0) {
        runs[0].text = runs[0].text.replace(/^\s+/, '');
        runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, '');
      }

      return runs.filter(r => r.text.length > 0);
    };

    // Extract background from body (image or color)
    const body = document.body;
    const bodyStyle = window.getComputedStyle(body);
    const bgImage = bodyStyle.backgroundImage;
    const bgColor = bodyStyle.backgroundColor;

    // Collect validation errors
    const errors = [];
    const contrastWarnings = [];

    // Resolve effective background color by walking up the DOM tree
    const resolveBackground = (el) => {
      let node = el.parentElement;
      while (node && node !== document.body) {
        const bg = window.getComputedStyle(node).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return rgbToHex(bg);
        node = node.parentElement;
      }
      return background.type === 'color' ? background.value : 'FFFFFF';
    };

    // Check text-background contrast and record warnings
    const checkContrast = (tagName, textSnippet, textColor, bgColor) => {
      const ratio = wcagContrast(textColor, bgColor);
      if (ratio < 4.5) {
        // White-on-white (ratio 1.0) where bg resolved to default FFFFFF is likely a false positive:
        // the text is probably on an image/overlay background that we can't detect via CSS ancestry.
        // Downgrade to WARN to avoid blocking the build.
        const isFallbackFP = ratio < 1.05 && textColor === 'FFFFFF' && bgColor === 'FFFFFF';
        const level = (ratio < 1.5 && !isFallbackFP) ? 'ERROR' : 'WARN';
        contrastWarnings.push({
          level,
          tag: tagName,
          text: textSnippet.substring(0, 40) + (textSnippet.length > 40 ? '...' : ''),
          textColor: '#' + textColor,
          bgColor: '#' + bgColor,
          ratio: ratio.toFixed(2)
        });
      }
    };

    // Validate: Check for CSS gradients
    if (bgImage && (bgImage.includes('linear-gradient') || bgImage.includes('radial-gradient'))) {
      errors.push(
        'CSS gradients are not supported. Use Sharp to rasterize gradients as PNG images first, ' +
        'then reference with background-image: url(\'gradient.png\')'
      );
    }

    let background;
    if (bgImage && bgImage !== 'none') {
      // Extract URL from url("...") or url(...)
      const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
      if (urlMatch) {
        background = {
          type: 'image',
          path: urlMatch[1]
        };
      } else {
        background = {
          type: 'color',
          value: rgbToHex(bgColor)
        };
      }
    } else {
      background = {
        type: 'color',
        value: rgbToHex(bgColor)
      };
    }

    // Process all elements
    const elements = [];
    const placeholders = [];
    const textTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI'];
    const processed = new Set();

    document.querySelectorAll('*').forEach((el) => {
      if (processed.has(el)) return;

      // Validate text elements don't have backgrounds, borders, or shadows
      if (textTags.includes(el.tagName)) {
        const computed = window.getComputedStyle(el);
        const hasBg = computed.backgroundColor && computed.backgroundColor !== 'rgba(0, 0, 0, 0)';
        const hasBorder = (computed.borderWidth && parseFloat(computed.borderWidth) > 0) ||
                          (computed.borderTopWidth && parseFloat(computed.borderTopWidth) > 0) ||
                          (computed.borderRightWidth && parseFloat(computed.borderRightWidth) > 0) ||
                          (computed.borderBottomWidth && parseFloat(computed.borderBottomWidth) > 0) ||
                          (computed.borderLeftWidth && parseFloat(computed.borderLeftWidth) > 0);
        const hasShadow = computed.boxShadow && computed.boxShadow !== 'none';

        if (hasBg || hasBorder || hasShadow) {
          errors.push(
            `Text element <${el.tagName.toLowerCase()}> has ${hasBg ? 'background' : hasBorder ? 'border' : 'shadow'}. ` +
            'Backgrounds, borders, and shadows are only supported on <div> elements, not text elements.'
          );
          return;
        }
      }

      // Extract placeholder elements (for charts, etc.)
      if (el.className && el.className.includes('placeholder')) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          errors.push(
            `Placeholder "${el.id || 'unnamed'}" has ${rect.width === 0 ? 'width: 0' : 'height: 0'}. Check the layout CSS.`
          );
        } else {
          placeholders.push({
            id: el.id || `placeholder-${placeholders.length}`,
            x: pxToInch(rect.left),
            y: pxToInch(rect.top),
            w: pxToInch(rect.width),
            h: pxToInch(rect.height)
          });
        }
        processed.add(el);
        return;
      }

      // Extract images
      if (el.tagName === 'IMG') {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          elements.push({
            type: 'image',
            src: el.src,
            position: {
              x: pxToInch(rect.left),
              y: pxToInch(rect.top),
              w: pxToInch(rect.width),
              h: pxToInch(rect.height)
            }
          });
          processed.add(el);
          return;
        }
      }

      // Extract DIVs with backgrounds/borders as shapes
      const isContainer = el.tagName === 'DIV' && !textTags.includes(el.tagName);
      if (isContainer) {
        const computed = window.getComputedStyle(el);
        let hasBg = computed.backgroundColor && computed.backgroundColor !== 'rgba(0, 0, 0, 0)';

        const hasBlockChildren = Array.from(el.querySelectorAll(textTags.join(', '))).length > 0;
        const actsAsText = !hasBlockChildren && el.textContent.trim() !== '';

        // Validate: Check for unwrapped text content in DIV
        if (!actsAsText) {
          for (const node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
              const text = node.textContent.trim();
              if (text) {
                errors.push(
                  `DIV element contains unwrapped text "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}". ` +
                  'All text must be wrapped in <p>, <h1>-<h6>, <ul>, or <ol> tags to appear in PowerPoint.'
                );
              }
            }
          }
        }

        // Check for background images on shapes
        const bgImage = computed.backgroundImage;

        // Gradient fallback: extract first color as solid fill (gradients can't be rendered in PPTX)
        // Supports rgb(), rgba(), #hex, hsl(), and named colors
        if (bgImage && bgImage !== 'none' && (bgImage.includes('linear-gradient') || bgImage.includes('radial-gradient'))) {
          let fallbackRgb = null;

          // Try rgba() first (browser computed style format)
          const rgbaMatch = bgImage.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
          if (rgbaMatch) {
            fallbackRgb = `rgb(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]})`;
          }

          // Try #hex format (from raw CSS)
          if (!fallbackRgb) {
            const hexMatch = bgImage.match(/#([0-9a-fA-F]{3,8})\b/);
            if (hexMatch) {
              let hex = hexMatch[1];
              if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
              if (hex.length >= 6) {
                const r = parseInt(hex.slice(0,2),16);
                const g = parseInt(hex.slice(2,4),16);
                const b = parseInt(hex.slice(4,6),16);
                fallbackRgb = `rgb(${r}, ${g}, ${b})`;
              }
            }
          }

          // Try hsl() format
          if (!fallbackRgb) {
            const hslMatch = bgImage.match(/hsla?\(\s*([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%/);
            if (hslMatch) {
              const h = parseFloat(hslMatch[1]) / 360;
              const s = parseFloat(hslMatch[2]) / 100;
              const l = parseFloat(hslMatch[3]) / 100;
              const hue2rgb = (p, q, t) => {
                if (t < 0) t += 1; if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
              };
              const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
              const p = 2 * l - q;
              const r = Math.round(hue2rgb(p, q, h + 1/3) * 255);
              const g = Math.round(hue2rgb(p, q, h) * 255);
              const b = Math.round(hue2rgb(p, q, h - 1/3) * 255);
              fallbackRgb = `rgb(${r}, ${g}, ${b})`;
            }
          }

          if (fallbackRgb) {
            const fallbackHex = rgbToHex(fallbackRgb);
            el.style.backgroundColor = fallbackRgb;
            console.warn(`  ⚠️  CSS gradient → solid fill #${fallbackHex} (PPTX does not support CSS gradients)`);
          } else {
            console.warn('  ⚠️  CSS gradient detected but could not extract color — shape may have no background');
          }
          // Re-read hasBg after override
          const recomputed = window.getComputedStyle(el);
          hasBg = recomputed.backgroundColor && recomputed.backgroundColor !== 'rgba(0, 0, 0, 0)';
        }

        if (bgImage && bgImage !== 'none' && bgImage.includes('url(')) {
          errors.push(
            'Background images on DIV elements are not supported. ' +
            'Use solid colors or borders for shapes, or use slide.addImage() in PptxGenJS to layer images.'
          );
          return;
        }

        // Check for borders - both uniform and partial
        const borderTop = computed.borderTopWidth;
        const borderRight = computed.borderRightWidth;
        const borderBottom = computed.borderBottomWidth;
        const borderLeft = computed.borderLeftWidth;
        const borders = [borderTop, borderRight, borderBottom, borderLeft].map(b => parseFloat(b) || 0);
        const hasBorder = borders.some(b => b > 0);
        const hasUniformBorder = hasBorder && borders.every(b => b === borders[0]);
        const borderLines = [];

        if (hasBorder && !hasUniformBorder) {
          const rect = el.getBoundingClientRect();
          const x = pxToInch(rect.left);
          const y = pxToInch(rect.top);
          const w = pxToInch(rect.width);
          const h = pxToInch(rect.height);

          // Collect lines to add after shape (inset by half the line width to center on edge)
          if (parseFloat(borderTop) > 0) {
            const widthPt = pxToPoints(borderTop);
            const inset = (widthPt / 72) / 2; // Convert points to inches, then half
            borderLines.push({
              type: 'line',
              x1: x, y1: y + inset, x2: x + w, y2: y + inset,
              width: widthPt,
              color: rgbToHex(computed.borderTopColor)
            });
          }
          if (parseFloat(borderRight) > 0) {
            const widthPt = pxToPoints(borderRight);
            const inset = (widthPt / 72) / 2;
            borderLines.push({
              type: 'line',
              x1: x + w - inset, y1: y, x2: x + w - inset, y2: y + h,
              width: widthPt,
              color: rgbToHex(computed.borderRightColor)
            });
          }
          if (parseFloat(borderBottom) > 0) {
            const widthPt = pxToPoints(borderBottom);
            const inset = (widthPt / 72) / 2;
            borderLines.push({
              type: 'line',
              x1: x, y1: y + h - inset, x2: x + w, y2: y + h - inset,
              width: widthPt,
              color: rgbToHex(computed.borderBottomColor)
            });
          }
          if (parseFloat(borderLeft) > 0) {
            const widthPt = pxToPoints(borderLeft);
            const inset = (widthPt / 72) / 2;
            borderLines.push({
              type: 'line',
              x1: x + inset, y1: y, x2: x + inset, y2: y + h,
              width: widthPt,
              color: rgbToHex(computed.borderLeftColor)
            });
          }
        }

        if (hasBg || hasBorder || actsAsText) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const shadow = parseBoxShadow(computed.boxShadow);

            // Check if this is a leaf div (no block children) with text content
            // If so, embed text inside the shape instead of creating empty shape
            let shapeText = '';
            let shapeAlign = 'left';
            let shapeValign = 'top';
            let shapeMargin = [0, 0, 0, 0];
            const textContent = el.textContent.trim();
            const hasBlockChild = el.querySelector(BLOCK_CHILD_SELECTOR);

            if (textContent && !hasBlockChild) {
              // Leaf div with background — extract text with formatting
              // Extract text honoring spans and multi-colored children
              const isBold = parseInt(computed.fontWeight) >= 600 && !shouldSkipBold(computed.fontFamily);
              const baseRunOptions = {
                fontSize: pxToPoints(computed.fontSize),
                fontFace: computed.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
                color: rgbToHex(computed.color),
                bold: isBold,
                italic: computed.fontStyle === 'italic',
                breakLine: false
              };
              shapeText = parseInlineFormatting(el, baseRunOptions);
              
              // Detect alignment from flex or text-align
              const justifyContent = computed.justifyContent;
              const alignItems = computed.alignItems;
              shapeAlign = (justifyContent === 'center' || computed.textAlign === 'center') ? 'center' :
                           (justifyContent === 'flex-end' || computed.textAlign === 'right') ? 'right' : 'left';
              shapeValign = (alignItems === 'center') ? 'middle' : 'top';
              
              // Extract padding to use as shape inner margin
              // IMPORTANT: PptxGenJS shape margin array resolves to [Left, Top, Right, Bottom] implicitly!
              shapeMargin = [
                pxToPoints(computed.paddingLeft),
                pxToPoints(computed.paddingTop),
                pxToPoints(computed.paddingRight),
                pxToPoints(computed.paddingBottom)
              ];

              const shapeFillColor = hasBg ? rgbToHex(computed.backgroundColor) : resolveBackground(el);
              if (shapeText.length > 0 && shapeText[0].options && shapeText[0].options.color) {
                  // WCAG contrast check on first text run just to be safe
                  checkContrast('div(shape)', textContent, shapeText[0].options.color, shapeFillColor);
              }

              // Extract line-height
              const rawLineHeight = computed.lineHeight;
              const calcLineHeight = rawLineHeight === 'normal' ? pxToPoints(computed.fontSize) * 1.2 : pxToPoints(rawLineHeight);
              el.dataset.shapeLineSpacing = calcLineHeight;

              // Mark all children as processed to prevent double-rendering
              el.querySelectorAll('*').forEach(child => processed.add(child));
            }

            // Only add shape if there's background or uniform border, or if it acts as text
            if (hasBg || hasUniformBorder || actsAsText) {
              elements.push({
                type: 'shape',
                text: shapeText || '',
                position: {
                  x: pxToInch(rect.left),
                  y: pxToInch(rect.top),
                  w: pxToInch(rect.width),
                  h: pxToInch(rect.height)
                },
                shape: {
                  fill: hasBg ? rgbToHex(computed.backgroundColor) : null,
                  transparency: hasBg ? extractAlpha(computed.backgroundColor) : null,
                  line: hasUniformBorder ? {
                    color: rgbToHex(computed.borderColor),
                    width: pxToPoints(computed.borderWidth)
                  } : null,
                  // Convert border-radius to rectRadius (in inches)
                  rectRadius: (() => {
                    const radius = computed.borderRadius;
                    const radiusValue = parseFloat(radius);
                    if (radiusValue === 0) return 0;

                    if (radius.includes('%')) {
                      if (radiusValue >= 50) return 1;
                      const minDim = Math.min(rect.width, rect.height);
                      return (radiusValue / 100) * pxToInch(minDim);
                    }

                    if (radius.includes('pt')) return radiusValue / 72;
                    return radiusValue / PX_PER_IN;
                  })(),
                  shadow: shadow,
                  textAlign: shapeAlign,
                  textValign: shapeValign,
                  margin: shapeMargin,
                  lineSpacing: el.dataset.shapeLineSpacing ? parseFloat(el.dataset.shapeLineSpacing) : undefined
                }
              });
            }

            // Add partial border lines
            elements.push(...borderLines);

            processed.add(el);
            return;
          }
        }
      }

      // Extract bullet lists as single text block
      if (el.tagName === 'UL' || el.tagName === 'OL') {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const liElements = Array.from(el.querySelectorAll('li'));
        const items = [];
        const ulComputed = window.getComputedStyle(el);
        const ulPaddingLeftPt = pxToPoints(ulComputed.paddingLeft);

        // Split: margin-left for bullet position, indent for text position
        // margin-left + indent = ul padding-left
        const marginLeft = ulPaddingLeftPt * 0.5;
        const textIndent = ulPaddingLeftPt * 0.5;

        liElements.forEach((li, idx) => {
          const isLast = idx === liElements.length - 1;
          const runs = parseInlineFormatting(li, { breakLine: false });
          // Clean manual bullets from first run
          if (runs.length > 0) {
            runs[0].text = runs[0].text.replace(/^[•\-\*▪▸]\s*/, '');
            runs[0].options.bullet = { indent: textIndent };
          }
          // Set breakLine on last run
          if (runs.length > 0 && !isLast) {
            runs[runs.length - 1].options.breakLine = true;
          }
          items.push(...runs);
        });

        const computed = window.getComputedStyle(liElements[0] || el);

        // WCAG contrast check for list text
        const listBgColor = resolveBackground(el);
        checkContrast('ul/ol', el.textContent.trim(), rgbToHex(computed.color), listBgColor);

        elements.push({
          type: 'list',
          items: items,
          position: {
            x: pxToInch(rect.left),
            y: pxToInch(rect.top),
            w: pxToInch(rect.width),
            h: pxToInch(rect.height)
          },
          style: {
            fontSize: pxToPoints(computed.fontSize),
            fontFace: computed.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
            color: rgbToHex(computed.color),
            transparency: extractAlpha(computed.color),
            align: computed.textAlign === 'start' ? 'left' : computed.textAlign,
            lineSpacing: computed.lineHeight && computed.lineHeight !== 'normal' ? pxToPoints(computed.lineHeight) : null,
            paraSpaceBefore: 0,
            paraSpaceAfter: pxToPoints(computed.marginBottom),
            // PptxGenJS margin array is [left, right, bottom, top]
            margin: [marginLeft, 0, 0, 0]
          }
        });

        liElements.forEach(li => processed.add(li));
        processed.add(el);
        return;
      }

      // Extract text elements (P, H1, H2, etc.)
      // Also handle leaf DIVs that contain only inline content (text, span, b, i, etc.)
      if (!textTags.includes(el.tagName)) {
        if (el.tagName === 'DIV') {
          const text = el.textContent.trim();
          const hasBlockChild = el.querySelector('div, p, h1, h2, h3, h4, h5, h6, ul, ol, li, table, img, svg, canvas');
          if (text && !hasBlockChild) {
            // This is a leaf text DIV — treat as paragraph below
          } else {
            return;
          }
        } else {
          return;
        }
      }

      const rect = el.getBoundingClientRect();
      const text = el.textContent.trim();
      if (rect.width === 0 || rect.height === 0 || !text) return;

      // Validate: Check for manual bullet symbols in text elements (not in lists)
      if (el.tagName !== 'LI' && /^[•\-\*▪▸○●◆◇■□]\s/.test(text.trimStart())) {
        errors.push(
          `Text element <${el.tagName.toLowerCase()}> starts with bullet symbol "${text.substring(0, 20)}...". ` +
          'Use <ul> or <ol> lists instead of manual bullet symbols.'
        );
        return;
      }

      const computed = window.getComputedStyle(el);
      const rotation = getRotation(computed.transform, computed.writingMode);
      const { x, y, w, h } = getPositionAndSize(el, rect, rotation);

      const baseStyle = {
        fontSize: pxToPoints(computed.fontSize),
        fontFace: computed.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
        color: rgbToHex(computed.color),
        align: computed.textAlign === 'start' ? 'left' : computed.textAlign,
        lineSpacing: pxToPoints(computed.lineHeight),
        paraSpaceBefore: pxToPoints(computed.marginTop),
        paraSpaceAfter: pxToPoints(computed.marginBottom),
        // PptxGenJS margin array is [left, right, bottom, top] (not [top, right, bottom, left] as documented)
        margin: [
          pxToPoints(computed.paddingLeft),
          pxToPoints(computed.paddingRight),
          pxToPoints(computed.paddingBottom),
          pxToPoints(computed.paddingTop)
        ]
      };

      const transparency = extractAlpha(computed.color);
      if (transparency !== null) baseStyle.transparency = transparency;

      if (rotation !== null) baseStyle.rotate = rotation;

      // WCAG contrast check for text elements (P, H1-H6, leaf DIV)
      const textBgColor = resolveBackground(el);
      checkContrast(el.tagName.toLowerCase(), text, rgbToHex(computed.color), textBgColor);

      const hasFormatting = el.querySelector('b, i, u, strong, em, span, br');

      if (hasFormatting) {
        // Text with inline formatting
        const transformStr = computed.textTransform;
        const runs = parseInlineFormatting(el, {}, [], (str) => applyTextTransform(str, transformStr));

        // Adjust lineSpacing based on largest fontSize in runs
        const adjustedStyle = { ...baseStyle };
        if (adjustedStyle.lineSpacing) {
          const maxFontSize = Math.max(
            adjustedStyle.fontSize,
            ...runs.map(r => r.options?.fontSize || 0)
          );
          if (maxFontSize > adjustedStyle.fontSize) {
            const lineHeightMultiplier = adjustedStyle.lineSpacing / adjustedStyle.fontSize;
            adjustedStyle.lineSpacing = maxFontSize * lineHeightMultiplier;
          }
        }

        elements.push({
          type: el.tagName.toLowerCase(),
          text: runs,
          position: { x: pxToInch(x), y: pxToInch(y), w: pxToInch(w), h: pxToInch(h) },
          style: adjustedStyle
        });
      } else {
        // Plain text - inherit CSS formatting
        const textTransform = computed.textTransform;
        const transformedText = applyTextTransform(text, textTransform);

        const isBold = computed.fontWeight === 'bold' || parseInt(computed.fontWeight) >= 600;

        elements.push({
          type: el.tagName.toLowerCase(),
          text: transformedText,
          position: { x: pxToInch(x), y: pxToInch(y), w: pxToInch(w), h: pxToInch(h) },
          style: {
            ...baseStyle,
            bold: isBold && !shouldSkipBold(computed.fontFamily),
            italic: computed.fontStyle === 'italic',
            underline: computed.textDecoration.includes('underline')
          }
        });
      }

      processed.add(el);
    });

    return { background, elements, placeholders, errors, contrastWarnings };
  });
}

async function html2pptx(htmlFile, pres, options = {}) {
  const {
    tmpDir = process.env.TMPDIR || '/tmp',
    slide = null
  } = options;

  try {
    const browser = await launchBrowser(tmpDir);

    let bodyDimensions;
    let slideData;

    const filePath = path.isAbsolute(htmlFile) ? htmlFile : path.join(process.cwd(), htmlFile);
    const validationErrors = [];

    try {
      const page = await browser.newPage();
      page.on('console', (msg) => {
        // Log the message text to your test runner's console
        console.log(`Browser console: ${msg.text()}`);
      });

      await page.goto(`file://${filePath}`);
      await waitForDynamicLibraryRender(page);
      await rasterizeDynamicVisuals(page);

      bodyDimensions = await getBodyDimensions(page);

      await page.setViewportSize({
        width: Math.round(bodyDimensions.width),
        height: Math.round(bodyDimensions.height)
      });

      slideData = await extractSlideData(page);
    } finally {
      await browser.close();
    }

    // Collect all validation errors
    if (bodyDimensions.errors && bodyDimensions.errors.length > 0) {
      validationErrors.push(...bodyDimensions.errors);
    }

    const dimensionErrors = validateDimensions(bodyDimensions, pres);
    if (dimensionErrors.length > 0) {
      validationErrors.push(...dimensionErrors);
    }

    const textBoxPositionErrors = validateTextBoxPosition(slideData, bodyDimensions);
    if (textBoxPositionErrors.length > 0) {
      validationErrors.push(...textBoxPositionErrors);
    }

    if (slideData.errors && slideData.errors.length > 0) {
      validationErrors.push(...slideData.errors);
    }

    // Log contrast warnings
    const contrastWarnings = slideData.contrastWarnings || [];
    if (contrastWarnings.length > 0) {
      for (const w of contrastWarnings) {
        const prefix = w.level === 'ERROR' ? '⚠️  CONTRAST ERROR' : '⚠️  CONTRAST WARN';
        console.warn(`  ${prefix}: <${w.tag}> "${w.text}" — ${w.textColor} on ${w.bgColor} (ratio ${w.ratio}:1)`);
      }
    }

    // Throw all errors at once if any exist
    if (validationErrors.length > 0) {
      const errorMessage = validationErrors.length === 1
        ? validationErrors[0]
        : `Multiple validation errors found:\n${validationErrors.map((e, i) => `  ${i + 1}. ${e}`).join('\n')}`;
      throw new Error(errorMessage);
    }

    const targetSlide = slide || pres.addSlide();

    await addBackground(slideData, targetSlide, tmpDir);
    addElements(slideData, targetSlide, pres);

    return { slide: targetSlide, placeholders: slideData.placeholders, contrastWarnings };
  } catch (error) {
    if (!error.message.startsWith(htmlFile)) {
      throw new Error(`${htmlFile}: ${error.message}`);
    }
    throw error;
  }
}

module.exports = html2pptx;
