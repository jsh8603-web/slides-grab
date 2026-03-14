---
name: presentation-skill
description: End-to-end presentation workflow. Use when making a full presentation from scratch — planning, designing slides, editing, and exporting.
---

# Presentation Skill - Full Workflow Orchestrator

Guides you through the complete presentation pipeline from topic to exported file.

**첫 호출 시 반드시 읽기**: `.claude/docs/presentation-flow.md` (전체 워크플로우 상세 절차)

---

## Workflow

### Stage 1 — Plan

Use **plan-skill** (`.claude/skills/plan-skill/SKILL.md`).

1. Take user's topic, audience, and tone.
2. Delegate outline creation to `organizer-agent`.
3. Present `slide-outline.md` to user.
4. Revise until user explicitly approves.

**Do not proceed to Stage 2 without approval.**

### Stage 2 — Design

Use **design-skill** (`.claude/skills/design-skill/SKILL.md`).
참조: `.claude/docs/design-modes.md` (디자인 모드별 상세), `.claude/docs/nanoBanana-guide.md` (이미지 생성)

1. Read approved `slide-outline.md`.
2. Generate `slide-*.html` files in the slides workspace (default: `slides/`).
3. Build the viewer: `node scripts/build-viewer.js --slides-dir <path>`
4. Present viewer to user for review.
5. Revise individual slides based on feedback.
6. Optionally launch the visual editor: `slides-grab edit --slides-dir <path>`

**Do not proceed to Stage 3 without approval.**

### Stage 3 — Export

Use **pptx-skill** (`.claude/skills/pptx-skill/SKILL.md`).
참조: `.claude/docs/pptx-inspection-log.md` (변환 이슈 패턴), `.claude/rules/html-prevention-rules.md` (HTML 금지/필수 규칙)

1. Confirm user wants conversion.
2. Export to PPTX: `node scripts/convert-native.mjs --slides-dir <path> --output <name>.pptx`
3. Export to PDF (if requested): `slides-grab pdf --slides-dir <path> --output <name>.pdf`
4. Report results.

---

## 참조 파일 로드 규칙

| 상황 | auto-loaded (항상 보임) | 스킬 | 추가 Read (조건부) |
|------|----------------------|------|-------------------|
| 프레젠테이션 새로 만들기 | prevention-rules + flow | presentation → plan → design | design-modes.md, nanoBanana-guide.md |
| HTML 슬라이드 생성 (Step 2) | prevention-rules | design-skill | media-guide.md (차트/이미지 시), design-modes.md |
| HTML 즉석 수정 (스킬 미호출) | prevention-rules | — | — |
| PPTX 변환 (Step 6) | prevention-rules | pptx-skill | html2pptx.md (에러 시), pptx-inspection-log.md |
| 레이아웃 버그 수정 | prevention-rules | — | pptx-inspection-log.md (패턴 기록) |
| 검증 규칙 추가 | prevention-rules | — | pptx-inspection-log.md (매핑 테이블) |

## Rules

1. **Always follow the stage order**: Plan → Design → Export.
2. **Get explicit user approval** before advancing to the next stage.
3. **Read each stage's SKILL.md** for detailed rules — this skill only orchestrates.
4. **Use `slides/<deck-name>/`** as the slides workspace.
5. **Read `.claude/docs/` files on demand** — they are not auto-loaded.
