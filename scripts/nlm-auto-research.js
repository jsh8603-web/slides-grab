/**
 * Automate NotebookLM web research via Playwright.
 *
 * Creates a new notebook, triggers web research for a given topic,
 * waits for completion, and extracts the resulting content.
 *
 * Usage:
 *   node scripts/nlm-auto-research.js --topic <topic> [--output <file>] [--timeout <seconds>] [--mode <fast|deep|auto>]
 *
 * Options:
 *   --topic     Research topic (required)
 *   --output    Output file path (default: notebook-content.md)
 *   --timeout   Max wait for research completion in seconds (default: auto — 120s fast, 300s deep)
 *   --mode      Research mode: fast, deep, or auto (default: auto)
 *               auto = classify topic difficulty and choose accordingly
 */

import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI argument parsing ──────────────────────────────────────────────

function parseArgs(argv) {
  const args = { topic: null, output: null, timeout: null, mode: "auto" };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--topic":
        args.topic = argv[++i];
        break;
      case "--output":
        args.output = argv[++i];
        break;
      case "--timeout":
        args.timeout = parseInt(argv[++i], 10);
        break;
      case "--mode":
        args.mode = argv[++i];
        break;
    }
  }
  if (!args.output) {
    args.output = join(__dirname, "..", "notebook-content.md");
  }
  if (!["fast", "deep", "auto"].includes(args.mode)) {
    console.error(`Invalid mode: ${args.mode}. Use fast, deep, or auto.`);
    process.exit(1);
  }
  return args;
}

const args = parseArgs(process.argv);

if (!args.topic) {
  console.error(
    "Usage: node scripts/nlm-auto-research.js --topic <topic> [--output <file>] [--timeout <seconds>] [--mode <fast|deep|auto>]"
  );
  process.exit(1);
}

// ── Research mode classification ─────────────────────────────────────

/**
 * Classify topic difficulty → fast or deep.
 *
 * Deep research triggers:
 * - Academic/technical terms (논문, 연구, 분석, 비교, 메타분석, systematic review)
 * - Multi-faceted queries (A vs B, 장단점, 비교분석)
 * - Niche/specialized domains (특정 연도/인물 + 전문 분야)
 * - Long queries (30+ chars Korean, 60+ chars English) suggesting complexity
 * - Explicit depth markers (심층, 상세, 종합, comprehensive, in-depth)
 */
function classifyResearchMode(topic) {
  const deepKeywords = [
    // Korean depth markers
    "심층", "상세", "종합", "깊이", "분석", "비교분석", "장단점",
    "메타분석", "체계적", "논문", "연구", "학술", "통계",
    "역사적", "변천사", "발전사", "영향", "원인과 결과",
    // English depth markers
    "comprehensive", "in-depth", "analysis", "comparison",
    "systematic", "research", "academic", "detailed",
    "pros and cons", "versus", "impact of", "history of",
  ];

  const fastKeywords = [
    // Simple/general topics
    "소개", "개요", "요약", "기본", "입문", "쉽게",
    "어린이", "초등", "간단", "재미있는",
    "introduction", "overview", "basics", "simple", "fun facts",
  ];

  const topicLower = topic.toLowerCase();

  // Check explicit fast keywords first
  const fastScore = fastKeywords.filter((k) => topicLower.includes(k)).length;
  const deepScore = deepKeywords.filter((k) => topicLower.includes(k)).length;

  // Length heuristic: longer queries tend to be more complex
  const isLong = /[\u3131-\uD79D]/.test(topic)
    ? topic.length > 30   // Korean: 30+ chars
    : topic.length > 60;  // English: 60+ chars

  // Multi-part query detection (vs, 비교, A와 B)
  const isComparative = /vs\.?|비교|대|versus|장단점/.test(topicLower);

  // Score calculation
  let score = deepScore - fastScore;
  if (isLong) score += 1;
  if (isComparative) score += 1;

  return score >= 1 ? "deep" : "fast";
}

// Resolve mode
const resolvedMode = args.mode === "auto"
  ? classifyResearchMode(args.topic)
  : args.mode;

// Set timeout based on mode if not explicitly provided
if (args.timeout === null) {
  args.timeout = resolvedMode === "deep" ? 300 : 120;
}

// Shared session directory with fetch-notebooklm.js
const SESSION_DIR = join(__dirname, "..", ".playwright-session");

const NLM_HOME = "https://notebooklm.google.com/";

// ── Helpers ───────────────────────────────────────────────────────────

