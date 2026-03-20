---
name: pptx-skill
description: Convert HTML slides to PowerPoint (PPTX) files. Use when PPTX generation, editing, or thumbnail creation is needed.
---

# PPTX Skill - PowerPoint Conversion

Converts HTML slides into editable PowerPoint presentation files.

## Prerequisites (Stage 3)

Only run when ALL met:
1. **Explicit user request** for PPTX conversion
2. **HTML slides reviewed** and approved
3. **No automatic execution** — don't auto-start after slide generation

If prerequisites not met → guide user to review in editor first.

---

## Core Workflow

### HTML -> PPTX Conversion

1. **Verify** HTML files exist in `--slides-dir` (720pt x 405pt spec)
2. **Convert**:
   ```bash
   node scripts/convert-native.mjs --slides-dir <path> --output presentation.pptx
   ```
3. **Verify** generated PPTX via thumbnail/preview

### Thumbnail Generation
```bash
python .claude/skills/pptx-skill/scripts/thumbnail.py presentation.pptx output-thumbnail
# Options: --cols N (3-6, default 5), --outline-placeholders
```

### PPTX Pack/Unpack
```bash
python .claude/skills/pptx-skill/ooxml/scripts/unpack.py presentation.pptx output_dir
python .claude/skills/pptx-skill/ooxml/scripts/pack.py input_dir presentation.pptx
```

### PPTX Validation
```bash
python .claude/skills/pptx-skill/ooxml/scripts/validate.py unpacked_dir --original presentation.pptx
```

## Reference Documents (에러 시에만 참조)

- [html2pptx.md](html2pptx.md) - HTML to PPTX conversion detailed guide
- [ooxml.md](ooxml.md) - Office Open XML technical reference

## PptxGenJS Key Rules

- **Color codes**: No `#` prefix — `{ color: 'FF0000' }` not `'#FF0000'`
- **Text tags**: Only `p`, `h1`-`h6`, `ul`, `ol` converted
- **Gradients**: Replace CSS gradients with images
- **Fonts**: Web-safe fonts only
- **Validation**: Always verify with thumbnails after conversion

## Dependencies

- **Node.js**: pptxgenjs, playwright, sharp
- **Python**: markitdown, defusedxml, pillow
- **System**: LibreOffice (soffice), Poppler (pdftoppm)
