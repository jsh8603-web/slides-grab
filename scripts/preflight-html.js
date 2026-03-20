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
    const colValue = colMatch[1].trim();
    // Handle repeat() shorthand: repeat(4, 1fr) → 4 columns
    const repeatMatch = colValue.match(/repeat\(\s*(\d+)/);
    let colCount;
    if (repeatMatch) {
      colCount = parseInt(repeatMatch[1], 10);
    } else {
      const colTokens = colValue.split(/\s+/).filter(t => t && !t.startsWith('/'));
      colCount = colTokens.length;
    }
    if (colCount < 3) continue;

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
          `${colCount}-column grid with CJK text at ${size}pt (>7.5pt) — may overflow in PPTX [IL-27]`));
        return issues; // one per file
      }
    }
  }
  return issues;
}

function checkPF16(html, file) {
  const issues = [];
  // IL-07: background image on body without text-shadow on text elements
  // Check both inline style on <body> and <style> block for body { background: url(...) }
  const bodyBgInline = /<body[^>]*style="[^"]*background[^"]*url\s*\(/i.test(html);
  const bodyBgStyle = /body\s*\{[^}]*background[^}]*url\s*\(/i.test(html);
  if (!bodyBgInline && !bodyBgStyle) return issues;

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
    if (/(?:scale\w*|skew\w*|perspective|matrix\w*)\s*\(/i.test(val)) {
      const fnMatch = val.match(/(scale\w*|skew\w*|perspective|matrix\w*)\s*\(/i);
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
const UNSUPPORTED_CSS_RE = /(?:backdrop-filter|clip-path|mask-image|filter\s*:\s*(?!none)(?:blur|brightness|contrast|drop-shadow|grayscale|hue-rotate|invert|saturate|sepia)|writing-mode\s*:\s*vertical|animation\s*:|@keyframes)\s*/i;

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
    // box-shadow: inset — html2pptx ignores inset shadows
    if (/box-shadow\s*:[^;]*\binset\b/i.test(style)) {
      issues.push(fmtWarn(file, 'PF-22',
        `box-shadow: inset — inset shadows ignored in PPTX, only outer shadows supported`));
      return issues;
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
    if (/box-shadow\s*:[^;]*\binset\b/i.test(block)) {
      issues.push(fmtWarn(file, 'PF-22',
        `box-shadow: inset in <style> — inset shadows ignored in PPTX`));
      return issues;
    }
  }
  return issues;
}

function checkPF25(html, file) {
  const issues = [];
  // Hard Floor: font-size < 10pt is ERROR (design-skill typography minimum)
  // Scans all inline style font-size declarations
  const fontSizeRe = /font-size\s*:\s*([\d.]+)\s*pt/gi;
  let m;
  const violations = [];
  while ((m = fontSizeRe.exec(html)) !== null) {
    const size = parseFloat(m[1]);
    if (size < 10) {
      violations.push(size);
    }
  }
  if (violations.length > 0) {
    const unique = [...new Set(violations)].sort((a, b) => a - b);
    issues.push(fmtError(file, 'PF-25',
      `Font size below Hard Floor (10pt): found ${unique.join('pt, ')}pt — increase to 10pt+ or split slide [IL-31]`));
  }
  return issues;
}

function checkPF27(html, file) {
  const issues = [];
  // CJK badge/label nowrap check: elements with explicit small width + CJK text without nowrap
  // Pattern: style="...width: Xpt..." containing CJK text without white-space: nowrap
  const styleBlockRe = /style="([^"]*)"/gi;
  let m;
  const violations = [];
  while ((m = styleBlockRe.exec(html)) !== null) {
    const style = m[1];
    // Check if element has explicit small width (< 150pt)
    const widthMatch = style.match(/(?:^|;\s*)width\s*:\s*([\d.]+)\s*pt/i);
    if (!widthMatch) continue;
    const width = parseFloat(widthMatch[1]);
    if (width >= 150) continue;
    // Check if it has nowrap already
    if (/white-space\s*:\s*nowrap/i.test(style)) continue;
    // Check surrounding context for CJK text (approximate: look at nearby HTML content)
    const pos = m.index;
    const nearby = html.substring(pos, Math.min(pos + 500, html.length));
    if (CJK_RE.test(nearby)) {
      violations.push(width);
    }
  }
  if (violations.length > 0) {
    const unique = [...new Set(violations)].sort((a, b) => a - b);
    issues.push(fmtWarn(file, 'PF-27',
      `CJK text in narrow container (${unique.join('pt, ')}pt width) without white-space:nowrap — may wrap in PPTX [IL-34]`));
  }
  return issues;
}

function checkPF28(html, file) {
  const issues = [];
  // Word count per slide: > 80 words WARN, > 120 ERROR (5x5/6x6 Rule, BCG principle)
  // Strip HTML tags, then count words
  // Extract body content only (ignore head/title/meta)
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : html;
  const textOnly = bodyContent.replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Count: CJK characters count as 1 word each, Latin words split by space
  const cjkChars = (textOnly.match(/[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/g) || []).length;
  // For word count: split non-CJK text by spaces, filter empties
  const nonCjk = textOnly.replace(/[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/g, ' ');
  const latinWords = nonCjk.split(/\s+/).filter(w => w.length > 0).length;
  // CJK: roughly 2 characters = 1 "word equivalent" for density
  const wordEquiv = latinWords + Math.ceil(cjkChars / 2);
  if (wordEquiv > 120) {
    issues.push(fmtError(file, 'PF-28',
      `Slide has ~${wordEquiv} word equivalents (max 120) — split content across slides [6x6 Rule]`));
  } else if (wordEquiv > 80) {
    issues.push(fmtWarn(file, 'PF-28',
      `Slide has ~${wordEquiv} word equivalents (recommend ≤80) — consider reducing text [5x5 Rule]`));
  }
  return issues;
}

function checkPF29(html, file) {
  const issues = [];
  // Image alt text check: <img> without alt or with alt="" (WCAG, Grackle, MS)
  const imgRe = /<img\b([^>]*)>/gi;
  let m;
  let missing = 0;
  while ((m = imgRe.exec(html)) !== null) {
    const attrs = m[1];
    // Skip tiny decorative images (icons)
    if (/width\s*[:=]\s*["']?\d{1,2}(px|pt)/i.test(attrs)) continue;
    // Check for alt attribute
    const altMatch = attrs.match(/\balt\s*=\s*"([^"]*)"/i);
    if (!altMatch || altMatch[1].trim() === '') {
      missing++;
    }
  }
  if (missing > 0) {
    issues.push(fmtWarn(file, 'PF-29',
      `${missing} image(s) missing alt text — add descriptive alt for accessibility [WCAG]`));
  }
  return issues;
}

function checkPF30(html, file) {
  const issues = [];
  // Font hierarchy inversion: title (h1/h2) font-size ≤ body (p/div/li) font-size
  let titleSize = 0;
  let bodyMaxSize = 0;

  // Find h1/h2 font sizes
  const titleRe = /<h[12][^>]*style="[^"]*font-size\s*:\s*([\d.]+)\s*pt/gi;
  let m;
  while ((m = titleRe.exec(html)) !== null) {
    const size = parseFloat(m[1]);
    if (size > titleSize) titleSize = size;
  }

  // Find body text font sizes (p, div with text, li)
  const bodyRe = /<(?:p|li)\b[^>]*style="[^"]*font-size\s*:\s*([\d.]+)\s*pt/gi;
  while ((m = bodyRe.exec(html)) !== null) {
    const size = parseFloat(m[1]);
    if (size > bodyMaxSize) bodyMaxSize = size;
  }

  if (titleSize > 0 && bodyMaxSize > 0 && titleSize <= bodyMaxSize) {
    issues.push(fmtWarn(file, 'PF-30',
      `Font hierarchy inversion: title ${titleSize}pt ≤ body ${bodyMaxSize}pt — title should be larger [2502.15412]`));
  }
  return issues;
}

// PF-31: Inline <span> inside heading/paragraph causes extra line breaks in PPTX [IL-45]
function checkPF34(html, file) {
  const issues = [];
  // Match <h1>...<span ...>...</span>...</h1> where text exists both before and inside span
  // This pattern causes PPTX converter to split span into separate paragraph
  const textElRe = /<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = textElRe.exec(html)) !== null) {
    const tag = m[1];
    const content = m[2];
    // Check if content has text + <span> + text (mixed inline content)
    // Skip if span wraps entire content (no split issue)
    const spanRe = /<span\b[^>]*(?:style|class)[^>]*>/gi;
    const spans = content.match(spanRe);
    if (!spans) continue;
    // Check if there's text content outside spans
    const textOutsideSpans = content
      .replace(/<span\b[\s\S]*?<\/span>/gi, '')
      .replace(/<br\s*\/?>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, '')
      .trim();
    if (textOutsideSpans.length > 0 && spans.length > 0) {
      // Count expected line increase
      const brCount = (content.match(/<br\s*\/?>/gi) || []).length;
      const htmlLines = brCount + 1;
      const pptxLines = htmlLines + spans.length; // each span boundary adds a line
      issues.push(fmtError(file, 'PF-34',
        `<${tag}> has inline <span> with mixed text — PPTX will add ${spans.length} extra line(s) (${htmlLines}→${pptxLines} lines). Use separate <p> elements instead [IL-45]`));
    }
  }
  return issues;
}

