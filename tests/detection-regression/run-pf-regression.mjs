#!/usr/bin/env node
/**
 * PF (Preflight HTML) Regression Test Runner — Static Rules Only
 *
 * Tests PF static check functions against known true-positive and false-positive
 * cases from the regression DB. Does NOT require Playwright (static regex only).
 *
 * Usage: node tests/detection-regression/run-pf-regression.mjs
 *
 * Exit code 0 = all pass, 1 = regression found
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Helpers (mirrored from preflight-html.js) ─────────────────────────────

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

function isBrightColor(colorStr) {
  if (!colorStr) return false;
  const s = colorStr.trim().toLowerCase();
  const hexMatch = s.match(/^#([0-9a-f]{3,6})$/i);
  if (hexMatch) {
    const rgb = hexToRgb(hexMatch[1]);
    return rgb ? relativeLuminance(...rgb) > 0.8 : false;
  }
  const rgbMatch = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch.map(Number);
    return relativeLuminance(r, g, b) > 0.8;
  }
  if (s === 'white') return true;
  return false;
}

const CJK_RE = /[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;
const FLAG_EMOJI_RE = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;

// ── PF Check Functions (re-implemented from preflight-html.js) ────────────
// Returns: 'ERROR' | 'WARN' | null

function checkPF01(html) {
  const gradientDivRe = /style="[^"]*(?:background(?:-image)?\s*:\s*[^"]*(?:linear|radial)-gradient)[^"]*"/gi;
  let m;
  while ((m = gradientDivRe.exec(html)) !== null) {
    const after = html.substring(m.index, m.index + 800);
    const colorMatches = after.matchAll(/color\s*:\s*([^;"'\s]+(?:\([^)]*\))?)/gi);
    for (const cm of colorMatches) {
      const preceding = after.substring(0, cm.index);
      if (/background-?\s*$/i.test(preceding)) continue;
      if (isBrightColor(cm[1])) return 'ERROR';
    }
  }
  return null;
}

function checkPF02(html) {
  const flexOneRe = /style="([^"]*)"/gi;
  let m;
  while ((m = flexOneRe.exec(html)) !== null) {
    const style = m[1];
    if (/flex\s*:\s*1(?:\s|;|$)/.test(style) && !/box-sizing\s*:\s*border-box/i.test(style)) {
      return 'WARN';
    }
  }
  return null;
}

function checkPF04(html) {
  const imgRe = /<img\s[^>]*style="([^"]*)"/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    const style = m[1];
    if (/height\s*:\s*100%/i.test(style) && !/max-height/i.test(style)) return 'WARN';
  }
  return null;
}

function checkPF05(html) {
  const divBgRe = /<div\s[^>]*style="[^"]*background(?:-image)?\s*:\s*[^"]*url\s*\(/gi;
  if (divBgRe.test(html)) return 'ERROR';
  return null;
}

function checkPF06(html) {
  const flexDivRe = /<div\s[^>]*style="([^"]*display\s*:\s*flex[^"]*)"/gi;
  let m;
  while ((m = flexDivRe.exec(html)) !== null) {
    const style = m[1];
    const afterDiv = html.substring(m.index, m.index + 1500);
    if (/<img\s/i.test(afterDiv) && !/overflow\s*:\s*hidden/i.test(style)) return 'WARN';
  }
  return null;
}

function checkPF07(html) {
  const tagRe = /<(p|h[1-6]|li)\s[^>]*style="([^"]*)"/gi;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const style = m[2];
    if (/(?:^|;\s*)(?:background|border)\s*:/i.test(style)) return 'ERROR';
  }
  return null;
}

function checkPF12(html) {
  FLAG_EMOJI_RE.lastIndex = 0;
  if (FLAG_EMOJI_RE.test(html)) return 'ERROR';
  return null;
}

function checkPF13(html) {
  const styleRe = /style="([^"]*)"/gi;
  let m;
  while ((m = styleRe.exec(html)) !== null) {
    const style = m[1];
    if (/border-radius\s*:\s*50%/i.test(style) && /(?:^|;\s*)border\s*:/i.test(style)) return 'ERROR';
  }
  return null;
}

function checkPF14(html) {
  const patternRe = /<div\s[^>]*style="[^"]*background[^"]*"[^>]*>\s*<\/div>\s*<span[\s>]/gi;
  if (patternRe.test(html)) return 'WARN';
  return null;
}

function checkPF15(html) {
  const gridRe = /style="([^"]*grid-template-columns\s*:[^"]*)"/gi;
  let m;
  while ((m = gridRe.exec(html)) !== null) {
    const style = m[1];
    const colMatch = style.match(/grid-template-columns\s*:\s*([^;"]+)/i);
    if (!colMatch) continue;
    const colValue = colMatch[1].trim();
    const repeatMatch = colValue.match(/repeat\(\s*(\d+)/);
    let colCount;
    if (repeatMatch) {
      colCount = parseInt(repeatMatch[1], 10);
    } else {
      const colTokens = colValue.split(/\s+/).filter(t => t && !t.startsWith('/'));
      colCount = colTokens.length;
    }
    if (colCount < 3) continue;
    const afterIdx = m.index;
    const region = html.substring(afterIdx, afterIdx + 3000);
    if (!CJK_RE.test(region)) continue;
    const fontSizeRe = /font-size\s*:\s*([\d.]+)\s*pt/gi;
    let fs;
    while ((fs = fontSizeRe.exec(region)) !== null) {
      const size = parseFloat(fs[1]);
      if (size > 7.5 && CJK_RE.test(region.substring(fs.index, fs.index + 500))) return 'WARN';
    }
  }
  return null;
}

function checkPF16(html) {
  const bodyBgInline = /<body[^>]*style="[^"]*background[^"]*url\s*\(/i.test(html);
  const bodyBgStyle = /body\s*\{[^}]*background[^}]*url\s*\(/i.test(html);
  if (!bodyBgInline && !bodyBgStyle) return null;
  const textElRe = /<(h[1-6]|p)\s[^>]*style="([^"]*)"/gi;
  let m;
  while ((m = textElRe.exec(html)) !== null) {
    const style = m[2];
    if (!/text-shadow/i.test(style)) return 'WARN';
  }
  return null;
}

function checkPF17(html) {
  const transformRe = /transform\s*:\s*([^;"]+)/gi;
  let m;
  while ((m = transformRe.exec(html)) !== null) {
    const val = m[1];
    if (/(?:scale\w*|skew\w*|perspective|matrix\w*)\s*\(/i.test(val)) return 'WARN';
  }
  return null;
}

const ALLOWED_FONTS = new Set([
  'pretendard', 'segoe ui', 'arial', 'helvetica', 'sans-serif', 'serif',
  'times new roman', 'courier new', 'monospace', 'calibri', 'cambria',
  'noto sans kr', 'noto sans', 'malgun gothic', 'gulim', 'dotum',
  'biz udpgothic', 'meiryo', 'yu gothic', 'ms pgothic',
  'inherit', 'initial', 'unset',
  '-apple-system', 'blinkmacsystemfont', 'system-ui', 'ui-sans-serif',
  'ui-serif', 'ui-monospace', 'ui-rounded',
]);

function checkPF19(html) {
  const fontRe = /font-family\s*:\s*([^;"]+)/gi;
  let m;
  while ((m = fontRe.exec(html)) !== null) {
    const fonts = m[1].split(',').map(f => f.trim().replace(/['"]/g, '').toLowerCase());
    for (const font of fonts) {
      if (!font || ALLOWED_FONTS.has(font)) continue;
      return 'WARN';
    }
  }
  return null;
}

const UNSUPPORTED_CSS_RE = /(?:backdrop-filter|clip-path|mask-image|filter\s*:\s*(?!none)(?:blur|brightness|contrast|drop-shadow|grayscale|hue-rotate|invert|saturate|sepia)|writing-mode\s*:\s*vertical|animation\s*:|@keyframes)\s*/i;

