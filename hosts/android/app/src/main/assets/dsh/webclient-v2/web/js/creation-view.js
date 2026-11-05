// dsh:logging-exempt (web page: all E2E evidence flows through carrier/runtime logs)
/**
 * creation-view.js — the presented-file viewer (split from main.js at the
 * code-size gate): a workspace file fetched over workspaceFiles/readAll and
 * shown fullscreen in a fresh sandboxed frame, WITH its relative siblings
 * inlined (a srcdoc frame resolves no links — measured 2026-10-28: the
 * presented app rendered bare text). The approval decision listener rides
 * here too (the card's answer posts approval/decide).
 */

import { rpc, isRemoteError } from './api.js';

/** The page's toast lives in main.js's module scope — the viewer asks the
 * host page through this hook instead of a second toast implementation. */
let toastHook = (message) => { console.warn('creation-view:', message); };
export const setCreationToast = (fn) => { toastHook = fn; };

/** Read one workspace file as text (readAll's three result spellings). */
const readWorkspaceText = async (path) => {
  const value = await rpc('workspaceFiles/readAll', { args: { path } });
  if (typeof value === 'string') return value;
  if (typeof value?.text === 'string') return value.text;
  if (typeof value?.data === 'string') {
    const bytes = Uint8Array.from(atob(value.data), (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return null;
};

/** A srcdoc frame resolves NO relative links — the presented HTML's
 * stylesheet/script/image references would all 404 inside the sandbox and
 * the deliverable renders unstyled and dead (measured 2026-10-28: the
 * netease-music card opened as bare text). Inline every RELATIVE reference
 * with the sibling file's content fetched over the same file leg; absolute
 * and data: URLs stay untouched. Bounded: a runaway linked chain stops at
 * the budget and keeps whatever inlined. */
const INLINE_BUDGET = 2 * 1024 * 1024;
const isRelativeRef = (u) => typeof u === 'string' && u !== ''
  && !/^(https?:|data:|blob:|\/\/|#)/i.test(u);
const cleanRef = (u) => u.split('?')[0].split('#')[0];
const joinSibling = (dir, ref) => (dir ? `${dir}/${cleanRef(ref)}` : cleanRef(ref));
const imageMime = (ref) => {
  const ext = cleanRef(ref).split('.').pop().toLowerCase();
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'image/png';
};
const inlineLinkedFiles = async (htmlText, dir) => {
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  let budget = INLINE_BUDGET;
  for (const link of [...doc.querySelectorAll('link[rel~="stylesheet"][href], link[rel="stylesheet"][href]')]) {
    const href = link.getAttribute('href');
    if (!isRelativeRef(href) || budget <= 0) continue;
    try {
      const css = await readWorkspaceText(joinSibling(dir, href));
      if (css === null) continue;
      const style = doc.createElement('style');
      style.textContent = css;
      link.replaceWith(style);
      budget -= css.length;
    } catch { /* unreadable sibling: keep the link, the rest still renders */ }
  }
  for (const script of [...doc.querySelectorAll('script[src]')]) {
    const src = script.getAttribute('src');
    if (!isRelativeRef(src) || budget <= 0) continue;
    try {
      const code = await readWorkspaceText(joinSibling(dir, src));
      if (code === null) continue;
      const inline = doc.createElement('script');
      inline.textContent = code;
      script.replaceWith(inline);
      budget -= code.length;
    } catch { /* keep */ }
  }
  for (const img of [...doc.querySelectorAll('img[src]')]) {
    const src = img.getAttribute('src');
    if (!isRelativeRef(src) || budget <= 0) continue;
    try {
      const value = await rpc('workspaceFiles/readAll', { args: { path: joinSibling(dir, src) } });
      if (typeof value?.data !== 'string') continue;
      img.setAttribute('src', `data:${imageMime(src)};base64,${value.data}`);
      budget -= value.data.length;
    } catch { /* keep */ }
  }
  return doc.documentElement.outerHTML;
};

const creationView = () => document.getElementById('creation-view');

/** Open one presented file: fullscreen, siblings inlined for HTML. */
export const openCreation = async (path, title) => {
  const view = creationView();
  document.getElementById('creation-title-text').textContent = title || path;
  view.hidden = false;
  try {
    let text = await readWorkspaceText(path);
    if (text === null) text = '';
    // HTML deliverables get their relative siblings inlined (see
    // inlineLinkedFiles); non-HTML text passes through verbatim.
    if (/<html|<!doctype html/i.test(text)) {
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      try {
        text = await inlineLinkedFiles(text, dir);
      } catch { /* a parse oddity renders the raw file rather than nothing */ }
    }
    // ArkWeb (HarmonyOS) stops reflecting iframe.srcdoc after the frame's
    // first clear — writes succeed but the engine neither navigates nor
    // reflects, so a SECOND opened deliverable renders blank (measured,
    // issue #230). Swap in a FRESH frame node per open: a first write on a
    // new node is the path every engine handles.
    const frame = document.getElementById('creation-frame');
    const fresh = frame.cloneNode(false);
    fresh.removeAttribute('srcdoc');
    frame.parentNode.replaceChild(fresh, frame);
    fresh.srcdoc = text;
  } catch (error) {
    view.hidden = true;
    toastHook(isRemoteError(error) ? `创作不可读（${error.code}）` : '创作不可读');
  }
};

/** The approval answer wiring (the approval card's 批准/拒绝). */
const wireApprovalAnswer = (toast) => {
  // The in-band approval answer: the card's 批准/拒绝 posts the decision to
  // the approval plane; a decided journal event re-renders authoritatively,
  // and until one arrives the answered card flips in place (the seat's
  // presentApproval arm resolves through this surface).
  document.addEventListener('dsh-approval-decide', async (event) => {
    const { id, approved } = event.detail;
    try {
      await rpc('approval/decide', { args: { id, approved } });
    } catch (error) {
      toast(isRemoteError(error) ? `审批通道不可用（${error.code}）` : '审批通道不可用');
      return;
    }
    for (const card of document.querySelectorAll('.approval-card')) {
      if (card.dataset.id !== id) continue;
      const state = card.querySelector('.approval-state');
      if (state) state.textContent = approved ? '已批准' : '已拒绝';
      const actions = card.querySelector('.approval-actions');
      if (actions) actions.remove();
      const glyph = card.querySelector('.approval-glyph');
      if (glyph) glyph.textContent = approved ? '✅' : '🚫';
    }
  });
};

/** The question answer wiring (the question card's options/typed answer). */
const wireQuestionAnswer = (toast) => {
  // The in-band question answer: the question card's option (or typed
  // answer) resumes the parked ask_user_question turn.
  document.addEventListener('dsh-question-answer', async (event) => {
    const { id, answers } = event.detail;
    try {
      await rpc('question/answer', { args: { id, answers } });
    } catch (error) {
      toast(isRemoteError(error) ? `问询通道不可用（${error.code}）` : '问询通道不可用');
      return;
    }
    for (const card of document.querySelectorAll('.approval-card')) {
      if (card.dataset.id !== id) continue;
      const state = card.querySelector('.approval-state');
      if (state) state.textContent = '已回答';
      card.querySelectorAll('.question-actions').forEach((a) => a.remove());
      const glyph = card.querySelector('.approval-glyph');
      if (glyph) glyph.textContent = '✅';
    }
  });
};

/** Wire the page events: the creation-card open + the two in-band answers. */
export const setupCreationView = ({ toast }) => {
  setCreationToast(toast);
  document.addEventListener('dsh-open-creation', (event) => {
    openCreation(event.detail.path, event.detail.title);
  });
  document.getElementById('creation-close').addEventListener('click', () => {
    document.getElementById('creation-view').hidden = true;
    document.getElementById('creation-frame').srcdoc = '';
  });
  wireApprovalAnswer(toast);
  wireQuestionAnswer(toast);
};
