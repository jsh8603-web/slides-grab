/**
 * HTML Pre-flight Validator — checks slide HTML files for known anti-patterns
 * BEFORE PPTX conversion.
 *
 * Usage:
 *   node scripts/preflight-html.js --slides-dir slides/presentation-name
 *   node scripts/preflight-html.js --slides-dir slides/presentation-name --full
 *   node scripts/preflight-html.js --slides-dir slides/presentation-name --full --summary
 *
 * Phase 1 (default): Static regex/string checks — fast, no browser.
 * Phase 2 (--full):  Playwright checks for overflow and CJK font-size.
 */

import fs from 'fs';
import path from 'path';

// ── ANSI helpers ──────────────────────────────────────────────────────────────

const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function fmtError(file, id, msg) {
  return `${RED}${BOLD}\u274c ERROR${RESET} ${RED}[${file}] ${id}: ${msg}${RESET}`;
}
function fmtWarn(file, id, msg) {
  return `${YELLOW}\u26a0\ufe0f  WARN ${RESET} ${YELLOW}[${file}] ${id}: ${msg}${RESET}`;
}

// ── Luminance helper ──────────────────────────────────────────────────────────

function hexToRgb(hex) {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  if (hex.length !== 6) return null;
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/** Returns true if a CSS color string is "bright" (luminance > 0.8). */
function isBrightColor(colorStr) {
  if (!colorStr) return false;
  const s = colorStr.trim().toLowerCase();
  // #fff / #ffffff / #FFF
  const hexMatch = s.match(/^#([0-9a-f]{3,6})$/i);
  if (hexMatch) {
    const rgb = hexToRgb(hexMatch[1]);
    return rgb ? relativeLuminance(...rgb) > 0.8 : false;
  }
  // rgb(r, g, b) or rgba(r, g, b, a)
  const rgbMatch = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch.map(Number);
    return relativeLuminance(r, g, b) > 0.8;
  }
  if (s === 'white') return true;
  return false;
}

// ── CJK detection ─────────────────────────────────────────────────────────────

const CJK_RE = /[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;
const FLAG_EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;

// ── Static checks (Phase 1) ──────────────────────────────────────────────────

function checkPF01(html, file) {
  // linear-gradient + bright text child
  const issues = [];
  // Find style blocks that contain gradient AND color
  // Strategy: find elements whose inline style has gradient bg, then look for color on same or child
  const gradientDivRe = /style="[^"]*(?:background(?:-image)?\s*:\s*[^"]*(?:linear|radial)-gradient)[^"]*"/gi;
  let m;
  while ((m = gradientDivRe.exec(html)) !== null) {
    const styleStr = m[0];
    // Grab surrounding context (~500 chars after) to find child text colors
    const after = html.substring(m.index, m.index + 800);
    // Check for color declarations in that region
    const colorMatches = after.matchAll(/color\s*:\s*([^;"'\s]+(?:\([^)]*\))?)/gi);
    for (const cm of colorMatches) {
      // Skip background-color
      const preceding = after.substring(0, cm.index);
      if (/background-?\s*$/i.test(preceding)) continue;
      if (isBrightColor(cm[1])) {
        issues.push(fmtError(file, 'PF-01',
          'linear-gradient with white/bright text \u2014 text will be invisible in PPTX'));
        return issues; // one per file is enough
      }
    }
  }
  return issues;
}

function checkPF02(html, file) {
  const issues = [];
  // Find flex:1 or flex: 1 in inline styles, then check if box-sizing: border-box is absent
  const flexOneRe = /style="([^"]*)"/gi;
  let m;
  while ((m = flexOneRe.exec(html)) !== null) {
    const style = m[1];
    if (/flex\s*:\s*1(?:\s|;|$)/.test(style) && !/box-sizing\s*:\s*border-box/i.test(style)) {
      issues.push(fmtWarn(file, 'PF-02',
        'flex:1 div without box-sizing:border-box \u2014 may cause overflow'));
      return issues; // one per file
    }
  }
  return issues;
}

function checkPF04(html, file) {
  const issues = [];
  // <img with height:100% but no max-height
  const imgRe = /<img\s[^>]*style="([^"]*)"/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    const style = m[1];
    if (/height\s*:\s*100%/i.test(style) && !/max-height/i.test(style)) {
      issues.push(fmtWarn(file, 'PF-04',
        'img with height:100% without max-height \u2014 may overflow 0.5" bottom margin'));
      break;
    }
  }
  return issues;
}