function checkPF22(html) {
  const styleRe = /style="([^"]*)"/gi;
  let m;
  while ((m = styleRe.exec(html)) !== null) {
    const style = m[1];
    if (UNSUPPORTED_CSS_RE.test(style)) return 'WARN';
    if (/box-shadow\s*:[^;]*\binset\b/i.test(style)) return 'WARN';
  }
  const styleBlockRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = styleBlockRe.exec(html)) !== null) {
    const block = m[1];
    if (UNSUPPORTED_CSS_RE.test(block)) return 'WARN';
    if (/box-shadow\s*:[^;]*\binset\b/i.test(block)) return 'WARN';
  }
  return null;
}

function checkPF25(html) {
  const fontSizeRe = /font-size\s*:\s*([\d.]+)\s*pt/gi;
  let m;
  while ((m = fontSizeRe.exec(html)) !== null) {
    if (parseFloat(m[1]) < 10) return 'ERROR';
  }
  return null;
}

function checkPF27(html) {
  const styleBlockRe = /style="([^"]*)"/gi;
  let m;
  while ((m = styleBlockRe.exec(html)) !== null) {
    const style = m[1];
    const widthMatch = style.match(/(?:^|;\s*)width\s*:\s*([\d.]+)\s*pt/i);
    if (!widthMatch) continue;
    const width = parseFloat(widthMatch[1]);
    if (width >= 150) continue;
    if (/white-space\s*:\s*nowrap/i.test(style)) continue;
    const pos = m.index;
    const nearby = html.substring(pos, Math.min(pos + 500, html.length));
    if (CJK_RE.test(nearby)) return 'WARN';
  }
  return null;
}

