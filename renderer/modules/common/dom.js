/**
 * DOM 引用 + DOM 辅助方法
 */
export const contentEl = document.getElementById('content');
export const statusEl = document.getElementById('statusBar');
export const urlInput = document.getElementById('urlInput');
export const navigateBtn = document.getElementById('navigateBtn');

/** 创建 DOM 元素辅助 */
export function el(tag, className, textContent) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (textContent) element.textContent = textContent;
  return element;
}

/** 创建字段标签（required=true 时追加 *） */
export function labelEl(text, required) {
  const label = el('label', 'field-label');
  label.textContent = text;
  if (required) label.appendChild(el('span', 'required', '*'));
  return label;
}

/** 缩短 URL 用于展示 */
export function shortenUrl(url) {
  if (!url || url === 'about:blank') return '空白页';
  try {
    const u = new URL(url);
    let display = u.hostname + u.pathname;
    if (display.length > 40) display = display.substring(0, 37) + '...';
    return display;
  } catch (e) {
    return url.substring(0, 40);
  }
}

/** 显示加载遮罩 */
export function showLoadingOverlay() {
  let overlay = document.getElementById('loadingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.3);z-index:9999;display:flex;align-items:center;justify-content:center;pointer-events:all;';
    const spinner = document.createElement('div');
    spinner.style.cssText = 'background:var(--bg-card);padding:20px 32px;border-radius:8px;color:var(--text-primary);font-size:14px;display:flex;align-items:center;gap:10px;';
    spinner.innerHTML = '<span class="loading-spinner"></span>处理中...';
    overlay.appendChild(spinner);
    document.body.appendChild(overlay);
  } else {
    overlay.style.display = 'flex';
  }
}

/** 隐藏加载遮罩 */
export function hideLoadingOverlay() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.style.display = 'none';
}