function checkPF05(html, file) {
  const issues = [];
  // Non-body DIV with background: url() or background-image: url()
  // Skip <body ...> lines. Look for <div with url() in background.
  const divBgRe = /<div\s[^>]*style="[^"]*background(?:-image)?\s*:\s*[^"]*url\s*\(/gi;
  if (divBgRe.test(html)) {
    issues.push(fmtError(file, 'PF-05',
      'non-body div with background url() \u2014 may fail in html2pptx conversion'));
  }
  return issues;
}

function checkPF06(html, file) {
  const issues = [];
  // Flex container with <img> child but missing overflow:hidden
  // Heuristic: find display:flex divs, check if they contain <img, and lack overflow:hidden
  const flexDivRe = /<div\s[^>]*style="([^"]*display\s*:\s*flex[^"]*)"/gi;
  let m;
  while ((m = flexDivRe.exec(html)) !== null) {
    const style = m[1];
    const afterDiv = html.substring(m.index, m.index + 1500);
    // Check if there's an <img within the next ~1500 chars (same container)
    if (/<img\s/i.test(afterDiv) && !/overflow\s*:\s*hidden/i.test(style)) {
      issues.push(fmtWarn(file, 'PF-06',
        'flex container with img child missing overflow:hidden \u2014 image may overflow'));
      return issues; // one per file
    }
  }
  return issues;
}

function checkPF07(html, file) {
  const issues = [];
  // <p>, <h1>-<h6>, <li> with background or border in inline style
  const tagRe = /<(p|h[1-6]|li)\s[^>]*style="([^"]*)"/gi;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    const style = m[2];
    if (/(?:^|;\s*)(?:background|border)\s*:/i.test(style)) {
      issues.push(fmtError(file, 'PF-07',
        `<${tag}> with background/border style \u2014 wrap in <div> for html2pptx`));
    }
  }
  return issues;
}

function checkPF12(html, file) {
  const issues = [];
  for (const m of html.matchAll(FLAG_EMOJI_RE)) {
    issues.push(fmtError(file, 'PF-12',
      `Flag emoji "${m[0]}" found — PowerPoint renders as text codes. Use <img> PNG instead [IL-26]`));
  }
  return issues;
}

function checkPF13(html, file) {
  const issues = [];
  // IL-25: border-radius: 50% + border combo (donut/circle chart trick)
  const styleRe = /style="([^"]*)"/gi;
  let m;
  while ((m = styleRe.exec(html)) !== null) {
    const style = m[1];
    if (/border-radius\s*:\s*50%/i.test(style) && /(?:^|;\s*)border\s*:/i.test(style)) {
      issues.push(fmtError(file, 'PF-13',
        'border-radius:50% + border combo — renders as roundRect in PPTX, use PNG image instead [IL-25]'));
      return issues; // one per file
    }
  }
  return issues;
}

function checkPF14(html, file) {
  const issues = [];
  // IL-24: <div> with background child div followed by direct sibling <span>
  // Problematic: <div><div style="background:..."></div><span>text</span></div>
  // Safe: <div><div style="background:..."></div><p><span>text</span></p></div>
  // Detect: </div> followed by whitespace then <span> (not inside <p>)
  const patternRe = /<div\s[^>]*style="[^"]*background[^"]*"[^>]*>\s*<\/div>\s*<span[\s>]/gi;
  if (patternRe.test(html)) {
    issues.push(fmtWarn(file, 'PF-14',
      'Background div followed by sibling <span> — span text will be lost in PPTX, use <p> instead [IL-24]'));
  }
  return issues;
}

