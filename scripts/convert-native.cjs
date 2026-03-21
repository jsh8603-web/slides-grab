/**
 * Convert HTML slides to editable PPTX using html2pptx (native text/shapes).
 * Usage: node scripts/convert-native.cjs --slides-dir slides --output output.pptx
 */

const PptxGenJS = require('pptxgenjs');
const path = require('path');
const fs = require('fs');
const html2pptx = require('../.claude/skills/pptx-skill/scripts/html2pptx.js');

const DEFAULT_SLIDES_DIR = 'slides';
const DEFAULT_OUTPUT = 'output-native.pptx';

function parseArgs(args) {
  const options = { slidesDir: DEFAULT_SLIDES_DIR, output: DEFAULT_OUTPUT };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--slides-dir' && args[i + 1]) { options.slidesDir = args[++i]; }
    if (args[i] === '--output' && args[i + 1]) { options.output = args[++i]; }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const slidesDir = path.resolve(options.slidesDir);
  const outputPath = path.resolve(options.output);

  const files = fs.readdirSync(slidesDir)
    .filter(f => /^slide-\d+[^]*\.html$/.test(f))
    .sort();

  if (files.length === 0) {
    console.error('No slide-*.html files found in', slidesDir);
    process.exit(1);
  }

  console.log(`Converting ${files.length} slides (native mode)...`);

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';

  for (const file of files) {
    const filePath = path.join(slidesDir, file);
    process.stdout.write(`  ${file} ... `);
    try {
      await html2pptx(filePath, pptx);
      console.log('OK');
    } catch (err) {
      console.log('FAILED:', err.message);
    }
  }

  await pptx.writeFile({ fileName: outputPath });
  console.log(`\nSaved: ${outputPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
