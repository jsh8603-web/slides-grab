/**
 * HTML Pre-flight Validator — checks slide HTML files for known anti-patterns
 * BEFORE PPTX conversion.
 *
 * Usage:
 *   node scripts/preflight-html.js --slides-dir slides/presentation-name
 *   node scripts/preflight-html.js --slides-dir slides/presentation-name --full
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

function runStaticChecks(html, file) {
  return [
    ...checkPF01(html, file),
    ...checkPF02(html, file),
    ...checkPF04(html, file),
    ...checkPF05(html, file),
    ...checkPF06(html, file),
    ...checkPF07(html, file),
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

        // PF-08: CJK text in card div with font-size > 11pt (14.67px)
        const cjkIssue = await page.evaluate(() => {
          const CJK = /[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;
          const divs = document.querySelectorAll('div[style*="background"]');
          for (const div of divs) {
            const text = div.textContent || '';
            if (!CJK.test(text)) continue;
            const cs = getComputedStyle(div);
            const fontSize = parseFloat(cs.fontSize);
            // 11pt = 14.67px
            if (fontSize > 14.67) {
              return { found: true, size: Math.round(fontSize * 100) / 100 };
            }
            // Also check child elements
            for (const child of div.querySelectorAll('*')) {
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
  const metrics = { h1FontSize: null, bodyPadding: null, usedColors: [] };

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

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--slides-dir' && args[i + 1]) slidesDir = args[++i];
    if (args[i] === '--full') full = true;
  }

  if (!slidesDir) {
    console.error('Usage: node scripts/preflight-html.js --slides-dir <dir> [--full]');
    process.exit(1);
  }

  console.log(`${BOLD}Pre-flight HTML check: ${path.resolve(slidesDir)}${RESET}`);
  if (full) console.log('  (Playwright checks enabled with --full)\n');
  else console.log('  (Static checks only \u2014 use --full for Playwright overflow/CJK checks)\n');

  const result = await preflightCheck(slidesDir, { full });

  for (const line of [...result.errors, ...result.warnings]) {
    console.log(line);
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