/** Click the center of an element's bounding box (useful for CDK overlays). */
async function clickCenter(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Element not visible – no bounding box");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Try multiple locator strategies in order; return the first visible one. */
async function findFirst(page, strategies, { timeout = 5000 } = {}) {
  for (const strategy of strategies) {
    try {
      const loc =
        typeof strategy === "string" ? page.locator(strategy) : strategy;
      await loc.first().waitFor({ state: "visible", timeout });
      return loc.first();
    } catch {
      // try next strategy
    }
  }
  return null;
}

/** Poll until `checkFn` returns true or timeout elapses. */
async function pollUntil(checkFn, { intervalMs = 3000, timeoutMs }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkFn()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// ── Main flow ─────────────────────────────────────────────────────────

async function main() {
  console.log(`Topic  : ${args.topic}`);
  console.log(`Mode   : ${resolvedMode}${args.mode === "auto" ? ` (auto-classified from "${args.topic}")` : ""}`);
  console.log(`Output : ${args.output}`);
  console.log(`Timeout: ${args.timeout}s\n`);

  // 1. Launch browser with persistent session ──────────────────────────
  console.log("[1/8] Launching browser (visible mode)...");
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const page = await context.newPage();

  try {
    // 2. Navigate to NotebookLM ─────────────────────────────────────────
    console.log("[2/8] Navigating to NotebookLM...");
    await page.goto(NLM_HOME, { waitUntil: "domcontentloaded", timeout: 60000 });

    // 3. Handle Google login if needed ──────────────────────────────────
    if (page.url().includes("accounts.google.com")) {
      console.log("\n========================================");
      console.log("  Google 로그인 화면이 표시됩니다.");
      console.log("  브라우저에서 로그인을 완료해주세요.");
      console.log("  로그인 후 자동으로 진행됩니다.");
      console.log("========================================\n");

      await page.waitForURL("**/notebooklm.google.com/**", { timeout: 180000 });
      console.log("Login successful!");
    }

    // Wait for the home page to settle
    await page.waitForTimeout(3000);

    // 4. Create a new notebook ──────────────────────────────────────────
    console.log("[3/8] Creating new notebook...");

    // NotebookLM home shows a "New notebook" button or a "+" card.
    // Try several selector strategies — the UI has changed across versions.
    const createBtn = await findFirst(page, [
      // Korean UI variants (2026 확인)
      page.getByText("새로 만들기", { exact: true }),
      page.getByRole("button", { name: /새로 만들기/i }),
      page.getByRole("button", { name: /새 노트북/i }),
      page.getByRole("button", { name: /새 노트 만들기/i }),
      // English UI variants
      page.getByRole("button", { name: /new notebook/i }),
      page.getByRole("button", { name: /create/i }),
      // The "+" card on the home grid
      'button[aria-label*="New"]',
      'button[aria-label*="Create"]',
      '[data-test-id="create-notebook"]',
      ".create-notebook-button",
    ]);

    if (!createBtn) {
      throw new Error(
        "Could not find 'New notebook' button. The NotebookLM UI may have changed."
      );
    }

    const urlBeforeCreate = page.url();
    await clickCenter(page, createBtn);
    console.log("  Clicked create button, waiting for notebook to open...");

    // Wait for URL to change (notebook creation navigates to a new URL with notebook ID)
    await pollUntil(
      async () => page.url() !== urlBeforeCreate,
      { intervalMs: 500, timeoutMs: 30000 }
    );
    await page.waitForTimeout(3000);

    // 5. The dialog should already be open (URL has ?addSource=true after creation)
    // If not, find and click "소스 추가" button
    console.log("[4/8] Checking for source dialog...");

    // Wait for the dialog/search input to appear
    await page.waitForTimeout(2000);

    // NLM opens with an overlay dialog ("YouTube 동영상을 활용해..." or "사용자의 메모를 활용해...")
    // This dialog has its own search input "웹에서 새 소스를 검색하세요" and chips.
    // Behind it, the left panel also has a search input.
    // We must use the DIALOG's search input (it's the functional one in the overlay).

    // First, check if a promotional overlay dialog is present and has a search input
    // The dialog search placeholder: "웹에서 새 소스를 검색하세요"
    let searchInput = await findFirst(page, [
      page.getByPlaceholder(/웹에서 새 소스를 검색/),
      page.getByPlaceholder(/무엇을 조사하고 싶으신가요/),
      page.getByPlaceholder(/search.*web/i),
      page.getByPlaceholder(/검색하세요/),
      page.getByPlaceholder(/검색/),
      page.getByPlaceholder(/조사/),
    ], { timeout: 5000 });

    if (!searchInput) {
      // Dialog not open yet — click "소스 추가" to open it
      console.log("  Dialog not open, clicking '소스 추가'...");
      const addSourceBtn = await findFirst(page, [
        page.getByText("소스 추가", { exact: false }),
        page.getByRole("button", { name: /소스 추가/i }),
        page.getByRole("button", { name: /add source/i }),
      ]);

      if (addSourceBtn) {
        await clickCenter(page, addSourceBtn);
        await page.waitForTimeout(2000);
      }

      searchInput = await findFirst(page, [
        page.getByPlaceholder(/웹에서 새 소스를 검색/),
        page.getByPlaceholder(/무엇을 조사하고 싶으신가요/),
        page.getByPlaceholder(/검색하세요/),
        page.getByPlaceholder(/검색/),
      ], { timeout: 5000 });
    }

    // If there are multiple search inputs (left panel + dialog), use the DIALOG one
    // The dialog input is typically inside a modal/overlay container
    const allSearchInputs = await page.locator('input[placeholder*="검색"], textarea[placeholder*="검색"], input[placeholder*="조사"], textarea[placeholder*="조사"]').all();
    if (allSearchInputs.length > 1) {
      console.log(`  Found ${allSearchInputs.length} search inputs. Using the dialog one...`);
      // The dialog input is usually the LAST one or inside a dialog/modal container
      // Try to find the one inside a dialog/overlay
      for (const input of allSearchInputs) {
        const isInDialog = await input.evaluate(el => {
          // Check if this input is inside a dialog/modal/overlay
          let parent = el.parentElement;
          while (parent) {
            const style = window.getComputedStyle(parent);
            const role = parent.getAttribute('role');
            const cls = parent.className || "";
            if (role === 'dialog' || role === 'alertdialog' ||
                cls.includes('dialog') || cls.includes('modal') || cls.includes('overlay') ||
                cls.includes('Dialog') || cls.includes('Modal') ||
                (style.position === 'fixed' && style.zIndex && parseInt(style.zIndex) > 100)) {
              return true;
            }
            parent = parent.parentElement;
          }
          return false;
        });
        if (isInDialog) {
          searchInput = input;
          console.log("  Using dialog search input.");
          break;
        }
      }
    }

    if (!searchInput) {
      throw new Error(
        "Could not find web search input. The NotebookLM UI may have changed."
      );
    }

    console.log("  Found search input.");

    // 6. Enter topic and submit ───────────────────────────────────────
    console.log("[5/8] Entering topic and submitting...");

    // Strategy 1: Try fill with force (bypasses CDK overlay actionability checks)
    let filled = false;
    try {
      await searchInput.fill(args.topic, { force: true, timeout: 3000 });
      const val = await searchInput.inputValue().catch(() => "");
      if (val.includes(args.topic.substring(0, 5))) {
        console.log(`  Strategy 1 (fill+force) succeeded: "${args.topic}"`);
        filled = true;
      }
    } catch {
      console.log("  Strategy 1 (fill+force) failed, trying DOM injection...");
    }

    // Strategy 2: Direct DOM manipulation — bypass CDK overlay entirely
    if (!filled) {
      try {
        await page.evaluate((topic) => {
          // Find textarea/input by placeholder text
          const candidates = [
            ...document.querySelectorAll('textarea, input[type="text"], input[type="search"]'),
          ];
          const el = candidates.find((e) => {
            const ph = e.placeholder || "";
            return ph.includes("검색") || ph.includes("search") || ph.includes("소스");
          }) || candidates[0];

          if (el) {
            // Focus and set value via native setter to trigger Angular change detection
            el.focus();
            const nativeInputValueSetter =
              Object.getOwnPropertyDescriptor(
                el.tagName === "TEXTAREA"
                  ? window.HTMLTextAreaElement.prototype
                  : window.HTMLInputElement.prototype,
                "value"
              ).set;
            nativeInputValueSetter.call(el, topic);
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            // Also dispatch keydown/keyup for frameworks that listen to those
            el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
          }
        }, args.topic);

        await page.waitForTimeout(500);
        const val2 = await searchInput.inputValue().catch(() => "");
        if (val2.includes(args.topic.substring(0, 5))) {
          console.log(`  Strategy 2 (DOM injection) succeeded: "${args.topic}"`);
          filled = true;
        }
      } catch (e) {
        console.log(`  Strategy 2 (DOM injection) failed: ${e.message}`);
      }
    }

    // Strategy 3: Click via dispatchEvent + keyboard.type
    if (!filled) {
      try {
        console.log("  Strategy 3: dispatchEvent click + keyboard.type...");
        await page.evaluate(() => {
          const candidates = [
            ...document.querySelectorAll('textarea, input[type="text"], input[type="search"]'),
          ];
          const el = candidates.find((e) => {
            const ph = e.placeholder || "";
            return ph.includes("검색") || ph.includes("search") || ph.includes("소스");
          }) || candidates[0];
          if (el) {
            el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
            el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            el.focus();
          }
        });
        await page.waitForTimeout(300);
        await page.keyboard.type(args.topic, { delay: 20 });
        await page.waitForTimeout(500);
        const val3 = await searchInput.inputValue().catch(() => "");
        if (val3.includes(args.topic.substring(0, 5))) {
          console.log(`  Strategy 3 (dispatchEvent+type) succeeded`);
          filled = true;
        }
      } catch (e) {
        console.log(`  Strategy 3 failed: ${e.message}`);
      }
    }

    if (!filled) {
      console.log("  [warn] All input strategies failed. Taking screenshot for debugging...");
      try {
        await page.screenshot({ path: "nlm-debug-input-failed.png" });
      } catch { /* ignore */ }
    }

    // 6b. Switch to Deep Research mode if needed ──────────────────────
    if (resolvedMode === "deep") {
      console.log("  Switching to Deep Research mode...");

      // The dialog has two chips: "🌐 웹 ▾" and "✨ Fast Research ▾"
      // We need to click "Fast Research ▾" to open the dropdown, then select "Deep Research".
      // The chip is near the search input. Use Playwright locator for reliability.

      // Find the Fast Research chip/button — it's a clickable element with "Fast Research" text
      const fastResearchChip = page.locator('text=Fast Research').first();
      const chipVisible = await fastResearchChip.isVisible().catch(() => false);

      if (chipVisible) {
        // Click the chip to open the dropdown
        await fastResearchChip.click();
        console.log("  Clicked 'Fast Research' chip to open dropdown.");
        await page.waitForTimeout(1500);

        // Take screenshot to see dropdown state
        try {
          await page.screenshot({ path: "nlm-debug-dropdown-open.png" });
          console.log("  [debug] Screenshot: nlm-debug-dropdown-open.png");
        } catch { /* ignore */ }

        // Now find and click "Deep Research" in the dropdown
        // The dropdown should show two options:
        //   1. "Fast Research" (search_spark icon) — 빠른 결과를 얻기에 적합
        //   2. "Deep Research" (travel_explore icon) — 심층적인 보고서 및 결과
        // We need the one with "심층적인" description to distinguish from the chip label

        // Strategy 1: Click text containing "심층적인" (unique to dropdown option)
        const deepByDesc = page.locator('text=심층적인').first();
        const descVisible = await deepByDesc.isVisible().catch(() => false);

        if (descVisible) {
          await deepByDesc.click();
          console.log("  Clicked Deep Research option (by description '심층적인').");
        } else {
          // Strategy 2: Find the Deep Research option with travel_explore icon
          const deepOption = page.locator('text=travel_explore').first();
          const travelVisible = await deepOption.isVisible().catch(() => false);

          if (travelVisible) {
            await deepOption.click();
            console.log("  Clicked Deep Research option (by travel_explore icon).");
          } else {
            // Strategy 3: DOM-based — find dropdown overlay items
            const clicked = await page.evaluate(() => {
              // The dropdown is a popup/overlay that just appeared
              // Find all elements that appeared after the chip click
              const allEls = [...document.querySelectorAll('*')];

              // Look for elements containing "Deep Research" that are in a popup/overlay
              for (const el of allEls) {
                const text = el.textContent?.trim() || "";
                const rect = el.getBoundingClientRect();

                if (rect.width > 0 && rect.height > 20 && rect.height < 100 &&
                    text.includes("Deep Research") && text.includes("심층")) {
                  // This looks like the dropdown option
                  el.click();
                  return true;
                }
              }
              return false;
            });

            if (clicked) {
              console.log("  Clicked Deep Research option (DOM strategy).");
            } else {
              console.log("  [warn] Could not find Deep Research option in dropdown.");
            }
          }
        }

        // Wait for dropdown to close and mode to register
        await page.waitForTimeout(2000);

        // Verify: check if the chip now shows "Deep Research" instead of "Fast Research"
        const chipText = await page.evaluate(() => {
          // Find all small elements with "Research" text
          const chips = [...document.querySelectorAll('*')].filter(el => {
            const text = el.textContent?.trim() || "";
            const rect = el.getBoundingClientRect();
            return rect.width > 50 && rect.width < 250 && rect.height > 15 && rect.height < 50 &&
                   text.includes("Research") && !text.includes("심층적인") && !text.includes("빠른");
          });
          // Return the smallest matching (most specific chip)
          chips.sort((a, b) => (a.textContent?.length || 999) - (b.textContent?.length || 999));
          return chips[0]?.textContent?.trim() || "unknown";
        });

        const isDeep = chipText.includes("Deep");
        console.log(`  Mode chip shows: "${chipText}" → ${isDeep ? "✓ Deep Research confirmed" : "⚠ Still Fast Research"}`);

        // If still Fast Research, try once more with a different approach
        if (!isDeep) {
          console.log("  Retrying: clicking chip again...");
          await fastResearchChip.click().catch(() => {});
          await page.waitForTimeout(1000);

          // Take screenshot of retry dropdown
          try {
            await page.screenshot({ path: "nlm-debug-dropdown-retry.png" });
          } catch { /* ignore */ }

          // Try clicking any visible "Deep Research" text that's NOT the chip itself
          const allDeepTexts = page.locator('text=Deep Research');
          const count = await allDeepTexts.count();
          console.log(`  Found ${count} "Deep Research" text elements.`);

          // Click the second one (first is the chip label if it changed, second is the option)
          if (count >= 2) {
            await allDeepTexts.nth(1).click();
            console.log("  Clicked second 'Deep Research' element.");
          } else if (count === 1) {
            // Only one — it might be in the dropdown. Click it.
            await allDeepTexts.first().click();
            console.log("  Clicked only 'Deep Research' element.");
          }

          await page.waitForTimeout(2000);
        }

        // Final screenshot to verify
        try {
          await page.screenshot({ path: "nlm-debug-mode-set.png" });
          console.log("  [debug] Screenshot: nlm-debug-mode-set.png");
        } catch { /* ignore */ }

      } else {
        // Maybe already set to Deep Research?
        const alreadyDeep = await page.locator('text=Deep Research').first().isVisible().catch(() => false);
        if (alreadyDeep) {
          console.log("  Deep Research chip already visible — may already be selected.");
        } else {
          console.log("  [warn] Fast Research chip not found. Cannot switch to Deep Research.");
        }
      }
    }

    // CRITICAL: Re-focus search input before submitting
    // After dropdown interaction, focus may have moved away from the search input.
    console.log("  Re-focusing search input and submitting...");

    // Click directly on the search input to ensure it has focus
    try {
      await clickCenter(page, searchInput);
      await page.waitForTimeout(500);
    } catch {
      // If the original locator is stale, re-find the search input
      const refocusInput = await findFirst(page, [
        page.getByPlaceholder(/무엇을 조사하고 싶으신가요/),
        page.getByPlaceholder(/웹에서 새 소스를 검색/),
        page.getByPlaceholder(/search.*web/i),
        page.getByPlaceholder(/검색/),
      ], { timeout: 3000 });
      if (refocusInput) {
        await clickCenter(page, refocusInput);
        await page.waitForTimeout(500);
      }
    }

    // Now press Enter to submit the search
    await page.keyboard.press("Enter");
    console.log("  Pressed Enter to submit.");

    // Wait and check if submission worked
    await page.waitForTimeout(3000);

    // Take debug screenshot to verify submission
    try {
      await page.screenshot({ path: "nlm-debug-after-submit.png" });
      console.log("  [debug] Screenshot saved: nlm-debug-after-submit.png");
    } catch { /* ignore */ }

    // Check if the dialog is still open (submission failed) — retry with submit button
    const dialogStillOpen = await findFirst(page, [
      page.getByPlaceholder(/무엇을 조사하고 싶으신가요/),
      page.getByPlaceholder(/웹에서 새 소스를 검색/),
      page.getByPlaceholder(/검색/),
    ], { timeout: 2000 });

    if (dialogStillOpen) {
      console.log("  Dialog still open after Enter — trying submit button...");

      // Look for the arrow/submit button (arrow_forward icon)
      const submitBtn = await findFirst(page, [
        page.locator('button[aria-label*="submit"], button[aria-label*="검색"], button[aria-label*="제출"]'),
        page.locator('button:has-text("arrow_forward")'),
        page.locator('button mat-icon:has-text("arrow_forward")').locator(".."),
        // The arrow-forward icon button near the search input
        page.locator('[class*="submit"], [class*="search-button"]'),
      ], { timeout: 2000 });

      if (submitBtn) {
        await clickCenter(page, submitBtn);
        console.log("  Clicked submit button.");
        await page.waitForTimeout(3000);
      } else {
        // Last resort: press Enter again after ensuring input has focus
        await page.evaluate(() => {
          const candidates = [
            ...document.querySelectorAll('textarea, input[type="text"], input[type="search"]'),
          ];
          const el = candidates.find((e) => {
            const ph = e.placeholder || "";
            return ph.includes("검색") || ph.includes("search") || ph.includes("조사");
          }) || candidates[0];
          if (el) {
            el.focus();
            el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
            el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
          }
        });
        console.log("  Dispatched Enter event via DOM.");
        await page.waitForTimeout(3000);
      }

      // Take another screenshot to check
      try {
        await page.screenshot({ path: "nlm-debug-after-retry.png" });
        console.log("  [debug] Screenshot saved: nlm-debug-after-retry.png");
      } catch { /* ignore */ }
    }

    // Take a debug screenshot
    try {
      await page.screenshot({ path: "nlm-debug-after-submit.png" });
      console.log("  [debug] Screenshot saved: nlm-debug-after-submit.png");
    } catch { /* ignore */ }

    // 7. Wait for research completion ───────────────────────────────────
    const modeLabel = resolvedMode === "deep" ? "Deep Research" : "Fast Research";
    console.log(`[6/8] Waiting for ${modeLabel} to complete (up to ${args.timeout}s)...`);

    const completed = await pollUntil(
      async () => {
        // Take periodic debug screenshots (every ~30s) for troubleshooting
        const elapsed = Date.now();

        // Check for completion indicators — multiple strategies
        const completionStatus = await page.evaluate(() => {
          const body = document.body.innerText || "";

          // 1. Explicit completion text
          if (body.includes("Research 완료") || body.includes("research complete") ||
              body.includes("조사 완료") || body.includes("연구 완료")) {
            return { done: true, reason: "completion text found" };
          }

          // 2. Check if dialog closed and sources appeared in the left panel
          // The source panel shows source cards with titles when research is done
          const sourcePanel = document.querySelector('[class*="source"]');
          const sourceLinks = document.querySelectorAll('a[href*="source"], [class*="source-card"], [class*="source-item"]');
          if (sourceLinks.length > 0) {
            return { done: true, reason: `${sourceLinks.length} source link(s) found` };
          }

          // 3. Check if the add-source dialog has closed (no more search input visible)
          const searchInputs = document.querySelectorAll('input[placeholder*="조사"], input[placeholder*="검색"], textarea[placeholder*="조사"]');
          const dialogVisible = [...searchInputs].some(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });

          // 4. Check for "저장된 소스" text with actual source content (not placeholder)
          const hasRealSources = body.includes("소스 ") && /소스 \d+개/.test(body) && !body.includes("소스 0개");
          if (hasRealSources && !dialogVisible) {
            return { done: true, reason: "source count indicator found" };
          }

          // 5. Check for loading/progress indicators
          const loadingEls = document.querySelectorAll('[class*="loading"], [class*="spinner"], [class*="progress"], [role="progressbar"]');
          const isLoading = [...loadingEls].some(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });

          if (isLoading) {
            return { done: false, reason: "loading" };
          }

          // 6. If dialog is gone and we have substantial content, consider done
          if (!dialogVisible) {
            const mainContent = document.querySelector("main") || document.querySelector('[role="main"]');
            const contentLen = mainContent?.innerText?.length || 0;
            if (contentLen > 500) {
              return { done: true, reason: `dialog closed, content length ${contentLen}` };
            }
          }

          return { done: false, reason: dialogVisible ? "dialog still open" : "waiting" };
        }).catch(() => ({ done: false, reason: "eval error" }));

        if (completionStatus.done) {
          console.log(`\n  ${modeLabel} completed: ${completionStatus.reason}`);
          return true;
        }

        process.stdout.write(".");
        return false;
      },
      { intervalMs: 5000, timeoutMs: args.timeout * 1000 }
    );

    if (!completed) {
      console.log(
        "\n  ⚠ Timeout reached. Extracting whatever content is available..."
      );
    }

    // After research completes, we need to:
    // 1. Click "보기" to view the Deep Research report
    // 2. Click "가져오기" to import sources into the notebook

    // Step A: Click "보기" (View) to read the research report
    console.log("  Looking for research report 'View' button...");
    const viewBtn = await findFirst(page, [
      page.getByText("보기", { exact: true }),
      page.getByRole("button", { name: /보기/ }),
      page.locator('text=보기').first(),
    ], { timeout: 5000 });

    let reportContent = "";
    if (viewBtn) {
      await clickCenter(page, viewBtn);
      console.log("  Clicked '보기' to view research report.");
      await page.waitForTimeout(3000);

      // Take screenshot of the report
      try {
        await page.screenshot({ path: "nlm-debug-report-view.png" });
        console.log("  [debug] Screenshot: nlm-debug-report-view.png");
      } catch { /* ignore */ }

      // Extract the report content — it should be displayed in a panel/modal
      reportContent = await page.evaluate(() => {
        // The report content appears in the main content area or a side panel
        // Look for the largest text block that appeared
        const allEls = [...document.querySelectorAll('*')];
        let bestContent = "";
        let bestLen = 0;

        for (const el of allEls) {
          const text = el.innerText?.trim() || "";
          const rect = el.getBoundingClientRect();
          if (rect.width > 200 && text.length > bestLen && text.length < 50000 &&
              el.tagName !== 'BODY' && el.tagName !== 'HTML' && el.tagName !== 'HEAD' &&
              !text.includes("스튜디오 출력이 여기에") &&
              !text.includes("NotebookLM이 부정확한")) {
            // Check it has real content (not just UI elements)
            const lines = text.split("\n").filter(l => l.trim().length > 20);
            if (lines.length > 3) {
              bestContent = text;
              bestLen = text.length;
            }
          }
        }
        return bestContent;
      });

      if (reportContent.length > 200) {
        console.log(`  Report content extracted: ${reportContent.length} characters.`);
      } else {
        console.log("  Report content too short, will try alternative extraction...");
      }

      // Go back to the main notebook view
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1000);
    } else {
      console.log("  '보기' button not found.");
    }

    // Step B: Click "가져오기" to import sources
    console.log("  Looking for '가져오기' (Import) button...");
    const importBtn = await findFirst(page, [
      page.getByText("가져오기", { exact: true }),
      page.getByRole("button", { name: /가져오기/ }),
      page.locator('button:has-text("가져오기")').first(),
    ], { timeout: 5000 });

    if (importBtn) {
      await clickCenter(page, importBtn);
      console.log("  Clicked '가져오기' to import sources.");

      // Wait for sources to be imported
      console.log("  Waiting for sources to be imported...");
      const sourcesReady = await pollUntil(
        async () => {
          const status = await page.evaluate(() => {
            const body = document.body.innerText || "";
            // After import, sources appear in the left panel
            // Check for "소스 N개" where N > 0 (not "소스 0개")
            const sourceMatch = body.match(/소스\s*(\d+)\s*개/);
            const counts = [];
            let match;
            const regex = /소스\s*(\d+)\s*개/g;
            while ((match = regex.exec(body)) !== null) {
              counts.push(parseInt(match[1], 10));
            }
            const maxCount = Math.max(0, ...counts);

            const stillLoading = body.includes("가져오는 중") || body.includes("importing") ||
                                 body.includes("처리 중");

            return { maxCount, stillLoading };
          }).catch(() => ({ maxCount: 0, stillLoading: false }));

          if (status.maxCount > 0 && !status.stillLoading) {
            console.log(`\n  Sources imported: ${status.maxCount} source(s) in notebook.`);
            return true;
          }
          process.stdout.write(".");
          return false;
        },
        { intervalMs: 5000, timeoutMs: 180000 }  // up to 3 min for source import
      );

      if (!sourcesReady) {
        console.log("\n  ⚠ Sources may not be fully imported. Proceeding...");
      }
    } else {
      console.log("  '가져오기' button not found.");
    }

    // Extra pause to let final rendering settle
    await page.waitForTimeout(3000);

    // 8. Extract content ────────────────────────────────────────────────
    console.log("[7/8] Extracting content...");

    // Take a final screenshot for debugging
    try {
      await page.screenshot({ path: "nlm-debug-before-extract.png" });
      console.log("  [debug] Screenshot: nlm-debug-before-extract.png");
    } catch { /* ignore */ }

    // Strategy: Use the chat to ask NotebookLM to summarize the sources
    // This gives much better structured content than scraping DOM elements
    console.log("  Asking NotebookLM to summarize sources via chat...");

    // Find the chat input at the bottom of the page
    const chatInput = await findFirst(page, [
      page.getByPlaceholder(/시작하려면 출처를 업로드/),
      page.getByPlaceholder(/메시지를 입력/),
      page.getByPlaceholder(/질문/),
      page.locator('textarea').last(),
      page.locator('input[type="text"]').last(),
    ], { timeout: 5000 });

    let chatContent = "";

    if (chatInput) {
      const chatPrompt = `"${args.topic}" 주제에 대해 수집된 소스들의 내용을 종합적으로 정리해주세요. 각 주요 항목별로 상세한 설명과 특징을 포함해주세요. 마크다운 형식으로 작성해주세요.`;

      try {
        await clickCenter(page, chatInput);
        await page.waitForTimeout(300);
        await chatInput.fill(chatPrompt, { force: true });
        await page.waitForTimeout(500);
        await page.keyboard.press("Enter");
        console.log("  Chat prompt sent. Waiting for response...");

        // Wait for chat response to appear
        const chatReady = await pollUntil(
          async () => {
            const responseLen = await page.evaluate(() => {
              // Look for the chat response area — typically the last message in chat
              const messages = document.querySelectorAll('[class*="message"], [class*="Message"], [class*="response"], [class*="Response"]');
              if (messages.length > 0) {
                const lastMsg = messages[messages.length - 1];
                return lastMsg.innerText?.length || 0;
              }
              // Fallback: check main content area for substantial text
              const main = document.querySelector('[class*="chat-area"], [class*="ChatArea"], main');
              return main?.innerText?.length || 0;
            }).catch(() => 0);

            if (responseLen > 200) return true;

            // Check if still generating
            const generating = await page.evaluate(() => {
              const body = document.body.innerText || "";
              return body.includes("생성 중") || body.includes("generating") || body.includes("typing");
            }).catch(() => false);

            if (generating) {
              process.stdout.write(".");
              return false;
            }

            process.stdout.write(".");
            return false;
          },
          { intervalMs: 3000, timeoutMs: 120000 }
        );

        if (chatReady) {
          // Wait a bit more for the full response to render
          await page.waitForTimeout(3000);

          chatContent = await page.evaluate(() => {
            // Get the last chat response message
            const messages = document.querySelectorAll('[class*="message"], [class*="Message"]');
            if (messages.length > 0) {
              // Find the longest message (likely the AI response, not the user prompt)
              let longest = "";
              messages.forEach(msg => {
                const text = msg.innerText?.trim() || "";
                if (text.length > longest.length) longest = text;
              });
              return longest;
            }

            // Fallback: get chat area content
            const chatArea = document.querySelector('[class*="chat"], main');
            return chatArea?.innerText?.trim() || "";
          });

          console.log(`\n  Chat response received: ${chatContent.length} characters.`);
        }
      } catch (e) {
        console.log(`  Chat extraction failed: ${e.message}`);
      }
    } else {
      console.log("  Chat input not found. Using DOM scraping fallback.");
    }

    // Fallback: scrape source panel and research results from DOM
    const domContent = await page.evaluate(() => {
      const results = [];

      // Get the research result summary (if visible — from the "보기" link)
      // Look for the research summary block
      const researchBlocks = [...document.querySelectorAll('*')].filter(el => {
        const text = el.textContent?.trim() || "";
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && text.length > 100 && text.length < 5000 &&
               !text.includes("NotebookLM이 부정확한") && // exclude footer
               !text.includes("스튜디오 출력이 여기에") && // exclude sidebar help
               !text.includes("저장된 소스가 여기에") && // exclude source panel placeholder
               el.tagName !== 'BODY' && el.tagName !== 'HTML' && el.tagName !== 'HEAD';
      });

      // Deduplicate by picking the most specific elements (smallest that are still substantial)
      const uniqueBlocks = researchBlocks
        .sort((a, b) => (a.textContent?.length || 0) - (b.textContent?.length || 0))
        .filter((el, i, arr) => {
          // Skip if a parent is already in the list and has similar content
          return !arr.slice(0, i).some(prev => el.contains(prev) && Math.abs(el.textContent.length - prev.textContent.length) < 100);
        });

      // Filter to get meaningful content blocks
      const meaningful = uniqueBlocks.filter(el => {
        const text = el.textContent?.trim() || "";
        // Must have substantial content and not be pure UI
        const uiKeywords = ["keyboard_arrow", "dock_to", "thumb_up", "thumb_down", "소스 추가", "소스 업로드"];
        const uiRatio = uiKeywords.filter(k => text.includes(k)).length;
        return text.length > 50 && uiRatio < 3;
      });

      if (meaningful.length > 0) {
        results.push("## Research Content");
        meaningful.slice(0, 5).forEach((el, i) => {
          const text = el.innerText?.trim();
          if (text && text.length > 50) {
            results.push(`### Section ${i + 1}\n${text}`);
          }
        });
      }

      // Also grab source titles from the left panel
      const sourceTexts = [];
      const leftPanel = document.querySelector('[class*="source"]')?.closest('[class*="panel"], aside, nav');
      if (leftPanel) {
        const links = leftPanel.querySelectorAll('a, [role="link"], [class*="title"]');
        links.forEach(link => {
          const text = link.innerText?.trim();
          if (text && text.length > 10 && text.length < 200 && !text.includes("소스 추가")) {
            sourceTexts.push(`- ${text}`);
          }
        });
      }

      if (sourceTexts.length > 0) {
        results.push("\n## Source Titles");
        results.push([...new Set(sourceTexts)].join("\n"));
      }

      return results.join("\n\n");
    });

    // Combine report content, chat response, and DOM scraping
    const title = await page.title();
    let finalContent = "";

    // Priority: reportContent (from "보기") > chatContent > domContent
    if (reportContent.length > 500) {
      finalContent = `## Deep Research Report\n\n${reportContent}`;
      if (chatContent.length > 200) {
        finalContent += `\n\n---\n\n## AI Summary (from NotebookLM Chat)\n\n${chatContent}`;
      }
    } else if (chatContent.length > 200) {
      finalContent = `## AI Summary (from NotebookLM Chat)\n\n${chatContent}`;
      if (domContent.length > 100) {
        finalContent += `\n\n---\n\n${domContent}`;
      }
    } else if (domContent.length > 100) {
      finalContent = domContent;
    } else {
      // Last resort: dump filtered body text
      finalContent = await page.evaluate(() => {
        const body = document.body.innerText || "";
        // Remove common UI noise
        return body
          .split("\n")
          .filter(line => {
            const l = line.trim();
            return l.length > 5 &&
              !["keyboard_arrow_down", "dock_to_right", "dock_to_left", "search_spark",
                "thumb_up", "thumb_down", "arrow_forward", "more_vert", "trending_up",
                "edit", "share", "settings", "add", "search", "language", "upload",
                "sticky_note_2", "메모 추가", "소스 추가", "소스 업로드", "PRO",
                "docs", "cards_star", "flowchart", "auto_tab_group", "stacked_bar_chart",
                "table_view", "edit_fix_auto", "audio_magic_eraser", "subscriptions",
                "quiz", "tablet", "tune", "close", "link"].includes(l);
          })
          .join("\n");
      });
      finalContent = `## Page Content (filtered)\n\n${finalContent}`;
    }

    const output = `# NotebookLM Auto Research: ${args.topic}\n\nSource: ${title}\nMode: ${resolvedMode}\n\n${finalContent}`;
    writeFileSync(args.output, output, "utf-8");
    console.log(`  Extracted ${finalContent.length} characters.`);

    // 9. Ensure notebook persistence ────────────────────────────────────
    console.log("[8/9] Ensuring notebook is saved on NLM server...");

    const notebookUrl = page.url();
    console.log(`  Notebook URL: ${notebookUrl}`);

    // NLM auto-names notebooks after Deep Research import.
    // Our job: wait for server sync, then verify by re-visiting the notebook.

    // Step A: Wait for NLM server sync (sources + content must be fully persisted)
    console.log("  Waiting for NLM server sync (20s)...");
    await page.waitForTimeout(20000);

    // Step B: Re-visit the notebook URL to verify it has sources
    console.log("  Re-visiting notebook URL to verify persistence...");
    let verified = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.goto(notebookUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(8000);

        // Check source count on the page
        const sourceInfo = await page.evaluate(() => {
          const body = document.body.innerText || "";
          const regex = /소스\s*(\d+)\s*개/g;
          const counts = [];
          let m;
          while ((m = regex.exec(body)) !== null) counts.push(parseInt(m[1], 10));
          const maxCount = Math.max(0, ...counts);
          // Also check for source list items in the left panel
          const sourceItems = document.querySelectorAll('[class*="source-item"], [class*="SourceItem"], .source-list-item');
          const title = document.title || "";
          const h1 = document.querySelector('h1, [class*="notebook-title"], [class*="NotebookTitle"]');
          const notebookTitle = h1?.textContent?.trim() || "";
          return { maxCount, sourceItems: sourceItems.length, title, notebookTitle };
        });

        console.log(`  Attempt ${attempt}: sources=${sourceInfo.maxCount}, title="${sourceInfo.notebookTitle || sourceInfo.title}"`);

        if (sourceInfo.maxCount > 0) {
          console.log(`  ✓ Notebook verified: ${sourceInfo.maxCount} sources persisted.`);
          verified = true;

          // Take final screenshot
          try {
            await page.screenshot({ path: "nlm-debug-verified.png" });
            console.log("  [debug] Verified screenshot: nlm-debug-verified.png");
          } catch { /* ignore */ }
          break;
        }

        console.log(`  Sources not yet visible. Waiting 10s before retry...`);
        await page.waitForTimeout(10000);
      } catch (e) {
        console.log(`  Attempt ${attempt} failed: ${e.message}`);
        await page.waitForTimeout(5000);
      }
    }

    // Step C: Navigate to NLM home to visually confirm
    console.log("  Checking NLM home for notebook listing...");
    try {
      await page.goto(NLM_HOME, { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.waitForTimeout(3000);

      await page.screenshot({ path: "nlm-debug-home-verify.png" });
      console.log("  [debug] Home screenshot: nlm-debug-home-verify.png");

      // Find all today's notebooks — NLM auto-names notebooks after Deep Research import
      // The newest non-Untitled notebook with sources > 0 is likely ours
      const todayNotebooks = await page.evaluate(() => {
        const items = document.querySelectorAll('[class*="notebook"], [class*="card"]');
        const results = [];
        items.forEach(item => {
          const text = item.textContent || "";
          if (text.includes("2026. 3.") || text.includes("2026.3.")) {
            results.push(text.replace(/\s+/g, " ").substring(0, 80));
          }
        });
        return results;
      });
      const namedNotebooks = todayNotebooks.filter(n => !n.includes("Untitled"));
      console.log(`  Today's named notebooks (${namedNotebooks.length}):`);
      namedNotebooks.forEach(n => console.log(`    ✓ ${n}`));
      const untitledCount = todayNotebooks.filter(n => n.includes("Untitled")).length;
      if (untitledCount > 0) console.log(`  (+ ${untitledCount} Untitled notebooks)`);

      if (namedNotebooks.length > 0) {
        verified = true;
        console.log("  ✓ Notebook confirmed on NLM home page.");
      }
    } catch (e) {
      console.log(`  Home verification failed: ${e.message}`);
    }

    if (!verified) {
      console.log("  ⚠ WARNING: Could not verify notebook persistence after 3 attempts.");
      console.log("    The notebook may still be syncing. Check NLM manually:");
      console.log(`    ${notebookUrl}`);
    }

    // Append notebook URL to the output file
    const existingContent = output;
    writeFileSync(args.output, existingContent + `\n\n---\n\n## Notebook Info\n- URL: ${notebookUrl}\n- Mode: ${resolvedMode}\n`, "utf-8");

    console.log(`  Content saved to: ${args.output}`);
    console.log("\n  Closing browser for persistence test...");
    await page.waitForTimeout(2000);

  } catch (err) {
    console.error(`\nError: ${err.message}`);
    console.error("\nTroubleshooting:");
    console.error("  1. Delete .playwright-session/ and re-run to reset login");
    console.error("  2. NotebookLM UI may have changed — check selectors");
    console.error("  3. Ensure you have network access to notebooklm.google.com");

    // Save partial content on error if possible
    try {
      const partial = await page.evaluate(
        () => document.body.innerText?.trim() || ""
      );
      if (partial.length > 100) {
        writeFileSync(
          args.output,
          `# NotebookLM Auto Research (partial): ${args.topic}\n\n${partial}`,
          "utf-8"
        );
        console.error(`\nPartial content saved to: ${args.output}`);
      }
    } catch {
      // ignore extraction failure during error handling
    }

    await context.close();
    process.exit(1);
  }

  // Close the original browser context completely
  await context.close();

  // ── 10. PERSISTENCE VERIFICATION ──────────────────────────────────
  // Open a FRESH browser session and verify the notebook still exists
  console.log("\n[VERIFY] Opening fresh browser to verify notebook persistence...");

  const verifyContext = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const verifyPage = await verifyContext.newPage();
  let persistenceOk = false;

  try {
    // Read the notebook URL from the saved output
    const savedContent = readFileSync(args.output, "utf-8");
    const urlMatch = savedContent.match(/URL:\s*(https:\/\/notebooklm\.google\.com\/notebook\/[^\s]+)/);
    const savedNotebookUrl = urlMatch ? urlMatch[1] : null;

    // Step 1: Go to NLM home
    console.log("[VERIFY] Loading NLM home page...");
    await verifyPage.goto(NLM_HOME, { waitUntil: "domcontentloaded", timeout: 30000 });
    await verifyPage.waitForTimeout(5000);

    await verifyPage.screenshot({ path: "nlm-verify-home.png" });
    console.log("  [debug] Screenshot: nlm-verify-home.png");

    // Check all notebooks on the home page
    const homeNotebooks = await verifyPage.evaluate(() => {
      const body = document.body.innerText || "";
      const lines = body.split("\n").filter(l => l.trim());
      // Find notebook-like entries
      const notebooks = [];
      for (const line of lines) {
        if (line.includes("소스") && (line.includes("개") || line.includes("sources"))) {
          notebooks.push(line.trim().substring(0, 100));
        }
      }
      return notebooks;
    });

    console.log(`  All notebooks with sources on home:`);
    homeNotebooks.forEach(n => console.log(`    - ${n}`));

    // Step 2: If we have a notebook URL, visit it directly
    if (savedNotebookUrl) {
      console.log(`\n[VERIFY] Visiting notebook URL: ${savedNotebookUrl}`);
      await verifyPage.goto(savedNotebookUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await verifyPage.waitForTimeout(8000);

      await verifyPage.screenshot({ path: "nlm-verify-notebook.png" });
      console.log("  [debug] Screenshot: nlm-verify-notebook.png");

      // Check if notebook has content and verify Deep Research mode
      const nbInfo = await verifyPage.evaluate(() => {
        const body = document.body.innerText || "";
        const sourceMatch = body.match(/소스\s*(\d+)\s*개/g);
        const counts = (sourceMatch || []).map(m => parseInt(m.match(/\d+/)[0], 10));
        const maxSources = Math.max(0, ...counts);
        const title = document.querySelector('h1, [class*="title"]')?.textContent?.trim() || "";
        const hasContent = body.length > 500;
        const is404 = body.includes("not found") || body.includes("404") || body.includes("삭제된");
        // Deep Research indicator: source list contains "Deep Research 보고서"
        const isDeepResearch = body.includes("Deep Research 보고서") || body.includes("Deep Research report");
        return { maxSources, title, hasContent, bodyLength: body.length, is404, isDeepResearch };
      });

      console.log(`  Notebook status:`);
      console.log(`    Title: ${nbInfo.title || "(none)"}`);
      console.log(`    Sources: ${nbInfo.maxSources}`);
      console.log(`    Has content: ${nbInfo.hasContent} (${nbInfo.bodyLength} chars)`);
      console.log(`    Is 404: ${nbInfo.is404}`);
      console.log(`    Deep Research: ${nbInfo.isDeepResearch ? "✓ YES" : "✗ NO (Fast Research)"}`);

      if (nbInfo.maxSources > 0 && nbInfo.hasContent && !nbInfo.is404) {
        persistenceOk = true;
        const modeLabel = nbInfo.isDeepResearch ? "Deep Research" : "Fast Research";
        console.log(`\n  ✅ PERSISTENCE VERIFIED: Notebook exists with ${nbInfo.maxSources} sources. Mode: ${modeLabel}`);
        if (!nbInfo.isDeepResearch && resolvedMode === "deep") {
          console.log(`  ⚠ WARNING: Requested Deep Research but notebook shows Fast Research.`);
        }
      } else {
        console.log(`\n  ❌ PERSISTENCE FAILED: Notebook not properly saved.`);
      }
    } else {
      console.log("  No notebook URL found in output file.");
    }

  } catch (e) {
    console.log(`  Verification error: ${e.message}`);
  }

  await verifyPage.waitForTimeout(2000);
  await verifyContext.close();

  if (persistenceOk) {
    console.log("\nDone! Notebook is confirmed persistent.");
  } else {
    console.log("\n⚠ Notebook persistence could not be confirmed.");
    console.log("  This may be a timing issue. Check NLM manually.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
