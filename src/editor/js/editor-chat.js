// editor-chat.js — Chat messages and runs list UI

import { chatMessagesEl } from './editor-dom.js';
import { currentSlideFile, getSlideState, randomId, escapeHtml, formatTime } from './editor-utils.js';

// Track how many messages are rendered so we can append incrementally
let _renderedSlide = '';
let _renderedCount = 0;

function renderMessageHtml(msg) {
  const time = escapeHtml(formatTime(msg.at));
  const kind = escapeHtml(msg.kind);
  return [
    `<div class="message ${kind}">`,
    `${escapeHtml(msg.text)}`,
    `<div class="run-meta" style="margin-top:6px;">${time}</div>`,
    '</div>',
  ].join('');
}

export function addChatMessage(kind, text, slide = currentSlideFile()) {
  if (!slide) return;

  const state = getSlideState(slide);
  state.messages.push({
    id: randomId('msg'),
    kind,
    text,
    at: new Date().toISOString(),
  });

  // Trim overflow
  const overflow = state.messages.length - 80;
  if (overflow > 0) {
    state.messages.splice(0, overflow);
    // Force full re-render since DOM elements at the start were removed
    if (slide === _renderedSlide) {
      _renderedCount = Math.max(0, _renderedCount - overflow);
    }
  }

  if (slide === currentSlideFile()) {
    renderChatMessages();
  }
}

export function renderChatMessages() {
  if (!chatMessagesEl) return;
  const slide = currentSlideFile();
  if (!slide) {
    chatMessagesEl.innerHTML = '';
    _renderedSlide = '';
    _renderedCount = 0;
    return;
  }

  const state = getSlideState(slide);
  const messages = Array.isArray(state.messages) ? state.messages : [];

  // Different slide or stale count → full re-render
  if (slide !== _renderedSlide || _renderedCount > messages.length) {
    chatMessagesEl.innerHTML = messages.map(renderMessageHtml).join('');
    _renderedSlide = slide;
    _renderedCount = messages.length;
  } else if (_renderedCount < messages.length) {
    // Append only new messages
    const newHtml = messages.slice(_renderedCount).map(renderMessageHtml).join('');
    chatMessagesEl.insertAdjacentHTML('beforeend', newHtml);
    _renderedCount = messages.length;
  }

  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

export function renderRunsList() {}
