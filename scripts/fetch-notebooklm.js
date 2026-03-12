/**
 * Fetch NotebookLM notebook content via Playwright with manual Google login.
 * Usage: node scripts/fetch-notebooklm.js <notebook-url> [output-file]
 */

import { chromium } from "playwright";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const notebookUrl = process.argv[2];
const outputFile = process.argv[3] || join(__dirname, "..", "notebook-content.md");

if (!notebookUrl) {
  console.error("Usage: node scripts/fetch-notebooklm.js <notebook-url> [output-file]");
  process.exit(1);
}

const SESSION_DIR = join(__dirname, "..", ".playwright-session");

async function main() {
  console.log("Launching browser (visible mode)...");

  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const page = await context.newPage();

  console.log(`Navigating to: ${notebookUrl}`);
  await page.goto(notebookUrl, { waitUntil: "domcontentloaded", timeout: 120000 });

  // Check if redirected to login
  const currentUrl = page.url();
  if (currentUrl.includes("accounts.google.com")) {
    console.log("\n========================================");
    console.log("  Google 로그인 화면이 표시됩니다.");
    console.log("  브라우저에서 로그인을 완료해주세요.");
    console.log("  로그인 후 자동으로 진행됩니다.");
    console.log("========================================\n");

    // Wait until URL is back to notebooklm
    await page.waitForURL("**/notebooklm.google.com/**", { timeout: 180000 });
    console.log("Login successful! Loading notebook...");
  }

  // Wait for notebook content to load
  console.log("Waiting for notebook content to render...");
  await page.waitForTimeout(5000);

  // Try multiple selectors to find content
  const content = await page.evaluate(() => {
    const results = [];

    // 1. Try to find source list/panel
    const sourceElements = document.querySelectorAll(
      '[data-test-id*="source"], [class*="source"], [class*="Source"]'
    );
    if (sourceElements.length > 0) {
      results.push("## Sources Found");
      sourceElements.forEach((el, i) => {
        const text = el.innerText?.trim();
        if (text) results.push(`### Source ${i + 1}\n${text}`);
      });
    }

    // 2. Try to find notes
    const noteElements = document.querySelectorAll(
      '[data-test-id*="note"], [class*="note"], [class*="Note"]'
    );
    if (noteElements.length > 0) {
      results.push("\n## Notes Found");
      noteElements.forEach((el, i) => {
        const text = el.innerText?.trim();
        if (text) results.push(`### Note ${i + 1}\n${text}`);
      });
    }

    // 3. Fallback: get main content area
    const mainContent = document.querySelector("main") || document.querySelector('[role="main"]');
    if (mainContent) {
      results.push("\n## Main Content");
      results.push(mainContent.innerText?.trim() || "");
    }

    // 4. Ultimate fallback: body text
    if (results.length === 0) {
      results.push("## Page Content (fallback)");
      results.push(document.body.innerText?.trim() || "No content found");
    }

    return results.join("\n\n");
  });

  console.log(`\nExtracted ${content.length} characters of content.`);

  // Also grab the page title
  const title = await page.title();

  const output = `# NotebookLM Content: ${title}\n\n${content}`;
  writeFileSync(outputFile, output, "utf-8");
  console.log(`Saved to: ${outputFile}`);

  // Try clicking on each source to expand full content
  console.log("\nAttempting to expand and read individual sources...");

  const sourceDetails = await page.evaluate(async () => {
    // Find clickable source items
    const items = document.querySelectorAll(
      '[class*="source-item"], [class*="SourceItem"], [role="listitem"]'
    );
    const details = [];
    for (const item of items) {
      const title = item.querySelector("h3, h4, [class*='title'], [class*='Title']");
      if (title) {
        details.push(`- ${title.innerText?.trim()}`);
      }
    }
    return details.join("\n");
  });

  if (sourceDetails) {
    const expanded = `\n\n## Source Titles\n${sourceDetails}`;
    writeFileSync(outputFile, output + expanded, "utf-8");
    console.log("Source titles appended.");
  }

  console.log("\nDone! You can close the browser now, or press Ctrl+C.");
  console.log("Content saved to:", outputFile);

  // Keep browser open briefly for manual inspection
  await page.waitForTimeout(3000);
  await context.close();
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