function checkPF28(html) {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : html;
  const textOnly = bodyContent.replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cjkChars = (textOnly.match(/[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/g) || []).length;
  const nonCjk = textOnly.replace(/[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/g, ' ');
  const latinWords = nonCjk.split(/\s+/).filter(w => w.length > 0).length;
  const wordEquiv = latinWords + Math.ceil(cjkChars / 2);
  if (wordEquiv > 120) return 'ERROR';
  if (wordEquiv > 80) return 'WARN';
  return null;
}

function checkPF29(html) {
  const imgRe = /<img\b([^>]*)>/gi;
  let m;
  let missing = 0;
  while ((m = imgRe.exec(html)) !== null) {
    const attrs = m[1];
    if (/width\s*[:=]\s*["']?\d{1,2}(px|pt)/i.test(attrs)) continue;
    const altMatch = attrs.match(/\balt\s*=\s*"([^"]*)"/i);
    if (!altMatch || altMatch[1].trim() === '') missing++;
  }
  return missing > 0 ? 'WARN' : null;
}

function checkPF30(html) {
  let titleSize = 0;
  let bodyMaxSize = 0;
  const titleRe = /<h[12][^>]*style="[^"]*font-size\s*:\s*([\d.]+)\s*pt/gi;
  let m;
  while ((m = titleRe.exec(html)) !== null) {
    const size = parseFloat(m[1]);
    if (size > titleSize) titleSize = size;
  }
  const bodyRe = /<(?:p|li)\b[^>]*style="[^"]*font-size\s*:\s*([\d.]+)\s*pt/gi;
  while ((m = bodyRe.exec(html)) !== null) {
    const size = parseFloat(m[1]);
    if (size > bodyMaxSize) bodyMaxSize = size;
  }
  if (titleSize > 0 && bodyMaxSize > 0 && titleSize <= bodyMaxSize) return 'WARN';
  return null;
}

function checkPF34(html) {
  const textElRe = /<(h[1-6]|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = textElRe.exec(html)) !== null) {
    const content = m[2];
    const spanRe = /<span\b[^>]*(?:style|class)[^>]*>/gi;
    const spans = content.match(spanRe);
    if (!spans) continue;
    const textOutsideSpans = content
      .replace(/<span\b[\s\S]*?<\/span>/gi, '')
      .replace(/<br\s*\/?>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, '')
      .trim();
    if (textOutsideSpans.length > 0 && spans.length > 0) return 'ERROR';
  }
  return null;
}

