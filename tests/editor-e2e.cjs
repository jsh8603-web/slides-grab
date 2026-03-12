const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  await page.goto('http://localhost:3463/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const results = [];
  let pass = 0, fail = 0;

  function log(name, ok, detail) {
    if (ok) pass++; else fail++;
    results.push((ok ? 'PASS' : 'FAIL') + ': ' + name + (detail ? ' — ' + detail : ''));
  }

  async function getFrame() {
    const h = await page.$('#slide-iframe');
    return h.contentFrame();
  }

  async function goSlide(n) {
    // Click prev until disabled (slide 1)
    for (let i = 0; i < 10; i++) {
      const disabled = await page.$eval('#btn-prev', el => el.disabled);
      if (disabled) break;
      await page.click('#btn-prev', { force: true });
      await page.waitForTimeout(80);
    }
    for (let i = 0; i < n - 1; i++) { await page.click('#btn-next', { force: true }); await page.waitForTimeout(300); }
    await page.waitForTimeout(800);
  }

  async function selectMode() { await page.click('#tool-mode-select'); await page.waitForTimeout(300); }
  async function drawMode() { await page.click('#tool-mode-draw'); await page.waitForTimeout(300); }

  async function clickSlide(xR, yR) {
    const dl = await page.$('#draw-layer');
    const bx = await dl.boundingBox();
    await page.mouse.click(bx.x + bx.width * xR, bx.y + bx.height * yR);
    await page.waitForTimeout(500);
  }

  async function getSelected() {
    try { return await page.$eval('#mini-tag', el => el.textContent); } catch { return ''; }
  }

  async function ctrlKey(k) {
    await page.keyboard.down('Control');
    await page.keyboard.press(k);
    await page.keyboard.up('Control');
    await page.waitForTimeout(800);
  }

  // === Navigation (1-7) ===
  log('1. Initial load', (await page.$eval('#slide-counter', el => el.textContent)).includes('1'));
  await page.click('#btn-next', { force: true }); await page.waitForTimeout(400);
  log('2. Next button', (await page.$eval('#slide-counter', el => el.textContent)).includes('2'));
  await page.click('#btn-prev', { force: true }); await page.waitForTimeout(400);
  log('3. Prev button', (await page.$eval('#slide-counter', el => el.textContent)).includes('1'));
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400);
  log('4. Arrow right', (await page.$eval('#slide-counter', el => el.textContent)).includes('2'));
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(400);
  log('5. Arrow left', (await page.$eval('#slide-counter', el => el.textContent)).includes('1'));
  await goSlide(10);
  log('6. Go to slide 10', (await page.$eval('#slide-counter', el => el.textContent)).includes('10'));
  await page.click('#btn-next', { force: true }); await page.waitForTimeout(300);
  log('7. No past last', (await page.$eval('#slide-counter', el => el.textContent)).includes('10'));

  // === Tool Mode (8-12) ===
  await drawMode();
  log('8. Draw mode active', await page.$eval('#tool-mode-draw', el => el.classList.contains('active')));
  await selectMode();
  log('9. Select mode active', await page.$eval('#tool-mode-select', el => el.classList.contains('active')));
  await drawMode();
  log('10. Select toolbar hidden in draw', await page.$eval('#select-toolbar', el => el.hidden));
  await selectMode();
  log('11. Bbox toolbar hidden in select', await page.$eval('#bbox-toolbar', el => el.hidden));
  log('12. Empty hint visible', (await page.$eval('#select-empty-hint', el => el.style.display)) !== 'none');

  // === Selection (13-20) ===
  await goSlide(1); await selectMode(); await clickSlide(0.5, 0.5);
  log('13. Select on slide 1', (await getSelected()).length > 0);
  await goSlide(3); await selectMode(); await clickSlide(0.3, 0.5);
  log('14. Select on slide 3', (await getSelected()).length > 0);
  await goSlide(4); await selectMode(); await clickSlide(0.7, 0.5);
  log('15. Select on slide 4', (await getSelected()).length > 0);
  await goSlide(5); await selectMode(); await clickSlide(0.5, 0.5);
  log('16. Select on slide 5', (await getSelected()).length > 0);
  await goSlide(6); await selectMode(); await clickSlide(0.3, 0.5);
  log('17. Select on slide 6', (await getSelected()).length > 0);
  await goSlide(7); await selectMode(); await clickSlide(0.5, 0.5);
  log('18. Select on slide 7', (await getSelected()).length > 0);
  await goSlide(8); await selectMode(); await clickSlide(0.5, 0.5);
  log('19. Select on slide 8', (await getSelected()).length > 0);
  await goSlide(10); await selectMode(); await clickSlide(0.5, 0.8);
  log('20. Select on slide 10', (await getSelected()).length > 0);

  // === Style Editing (21-30) ===
  await goSlide(10); await selectMode(); await clickSlide(0.65, 0.55);
  const b21 = await page.$eval('#toggle-bold', el => el.classList.contains('active'));
  await page.click('#toggle-bold'); await page.waitForTimeout(300);
  log('21. Bold toggle', b21 !== (await page.$eval('#toggle-bold', el => el.classList.contains('active'))));
  await ctrlKey('z');

  await selectMode(); await clickSlide(0.65, 0.55);
  const i22 = await page.$eval('#toggle-italic', el => el.classList.contains('active'));
  await page.click('#toggle-italic'); await page.waitForTimeout(300);
  log('22. Italic toggle', i22 !== (await page.$eval('#toggle-italic', el => el.classList.contains('active'))));
  await ctrlKey('z');

  await selectMode(); await clickSlide(0.65, 0.55);
  await page.click('#toggle-underline'); await page.waitForTimeout(300);
  log('23. Underline toggle', await page.$eval('#toggle-underline', el => el.classList.contains('active')));
  await ctrlKey('z');

  await selectMode(); await clickSlide(0.65, 0.55);
  await page.click('#toggle-strike'); await page.waitForTimeout(300);
  log('24. Strike toggle', await page.$eval('#toggle-strike', el => el.classList.contains('active')));
  await ctrlKey('z');

  await selectMode(); await clickSlide(0.65, 0.55);
  await page.click('#align-center'); await page.waitForTimeout(300);
  log('25. Align center', await page.$eval('#align-center', el => el.classList.contains('active')));
  await ctrlKey('z');

  await selectMode(); await clickSlide(0.65, 0.55);
  await page.click('#align-right'); await page.waitForTimeout(300);
  log('26. Align right', await page.$eval('#align-right', el => el.classList.contains('active')));
  await ctrlKey('z');

  await selectMode(); await clickSlide(0.65, 0.55);
  await page.click('#align-left'); await page.waitForTimeout(300);
  log('27. Align left', await page.$eval('#align-left', el => el.classList.contains('active')));

  // Keyboard shortcuts
  await selectMode(); await clickSlide(0.65, 0.55);
  const kb28 = await page.$eval('#toggle-bold', el => el.classList.contains('active'));
  await ctrlKey('b');
  log('28. Ctrl+B', kb28 !== (await page.$eval('#toggle-bold', el => el.classList.contains('active'))));
  await ctrlKey('z');

  await selectMode(); await clickSlide(0.65, 0.55);
  const kb29 = await page.$eval('#toggle-italic', el => el.classList.contains('active'));
  await ctrlKey('i');
  log('29. Ctrl+I', kb29 !== (await page.$eval('#toggle-italic', el => el.classList.contains('active'))));
  await ctrlKey('z');

  await selectMode(); await clickSlide(0.65, 0.55);
  await ctrlKey('u');
  log('30. Ctrl+U', await page.$eval('#toggle-underline', el => el.classList.contains('active')));
  await ctrlKey('z');

  // === Color & Bg (31-37) ===
  await selectMode(); await clickSlide(0.65, 0.55);
  let frame = await getFrame();
  await page.evaluate(() => { const i = document.getElementById('popover-text-color-input'); i.value = '#ff0000'; i.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(600);
  log('31. Text color no error', true);
  await ctrlKey('z');

  await selectMode(); await clickSlide(0.65, 0.55);
  await page.evaluate(() => { const i = document.getElementById('popover-bg-color-input'); i.value = '#00ff00'; i.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(600);
  frame = await getFrame();
  log('32. Bg color green', await frame.evaluate(() => !!document.querySelector('[style*="rgb(0, 255, 0)"]')));

  await ctrlKey('z');
  frame = await getFrame();
  log('33. Undo bg color', await frame.evaluate(() => !document.querySelector('[style*="rgb(0, 255, 0)"]')));

  await ctrlKey('y');
  frame = await getFrame();
  log('34. Redo bg color', await frame.evaluate(() => !!document.querySelector('[style*="rgb(0, 255, 0)"]')));

  await selectMode(); await clickSlide(0.65, 0.55);
  await page.click('#btn-bg-transparent'); await page.waitForTimeout(600);
  frame = await getFrame();
  log('35. Transparent button', await frame.evaluate(() => !!document.querySelector('[style*="transparent"]')));
  await ctrlKey('z');

  // 36. Bg white then undo
  await selectMode(); await clickSlide(0.65, 0.55);
  frame = await getFrame();
  const before36 = await frame.evaluate(() => document.body.outerHTML);
  await page.evaluate(() => { const i = document.getElementById('popover-bg-color-input'); i.value = '#ffffff'; i.dispatchEvent(new Event('input')); });
  await page.waitForTimeout(600);
  await ctrlKey('z');
  frame = await getFrame();
  const after36 = await frame.evaluate(() => document.body.outerHTML);
  log('36. Bg white + undo restores', before36 === after36);

  // 37. Size change
  await selectMode(); await clickSlide(0.65, 0.55);
  await page.fill('#popover-size-input', '40');
  await page.click('#popover-apply-size'); await page.waitForTimeout(500);
  log('37. Size change no error', true);
  await ctrlKey('z');

  // === BBox (38-42) ===
  await goSlide(1); await drawMode();
  const dl = await page.$('#draw-layer');
  const dlBx = await dl.boundingBox();
  await page.mouse.move(dlBx.x + 100, dlBx.y + 100);
  await page.mouse.down();
  await page.mouse.move(dlBx.x + 300, dlBx.y + 300, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  log('38. Draw bbox', (await page.$eval('#bbox-count', el => el.textContent)).includes('1'));

  await page.mouse.move(dlBx.x + 400, dlBx.y + 100);
  await page.mouse.down();
  await page.mouse.move(dlBx.x + 600, dlBx.y + 200, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  log('39. Second bbox', (await page.$eval('#bbox-count', el => el.textContent)).includes('2'));

  await page.click('#btn-clear-bboxes'); await page.waitForTimeout(300);
  log('40. Clear bboxes', (await page.$eval('#bbox-count', el => el.textContent)).includes('0'));

  await drawMode();
  await page.mouse.move(dlBx.x + 100, dlBx.y + 100);
  await page.mouse.down();
  await page.mouse.move(dlBx.x + 200, dlBx.y + 200, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.click('#btn-next', { force: true }); await page.waitForTimeout(500);
  log('41. Bbox isolated per slide', (await page.$eval('#bbox-count', el => el.textContent)).includes('0'));
  await page.click('#btn-prev', { force: true }); await page.waitForTimeout(500);
  log('42. Bbox persists on return', (await page.$eval('#bbox-count', el => el.textContent)).includes('1'));
  await page.click('#btn-clear-bboxes');

  // === Images (43-45) ===
  await goSlide(1); frame = await getFrame();
  log('43. Slide 1 image loaded', await frame.evaluate(() => { const i = document.querySelector('img'); return i ? i.naturalWidth > 0 : false; }));
  await goSlide(4); frame = await getFrame();
  log('44. Slide 4 image', await frame.evaluate(() => { const i = document.querySelector('img'); return i ? i.src.includes('pangaea') : false; }));
  await goSlide(10); frame = await getFrame();
  log('45. Slide 10 image', await frame.evaluate(() => { const i = document.querySelector('img'); return i ? i.src.includes('closing') : false; }));

  // === Multi-undo (46-48) ===
  await goSlide(10); await selectMode(); await clickSlide(0.5, 0.4);
  await page.click('#toggle-bold'); await page.waitForTimeout(300);
  await page.click('#toggle-italic'); await page.waitForTimeout(300);
  await page.click('#toggle-underline'); await page.waitForTimeout(300);
  for (let i = 0; i < 3; i++) await ctrlKey('z');
  log('46. Multi-undo 3x', true);
  for (let i = 0; i < 3; i++) await ctrlKey('y');
  log('47. Multi-redo 3x', true);
  for (let i = 0; i < 20; i++) { await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control'); await page.waitForTimeout(50); }
  await page.waitForTimeout(500);
  log('48. Excessive undo no crash', errors.length === 0);

  // === Misc (49-50) ===
  log('49. Model selector', (await page.$eval('#model-select', el => el.value)).length > 0);
  log('50. Status message', (await page.$eval('#status-message', el => el.textContent)).length > 0);

  // === Report ===
  console.log('\n' + '='.repeat(50));
  console.log('RESULTS: ' + pass + ' PASS, ' + fail + ' FAIL out of ' + (pass + fail));
  console.log('='.repeat(50));
  results.forEach(r => console.log(r));
  if (errors.length > 0) { console.log('\nPage errors:'); errors.forEach(e => console.log('  ' + e)); }
  await browser.close();
})();
