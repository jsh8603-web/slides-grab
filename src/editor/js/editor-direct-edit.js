// editor-direct-edit.js — Style changes, direct save (debounced), undo/redo

import { localFileUpdateBySlide } from './editor-state.js';
import { slideIframe } from './editor-dom.js';
import { currentSlideFile, getDirectSaveState, setStatus } from './editor-utils.js';
import { addChatMessage } from './editor-chat.js';
import { getSelectedObjectElement, renderObjectSelection, updateObjectEditorControls, readSelectedObjectStyleState } from './editor-select.js';

// --- Undo / Redo (per-slide HTML snapshot stack) ---
const MAX_HISTORY = 40;
const historyBySlide = new Map(); // slide -> { stack: string[], index: number }

function getHistory(slide) {
  if (!historyBySlide.has(slide)) {
    historyBySlide.set(slide, { stack: [], index: -1 });
  }
  return historyBySlide.get(slide);
}

export function pushUndoSnapshot(slide) {
  if (!slide) slide = currentSlideFile();
  if (!slide) return;
  const html = serializeSlideDocument(slideIframe.contentDocument);
  if (!html) return;
  const h = getHistory(slide);
  // Trim any redo entries ahead of current index
  if (h.index < h.stack.length - 1) {
    h.stack.length = h.index + 1;
  }
  // Skip duplicate consecutive snapshots
  if (h.stack.length > 0 && h.stack[h.stack.length - 1] === html) return;
  h.stack.push(html);
  if (h.stack.length > MAX_HISTORY) h.stack.shift();
  h.index = h.stack.length - 1;
}

export function initUndoForSlide(slide) {
  if (!slide) return;
  const h = getHistory(slide);
  if (h.stack.length === 0) {
    const html = serializeSlideDocument(slideIframe.contentDocument);
    if (html) {
      h.stack.push(html);
      h.index = 0;
    }
  }
}

export function canUndo(slide) {
  if (!slide) slide = currentSlideFile();
  if (!slide) return false;
  const h = getHistory(slide);
  return h.index > 0;
}

export function canRedo(slide) {
  if (!slide) slide = currentSlideFile();
  if (!slide) return false;
  const h = getHistory(slide);
  return h.index < h.stack.length - 1;
}

export function performUndo() {
  const slide = currentSlideFile();
  if (!slide || !canUndo(slide)) return;
  const h = getHistory(slide);
  h.index--;
  applySnapshot(slide, h.stack[h.index]);
  setStatus('Undo applied.');
}

export function performRedo() {
  const slide = currentSlideFile();
  if (!slide || !canRedo(slide)) return;
  const h = getHistory(slide);
  h.index++;
  applySnapshot(slide, h.stack[h.index]);
  setStatus('Redo applied.');
}

function applySnapshot(slide, html) {
  if (!slide || !html) return;
  const doc = slideIframe.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
  renderObjectSelection();
  updateObjectEditorControls();
  queueDirectSave(slide, html, `${slide} restored.`);
}

export function serializeSlideDocument(doc) {
  if (!doc?.documentElement) return '';
  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : '<!DOCTYPE html>';
  return `${doctype}\n${doc.documentElement.outerHTML}`;
}

async function persistDirectSlideHtml(slide, html, message) {
  if (!slide || !html) return;

  try {
    const res = await fetch(`/api/slides/${encodeURIComponent(slide)}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slide, html }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || `Save failed with HTTP ${res.status}`);
    }

    localFileUpdateBySlide.set(slide, Date.now());
    if (slide === currentSlideFile()) {
      setStatus(message || `${slide} saved.`);
    }
  } catch (error) {
    addChatMessage('error', `[${slide}] Direct edit save failed: ${error.message}`, slide);
    setStatus(`Error: ${error.message}`);
  }
}

function queueDirectSave(slide, html, message) {
  const saveState = getDirectSaveState(slide);
  if (!html) return saveState.chain;
  saveState.chain = saveState.chain
    .catch(() => {})
    .then(() => persistDirectSlideHtml(slide, html, message));
  return saveState.chain;
}

export function scheduleDirectSave(delay = 0, message = 'Object updated and saved.') {
  const slide = currentSlideFile();
  const html = serializeSlideDocument(slideIframe.contentDocument);
  if (!slide || !html) return;

  const saveState = getDirectSaveState(slide);
  saveState.pendingHtml = html;
  saveState.pendingMessage = message;
  if (saveState.timer) {
    window.clearTimeout(saveState.timer);
  }
  saveState.timer = window.setTimeout(() => {
    saveState.timer = null;
    const nextHtml = saveState.pendingHtml;
    const nextMessage = saveState.pendingMessage;
    saveState.pendingHtml = '';
    queueDirectSave(slide, nextHtml, nextMessage);
  }, Math.max(0, delay));
}

export async function flushDirectSaveForSlide(slide) {
  if (!slide) return;

  const saveState = getDirectSaveState(slide);
  if (saveState.timer) {
    window.clearTimeout(saveState.timer);
    saveState.timer = null;
    const html = saveState.pendingHtml;
    const message = saveState.pendingMessage;
    saveState.pendingHtml = '';
    await queueDirectSave(slide, html, message);
    return;
  }

  await saveState.chain.catch(() => {});
}

export function applyTextDecorationToken(el, token, shouldEnable) {
  const frameWindow = slideIframe.contentWindow;
  const styles = frameWindow?.getComputedStyle ? frameWindow.getComputedStyle(el) : null;
  const parts = new Set(
    String(styles?.textDecorationLine || '')
      .split(/\s+/)
      .filter((part) => part === 'underline' || part === 'line-through'),
  );
  if (shouldEnable) {
    parts.add(token);
  } else {
    parts.delete(token);
  }
  el.style.textDecorationLine = parts.size > 0 ? Array.from(parts).join(' ') : 'none';
}

export function mutateSelectedObject(mutator, message, { delay = 0, preserveTextInput = false } = {}) {
  const selected = getSelectedObjectElement();
  if (!selected) return;
  pushUndoSnapshot();
  mutator(selected);
  pushUndoSnapshot(); // Save post-mutation state so undo has a target to go back from
  renderObjectSelection();
  updateObjectEditorControls({ preserveTextInput });
  scheduleDirectSave(delay, message);
  setStatus('Saving direct edit...');
}