function checkPF15(html, file) {
  const issues = [];
  // IL-27: 3+ column CSS grid with CJK text > 7.5pt
  const gridRe = /style="([^"]*grid-template-columns\s*:[^"]*)"/gi;
  let m;
  while ((m = gridRe.exec(html)) !== null) {
    const style = m[1];
    // Count columns: split grid-template-columns value by whitespace tokens
    const colMatch = style.match(/grid-template-columns\s*:\s*([^;"]+)/i);
    if (!colMatch) continue;
    const colTokens = colMatch[1].trim().split(/\s+/).filter(t => t && !t.startsWith('/'));
    if (colTokens.length < 3) continue;

    // Check surrounding context (~2000 chars) for CJK text with font-size > 7.5pt
    const afterIdx = m.index;
    const region = html.substring(afterIdx, afterIdx + 3000);
    if (!CJK_RE.test(region)) continue;

    // Look for font-size declarations in this region
    const fontSizeRe = /font-size\s*:\s*([\d.]+)\s*pt/gi;
    let fs;
    while ((fs = fontSizeRe.exec(region)) !== null) {
      const size = parseFloat(fs[1]);
      if (size > 7.5 && CJK_RE.test(region.substring(fs.index, fs.index + 500))) {
        issues.push(fmtWarn(file, 'PF-15',
          `${colTokens.length}-column grid with CJK text at ${size}pt (>7.5pt) — may overflow in PPTX [IL-27]`));
        return issues; // one per file
      }
    }
  }
  return issues;
}

function checkPF16(html, file) {
  const issues = [];
  // IL-07: background image on body without text-shadow on text elements
  const bodyBgRe = /<body[^>]*style="[^"]*background[^"]*url\s*\(/i;
  if (!bodyBgRe.test(html)) return issues;

  // Body has background image — check if text elements have text-shadow
  // Look for text-bearing elements (h1-h6, p, span, div with text) without text-shadow
  const textElRe = /<(h[1-6]|p)\s[^>]*style="([^"]*)"/gi;
  let m;
  let hasTextWithoutShadow = false;
  while ((m = textElRe.exec(html)) !== null) {
    const style = m[2];
    if (!/text-shadow/i.test(style)) {
      hasTextWithoutShadow = true;
      break;
    }
  }
  if (hasTextWithoutShadow) {
    issues.push(fmtWarn(file, 'PF-16',
      'Background image slide has text elements without text-shadow — readability issue in PPTX [IL-07]'));
  }
  return issues;
}

function checkPF17(html, file) {
  const issues = [];
  // Unsupported CSS transforms (scale, skew, perspective — only rotate is supported)
  const transformRe = /transform\s*:\s*([^;"]+)/gi;
  let m;
  while ((m = transformRe.exec(html)) !== null) {
    const val = m[1];
    // Check for unsupported transform functions (translate is OK — used for centering)
    if (/(?:scale|skew|perspective|matrix)\s*\(/i.test(val)) {
      const fnMatch = val.match(/(scale|skew|perspective|matrix)\s*\(/i);
      issues.push(fmtWarn(file, 'PF-17',
        `Unsupported CSS transform "${fnMatch[1]}()" — only rotate is supported in PPTX conversion`));
      return issues; // one per file
    }
  }
  return issues;
}

// Allowed fonts that are available in PowerPoint or embedded
const ALLOWED_FONTS = new Set([
  'pretendard', 'segoe ui', 'arial', 'helvetica', 'sans-serif', 'serif',
  'times new roman', 'courier new', 'monospace', 'calibri', 'cambria',
  'noto sans kr', 'noto sans', 'malgun gothic', 'gulim', 'dotum',
  'biz udpgothic', 'meiryo', 'yu gothic', 'ms pgothic',
  'inherit', 'initial', 'unset',
  // CSS system font keywords — gracefully fall back in all environments
  '-apple-system', 'blinkmacsystemfont', 'system-ui', 'ui-sans-serif',
  'ui-serif', 'ui-monospace', 'ui-rounded',
]);

function checkPF19(html, file) {
  const issues = [];
  // Font availability: check font-family declarations against allowed list
  const fontRe = /font-family\s*:\s*([^;"]+)/gi;
  let m;
  while ((m = fontRe.exec(html)) !== null) {
    const fonts = m[1].split(',').map(f => f.trim().replace(/['"]/g, '').toLowerCase());
    for (const font of fonts) {
      if (!font || ALLOWED_FONTS.has(font)) continue;
      issues.push(fmtWarn(file, 'PF-19',
        `Font "${font}" may not be available in PowerPoint — will fallback to Arial`));
      return issues; // one per file
    }
  }
  return issues;
}

// CSS properties that html2pptx cannot convert
const UNSUPPORTED_CSS_RE = /(?:backdrop-filter|mix-blend-mode|clip-path|mask-image|filter\s*:\s*(?!none)(?:blur|brightness|contrast|grayscale|hue-rotate|invert|saturate|sepia)|writing-mode\s*:\s*vertical|animation\s*:|@keyframes)\s*/i;

function checkPF22(html, file) {
  const issues = [];
  const styleRe = /style="([^"]*)"/gi;
  let m;
  while ((m = styleRe.exec(html)) !== null) {
    const style = m[1];
    const unsupported = style.match(UNSUPPORTED_CSS_RE);
    if (unsupported) {
      const prop = unsupported[0].trim().replace(/\s*:\s*$/, '');
      issues.push(fmtWarn(file, 'PF-22',
        `Unsupported CSS property "${prop}" — will be ignored in PPTX conversion`));
      return issues; // one per file
    }
  }
  // Also check <style> blocks
  const styleBlockRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = styleBlockRe.exec(html)) !== null) {
    const block = m[1];
    const unsupported = block.match(UNSUPPORTED_CSS_RE);
    if (unsupported) {
      const prop = unsupported[0].trim().replace(/\s*:\s*$/, '');
      issues.push(fmtWarn(file, 'PF-22',
        `Unsupported CSS property "${prop}" in <style> block — will be ignored in PPTX conversion`));
      return issues;
    }
  }
  return issues;
}

function runStaticChecks(html, file) {
  return [
    ...checkPF01(html, file),
    ...checkPF02(html, file),
    ...checkPF04(html, file),
    ...checkPF05(html, file),
    ...checkPF06(html, file),
    ...checkPF07(html, file),
    ...checkPF12(html, file),
    ...checkPF13(html, file),
    ...checkPF14(html, file),
    ...checkPF15(html, file),
    ...checkPF16(html, file),
    ...checkPF17(html, file),
    ...checkPF19(html, file),
    ...checkPF22(html, file),
  ];
}

// ── Playwright checks (Phase 2) ─────────────────────────────────────────────

async function runPlaywrightChecks(slidesDir, files) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    for (const file of files) {
      const filePath = path.resolve(slidesDir, file);
      const fileUrl = `file:///${filePath.replace(/\\/g, '/')}`;
      const page = await browser.newPage({ viewport: { width: 960, height: 540 } });

      try {
        await page.goto(fileUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });

        // PF-03: overflow check
        const overflow = await page.evaluate(() => {
          const body = document.body;
          return body.scrollHeight > body.clientHeight;
        });
        if (overflow) {
          results.push(fmtError(file, 'PF-03',
            'content height exceeds 405pt (body overflow) \u2014 will be clipped in PPTX'));
        }

        // PF-08: CJK text in any element with background and font-size > 11pt (14.67px)
        // Expanded scope: scans all elements with non-transparent computed background
        const cjkIssue = await page.evaluate(() => {
          const CJK = /[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;
          const allEls = document.querySelectorAll('*');
          for (const el of allEls) {
            const cs = getComputedStyle(el);
            const bg = cs.backgroundColor;
            // Skip elements without a visible background
            if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') continue;
            // Skip body element (full slide background, not a card)
            if (el.tagName === 'BODY') continue;
            const text = el.textContent || '';
            if (!CJK.test(text)) continue;
            const fontSize = parseFloat(cs.fontSize);
            // 11pt = 14.67px
            if (fontSize > 14.67) {
              return { found: true, size: Math.round(fontSize * 100) / 100 };
            }
            // Also check child elements
            for (const child of el.querySelectorAll('*')) {
              const ccs = getComputedStyle(child);
              const cfs = parseFloat(ccs.fontSize);
              if (cfs > 14.67 && CJK.test(child.textContent || '')) {
                return { found: true, size: Math.round(cfs * 100) / 100 };
              }
            }
          }
          return { found: false };
        });
        if (cjkIssue.found) {
          results.push(fmtWarn(file, 'PF-08',
            `CJK text in card at ${cjkIssue.size}px (>${Math.round(14.67)}px / 11pt) \u2014 may overflow in PPTX`));
        }
        // PF-18: Element overlap detection (text-on-text or image-on-text)
        const overlapIssue = await page.evaluate(() => {
          const textEls = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span,li,div,img'));
          const rects = textEls
            .filter(el => {
              const t = (el.textContent || '').trim();
              if (!t) return false;
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.height > 0;
            })
            .map(el => {
              const r = el.getBoundingClientRect();
              const ownText = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
              return { tag: el.tagName, left: r.left, top: r.top, right: r.right, bottom: r.bottom, area: r.width * r.height, ownText };
            })
            // Filter to elements with their own text content (not just inherited)
            .filter(r => r.ownText.length > 0 || ['IMG', 'DIV'].includes(r.tag));

          // Check pairwise overlaps (limit to first 50 elements for performance)
          const check = rects.slice(0, 50);
          for (let i = 0; i < check.length; i++) {
            for (let j = i + 1; j < check.length; j++) {
              const a = check[i], b = check[j];
              // Skip parent-child relationships (one contains the other)
              const aContainsB = a.left <= b.left && a.right >= b.right && a.top <= b.top && a.bottom >= b.bottom;
              const bContainsA = b.left <= a.left && b.right >= a.right && b.top <= a.top && b.bottom >= a.bottom;
              if (aContainsB || bContainsA) continue;

              const overlapW = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const overlapH = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              if (overlapW > 0 && overlapH > 0) {
                const overlapArea = overlapW * overlapH;
                const smallerArea = Math.min(a.area, b.area);
                if (smallerArea > 0 && overlapArea / smallerArea > 0.2) {
                  return { found: true, tag1: a.tag, tag2: b.tag, pct: Math.round(overlapArea / smallerArea * 100) };
                }
              }
            }
          }
          return { found: false };
        });
        if (overlapIssue.found) {
          results.push(fmtWarn(file, 'PF-18',
            `Elements overlap: ${overlapIssue.tag1} and ${overlapIssue.tag2} (${overlapIssue.pct}% overlap) — may cause readability issues`));
        }

        // PF-20: Bottom margin intrusion (content in 0.5" safe zone: 369pt-405pt)
        const marginIssue = await page.evaluate(() => {
          const allEls = document.querySelectorAll('body > *');
          let maxBottom = 0;
          for (const el of allEls) {
            const r = el.getBoundingClientRect();
            if (r.height > 0 && r.bottom > maxBottom) maxBottom = r.bottom;
          }
          // 369pt = 405pt - 36pt (0.5" margin)
          return { maxBottom: Math.round(maxBottom * 100) / 100, inMargin: maxBottom > 369, overSlide: maxBottom > 405 };
        });
        if (marginIssue.overSlide) {
          // PF-03 already covers this as ERROR
        } else if (marginIssue.inMargin) {
          results.push(fmtWarn(file, 'PF-20',
            `Content extends to ${marginIssue.maxBottom.toFixed(0)}pt — inside 0.5" bottom safe margin (369-405pt)`));
        }

        // PF-21: Image resolution and aspect ratio check
        const imgIssues = await page.evaluate(() => {
          const issues = [];
          const imgs = document.querySelectorAll('img');
          for (const img of imgs) {
            if (!img.naturalWidth || !img.naturalHeight) continue;
            const r = img.getBoundingClientRect();
            if (r.width < 10 || r.height < 10) continue; // skip tiny/icon images

            // Upscale check: display size > natural size × 2
            const scaleX = r.width / img.naturalWidth;
            const scaleY = r.height / img.naturalHeight;
            if (scaleX > 2.0 || scaleY > 2.0) {
              issues.push({ type: 'lowres', scale: Math.max(scaleX, scaleY).toFixed(1), src: img.src.split('/').pop() });
            }

            // Aspect ratio distortion: >5% difference between scale axes
            if (Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY) > 0.05) {
              issues.push({ type: 'distorted', src: img.src.split('/').pop(), scaleX: scaleX.toFixed(2), scaleY: scaleY.toFixed(2) });
            }
          }
          return issues;
        });
        for (const img of imgIssues) {
          if (img.type === 'lowres') {
            results.push(fmtWarn(file, 'PF-21',
              `Image "${img.src}" upscaled ${img.scale}x — will look blurry when projected`));
          } else if (img.type === 'distorted') {
            results.push(fmtWarn(file, 'PF-21',
              `Image "${img.src}" aspect ratio distorted (scaleX=${img.scaleX}, scaleY=${img.scaleY})`));
          }
        }

        // PF-23: CJK text density — predict overflow with 20% width correction
        const densityIssue = await page.evaluate(() => {
          const CJK = /[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;
          const allEls = document.querySelectorAll('div, p, span, h1, h2, h3, h4, h5, h6, li');
          for (const el of allEls) {
            const text = (el.textContent || '').trim();
            if (!text || text.length < 3) continue;
            if (!CJK.test(text)) continue;

            const r = el.getBoundingClientRect();
            if (r.width < 20) continue;

            // Calculate CJK character ratio
            const cjkChars = (text.match(/[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/g) || []).length;
            const cjkRatio = cjkChars / text.length;
            if (cjkRatio < 0.3) continue;

            // Compare scrollWidth with clientWidth, applying 20% CJK correction
            const correctedWidth = el.scrollWidth * (1 + cjkRatio * 0.2);
            if (correctedWidth > r.width * 1.05) { // 5% tolerance
              return {
                found: true,
                text: text.substring(0, 30),
                containerWidth: Math.round(r.width),
                correctedWidth: Math.round(correctedWidth),
                cjkRatio: Math.round(cjkRatio * 100)
              };
            }
          }
          return { found: false };
        });
        if (densityIssue.found) {
          results.push(fmtWarn(file, 'PF-23',
            `CJK text "${densityIssue.text}..." (${densityIssue.cjkRatio}% CJK) will likely overflow in PPTX ` +
            `(corrected width ${densityIssue.correctedWidth}px > container ${densityIssue.containerWidth}px)`));
        }

      } catch (e) {
        results.push(fmtWarn(file, 'PF-XX', `Playwright check failed: ${e.message}`));
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}

// ── Cross-slide consistency helpers ─────────────────────────────────────────

function stddev(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

/** Extract metrics from HTML for cross-slide consistency checks. */
function extractSlideMetrics(html) {
  const metrics = { h1FontSize: null, bodyPadding: null, usedColors: [], bodyBgBrightness: null, textColors: [] };

  // h1 font-size (inline style)
  const h1Match = html.match(/<h1[^>]*style="[^"]*font-size\s*:\s*([\d.]+)\s*pt/i);
  if (h1Match) metrics.h1FontSize = parseFloat(h1Match[1]);

  // body padding (inline style)
  const bodyMatch = html.match(/<body[^>]*style="[^"]*padding\s*:\s*([^;"]+)/i);
  if (bodyMatch) metrics.bodyPadding = bodyMatch[1].trim();

  // Collect hex colors used in inline styles only (skip href, id, class attributes)
  const styleBlocks = html.matchAll(/style="([^"]*)"/gi);
  for (const sb of styleBlocks) {
    const styleStr = sb[1];
    const colorMatches = styleStr.matchAll(/#([0-9a-fA-F]{6})(?=[;\s"',)]|$)/g);
    for (const m of colorMatches) {
      metrics.usedColors.push(m[1].toUpperCase());
    }
  }

  // Body background brightness for PF-24
  const bodyBgMatch = html.match(/<body[^>]*style="[^"]*background\s*:\s*#([0-9a-fA-F]{6})/i);
  if (bodyBgMatch) {
    const rgb = hexToRgb(bodyBgMatch[1]);
    if (rgb) metrics.bodyBgBrightness = relativeLuminance(...rgb);
  }

  // Text colors for PF-24
  const textColorRe = /(?:^|;\s*)color\s*:\s*#([0-9a-fA-F]{6})/gi;
  for (const sb of html.matchAll(/style="([^"]*)"/gi)) {
    const styleStr = sb[1];
    // Skip background-color
    let tcm;
    while ((tcm = textColorRe.exec(styleStr)) !== null) {
      const preceding = styleStr.substring(Math.max(0, tcm.index - 15), tcm.index);
      if (!/background-?\s*$/i.test(preceding)) {
        metrics.textColors.push(tcm[1].toUpperCase());
      }
    }
  }

  return metrics;
}

function checkConsistency(allMetrics) {
  const warnings = [];

  // PF-09: Title (h1) font-size consistency
  const titleSizes = allMetrics.map(m => m.h1FontSize).filter(Boolean);
  if (titleSizes.length >= 2) {
    const sd = stddev(titleSizes);
    if (sd > 2) {
      warnings.push(fmtWarn('cross-slide', 'PF-09',
        `Title font-size inconsistency (stddev=${sd.toFixed(1)}pt across ${titleSizes.length} slides)`));
    }
  }

  // PF-10: Body padding consistency
  const paddings = allMetrics.map(m => m.bodyPadding).filter(Boolean);
  const uniquePaddings = new Set(paddings);
  if (uniquePaddings.size > 2) {
    warnings.push(fmtWarn('cross-slide', 'PF-10',
      `Body padding varies across ${uniquePaddings.size} patterns`));
  }

  // PF-11: Color palette consistency (unique color count)
  const allColors = new Set(allMetrics.flatMap(m => m.usedColors));
  if (allColors.size > 8) {
    warnings.push(fmtWarn('cross-slide', 'PF-11',
      `${allColors.size} unique colors used across deck (recommend ≤8)`));
  }

  // PF-24: Cross-slide background-text contrast consistency
  for (let i = 0; i < allMetrics.length; i++) {
    const m = allMetrics[i];
    if (m.bodyBgBrightness === null || m.textColors.length === 0) continue;
    const isDarkBg = m.bodyBgBrightness < 0.2;
    const isLightBg = m.bodyBgBrightness > 0.8;

    for (const tc of m.textColors) {
      const rgb = hexToRgb(tc);
      if (!rgb) continue;
      const textLum = relativeLuminance(...rgb);
      // Dark bg + dark text or light bg + light text
      if (isDarkBg && textLum < 0.2) {
        warnings.push(fmtWarn(`slide-${String(i + 1).padStart(2, '0')}`, 'PF-24',
          `Dark text #${tc} on dark background (luminance ${m.bodyBgBrightness.toFixed(2)}) — low contrast`));
        break;
      }
      if (isLightBg && textLum > 0.8) {
        warnings.push(fmtWarn(`slide-${String(i + 1).padStart(2, '0')}`, 'PF-24',
          `Light text #${tc} on light background (luminance ${m.bodyBgBrightness.toFixed(2)}) — low contrast`));
        break;
      }
    }
  }

  return warnings;
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Run pre-flight checks on slide HTML files.
 * @param {string} slidesDir - Path to directory containing slide-*.html files
 * @param {{ full?: boolean }} options
 * @returns {Promise<{ errors: string[], warnings: string[], passed: boolean }>}
 */
export async function preflightCheck(slidesDir, options = {}) {
  const absDir = path.resolve(slidesDir);
  const files = fs.readdirSync(absDir)
    .filter(f => /^slide-\d+\.html$/.test(f))
    .sort();

  if (files.length === 0) {
    return { errors: ['No slide-*.html files found in ' + absDir], warnings: [], passed: false };
  }

  const errors = [];
  const warnings = [];
  const allMetrics = [];

  // Phase 1: static checks + metric collection
  for (const file of files) {
    const html = fs.readFileSync(path.join(absDir, file), 'utf-8');
    const issues = runStaticChecks(html, file);
    for (const line of issues) {
      if (line.includes('ERROR')) errors.push(line);
      else warnings.push(line);
    }
    allMetrics.push(extractSlideMetrics(html));
  }

  // Phase 2: Playwright checks (only with --full)
  if (options.full) {
    const pwIssues = await runPlaywrightChecks(absDir, files);
    for (const line of pwIssues) {
      if (line.includes('ERROR')) errors.push(line);
      else warnings.push(line);
    }
  }

  // Phase 3: Cross-slide consistency
  if (allMetrics.length >= 2) {
    const consistencyIssues = checkConsistency(allMetrics);
    for (const line of consistencyIssues) {
      warnings.push(line);
    }
  }

  return { errors, warnings, passed: errors.length === 0 };
}

export default preflightCheck;

// ── CLI entry ────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let slidesDir = null;
  let full = false;
  let summary = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--slides-dir' && args[i + 1]) slidesDir = args[++i];
    if (args[i] === '--full') full = true;
    if (args[i] === '--summary') summary = true;
  }

  if (!slidesDir) {
    console.error('Usage: node scripts/preflight-html.js --slides-dir <dir> [--full] [--summary]');
    process.exit(1);
  }

  console.log(`${BOLD}Pre-flight HTML check: ${path.resolve(slidesDir)}${RESET}`);
  if (full) console.log('  (Playwright checks enabled with --full)\n');
  else console.log('  (Static checks only \u2014 use --full for Playwright overflow/CJK checks)\n');

  const result = await preflightCheck(slidesDir, { full });

  if (summary) {
    // --summary: ERROR detailed, WARN aggregated by rule ID
    for (const line of result.errors) {
      console.log(line);
    }
    if (result.warnings.length > 0) {
      // Group warnings by rule ID (e.g. "PF-08")
      const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, '');
      const warnGroups = new Map();
      for (const line of result.warnings) {
        const plain = stripAnsi(line);
        const idMatch = plain.match(/\] (PF-\d+):/);
        const fileMatch = plain.match(/\[([^\]]+)\]/);
        const id = idMatch ? idMatch[1] : 'OTHER';
        const file = fileMatch ? fileMatch[1] : 'unknown';
        if (!warnGroups.has(id)) warnGroups.set(id, { files: [], msg: '' });
        const group = warnGroups.get(id);
        group.files.push(file);
        if (!group.msg) {
          const msgMatch = plain.match(/PF-\d+: (.+)/);
          group.msg = msgMatch ? msgMatch[1] : '';
        }
      }
      console.log('');
      for (const [id, group] of warnGroups) {
        const fileList = group.files.length <= 3
          ? group.files.join(', ')
          : `${group.files[0]}~${group.files[group.files.length - 1]}`;
        console.log(`${YELLOW}${id}: ${group.files.length} slides (${fileList}) — ${group.msg}${RESET}`);
      }
    }
  } else {
    for (const line of [...result.errors, ...result.warnings]) {
      console.log(line);
    }
  }

  const total = result.errors.length + result.warnings.length;
  if (total === 0) {
    console.log(`\n${GREEN}${BOLD}\u2705 All checks passed.${RESET}`);
  } else {
    console.log(`\n${BOLD}Results: ${RED}${result.errors.length} error(s)${RESET}, ` +
      `${YELLOW}${result.warnings.length} warning(s)${RESET}`);
  }

  process.exit(result.passed ? 0 : 1);
}

// Run CLI when executed directly
const isMain = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
if (isMain) {
  main().catch(err => { console.error(err); process.exit(1); });
}
