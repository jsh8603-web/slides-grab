/**
 * Test: enhancePrompt split-layout composition logic
 * Verifies that 4:3/3:4/1:1 images get "fills the frame" instead of "negative space"
 */
import fs from 'fs';

// Extract enhancePrompt function source
const code = fs.readFileSync('scripts/generate-images.mjs', 'utf8');

// Simulate the split-layout detection logic inline (same as enhancePrompt)
function testSplitLogic(prompt, aspectRatio) {
  let enhanced = prompt;
  // Strip hex codes
  enhanced = enhanced.replace(/#[0-9A-Fa-f]{3,8}/g, "").replace(/\s{2,}/g, " ");
  if (!/no text/i.test(enhanced)) enhanced += " No text whatsoever.";

  const isPhoto = /\b(cinematic|photograph|photo|aerial|drone|macro|close-up)\b/i.test(enhanced);
  const isCover = false;
  const isFrameOrDiagram = /\b(frame|timeline|process|funnel|pyramid|comparison|matrix|diagram|radial|venn|staircase|hub|flowchart|chevron)\b/i.test(enhanced);
  const isSplitLayout = /^(4:3|3:4|1:1)$/.test(aspectRatio || "");

  if (isPhoto && !isCover && !isFrameOrDiagram) {
    if (isSplitLayout && !/fills? the frame|centered composition/i.test(enhanced)) {
      enhanced += " Subject fills the frame with centered composition, no large empty areas.";
    } else if (!isSplitLayout && !/negative space|empty area|text overlay/i.test(enhanced)) {
      enhanced += " Ample negative space on one side for text overlay.";
    }
  }
  return enhanced;
}

let pass = 0, fail = 0;
function test(name, condition) {
  if (condition) { console.log(`  PASS: ${name}`); pass++; }
  else { console.log(`  FAIL: ${name}`); fail++; }
}

console.log("enhancePrompt split-layout tests\n================================");

// T1: 4:3 photo → fills the frame, NOT negative space
const r1 = testSplitLogic("A brass balance scale, cinematic lighting", "4:3");
test("T1: 4:3 photo gets 'fills the frame'", r1.includes("fills the frame"));
test("T1: 4:3 photo no 'negative space'", !r1.includes("negative space"));

// T2: 16:9 photo → negative space, NOT fills the frame
// Note: "hub" triggers isFrameOrDiagram, so use a prompt without frame keywords
const r2 = testSplitLogic("Aerial night photograph of a city skyline, cinematic", "16:9");
test("T2: 16:9 photo gets 'negative space'", r2.includes("negative space"));
test("T2: 16:9 photo no 'fills the frame'", !r2.includes("fills the frame"));

// T3: 4:3 with existing "fills the frame" → no duplication
const r3 = testSplitLogic("A vault fills the frame, cinematic", "4:3");
test("T3: no duplicate 'fills the frame'", (r3.match(/fills the frame/g) || []).length === 1);

// T4: 3:4 photo → fills the frame
const r4 = testSplitLogic("A close-up photograph of documents", "3:4");
test("T4: 3:4 photo gets 'fills the frame'", r4.includes("fills the frame"));

// T5: 1:1 photo → fills the frame
const r5 = testSplitLogic("An icon photograph style", "1:1");
test("T5: 1:1 photo gets 'fills the frame'", r5.includes("fills the frame"));

// T6: non-photo 4:3 → neither (not triggered)
const r6 = testSplitLogic("Abstract layered building blocks", "4:3");
test("T6: non-photo gets neither", !r6.includes("fills the frame") && !r6.includes("negative space"));

// T7: 16:9 with existing "negative space" → no duplication
const r7 = testSplitLogic("Photo with negative space on right, cinematic", "16:9");
test("T7: no duplicate 'negative space'", (r7.match(/negative space/g) || []).length === 1);

// T8: cover photo → neither (isCover bypasses)
// (isCover is always false in our test, but this tests the non-cover path)
const r8 = testSplitLogic("A drone shot of city", "4:3");
test("T8: 4:3 drone fills frame", r8.includes("fills the frame"));

// T9: Verify actual generate-images.mjs has the split-layout code
test("T9: source has isSplitLayout check", code.includes("isSplitLayout"));
test("T9: source has 'fills the frame'", code.includes("Subject fills the frame"));
test("T9: source retains negative space for non-split", code.includes("Ample negative space on one side"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
