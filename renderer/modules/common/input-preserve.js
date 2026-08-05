/**
 * 表单输入值保留 — 渲染前后保存/恢复输入框内容与光标位置
 */
import { appState } from './state.js';
import { contentEl } from './dom.js';

/** 保存当前所有输入框的值与焦点位置 */
export function saveInputValues() {
  const inputs = contentEl.querySelectorAll('input, textarea, select');
  inputs.forEach((input) => {
    if (input.id) appState.savedInputValues[input.id] = input.value;
  });
  const activeEl = document.activeElement;
  if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && activeEl.id) {
    appState.focusedInputId = activeEl.id;
    appState.cursorPos = activeEl.selectionStart;
  } else {
    appState.focusedInputId = null;
    appState.cursorPos = null;
  }
}

/** 恢复输入框值与焦点 */
export function restoreInputValues() {
  Object.keys(appState.savedInputValues).forEach((id) => {
    const input = document.getElementById(id);
    if (input && input.value !== appState.savedInputValues[id]) {
      input.value = appState.savedInputValues[id];
    }
  });
  if (appState.focusedInputId) {
    const inputEl = document.getElementById(appState.focusedInputId);
    if (inputEl) {
      inputEl.focus();
      if (appState.cursorPos !== null && inputEl.setSelectionRange) {
        try { inputEl.setSelectionRange(appState.cursorPos, appState.cursorPos); } catch (e) {}
      }
    }
  }
  appState.savedInputValues = {};
  appState.focusedInputId = null;
  appState.cursorPos = null;
}