// PF-32: <li> + ::before/::after pseudo-element — PPTX ignores pseudo-elements [IL-44]
function checkPF35(html, file) {
  const issues = [];
  const hasLi = /<li\b/i.test(html);
  const hasPseudo = /::(?:before|after)\s*\{/i.test(html);
  if (hasLi && hasPseudo) {
    issues.push(fmtError(file, 'PF-35',
      `<li> with ::before/::after pseudo-element — PPTX ignores pseudo-elements, causing position errors. Use <p> + inline bullet character instead [IL-44]`));
  }
  return issues;
}

// PF-33: background: rgba() on any element — creates opaque shape covering text in PPTX [IL-43]
function checkPF36(html, file) {
  const issues = [];
  // Extract CSS from <style> blocks
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch;
  while ((styleMatch = styleRe.exec(html)) !== null) {
    const css = styleMatch[1];
    // Find background: rgba(...) or background-color: rgba(...)
    const bgRgbaRe = /background(?:-color)?\s*:\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/gi;
    let bgMatch;
    while ((bgMatch = bgRgbaRe.exec(css)) !== null) {
      const alpha = parseFloat(bgMatch[4]);
      if (alpha > 0 && alpha < 1.0) {
        issues.push(fmtError(file, 'PF-36',
          `background: rgba(${bgMatch[1]},${bgMatch[2]},${bgMatch[3]},${bgMatch[4]}) — PPTX converts ANY alpha to opaque shape. Use solid hex: blend with parent color [IL-43]`));
      }
    }
  }
  // Also check inline styles
  const inlineRe = /style="[^"]*background(?:-color)?\s*:\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/gi;
  let inlineMatch;
  while ((inlineMatch = inlineRe.exec(html)) !== null) {
    const alpha = parseFloat(inlineMatch[4]);
    if (alpha > 0 && alpha < 1.0) {
      issues.push(fmtError(file, 'PF-36',
        `Inline background: rgba(${inlineMatch[1]},${inlineMatch[2]},${inlineMatch[3]},${inlineMatch[4]}) — PPTX converts ANY alpha to opaque shape. Use solid hex [IL-43]`));
    }
  }
  return issues;
}

/**
 * PF-37: CSS border-triangle detection (IL-28)
 * border-top/bottom/left/right + transparent → white block in PPTX
 */