function checkPF35(html) {
  const hasLi = /<li\b/i.test(html);
  const hasPseudo = /::(?:before|after)\s*\{/i.test(html);
  return (hasLi && hasPseudo) ? 'ERROR' : null;
}

function checkPF36(html) {
  // Style blocks
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch;
  while ((styleMatch = styleRe.exec(html)) !== null) {
    const css = styleMatch[1];
    const bgRgbaRe = /background(?:-color)?\s*:\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/gi;
    let bgMatch;
    while ((bgMatch = bgRgbaRe.exec(css)) !== null) {
      const alpha = parseFloat(bgMatch[4]);
      if (alpha > 0 && alpha < 1.0) return 'ERROR';
    }
  }
  // Inline styles
  const inlineRe = /style="[^"]*background(?:-color)?\s*:\s*rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/gi;
  let inlineMatch;
  while ((inlineMatch = inlineRe.exec(html)) !== null) {
    const alpha = parseFloat(inlineMatch[4]);
    if (alpha > 0 && alpha < 1.0) return 'ERROR';
  }
  return null;
}

function checkPF37(html) {
  const allCss = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = styleRe.exec(html)) !== null) allCss.push(m[1]);
  const inlineRe = /style="([^"]*)"/gi;
  while ((m = inlineRe.exec(html)) !== null) allCss.push(m[1]);
  for (const css of allCss) {
    const borderTransRe = /border-(top|bottom|left|right)\s*:\s*[^;]*transparent/gi;
    if (borderTransRe.test(css)) return 'ERROR';
  }
  return null;
}

function checkPF38(html) {
  const re = /text-decoration(?:-line)?\s*:\s*[^;]*underline/gi;
  return re.test(html) ? 'ERROR' : null;
}

function checkPF39(html) {
  // Inline styles on non-body elements
  const inlineGradRe = /<(?!body\b)(\w+)[^>]*style="[^"]*background-image\s*:\s*linear-gradient\([^"]*"/gi;
  if (inlineGradRe.test(html)) return 'ERROR';
  // Style blocks
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = styleRe.exec(html)) !== null) {
    const css = m[1];
    const ruleRe = /([^{}]+)\{([^}]*background-image\s*:\s*linear-gradient[^}]*)\}/gi;
    let rm;
    while ((rm = ruleRe.exec(css)) !== null) {
      const selector = rm[1].trim();
      if (/^(body|html)\s*$/i.test(selector)) continue;
      return 'ERROR';
    }
  }
  return null;
}

