/**
 * Convert HTML slides to editable PPTX using html2pptx (native text/shapes).
 * Usage: node scripts/convert-native.mjs --slides-dir slides --output output.pptx
 *
 * Pipeline: Preflight check → PPTX conversion → Post-PPTX XML validation
 */

import PptxGenJS from 'pptxgenjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const html2pptx = require('../.claude/skills/pptx-skill/scripts/html2pptx.cjs');

const DEFAULT_SLIDES_DIR = 'slides';
const DEFAULT_OUTPUT = 'output-native.pptx';

function parseArgs(args) {
  const options = {
    slidesDir: DEFAULT_SLIDES_DIR,
    output: DEFAULT_OUTPUT,
    skipPreflight: false,
    skipValidation: false,
    full: false
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--slides-dir' && args[i + 1]) { options.slidesDir = args[++i]; }
    if (args[i] === '--output' && args[i + 1]) { options.output = args[++i]; }
    if (args[i] === '--skip-preflight') { options.skipPreflight = true; }
    if (args[i] === '--skip-validation') { options.skipValidation = true; }
    if (args[i] === '--full') { options.full = true; }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const slidesDir = path.resolve(options.slidesDir);
  const outputPath = path.resolve(options.output);

  const files = fs.readdirSync(slidesDir)
    .filter(f => /^slide-\d+\.html$/.test(f))
    .sort();

  if (files.length === 0) {
    console.error('No slide-*.html files found in', slidesDir);
    process.exit(1);
  }

  // Phase 1: Preflight HTML validation
  if (!options.skipPreflight) {
    const preflightPath = new URL('./preflight-html.js', import.meta.url);
    if (fs.existsSync(fileURLToPath(preflightPath))) {
      console.log('Running preflight checks...');
      try {
        const { preflightCheck } = await import(preflightPath.href);
        const result = await preflightCheck(slidesDir, { full: options.full });
        if (result.errors.length > 0) {
          console.error(`\n❌ Preflight found ${result.errors.length} ERROR(s) — fix before conversion:\n`);
          for (const e of result.errors) {
            console.error(`  ${e}`);
          }
          console.error('');
          process.exit(1);
        }
        if (result.warnings.length > 0) {
          console.warn(`\n⚠️  Preflight found ${result.warnings.length} warning(s):\n`);
          for (const w of result.warnings) {
            console.warn(`  ${w}`);
          }
          console.warn('');
        }
        if (result.passed) {
          console.log('  Preflight: all checks passed ✓\n');
        }
      } catch (err) {
        console.warn(`  Preflight skipped: ${err.message}\n`);
      }
    }
  }

  // Phase 1.5: Playwright dynamic validation (only with --full)
  if (!options.skipPreflight && options.full) {
    try {
      const validateUrl = new URL('./validate-slides.js', import.meta.url);
      const { validateSlides } = await import(validateUrl.href);
      console.log('Running Playwright dynamic validation (--full)...');
      const vsResult = await validateSlides(slidesDir);
      if (vsResult.errors.length > 0) {
        console.error(`\n❌ Dynamic validation found ${vsResult.errors.length} ERROR(s):\n`);
        for (const e of vsResult.errors) console.error(`  ${e}`);
        console.error('');
        process.exit(1);
      }
      if (vsResult.warnings.length > 0) {
        console.warn(`\n⚠️  Dynamic validation found ${vsResult.warnings.length} warning(s):\n`);
        for (const w of vsResult.warnings) console.warn(`  ${w}`);
        console.warn('');
      }
      if (vsResult.passed && vsResult.warnings.length === 0) {
        console.log('  Dynamic validation: all checks passed ✓\n');
      }
    } catch (err) {
      console.warn(`  Dynamic validation skipped: ${err.message}\n`);
    }
  }

  // Phase 2: PPTX conversion
  console.log(`Converting ${files.length} slides (native/editable mode)...`);

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';

  const allContrastWarnings = [];

  for (const file of files) {
    const filePath = path.join(slidesDir, file);
    process.stdout.write(`  ${file} ... `);
    try {
      const result = await html2pptx(filePath, pptx);
      console.log('OK');
      if (result.contrastWarnings && result.contrastWarnings.length > 0) {
        for (const w of result.contrastWarnings) {
          allContrastWarnings.push({ file, ...w });
        }
      }
    } catch (err) {
      console.log('FAILED:', err.message);
    }
  }

  await pptx.writeFile({ fileName: outputPath });
  console.log(`\nSaved: ${outputPath}`);

  // Summary of contrast issues
  if (allContrastWarnings.length > 0) {
    const contrastErrors = allContrastWarnings.filter(w => w.level === 'ERROR');
    console.log(`\n⚠️  ${allContrastWarnings.length} contrast issue(s) found — check pattern #14/#16`);
    for (const w of allContrastWarnings) {
      const prefix = w.level === 'ERROR' ? 'ERROR' : 'WARN ';
      console.log(`   [${w.file}] <${w.tag}> "${w.text}": ${w.textColor} on ${w.bgColor} (${w.ratio}:1) ${prefix}`);
    }
    if (contrastErrors.length > 0) {
      console.log(`\n   ${contrastErrors.length} invisible-text ERROR(s) — text is unreadable in PPTX`);
    }
  }

  // Phase 3: Post-PPTX XML validation
  if (!options.skipValidation) {
    const validatorUrl = new URL('./validate-pptx.js', import.meta.url);
    if (fs.existsSync(fileURLToPath(validatorUrl))) {
      console.log('\nRunning post-PPTX XML validation...');
      try {
        const { validatePptx } = await import(validatorUrl.href);
        const result = await validatePptx(outputPath);
        const fmtIssue = (i) => `[slide ${i.slide}] ${i.code}: ${i.message}`;
        if (result.errors.length > 0) {
          console.error(`\n❌ XML validation found ${result.errors.length} ERROR(s):\n`);
          for (const e of result.errors) {
            console.error(`  ${fmtIssue(e)}`);
          }
        }
        if (result.warnings.length > 0) {
          console.warn(`\n⚠️  XML validation found ${result.warnings.length} warning(s):\n`);
          for (const w of result.warnings) {
            console.warn(`  ${fmtIssue(w)}`);
          }
        }
        if (result.passed) {
          console.log('  XML validation: all checks passed ✓');
        }
      } catch (err) {
        console.warn(`  XML validation skipped: ${err.message}`);
      }
    }
  }

  // Phase 4: Post-PPTX COM validation (--full only, requires PowerPoint)
  if (!options.skipValidation && options.full) {
    const comValidatorUrl = new URL('./validate-pptx-com.mjs', import.meta.url);
    if (fs.existsSync(fileURLToPath(comValidatorUrl))) {
      console.log('\nRunning COM validation (PowerPoint rendering engine)...');
      try {
        const { validatePptxCom } = await import(comValidatorUrl.href);
        const comResult = await validatePptxCom(outputPath);
        const fmtIssue = (i) => `[slide ${i.slide}] ${i.code} "${i.shape}": ${i.message}`;

        // Separate by VC code
        const overflowIssues = comResult.issues.filter(i => i.code === 'VC-02' || i.code === 'VC-03');
        const overlapIssues = comResult.issues.filter(i => i.code === 'VC-04');
        const boundsIssues = comResult.issues.filter(i => i.code === 'VC-01');
        const autoShrinkIssues = comResult.issues.filter(i => i.code === 'VC-05');
        const fontSubIssues = comResult.issues.filter(i => i.code === 'VC-06');
        const proximityIssues = comResult.issues.filter(i => i.code === 'VC-07');

        if (overflowIssues.length > 0) {
          const errors = overflowIssues.filter(i => i.level === 'ERROR');
          const warns = overflowIssues.filter(i => i.level === 'WARN');
          console.error(`\n❌ COM: ${errors.length} text overflow ERROR(s), ${warns.length} warning(s):\n`);
          for (const e of overflowIssues) {
            const icon = e.level === 'ERROR' ? 'ERROR' : 'WARN ';
            console.error(`  ${icon} ${fmtIssue(e)}`);
          }
        }

        if (boundsIssues.length > 0) {
          console.warn(`\n⚠️  COM: ${boundsIssues.length} out-of-bounds issue(s):\n`);
          for (const b of boundsIssues) {
            console.warn(`  ${fmtIssue(b)}`);
          }
        }

        const overlapErrors = overlapIssues.filter(i => i.level === 'ERROR');
        if (overlapErrors.length > 0) {
          console.warn(`\n⚠️  COM: ${overlapErrors.length} shape overlap ERROR(s), ${overlapIssues.length - overlapErrors.length} warning(s):\n`);
          for (const e of overlapErrors) {
            console.warn(`  ${fmtIssue(e)}`);
          }
        }

        if (autoShrinkIssues.length > 0) {
          console.warn(`\n⚠️  COM: ${autoShrinkIssues.length} auto-shrink warning(s):\n`);
          for (const e of autoShrinkIssues) console.warn(`  ${fmtIssue(e)}`);
        }

        if (fontSubIssues.length > 0) {
          console.warn(`\n⚠️  COM: ${fontSubIssues.length} font substitution warning(s):\n`);
          for (const e of fontSubIssues) console.warn(`  ${fmtIssue(e)}`);
        }

        if (proximityIssues.length > 0) {
          console.warn(`\n⚠️  COM: ${proximityIssues.length} decoration proximity warning(s):\n`);
          for (const e of proximityIssues) console.warn(`  ${fmtIssue(e)}`);
        }

        console.log(`\n  COM validation: ${comResult.slideCount} slides, ${comResult.errors} error(s), ${comResult.warnings} warning(s)`);
        if (comResult.passed) {
          console.log('  COM validation: no critical errors ✓');
        }
      } catch (err) {
        console.warn(`  COM validation skipped: ${err.message}`);
      }
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