function checkPF37(html, file) {
  const issues = [];
  const allCss = [];
  // Collect CSS from <style> blocks
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = styleRe.exec(html)) !== null) allCss.push(m[1]);
  // Collect inline styles
  const inlineRe = /style="([^"]*)"/gi;
  while ((m = inlineRe.exec(html)) !== null) allCss.push(m[1]);

  for (const css of allCss) {
    // Check for border-side with transparent
    const borderTransRe = /border-(top|bottom|left|right)\s*:\s*[^;]*transparent/gi;
    let bm;
    while ((bm = borderTransRe.exec(css)) !== null) {
      issues.push(fmtError(file, 'PF-37',
        `border-${bm[1]}: ...transparent — CSS triangle trick renders as white block in PPTX. Use rect shapes or SVG instead [IL-28]`));
      break; // one per CSS block is enough
    }
  }
  return issues;
}

/**
 * PF-38: text-decoration: underline detection (IL-38)
 * Underline position is distorted in PPTX
 */
function checkPF38(html, file) {
  const issues = [];
  const re = /text-decoration(?:-line)?\s*:\s*[^;]*underline/gi;
  if (re.test(html)) {
    issues.push(fmtError(file, 'PF-38',
      `text-decoration: underline — position distorted in PPTX. Use color or font-weight:700 for emphasis instead [IL-38]`));
  }
  return issues;
}

/**
 * PF-39: Non-body div with background-image: linear-gradient (IL-39)
 * Converts to solid rectangle covering content in PPTX
 */
function checkPF39(html, file) {
  const issues = [];
  // Check inline styles on non-body elements
  const inlineGradRe = /<(?!body\b)(\w+)[^>]*style="[^"]*background-image\s*:\s*linear-gradient\([^"]*"/gi;
  let m;
  while ((m = inlineGradRe.exec(html)) !== null) {
    issues.push(fmtError(file, 'PF-39',
      `<${m[1]}> has background-image: linear-gradient() — PPTX converts to solid rectangle covering content. Move to body background or use PNG [IL-39]`));
  }
  // Check <style> blocks for non-body selectors with background-image: linear-gradient
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = styleRe.exec(html)) !== null) {
    const css = m[1];
    // Match CSS rules: selector { ... background-image: linear-gradient ... }
    const ruleRe = /([^{}]+)\{([^}]*background-image\s*:\s*linear-gradient[^}]*)\}/gi;
    let rm;
    while ((rm = ruleRe.exec(css)) !== null) {
      const selector = rm[1].trim();
      // Skip body/html selectors
      if (/^(body|html)\s*$/i.test(selector)) continue;
      issues.push(fmtError(file, 'PF-39',
        `CSS "${selector}" has background-image: linear-gradient() — PPTX converts to solid rectangle. Move to body or use PNG [IL-39]`));
    }
  }
  return issues;
}

/**
 * PF-40: AI-generated infographic image detection (IL-31)
 * Images in assets/ with chart/graph/data keywords likely contain fake data
 */
/**
 * PF-41: letter-spacing detection
 * html2pptx ignores letter-spacing — text width differs in PPTX
 */
function checkPF41(html, file) {
  const issues = [];
  const re = /letter-spacing\s*:\s*(-?[\d.]+)\s*pt/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const val = Math.abs(parseFloat(m[1]));
    if (val > 1) {
      issues.push(fmtWarn(file, 'PF-41',
        `letter-spacing: ${m[1]}pt — ignored in PPTX (>±1pt threshold). Remove or accept width difference [IL-46]`));
      return issues;
    }
  }
  return issues;
}

/**
 * PF-42: opacity on non-body elements
 * html2pptx ignores standalone opacity CSS — element renders fully opaque in PPTX
 */
function checkPF42(html, file) {
  const issues = [];
  // Check inline styles for opacity (not inside rgba)
  const styleRe = /style="([^"]*)"/gi;
  let m;
  while ((m = styleRe.exec(html)) !== null) {
    const style = m[1];
    // Match standalone opacity property (not inside rgba/hsla)
    const opacityMatch = style.match(/(?:^|;\s*)opacity\s*:\s*([\d.]+)/i);
    if (!opacityMatch) continue;
    const val = parseFloat(opacityMatch[1]);
    if (val < 1.0) {
      // Check it's not on body
      const tagBefore = html.substring(Math.max(0, m.index - 30), m.index);
      if (/<body\b/i.test(tagBefore)) continue;
      issues.push(fmtWarn(file, 'PF-42',
        `opacity: ${val} — ignored in PPTX, element will be fully opaque. Use rgba() background or remove [IL-47]`));
      return issues;
    }
  }
  // Also check <style> blocks
  const styleBlockRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = styleBlockRe.exec(html)) !== null) {
    const css = m[1];
    const opacityMatch = css.match(/(?:^|;\s*|{\s*)opacity\s*:\s*([\d.]+)/i);
    if (opacityMatch) {
      const val = parseFloat(opacityMatch[1]);
      if (val < 1.0) {
        issues.push(fmtWarn(file, 'PF-42',
          `opacity: ${val} in <style> — ignored in PPTX, element will be fully opaque [IL-47]`));
        return issues;
      }
    }
  }
  return issues;
}

/**
 * PF-43: object-fit: cover/fill/scale-down on img
 * html2pptx forces all images to contain mode — cover/fill intent lost
 */
function checkPF43(html, file) {
  const issues = [];
  const re = /object-fit\s*:\s*(cover|fill|scale-down)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    issues.push(fmtWarn(file, 'PF-43',
      `object-fit: ${m[1]} — PPTX converts all images to contain mode. Crop intent will be lost [IL-48]`));
    return issues;
  }
  return issues;
}

/**
 * PF-44: outline property (not none/0)
 * html2pptx ignores outline completely — use border instead
 */
