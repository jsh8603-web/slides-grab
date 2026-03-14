/**
 * Clean up old dinosaur notebooks from NotebookLM.
 * Keeps the most recent one, deletes the rest.
 * Also deletes "Untitled notebook" entries with 0 sources.
 *
 * Usage: node scripts/nlm-cleanup.js [--keep-latest] [--dry]
 */

import { chromium } from "playwright";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = join(__dirname, "..", ".playwright-session");
const NLM_HOME = "https://notebooklm.google.com/";

const args = {
  dry: process.argv.includes("--dry"),
};

async function main() {
  console.log(`NLM Cleanup ${args.dry ? "(DRY RUN)" : ""}\n`);

  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const page = await context.newPage();

  try {
    console.log("[1] Loading NLM home...");
    await page.goto(NLM_HOME, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(5000);

    // Click "내 노트북" tab to see only own notebooks
    const myTab = page.locator('text=내 노트북').first();
    if (await myTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await myTab.click();
      await page.waitForTimeout(2000);
    }

    // Click "모두 보기" if visible to see all notebooks
    const showAll = page.locator('text=모두 보기').first();
    if (await showAll.isVisible({ timeout: 3000 }).catch(() => false)) {
      await showAll.click();
      await page.waitForTimeout(2000);
    }

    console.log("[2] Scanning notebooks...");
    await page.screenshot({ path: "nlm-cleanup-before.png" });

    // Find all notebook cards with their info
    const notebooks = await page.evaluate(() => {
      const cards = document.querySelectorAll('[class*="notebook"], [class*="card"]');
      const results = [];
      cards.forEach((card, index) => {
        const text = card.textContent || "";
        // Skip "새 노트 만들기" card
        if (text.includes("새 노트 만들기") || text.includes("새로 만들기")) return;

        const nameEl = card.querySelector('h3, h2, [class*="title"], [class*="name"]');
        const name = nameEl?.textContent?.trim() || text.substring(0, 50).trim();
        const dateMatch = text.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
        const sourceMatch = text.match(/소스\s*(\d+)\s*개/);
        const sources = sourceMatch ? parseInt(sourceMatch[1], 10) : -1;

        results.push({
          index,
          name: name.replace(/more_vert/g, "").trim(),
          date: dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : "",
          sources,
          text: text.replace(/\s+/g, " ").substring(0, 100),
        });
      });
      return results;
    });

    console.log(`  Found ${notebooks.length} notebooks:\n`);

    // Categorize notebooks for deletion
    const dinosaurKeywords = ["jurassic", "dinosaur", "sauropod", "theropod", "paleontology", "공룡", "쥬라기"];
    const toDelete = [];
    let latestDinosaur = null;

    for (const nb of notebooks) {
      const nameLC = nb.name.toLowerCase();
      const isDinosaur = dinosaurKeywords.some(k => nameLC.includes(k));
      const isUntitled = nameLC.includes("untitled") && nb.sources === 0;

      if (isDinosaur) {
        if (!latestDinosaur || nb.index < latestDinosaur.index) {
          // Lower index = more recent (NLM sorts newest first)
          if (latestDinosaur) toDelete.push({ ...latestDinosaur, reason: "older dinosaur notebook" });
          latestDinosaur = nb;
        } else {
          toDelete.push({ ...nb, reason: "older dinosaur notebook" });
        }
      } else if (isUntitled) {
        toDelete.push({ ...nb, reason: "untitled with 0 sources" });
      }
    }

    if (latestDinosaur) {
      console.log(`  ✓ KEEP: "${latestDinosaur.name}" (${latestDinosaur.sources} sources)\n`);
    }

    if (toDelete.length === 0) {
      console.log("  Nothing to delete. All clean!");
      await context.close();
      return;
    }

    console.log(`  DELETE (${toDelete.length}):`);
    toDelete.forEach(nb => console.log(`    ✗ "${nb.name}" — ${nb.reason}`));

    if (args.dry) {
      console.log("\n  (Dry run — no deletions performed)");
      await context.close();
      return;
    }

    // Delete notebooks one by one using 3-dot menu
    console.log(`\n[3] Deleting ${toDelete.length} notebooks...`);

    for (let i = 0; i < toDelete.length; i++) {
      const nb = toDelete[i];
      console.log(`  [${i + 1}/${toDelete.length}] Deleting "${nb.name}"...`);

      // Re-scan cards each time since DOM changes after deletion
      await page.waitForTimeout(1000);

      // Find the card by its name text
      const targetCard = page.locator(`text=${nb.name.substring(0, 30)}`).first();
      const cardVisible = await targetCard.isVisible({ timeout: 3000 }).catch(() => false);

      if (!cardVisible) {
        console.log(`    Skipped — card not found (may already be deleted).`);
        continue;
      }

      // Find the 3-dot menu button near this card
      // Strategy: right-click or find more_vert icon near the text
      try {
        // Look for the more_vert (3-dot) button in the same card container
        const cardEl = targetCard.locator("xpath=ancestor::*[contains(@class, 'card') or contains(@class, 'notebook') or contains(@class, 'mat-card')]").first();
        let menuBtn = null;

        // Try to find menu button within the card ancestor
        const cardMenuBtn = cardEl.locator('button[aria-label*="메뉴"], button[aria-label*="menu"], button[aria-label*="옵션"], mat-icon:has-text("more_vert"), [class*="menu-trigger"]').first();
        if (await cardMenuBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          menuBtn = cardMenuBtn;
        }

        if (!menuBtn) {
          // Fallback: hover over the card area and look for the menu button
          await targetCard.hover();
          await page.waitForTimeout(500);

          // After hover, menu button might appear
          const hoverMenuBtn = page.locator('button[aria-label*="메뉴"], button[aria-label*="menu"], button[aria-label*="옵션"]').first();
          if (await hoverMenuBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            menuBtn = hoverMenuBtn;
          }
        }

        if (!menuBtn) {
          // Last resort: find all more_vert buttons and click the one at the right index
          const allMenuBtns = await page.locator('button:has(mat-icon:has-text("more_vert")), [aria-label*="옵션"], [aria-label*="메뉴"]').all();
          // The nb.index-th button (adjusted for "새 노트 만들기" card which has no menu)
          if (allMenuBtns.length > 0) {
            // Find the menu button closest to our target
            for (const btn of allMenuBtns) {
              const btnBox = await btn.boundingBox();
              const targetBox = await targetCard.boundingBox();
              if (btnBox && targetBox && Math.abs(btnBox.y - targetBox.y) < 60) {
                menuBtn = btn;
                break;
              }
            }
          }
        }

        if (menuBtn) {
          await menuBtn.click();
          await page.waitForTimeout(500);

          // Click "삭제" (Delete) option
          const deleteOpt = page.locator('text=삭제').first();
          const deleteVisible = await deleteOpt.isVisible({ timeout: 2000 }).catch(() => false);
          if (deleteVisible) {
            await deleteOpt.click();
            await page.waitForTimeout(500);

            // Confirm deletion dialog if it appears
            const confirmBtn = page.locator('button:has-text("삭제"), button:has-text("확인"), button:has-text("Delete")').last();
            const confirmVisible = await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false);
            if (confirmVisible) {
              await confirmBtn.click();
              await page.waitForTimeout(2000);
            }
            console.log(`    ✓ Deleted.`);
          } else {
            console.log(`    Skipped — '삭제' option not found in menu.`);
            // Close the menu
            await page.keyboard.press("Escape");
          }
        } else {
          console.log(`    Skipped — menu button not found.`);
        }
      } catch (e) {
        console.log(`    Error: ${e.message}`);
        await page.keyboard.press("Escape").catch(() => {});
      }
    }

    console.log("\n[4] Verification...");
    await page.waitForTimeout(2000);
    // Reload to see current state
    await page.goto(NLM_HOME, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(3000);
    // Click "내 노트북" again
    const myTab2 = page.locator('text=내 노트북').first();
    if (await myTab2.isVisible({ timeout: 3000 }).catch(() => false)) {
      await myTab2.click();
      await page.waitForTimeout(2000);
    }
    await page.screenshot({ path: "nlm-cleanup-after.png" });
    console.log("  [debug] Screenshot: nlm-cleanup-after.png");

    const remaining = await page.evaluate(() => {
      const body = document.body.innerText || "";
      const dino = ["Jurassic", "Dinosaur", "Sauropod", "Theropod", "Paleontology"];
      const lines = body.split("\n");
      return lines.filter(l => dino.some(k => l.includes(k))).map(l => l.trim().substring(0, 80));
    });
    console.log(`  Remaining dinosaur notebooks: ${remaining.length}`);
    remaining.forEach(r => console.log(`    - ${r}`));

    console.log("\nDone!");
  } catch (err) {
    console.error(`Error: ${err.message}`);
  }

  await context.close();
}

main().catch(console.error);
