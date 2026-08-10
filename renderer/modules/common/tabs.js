/**
 * 应用内多 tab 管理器（基于多个 <webview> tag，display 切换显隐）
 *
 * - 主 tab = #previewWebview（保留在 panel.html 已有）
 * - target=_blank 拦截后由 main.js 通过 IPC 'app-open-tab' 通知本模块开新 webview 实例
 * - tabs.js 维护 tabId -> {webviewEl, title, url} 映射
 * - 切换 tab = display 切换 + 调 updateWebviewScale 重新计算当前 webview 缩放
 * - 关闭 tab = removeChild webview
 * - tab state 推送给 main.js（用 BVM 维护 activeTabId 用于录制 helper 注入）
 */
import { appState } from './state.js';
import { api } from './api.js';

let logMain = (msg) => {
  try { if (window.electronAPI && window.electronAPI.logMain) window.electronAPI.logMain(msg); } catch (e) {}
  console.log(msg);
};

/** 下一个 tabId 序号 */
let tabSeq = 0;
/** @type {Map<string, {id:string, url:string, title:string, webviewEl:HTMLElement, pageEl:HTMLElement}>} */
const tabs = new Map();
/** 当前激活 tab id（初始为 'main'，对应 panel.html 的 #previewWebview） */
let activeTabId = 'main';
let ipcBound = false;

function tabBarEl() { return document.getElementById('tabBar'); }
function tabPagesEl() { return document.getElementById('tabPages'); }

/** 初始化：订阅 main.js 推过来的 open-tab 事件 */
export function initTabs() {
  logMain('[tabs] initTabs called, panel.html DOM ready=' + (!!document.getElementById('tabBar')));

  // 主 tab 注册到 map（用 panel.html 已有的 previewWebview）
  let mainWebview = document.getElementById('previewWebview');
  let mainPage = mainWebview ? mainWebview.closest('.webview-tab-page') : null;

  if (!mainWebview || !mainPage) {
    logMain('[tabs] 主 webview 不在 DOM，DOMContentLoaded 后重试');
    document.addEventListener('DOMContentLoaded', () => {
      logMain('[tabs] DOMContentLoaded fired, retry init');
      initTabs();
    });
    return;
  }

  tabs.set('main', {
    id: 'main',
    url: mainWebview.src || '',
    title: '主页面',
    webviewEl: mainWebview,
    pageEl: mainPage,
  });
  logMain('[tabs] 主 tab 已注册（panel.html 静态）');

  // ★ 监听 main.js 推送的 'app-open-tab' 事件（target=_blank 拦截后开新 tab）
  if (!ipcBound && window.electronAPI && window.electronAPI.onAppOpenTab) {
    ipcBound = true;
    window.electronAPI.onAppOpenTab(({ url, sourceWebviewId }) => {
      logMain('[tabs] recv app-open-tab url=' + url);
      openTab(url);
    });
    logMain('[tabs] 已订阅 app-open-tab 事件');
  } else if (!window.electronAPI || !window.electronAPI.onAppOpenTab) {
    logMain('[tabs] electronAPI.onAppOpenTab 不可用（主进程未注册？）');
  }

  // 监听 webview-new-window（兜底，BVM/old 模式兼容）
  if (window.electronAPI && window.electronAPI.onWebviewNewWindow) {
    window.electronAPI.onWebviewNewWindow(({ url }) => {
      logMain('[tabs] recv webview-new-window url=' + url);
      openTab(url);
    });
  }

  renderTabBar();
}

/** 打开新 tab（在 #tabPages 末尾追加 webview tag，激活它） */
export function openTab(url) {
  if (!url) return null;
  tabSeq += 1;
  const tabId = 'tab-' + tabSeq;
  const title = makeTabTitle(url);

  // 创建 webview tab page（与 .webview-tab-page 同结构：scroll-wrapper + scale-wrapper + webview）
  const pagesEl = tabPagesEl();
  if (!pagesEl) return null;

  const pageEl = document.createElement('div');
  pageEl.className = 'webview-tab-page';
  pageEl.dataset.tabId = tabId;
  pageEl.style.display = 'none'; // 先隐藏

  const scrollWrapper = document.createElement('div');
  scrollWrapper.className = 'webview-scroll-wrapper';
  scrollWrapper.id = 'webviewScrollWrapper-' + tabId;

  const scaleWrapper = document.createElement('div');
  scaleWrapper.className = 'webview-scale-wrapper';
  scaleWrapper.id = 'webviewScaleWrapper-' + tabId;

  const wv = document.createElement('webview');
  wv.id = 'previewWebview-' + tabId;
  wv.className = 'preview-webview-inner';
  wv.setAttribute('partition', 'persist:webview');
  wv.setAttribute('webpreferences', 'allowpopups');
  wv.setAttribute('src', url);
  wv.style.display = 'flex';

  scaleWrapper.appendChild(wv);
  scrollWrapper.appendChild(scaleWrapper);
  pageEl.appendChild(scrollWrapper);
  pagesEl.appendChild(pageEl);

  tabs.set(tabId, { id: tabId, url, title, webviewEl: wv, pageEl });
  activateTab(tabId);
  renderTabBar();
  logMain('[tabs] openTab ' + tabId + ' url=' + url);

  // ★ 通知主进程（让 main.js 知道新 tab 存在，录制 helper 注入能正确路由）
  try { if (api && api.notifyTabOpened) api.notifyTabOpened(tabId, url); } catch (e) { /* ignore */ }
  return tabId;
}