function checkPF44(html, file) {
  const issues = [];
  const re = /(?:^|;\s*)outline\s*:\s*([^;"]+)/gi;
  const allCss = [];
  // Collect inline styles
  let m;
  const inlineRe = /style="([^"]*)"/gi;
  while ((m = inlineRe.exec(html)) !== null) allCss.push(m[1]);
  // Collect <style> blocks
  const styleBlockRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = styleBlockRe.exec(html)) !== null) allCss.push(m[1]);

  for (const css of allCss) {
    const outlineRe = /(?:^|;\s*)outline\s*:\s*([^;"]+)/gi;
    let om;
    while ((om = outlineRe.exec(css)) !== null) {
      const val = om[1].trim().toLowerCase();
      if (val === 'none' || val === '0' || val === '0px' || val === '0pt') continue;
      issues.push(fmtWarn(file, 'PF-44',
        `outline: ${val} — ignored in PPTX. Use border instead [IL-49]`));
      return issues;
    }
  }
  return issues;
}

/**
 * PF-45: Negative margins (≤ -5pt)
 * PPTX shape positioning may differ with large negative margins
 */
function checkPF45(html, file) {
  const issues = [];
  const re = /margin(?:-(?:top|bottom|left|right))?\s*:\s*(-[\d.]+)\s*pt/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const val = parseFloat(m[1]);
    if (val <= -5) {
      issues.push(fmtWarn(file, 'PF-45',
        `Negative margin ${m[1]}pt — PPTX shape positioning may differ. Consider absolute positioning [IL-50]`));
      return issues;
    }
  }
  return issues;
}

/**
 * PF-46: text-indent
 * html2pptx does not extract text-indent — first-line indent ignored in PPTX
 */
function checkPF46(html, file) {
  const issues = [];
  const re = /text-indent\s*:\s*(-?[\d.]+)\s*(?:pt|px|em)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const val = parseFloat(m[1]);
    if (val !== 0) {
      issues.push(fmtWarn(file, 'PF-46',
        `${m[0].match(/text-indent\s*:\s*[^;]+/)[0]} — ignored in PPTX. Use padding-left instead [IL-51]`));
      return issues;
    }
  }
  return issues;
}

/**
 * PF-47: word-break: break-all / overflow-wrap: break-word
 * PPTX ignores these — line break positions differ
 */
function checkPF47(html, file) {
  const issues = [];
  if (/word-break\s*:\s*break-all/i.test(html)) {
    issues.push(fmtWarn(file, 'PF-47',
      `word-break: break-all — ignored in PPTX, line breaks will differ. Verify text fits [IL-52]`));
  }
  return issues;
}

/**
 * PF-48: column-count / columns (multi-column layout)
 * html2pptx does not support CSS columns — renders as single column
 */
function checkPF48(html, file) {
  const issues = [];
  // Avoid matching grid-template-columns by requiring word boundary before 'column-count'/'columns'
  const re = /(?<![a-z-])(?:column-count|columns)\s*:\s*(\d+)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const count = parseInt(m[1], 10);
    if (count >= 2) {
      issues.push(fmtError(file, 'PF-48',
        `column-count: ${count} — CSS columns not supported in PPTX, will render as single column. Use CSS grid or flex instead [IL-53]`));
      return issues;
    }
  }
  return issues;
}

/**
 * PF-49: mix-blend-mode (non-normal)
 * PPTX ignores blend modes — visual effect lost
 */
function checkPF49(html, file) {
  const issues = [];
  const re = /mix-blend-mode\s*:\s*(\w[\w-]*)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1].toLowerCase() !== 'normal') {
      issues.push(fmtWarn(file, 'PF-49',
        `mix-blend-mode: ${m[1]} — ignored in PPTX, visual effect will be lost [IL-54]`));
      return issues;
    }
  }
  return issues;
}

/**
 * PF-50: border-image / border-image-source
 * PPTX does not support image/gradient borders
 */
function checkPF50(html, file) {
  const issues = [];
  if (/border-image(?:-source)?\s*:\s*(?!none)/i.test(html)) {
    issues.push(fmtWarn(file, 'PF-50',
      `border-image — not supported in PPTX, border will be missing. Use solid border instead [IL-55]`));
  }
  return issues;
}

/**
 * PF-51: position: sticky
 * PPTX treats sticky as absolute — positioning differs
 */
function checkPF51(html, file) {
  const issues = [];
  if (/position\s*:\s*sticky/i.test(html)) {
    issues.push(fmtWarn(file, 'PF-51',
      `position: sticky — treated as absolute in PPTX, positioning will differ [IL-56]`));
  }
  return issues;
}

/**
 * PF-52: @font-face custom font
 * PPTX falls back to system fonts — layout may change
 */