function checkPF40(html) {
  const BANNED_KEYWORDS = /chart|graph|table|data|infographic|calendar|spreadsheet|timeline|diagram|funnel|waterfall|donut|pie|heatmap/i;
  const imgRe = /<img\b([^>]*)>/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    const attrs = m[1];
    const srcMatch = attrs.match(/src\s*=\s*["']([^"']+)/i);
    if (!srcMatch) continue;
    const src = srcMatch[1];
    if (!/assets\//i.test(src)) continue;
    if (/\.svg$/i.test(src)) continue;
    const filename = src.split('/').pop().toLowerCase();
    const altMatch = attrs.match(/alt\s*=\s*["']([^"']*)/i);
    const alt = altMatch ? altMatch[1] : '';
    if (BANNED_KEYWORDS.test(filename) || BANNED_KEYWORDS.test(alt)) return 'WARN';
  }
  return null;
}

function checkPF41(html) {
  const re = /letter-spacing\s*:\s*(-?[\d.]+)\s*pt/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (Math.abs(parseFloat(m[1])) > 1) return 'WARN';
  }
  return null;
}

function checkPF42(html) {
  // Inline styles
  const styleRe = /style="([^"]*)"/gi;
  let m;
  while ((m = styleRe.exec(html)) !== null) {
    const style = m[1];
    const opacityMatch = style.match(/(?:^|;\s*)opacity\s*:\s*([\d.]+)/i);
    if (!opacityMatch) continue;
    const val = parseFloat(opacityMatch[1]);
    if (val < 1.0) {
      const tagBefore = html.substring(Math.max(0, m.index - 30), m.index);
      if (/<body\b/i.test(tagBefore)) continue;
      return 'WARN';
    }
  }
  // Style blocks
  const styleBlockRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = styleBlockRe.exec(html)) !== null) {
    const css = m[1];
    const opacityMatch = css.match(/(?:^|;\s*|{\s*)opacity\s*:\s*([\d.]+)/i);
    if (opacityMatch && parseFloat(opacityMatch[1]) < 1.0) return 'WARN';
  }
  return null;
}

function checkPF43(html) {
  const re = /object-fit\s*:\s*(cover|fill|scale-down)/gi;
  return re.test(html) ? 'WARN' : null;
}

function checkPF44(html) {
  const allCss = [];
  let m;
  const inlineRe = /style="([^"]*)"/gi;
  while ((m = inlineRe.exec(html)) !== null) allCss.push(m[1]);
  const styleBlockRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = styleBlockRe.exec(html)) !== null) allCss.push(m[1]);
  for (const css of allCss) {
    const outlineRe = /(?:^|;\s*)outline\s*:\s*([^;"]+)/gi;
    let om;
    while ((om = outlineRe.exec(css)) !== null) {
      const val = om[1].trim().toLowerCase();
      if (val === 'none' || val === '0' || val === '0px' || val === '0pt') continue;
      return 'WARN';
    }
  }
  return null;
}

function checkPF45(html) {
  const re = /margin(?:-(?:top|bottom|left|right))?\s*:\s*(-[\d.]+)\s*pt/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (parseFloat(m[1]) <= -5) return 'WARN';
  }
  return null;
}

function checkPF46(html) {
  const re = /text-indent\s*:\s*(-?[\d.]+)\s*(?:pt|px|em)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (parseFloat(m[1]) !== 0) return 'WARN';
  }
  return null;
}

function checkPF47(html) {
  return /word-break\s*:\s*break-all/i.test(html) ? 'WARN' : null;
}

function checkPF48(html) {
  const re = /(?<![a-z-])(?:column-count|columns)\s*:\s*(\d+)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (parseInt(m[1], 10) >= 2) return 'ERROR';
  }
  return null;
}

function checkPF49(html) {
  const re = /mix-blend-mode\s*:\s*(\w[\w-]*)/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1].toLowerCase() !== 'normal') return 'WARN';
  }
  return null;
}

function checkPF50(html) {
  return /border-image(?:-source)?\s*:\s*(?!none)/i.test(html) ? 'WARN' : null;
}

function checkPF51(html) {
  return /position\s*:\s*sticky/i.test(html) ? 'WARN' : null;
}

