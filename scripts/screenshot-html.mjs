#!/usr/bin/env node

/**
 * Capture Playwright screenshots of HTML slides for comparison with PPTX COM exports.
 *
 * Usage:
 *   node scripts/screenshot-html.mjs --slides-dir slides/폴더명 --output slides/폴더명/html-preview
 *   node scripts/screenshot-html.mjs --slides-dir slides/폴더명 --output slides/폴더명/html-preview --slides "1,3,5"
 */

import { readdir, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createScreenshotBrowser, createScreenshotPage, captureSlideScreenshot } from '../src/editor/screenshot.js';

const SLIDE_PATTERN = /^slide-(\d+)\.html$/i;

function parseArgs(argv) {
  const opts = { slidesDir: null, output: null, slides: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--slides-dir' && argv[i + 1]) { opts.slidesDir = argv[++i]; continue; }
    if (argv[i] === '--output' && argv[i + 1]) { opts.output = argv[++i]; continue; }
    if (argv[i] === '--slides' && argv[i + 1]) { opts.slides = argv[++i].split(',').map(Number); continue; }
  }
  if (!opts.slidesDir) { process.stderr.write('--slides-dir required\n'); process.exit(1); }
  if (!opts.output) { opts.output = join(opts.slidesDir, 'html-preview'); }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const slidesDir = resolve(opts.slidesDir);
  const outputDir = resolve(opts.output);
  await mkdir(outputDir, { recursive: true });

  const entries = await readdir(slidesDir);
  let slideFiles = entries
    .filter(f => SLIDE_PATTERN.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)[0], 10);
      const nb = parseInt(b.match(/\d+/)[0], 10);
      return na - nb;
    });

  if (opts.slides) {
    const set = new Set(opts.slides);
    slideFiles = slideFiles.filter(f => {
      const num = parseInt(f.match(/\d+/)[0], 10);
      return set.has(num);
    });
  }

  if (slideFiles.length === 0) {
    process.stderr.write('No matching slide files found.\n');
    process.exit(1);
  }

  process.stdout.write(`Capturing ${slideFiles.length} HTML screenshots...\n`);

  const { browser } = await createScreenshotBrowser();
  try {
    for (const file of slideFiles) {
      const num = file.match(/\d+/)[0];
      const outPath = join(outputDir, `slide-${num}.png`);
      const { context, page } = await createScreenshotPage(browser);
      try {
        await captureSlideScreenshot(page, file, outPath, slidesDir);
        process.stdout.write(`  ✓ ${file} → ${outPath}\n`);
      } finally {
        await context.close().catch(() => {});
      }
    }
  } finally {
    await browser.close();
  }

  process.stdout.write(`Done. HTML previews saved to: ${outputDir}\n`);
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