function checkPF52(html, file) {
  const issues = [];
  if (/@font-face\s*\{/i.test(html)) {
    issues.push(fmtWarn(file, 'PF-52',
      `@font-face custom font — PPTX uses system fonts, layout may change [IL-57]`));
  }
  return issues;
}

/**
 * PF-53: direction: rtl
 * PPTX may not respect text direction
 */
function checkPF53(html, file) {
  const issues = [];
  if (/direction\s*:\s*rtl/i.test(html)) {
    issues.push(fmtWarn(file, 'PF-53',
      `direction: rtl — PPTX may not respect RTL text direction [IL-58]`));
  }
  return issues;
}

/**
 * PF-54: white-space: pre / pre-line
 * PPTX whitespace handling differs
 */
function checkPF54(html, file) {
  const issues = [];
  if (/white-space\s*:\s*pre(?:-line)?(?:\s|;|"|$)/i.test(html)) {
    // Skip white-space: pre-wrap (commonly used and less problematic)
    const match = html.match(/white-space\s*:\s*(pre(?:-line)?)(?:\s|;|"|$)/i);
    if (match) {
      issues.push(fmtWarn(file, 'PF-54',
        `white-space: ${match[1]} — PPTX whitespace/line-break handling may differ [IL-59]`));
    }
  }
  return issues;
}

/**
 * PF-55: Inline <span> with background inside text elements
 * html2pptx strips span backgrounds → text becomes invisible on parent bg
 */
function checkPF55(html, file) {
  const issues = [];
  // Match <span with background/background-color in style attribute
  const spanBgRe = /<span\b[^>]*style="[^"]*background(?:-color)?\s*:\s*(?!none|transparent)[^"]*"[^>]*>/gi;
  let m;
  while ((m = spanBgRe.exec(html)) !== null) {
    const tag = m[0];
    // Check if this span also has a contrasting text color (the dangerous pattern)
    const colorMatch = tag.match(/(?<!-)color\s*:\s*(#[0-9A-Fa-f]{3,8}|rgba?\([^)]+\)|[a-z]+)/i);
    const bgMatch = tag.match(/background(?:-color)?\s*:\s*(#[0-9A-Fa-f]{3,8}|rgba?\([^)]+\)|[a-z]+)/i);
    if (bgMatch) {
      const msg = colorMatch
        ? `<span> with background:${bgMatch[1]} + color:${colorMatch[1]} — PPTX strips span background, text color remains on parent bg → may become invisible. Use parent div background or text-only styling [IL-60]`
        : `<span> with background:${bgMatch[1]} — PPTX strips span background. Move background to parent <div> [IL-60]`;
      issues.push(fmtError(file, 'PF-55', msg));
    }
  }
  return issues;
}

function checkPF40(html, file) {
  const issues = [];
  const BANNED_KEYWORDS = /chart|graph|table|data|infographic|calendar|spreadsheet|timeline|diagram|funnel|waterfall|donut|pie|heatmap/i;

  const imgRe = /<img\b([^>]*)>/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    const attrs = m[1];
    const srcMatch = attrs.match(/src\s*=\s*["']([^"']+)/i);
    if (!srcMatch) continue;
    const src = srcMatch[1];
    // Only check assets/ images (AI-generated), skip external URLs and SVGs
    if (!/assets\//i.test(src)) continue;
    if (/\.svg$/i.test(src)) continue;

    const filename = src.split('/').pop().toLowerCase();
    const altMatch = attrs.match(/alt\s*=\s*["']([^"']*)/i);
    const alt = altMatch ? altMatch[1] : '';

    const filenameHit = filename.match(BANNED_KEYWORDS);
    const altHit = alt.match(BANNED_KEYWORDS);

    if (filenameHit || altHit) {
      const keyword = (filenameHit || altHit)[0];
      issues.push(fmtWarn(file, 'PF-40',
        `AI image "${src}" may contain fake ${keyword} data — use HTML/CSS or PPTX native chart instead [IL-31]`));
    }
  }
  return issues;
}

/**
 * PF-58: Image src points to non-existent file in assets/
 * Catches filename mismatches between HTML and actual asset files
 */
function checkPF58(html, file, slidesDir) {
  const issues = [];
  const imgRe = /<img\b([^>]*)>/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    const attrs = m[1];
    const srcMatch = attrs.match(/src\s*=\s*["']([^"']+)/i);
    if (!srcMatch) continue;
    const src = srcMatch[1];
    // Only check local assets/ paths, skip URLs
    if (/^https?:\/\//i.test(src)) continue;
    if (!slidesDir) continue;
    const filePath = path.join(slidesDir, src);
    if (!fs.existsSync(filePath)) {
      issues.push(fmtError(file, 'PF-58',
        `Image file not found: "${src}" — check filename matches actual asset [IL-64]`));
    }
  }
  return issues;
}

/**
 * PF-59: flex:1 + overflow:hidden container with tall fixed-height children
 * Content at the top may be clipped when align-items:flex-end pushes content down
 */
function checkPF59(html, file) {
  const issues = [];
  // Find flex:1 containers with overflow:hidden and flex-direction:column (or default)
  // Then check if they contain children with large fixed heights
  const containerRe = /style\s*=\s*"([^"]*flex:\s*1[^"]*overflow:\s*hidden[^"]*)"/gi;
  let m;
  while ((m = containerRe.exec(html)) !== null) {
    const style = m[1];
    // Only check column-direction flex containers (bar charts, vertical layouts)
    // Skip row-direction (default) as height clipping is less common
    if (!/flex-direction:\s*column/i.test(style) && !/align-items:\s*flex-end/i.test(style)) continue;
    // Look at the content after this container opening for fixed heights
    const after = html.substring(m.index, Math.min(m.index + 2000, html.length));
    const heightMatches = [...after.matchAll(/height:\s*(\d+(?:\.\d+)?)pt/gi)];
    if (heightMatches.length === 0) continue;
    const maxHeight = Math.max(...heightMatches.map(h => parseFloat(h[1])));
    if (maxHeight > 90) {
      issues.push(fmtWarn(file, 'PF-59',
        `flex:1 + overflow:hidden container has child with height ${maxHeight}pt — content may be clipped at top [IL-65]`));
    }
  }
  return issues;
}

/**
 * PF-60: Badge/decoration div text color invisible against parent background [IL-66]
 * Small divs (border-radius:50% or width/height ≤40pt) with text — PPTX may not
 * transfer the badge's background to the text shape, so text color must contrast
 * against the PARENT container's background, not just the badge's own background.
 */
function checkPF60(html, file) {
  const issues = [];
  // Find badge divs with border-radius:50% AND a background color AND containing text
  // The badge must have its own background (colored circle) to be relevant
  const badgeRe = /<div\b[^>]*style\s*=\s*"([^"]*border-radius:\s*50%[^"]*)"\s*>\s*<(?:p|h[1-6])\b[^>]*style\s*=\s*"([^"]*color:\s*(#[0-9A-Fa-f]{3,8})[^"]*)"/gi;
  let m;
  while ((m = badgeRe.exec(html)) !== null) {
    const divStyle = m[1];
    const textColor = m[3].toUpperCase();
    // Badge must have its own background color
    const badgeBgMatch = divStyle.match(/background(?:-color)?:\s*(#[0-9A-Fa-f]{3,8})/i);
    if (!badgeBgMatch) continue;
    const pos = m.index;
    // Find the nearest ancestor div with a background color (the parent card/container)
    const before = html.substring(Math.max(0, pos - 1500), pos);
    const parentBgs = [...before.matchAll(/background(?:-color)?:\s*(#[0-9A-Fa-f]{3,8})/gi)];
    if (parentBgs.length === 0) continue;
    const parentBg = parentBgs[parentBgs.length - 1][1].toUpperCase();
    // Calculate contrast of text against PARENT background (not badge background)
    const ratio = contrastRatio(textColor, parentBg);
    if (ratio < 3.0) {
      issues.push(fmtWarn(file, 'PF-60',
        `Badge text "${textColor}" on parent background "${parentBg}" — contrast ${ratio.toFixed(1)}:1 < 3:1. PPTX may not render badge fill → text invisible [IL-66]`));
    }
  }
  return issues;
}

// Helper for PF-60: WCAG contrast ratio calculation
function contrastRatio(hex1, hex2) {
  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
  }
  function luminance(rgb) {
    const [r, g, b] = rgb.map(c => {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const l1 = luminance(hexToRgb(hex1));
  const l2 = luminance(hexToRgb(hex2));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * PF-56: Image container with flex centering but missing explicit height
 * flex align-items:center without height causes container to collapse → centering has no effect
 */
function checkPF56(html, file) {
  const issues = [];
  // Find <img> tags with assets/ src (project images)
  const imgRe = /<img\b[^>]*src\s*=\s*["'](?:assets\/[^"']+)["'][^>]*>/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    const imgPos = m.index;
    // Look for the closest parent div/element with flex + align-items:center
    // Search backwards from img position for style containing align-items
    const before = html.substring(Math.max(0, imgPos - 800), imgPos);
    // Find the innermost opening div/element before this img
    const parentDivs = [...before.matchAll(/<(?:div|section)\b([^>]*)>/gi)];
    if (parentDivs.length === 0) continue;
    const closestParent = parentDivs[parentDivs.length - 1];
    const parentAttrs = closestParent[1];
    // Check inline style
    const styleMatch = parentAttrs.match(/style\s*=\s*["']([^"']+)/i);
    if (!styleMatch) continue;
    const style = styleMatch[1];
    // Must have flex centering
    const hasFlex = /display\s*:\s*flex/i.test(style);
    const hasAlignCenter = /align-items\s*:\s*center/i.test(style);
    if (!hasFlex || !hasAlignCenter) continue;
    // Check if height is set (height:100%, height:NNpt, etc.)
    const hasHeight = /(?:^|;)\s*height\s*:/i.test(style);
    if (!hasHeight) {
      // Also check if it might be in a CSS class (check <style> block)
      // Extract class if any
      const classMatch = parentAttrs.match(/class\s*=\s*["']([^"']+)/i);
      let heightInClass = false;
      if (classMatch) {
        const className = classMatch[1].trim().split(/\s+/)[0];
        const classRe = new RegExp(`\\.${className}\\s*\\{([^}]+)\\}`, 'i');
        const classBody = html.match(classRe);
        if (classBody && /height\s*:/i.test(classBody[1])) {
          heightInClass = true;
        }
      }
      if (!heightInClass) {
        const src = (m[0].match(/src=["']([^"']+)/i) || [])[1] || 'unknown';
        issues.push(fmtWarn(file, 'PF-56',
          `Image container has flex centering but no explicit height — vertical centering will not work (img: ${src})`));
      }
    }
  }
  return issues;
}

/**
 * PF-57: Image too small relative to its container
 * Detects images with max-width/width < 30% of slide width (720pt) in split layouts
 */
function checkPF57(html, file) {
  const issues = [];
  const imgRe = /<img\b([^>]*)>/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    const attrs = m[1];
    const srcMatch = attrs.match(/src\s*=\s*["']([^"']+)/i);
    if (!srcMatch) continue;
    const src = srcMatch[1];
    if (!/assets\//i.test(src)) continue; // only project images

    // Extract image dimensions from inline style or attributes
    const styleMatch = attrs.match(/style\s*=\s*["']([^"']+)/i);
    const style = styleMatch ? styleMatch[1] : '';

    // Get width/max-width in pt
    let imgWidth = null;
    const widthStyle = style.match(/(?:max-)?width\s*:\s*([\d.]+)\s*pt/i);
    const widthAttr = attrs.match(/width\s*=\s*["']?([\d.]+)/i);
    if (widthStyle) imgWidth = parseFloat(widthStyle[1]);
    else if (widthAttr) imgWidth = parseFloat(widthAttr[1]);

    let imgHeight = null;
    const heightStyle = style.match(/(?:max-)?height\s*:\s*([\d.]+)\s*pt/i);
    if (heightStyle) imgHeight = parseFloat(heightStyle[1]);

    // If image has explicit small dimensions
    if (imgWidth !== null && imgWidth < 100) {
      issues.push(fmtWarn(file, 'PF-57',
        `Image "${src}" width=${imgWidth}pt is very small (<100pt) — content may be hard to see`));
    } else if (imgHeight !== null && imgHeight < 80 && imgWidth === null) {
      issues.push(fmtWarn(file, 'PF-57',
        `Image "${src}" height=${imgHeight}pt is very small (<80pt) — content may be hard to see`));
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
    ...checkPF25(html, file),
    ...checkPF27(html, file),
    ...checkPF28(html, file),
    ...checkPF29(html, file),
    ...checkPF30(html, file),
    ...checkPF34(html, file),
    ...checkPF35(html, file),
    ...checkPF36(html, file),
    ...checkPF37(html, file),
    ...checkPF38(html, file),
    ...checkPF39(html, file),
    ...checkPF40(html, file),
    ...checkPF41(html, file),
    ...checkPF42(html, file),
    ...checkPF43(html, file),
    ...checkPF44(html, file),
    ...checkPF45(html, file),
    ...checkPF46(html, file),
    ...checkPF47(html, file),
    ...checkPF48(html, file),
    ...checkPF49(html, file),
    ...checkPF50(html, file),
    ...checkPF51(html, file),
    ...checkPF52(html, file),
    ...checkPF53(html, file),
    ...checkPF54(html, file),
    ...checkPF55(html, file),
    ...checkPF56(html, file),
    ...checkPF57(html, file),
    ...checkPF59(html, file),
    ...checkPF60(html, file),
  ];
}

// ── Playwright checks (Phase 2) ─────────────────────────────────────────────

async function runPlaywrightChecks(slidesDir, files) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const results = [];
  // A-02: Reuse a single page instead of newPage()/close() per file
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });

  try {
    for (const file of files) {
      const filePath = path.resolve(slidesDir, file);
      const fileUrl = `file:///${filePath.replace(/\\/g, '/')}`;

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
          const isError = overlapIssue.pct >= 20;
          results.push((isError ? fmtError : fmtWarn)(file, 'PF-18',
            `Elements overlap: ${overlapIssue.tag1} and ${overlapIssue.tag2} (${overlapIssue.pct}% overlap) — ${isError ? 'text unreadable, fix layout or split slide' : 'may cause readability issues'}`));
        }

        // PF-20: Bottom margin intrusion (content in 0.5" safe zone: 369pt-405pt)
        // getBoundingClientRect returns px; convert to pt: pt = px * 0.75 (72/96)
        const marginIssue = await page.evaluate(() => {
          const allEls = document.querySelectorAll('body > *');
          let maxBottomPx = 0;
          for (const el of allEls) {
            const r = el.getBoundingClientRect();
            if (r.height > 0 && r.bottom > maxBottomPx) maxBottomPx = r.bottom;
          }
          const maxBottomPt = maxBottomPx * 0.75; // px → pt
          // 369pt = 405pt - 36pt (0.5" margin)
          return { maxBottom: Math.round(maxBottomPt * 100) / 100, inMargin: maxBottomPt > 369, overSlide: maxBottomPt > 405 };
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

            // DPI estimation: display pt * 96/72 → effective pixels needed, compare with natural
            // For projection: 96 DPI minimum, so display width in inches × 96 = min pixels
            // Slide is 720pt = 10 inches, so 1pt ≈ 1/72 inch
            const displayWidthInches = r.width / 72;
            const effectiveDPI = img.naturalWidth / displayWidthInches;
            if (effectiveDPI < 72 && r.width > 50) {
              issues.push({ type: 'lowdpi', src: img.src.split('/').pop(), dpi: Math.round(effectiveDPI) });
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
          } else if (img.type === 'lowdpi') {
            results.push(fmtWarn(file, 'PF-21',
              `Image "${img.src}" effective DPI ${img.dpi} (min 72) — will look pixelated when projected`));
          }
        }

        // PF-26: Content section density — count visible top-level content blocks
        const densityCheck = await page.evaluate(() => {
          const body = document.body;
          if (!body) return { count: 0 };
          const children = Array.from(body.children);
          let visibleBlocks = 0;
          for (const child of children) {
            const r = child.getBoundingClientRect();
            // Count only visible blocks with meaningful size (> 30px height, > 50px width)
            if (r.height > 30 && r.width > 50) {
              visibleBlocks++;
            }
          }
          return { count: visibleBlocks };
        });
        if (densityCheck.count > 5) {
          results.push(fmtError(file, 'PF-26',
            `Slide has ${densityCheck.count} top-level content blocks (max 5) — split into multiple slides [IL-33]`));
        } else if (densityCheck.count > 4) {
          results.push(fmtWarn(file, 'PF-26',
            `Slide has ${densityCheck.count} top-level content blocks — consider splitting for readability [IL-33]`));
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

        // PF-61: Image background contrast — check text readability on background images
        // Samples pixel brightness under text elements that sit on top of images
        const imgContrastIssues = await page.evaluate(() => {
          const issues = [];
          // Find text elements positioned over background images
          const textEls = document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,span');
          for (const el of textEls) {
            const text = (el.textContent || '').trim();
            if (!text || text.length < 2) continue;
            const cs = getComputedStyle(el);
            const textColor = cs.color;
            // Parse text color rgb
            const rgbMatch = textColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (!rgbMatch) continue;
            const [tr, tg, tb] = [+rgbMatch[1], +rgbMatch[2], +rgbMatch[3]];

            // Check if any ancestor has a background-image or if there's an <img> behind this element
            let hasImageBg = false;
            let ancestor = el.parentElement;
            while (ancestor) {
              const acs = getComputedStyle(ancestor);
              if (acs.backgroundImage && acs.backgroundImage !== 'none') {
                hasImageBg = true;
                break;
              }
              ancestor = ancestor.parentElement;
            }
            // Also check for <img> siblings/cousins that might be positioned behind (absolute/relative)
            // Walk up ALL ancestors — the <img> may be a sibling of any ancestor, not just the closest positioned one
            if (!hasImageBg) {
              const elRect = el.getBoundingClientRect();
              let walk = el.parentElement;
              while (walk && walk !== document.body) {
                const imgs = walk.querySelectorAll(':scope > img');
                for (const img of imgs) {
                  const imgCs = getComputedStyle(img);
                  if (imgCs.position === 'absolute' || imgCs.position === 'fixed') {
                    const imgRect = img.getBoundingClientRect();
                    if (imgRect.left <= elRect.left && imgRect.right >= elRect.right &&
                        imgRect.top <= elRect.top && imgRect.bottom >= elRect.bottom) {
                      hasImageBg = true;
                      break;
                    }
                  }
                }
                if (hasImageBg) break;
                walk = walk.parentElement;
              }
            }
            if (!hasImageBg) continue;

            // Check if there's a solid overlay between image and text
            // Walk up from text element, check for solid background divs
            let hasOverlay = false;
            let cur = el.parentElement;
            while (cur && cur !== document.body) {
              const curCs = getComputedStyle(cur);
              const bg = curCs.backgroundColor;
              if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
                // Parse alpha
                const rgbaM = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
                if (rgbaM) {
                  const alpha = rgbaM[4] !== undefined ? parseFloat(rgbaM[4]) : 1;
                  if (alpha >= 0.4) {
                    hasOverlay = true;
                    break;
                  }
                }
              }
              // Check opacity property on the element (used for overlays)
              const opacity = parseFloat(curCs.opacity);
              if (opacity < 1 && curCs.backgroundColor && curCs.backgroundColor !== 'transparent' && curCs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
                hasOverlay = true;
                break;
              }
              cur = cur.parentElement;
            }

            // Check text-shadow as fallback readability aid
            const hasShadow = cs.textShadow && cs.textShadow !== 'none';

            if (!hasOverlay && !hasShadow) {
              issues.push({
                text: text.substring(0, 40),
                color: `rgb(${tr},${tg},${tb})`,
                tag: el.tagName
              });
            }
          }
          return issues;
        });
        for (const issue of imgContrastIssues) {
          results.push(fmtWarn(file, 'PF-61',
            `Text "${issue.text}..." (${issue.color}) on background image without overlay or text-shadow — may be unreadable [IL-69]`));
        }

      } catch (e) {
        results.push(fmtWarn(file, 'PF-XX', `Playwright check failed: ${e.message}`));
      }
    }
  } finally {
    await page.close();
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
  const metrics = { h1FontSize: null, h1Text: null, bodyPadding: null, usedColors: [], bodyBgBrightness: null, textColors: [] };

  // h1 font-size (inline style) and text content
  const h1Match = html.match(/<h1[^>]*style="[^"]*font-size\s*:\s*([\d.]+)\s*pt/i);
  if (h1Match) metrics.h1FontSize = parseFloat(h1Match[1]);
  const h1TextMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1TextMatch) metrics.h1Text = h1TextMatch[1].replace(/<[^>]+>/g, '').trim();

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

  // Body background brightness for PF-24 — check both inline and <style> block
  const bodyBgMatch = html.match(/<body[^>]*style="[^"]*background\s*:\s*#([0-9a-fA-F]{6})/i)
    || html.match(/body\s*\{[^}]*background\s*:\s*#([0-9a-fA-F]{6})/i);
  if (bodyBgMatch) {
    const rgb = hexToRgb(bodyBgMatch[1]);
    if (rgb) metrics.bodyBgBrightness = relativeLuminance(...rgb);
  }

  // All container background colors for PF-24 (div/section/header with background)
  // Used to avoid false positives: white text on dark div is fine even if body bg is white
  metrics.containerBgColors = [];
  const styleBlockMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  const bgRe = /background\s*:\s*#([0-9a-fA-F]{6})/gi;
  for (const sb of html.matchAll(/style="([^"]*)"/gi)) {
    let bm;
    while ((bm = bgRe.exec(sb[1])) !== null) {
      metrics.containerBgColors.push(bm[1].toUpperCase());
    }
  }
  if (styleBlockMatch) {
    let bm;
    const bgReBlock = /background\s*:\s*#([0-9a-fA-F]{6})/gi;
    while ((bm = bgReBlock.exec(styleBlockMatch[1])) !== null) {
      metrics.containerBgColors.push(bm[1].toUpperCase());
    }
  }

  // Text colors for PF-24 — check both inline styles and <style> blocks
  const textColorRe = /(?:^|;\s*)color\s*:\s*#([0-9a-fA-F]{6})/gi;
  // Inline styles
  for (const sb of html.matchAll(/style="([^"]*)"/gi)) {
    const styleStr = sb[1];
    let tcm;
    while ((tcm = textColorRe.exec(styleStr)) !== null) {
      const preceding = styleStr.substring(Math.max(0, tcm.index - 15), tcm.index);
      if (!/background-?\s*$/i.test(preceding)) {
        metrics.textColors.push(tcm[1].toUpperCase());
      }
    }
  }
  // Style block color declarations (for slides with CSS in <style>)
  if (styleBlockMatch) {
    const styleBlock = styleBlockMatch[1];
    const blockColorRe = /(?:^|;\s*)color\s*:\s*#([0-9a-fA-F]{6})/gi;
    let bcm;
    while ((bcm = blockColorRe.exec(styleBlock)) !== null) {
      const preceding = styleBlock.substring(Math.max(0, bcm.index - 15), bcm.index);
      if (!/background-?\s*$/i.test(preceding)) {
        metrics.textColors.push(bcm[1].toUpperCase());
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

  // PF-31: Title uniqueness (Grackle, MS Accessibility)
  const titles = allMetrics.map((m, i) => ({ text: m.h1Text, slide: i + 1 })).filter(t => t.text);
  const titleMap = new Map();
  for (const t of titles) {
    const norm = t.text.toLowerCase().trim();
    if (!norm) continue;
    if (!titleMap.has(norm)) titleMap.set(norm, []);
    titleMap.get(norm).push(t.slide);
  }
  for (const [title, slides] of titleMap) {
    if (slides.length > 1) {
      warnings.push(fmtWarn('cross-slide', 'PF-31',
        `Duplicate slide title "${title.substring(0, 40)}..." on slides ${slides.join(', ')} — each slide should have a unique title [WCAG]`));
    }
  }

  // PF-24: Cross-slide background-text contrast consistency
  // Improved: check if text has sufficient contrast with ANY background on the slide
  // (body bg OR container div bg) to avoid false positives from table headers etc.
  for (let i = 0; i < allMetrics.length; i++) {
    const m = allMetrics[i];
    if (m.bodyBgBrightness === null || m.textColors.length === 0) continue;
    const isDarkBg = m.bodyBgBrightness < 0.2;
    const isLightBg = m.bodyBgBrightness > 0.8;

    // Collect all background luminances on this slide (body + container divs)
    const allBgLums = [m.bodyBgBrightness];
    for (const bgHex of (m.containerBgColors || [])) {
      const bgRgb = hexToRgb(bgHex);
      if (bgRgb) allBgLums.push(relativeLuminance(...bgRgb));
    }

    for (const tc of m.textColors) {
      const rgb = hexToRgb(tc);
      if (!rgb) continue;
      const textLum = relativeLuminance(...rgb);

      // Check: does this text color have good contrast with ANY background on the slide?
      // WCAG contrast ratio = (L1 + 0.05) / (L2 + 0.05) where L1 > L2
      const hasGoodContrast = allBgLums.some(bgLum => {
        const l1 = Math.max(textLum, bgLum);
        const l2 = Math.min(textLum, bgLum);
        return (l1 + 0.05) / (l2 + 0.05) >= 3.0; // minimum 3:1 for large text
      });

      if (hasGoodContrast) continue; // text is readable on at least one background

      // No background provides sufficient contrast — warn
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
    const issues = [
      ...runStaticChecks(html, file),
      ...checkPF58(html, file, absDir),
    ];
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