function checkPF52(html) {
  return /@font-face\s*\{/i.test(html) ? 'WARN' : null;
}

function checkPF53(html) {
  return /direction\s*:\s*rtl/i.test(html) ? 'WARN' : null;
}

function checkPF54(html) {
  if (/white-space\s*:\s*pre(?:-line)?(?:\s|;|"|$)/i.test(html)) {
    const match = html.match(/white-space\s*:\s*(pre(?:-line)?)(?:\s|;|"|$)/i);
    if (match) return 'WARN';
  }
  return null;
}

function checkPF55(html) {
  const spanBgRe = /<span\b[^>]*style="[^"]*background(?:-color)?\s*:\s*(?!none|transparent)[^"]*"[^>]*>/gi;
  let m;
  while ((m = spanBgRe.exec(html)) !== null) {
    const tag = m[0];
    const bgMatch = tag.match(/background(?:-color)?\s*:\s*(#[0-9A-Fa-f]{3,8}|rgba?\([^)]+\)|[a-z]+)/i);
    if (bgMatch) return 'ERROR';
  }
  return null;
}

function checkPF56(html) {
  const imgRe = /<img\b[^>]*src\s*=["'](?:assets\/[^"']+)["'][^>]*>/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    const imgPos = m.index;
    const before = html.substring(Math.max(0, imgPos - 800), imgPos);
    const parentDivs = [...before.matchAll(/<(?:div|section)\b([^>]*)>/gi)];
    if (parentDivs.length === 0) continue;
    const closestParent = parentDivs[parentDivs.length - 1];
    const parentAttrs = closestParent[1];
    const styleMatch = parentAttrs.match(/style\s*=["']([^"']+)/i);
    if (!styleMatch) continue;
    const style = styleMatch[1];
    const hasFlex = /display\s*:\s*flex/i.test(style);
    const hasAlignCenter = /align-items\s*:\s*center/i.test(style);
    if (!hasFlex || !hasAlignCenter) continue;
    const hasHeight = /(?:^|;)\s*height\s*:/i.test(style);
    if (!hasHeight) {
      const classMatch = parentAttrs.match(/class\s*=["']([^"']+)/i);
      let heightInClass = false;
      if (classMatch) {
        const className = classMatch[1].trim().split(/\s+/)[0];
        const classRe = new RegExp(`\\.${className}\\s*\\{([^}]+)\\}`, 'i');
        const classBody = html.match(classRe);
        if (classBody && /height\s*:/i.test(classBody[1])) heightInClass = true;
      }
      if (!heightInClass) return 'WARN';
    }
  }
  return null;
}

function checkPF57(html) {
  const imgRe = /<img\b([^>]*)>/gi;
  let m;
  while ((m = imgRe.exec(html)) !== null) {
    const attrs = m[1];
    const srcMatch = attrs.match(/src\s*=["']([^"']+)/i);
    if (!srcMatch) continue;
    if (!/assets\//i.test(srcMatch[1])) continue;
    const styleMatch = attrs.match(/style\s*=["']([^"']+)/i);
    const style = styleMatch ? styleMatch[1] : '';
    const widthStyle = style.match(/(?:max-)?width\s*:\s*([\d.]+)\s*pt/i);
    const widthAttr = attrs.match(/width\s*=["']?([\d.]+)/i);
    let imgWidth = null;
    if (widthStyle) imgWidth = parseFloat(widthStyle[1]);
    else if (widthAttr) imgWidth = parseFloat(widthAttr[1]);
    if (imgWidth !== null && imgWidth < 100) return 'WARN';
    const heightStyle = style.match(/(?:max-)?height\s*:\s*([\d.]+)\s*pt/i);
    if (heightStyle && parseFloat(heightStyle[1]) < 80 && imgWidth === null) return 'WARN';
  }
  return null;
}

// ── Rule dispatch map ─────────────────────────────────────────────────────

const CHECK_MAP = {
  'PF-01': checkPF01,
  'PF-02': checkPF02,
  'PF-04': checkPF04,
  'PF-05': checkPF05,
  'PF-06': checkPF06,
  'PF-07': checkPF07,
  'PF-12': checkPF12,
  'PF-13': checkPF13,
  'PF-14': checkPF14,
  'PF-15': checkPF15,
  'PF-16': checkPF16,
  'PF-17': checkPF17,
  'PF-19': checkPF19,
  'PF-22': checkPF22,
  'PF-25': checkPF25,
  'PF-27': checkPF27,
  'PF-28': checkPF28,
  'PF-29': checkPF29,
  'PF-30': checkPF30,
  'PF-34': checkPF34,
  'PF-35': checkPF35,
  'PF-36': checkPF36,
  'PF-37': checkPF37,
  'PF-38': checkPF38,
  'PF-39': checkPF39,
  'PF-40': checkPF40,
  'PF-41': checkPF41,
  'PF-42': checkPF42,
  'PF-43': checkPF43,
  'PF-44': checkPF44,
  'PF-45': checkPF45,
  'PF-46': checkPF46,
  'PF-47': checkPF47,
  'PF-48': checkPF48,
  'PF-49': checkPF49,
  'PF-50': checkPF50,
  'PF-51': checkPF51,
  'PF-52': checkPF52,
  'PF-53': checkPF53,
  'PF-54': checkPF54,
  'PF-55': checkPF55,
  'PF-56': checkPF56,
  'PF-57': checkPF57,
};

// ── Test runner ───────────────────────────────────────────────────────────

function runTests() {
  const casesFile = join(__dirname, 'pf-cases.json');
  const data = JSON.parse(readFileSync(casesFile, 'utf8'));
  const cases = data.cases;

  let passed = 0, failed = 0, skipped = 0, knownIssues = 0;
  const failures = [];

  for (const tc of cases) {
    const checkFn = CHECK_MAP[tc.rule];
    if (!checkFn) {
      skipped++;
      console.log(`  ? ${tc.id}: SKIPPED — no check function for ${tc.rule}`);
      continue;
    }

    if (!tc.input || !tc.input.html) {
      skipped++;
      console.log(`  ? ${tc.id}: SKIPPED — no input.html`);
      continue;
    }

    const actual = checkFn(tc.input.html);

    // Known issues: verify the code still produces the ACTUAL (not desired) level
    if (tc.status === 'known_issue') {
      const actualLevel = tc.actualLevel ?? null;
      if (actual === actualLevel) {
        knownIssues++;
        console.log(`  \u26a0 ${tc.id}: KNOWN ISSUE — want ${tc.expectedLevel ?? 'null'}, code gives ${actual ?? 'null'} (tracked)`);
      } else {
        if (actual === tc.expectedLevel || (tc.type === 'true_positive' && actual != null && tc.expectedLevel != null)) {
          passed++;
          console.log(`  \ud83c\udf89 ${tc.id}: FIXED — now gives ${actual ?? 'null'} (was ${actualLevel ?? 'null'}, wanted ${tc.expectedLevel ?? 'null'})`);
        } else {
          failed++;
          console.log(`  \u2717 ${tc.id}: CHANGED — was ${actualLevel ?? 'null'}, now ${actual ?? 'null'} (wanted ${tc.expectedLevel ?? 'null'})`);
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
      // false_positive: should NOT detect (or detect at a lower/equal level)
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
      console.log(`  \u2713 ${tc.id}: ${tc.type === 'true_positive' ? 'TP' : 'FP'} — expected ${tc.expectedLevel ?? 'null'}, got ${actual ?? 'null'}`);
    } else {
      failed++;
      const msg = `  \u2717 ${tc.id}: REGRESSION — expected ${tc.expectedLevel ?? 'null'}, got ${actual ?? 'null'} (${tc.description})`;
      console.log(msg);
      failures.push({ id: tc.id, expected: tc.expectedLevel, actual, description: tc.description });
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${knownIssues} known issues, ${skipped} skipped`);

  if (failures.length > 0) {
    console.log('\n\u274c REGRESSIONS FOUND:');
    for (const f of failures) {
      console.log(`  ${f.id}: expected ${f.expected ?? 'null'} but got ${f.actual ?? 'null'}`);
      console.log(`    ${f.description}`);
    }
    process.exit(1);
  } else {
    console.log('\n\u2705 All PF regression tests passed');
    if (knownIssues > 0) console.log(`   (${knownIssues} known issues tracked for future fix)`);
    process.exit(0);
  }
}

console.log('PF Regression Tests (Static Rules)');
console.log('===================================\n');
runTests();