/** 切换到指定 tab（display 切换） */
export async function activateTab(tabId) {
  if (!tabs.has(tabId)) return;
  if (tabId === activeTabId) return;

  // 隐藏旧的
  const prev = tabs.get(activeTabId);
  if (prev && prev.pageEl) {
    prev.pageEl.classList.remove('active');
    prev.pageEl.style.display = 'none';
  }
  // 显示新的
  const next = tabs.get(tabId);
  if (next && next.pageEl) {
    next.pageEl.classList.add('active');
    next.pageEl.style.display = 'flex';
  }
  activeTabId = tabId;
  if (window.appState) window.appState.activeAppTabId = tabId;
  renderTabBar();
  // ★ 重新计算缩放（确保切回主 tab 时缩放不丢）
  try {
    const mod = await import('./webview-controls.js');
    mod.updateWebviewScale();
  } catch (e) { /* ignore */ }
  logMain('[tabs] activateTab ' + tabId);
}

/** 关闭 tab */
export async function closeTab(tabId) {
  if (tabId === 'main') return; // 主 tab 不可关
  const t = tabs.get(tabId);
  if (!t) return;
  // 移除 DOM
  if (t.pageEl && t.pageEl.parentNode) t.pageEl.parentNode.removeChild(t.pageEl);
  // 销毁 webview
  try {
    if (t.webviewEl && typeof t.webviewEl.remove === 'function') t.webviewEl.remove();
  } catch (e) { /* ignore */ }
  tabs.delete(tabId);
  // 切换到主 tab
  if (activeTabId === tabId) {
    await activateTab('main');
  }
  renderTabBar();
  logMain('[tabs] closeTab ' + tabId);
}

/** 渲染 tabBar UI — 即使 tabs Map 为空也显示"主页面"占位 */
function renderTabBar() {
  const bar = tabBarEl();
  if (!bar) {
    logMain('[tabs] renderTabBar: bar element not found, retrying...');
    setTimeout(renderTabBar, 100);
    return;
  }
  bar.innerHTML = '';

  // ★ 兜底：如果 tabs Map 为空，至少渲染一个"主页面"占位
  if (tabs.size === 0) {
    logMain('[tabs] renderTabBar: tabs Map 空，渲染占位');
    bar.appendChild(makeTabEl({ id: 'main', title: '主页面', closable: false }));
    return;
  }

  for (const [id, t] of tabs) {
    bar.appendChild(makeTabEl({ id, title: t.title, closable: id !== 'main' }));
  }
  logMain('[tabs] tabBar 已渲染 tabs=' + tabs.size + ' active=' + activeTabId);
}

function makeTabEl({ id, title, closable }) {
  const el = document.createElement('div');
  el.className = 'tab-item' + (id === activeTabId ? ' active' : '');
  el.style.cssText = [
    'display:flex', 'align-items:center', 'gap:6px',
    'padding:4px 8px', 'border-radius:4px',
    'cursor:pointer', 'background:' + (id === activeTabId ? 'var(--accent-blue-bg, #e8f0fe)' : 'transparent'),
    'color:' + (id === activeTabId ? 'var(--accent-blue-light, #165dff)' : 'var(--text-secondary, #666)'),
    'font-size:12px', 'user-select:none',
    'white-space:nowrap', 'max-width:160px',
  ].join(';');
  const titleSpan = document.createElement('span');
  titleSpan.textContent = title;
  titleSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;';
  el.appendChild(titleSpan);
  if (closable) {
    const closeBtn = document.createElement('span');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = 'font-size:14px;line-height:1;padding:0 4px;border-radius:4px;cursor:pointer;';
    closeBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeTab(id);
    });
    el.appendChild(closeBtn);
  }
  el.addEventListener('click', () => activateTab(id));
  return el;
}

/** URL -> tab title */
function makeTabTitle(url) {
  try {
    const u = new URL(url);
    return u.hostname || url.substring(0, 30);
  } catch (e) {
    return url.substring(0, 30);
  }
}

/** 暴露当前激活 webview（供 webview-recording.js 使用） */
export function getActiveWebview() {
  const t = tabs.get(activeTabId);
  return t ? t.webviewEl : null;
}

/** 暴露当前激活 tab id */
export function getActiveTabId() {
  return activeTabId;
}
