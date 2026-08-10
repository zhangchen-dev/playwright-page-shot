/**
 * 应用内多 tab 管理器（基于多个 <webview> tag，display 切换显隐）
 *
 * - 主 tab = #previewWebview（panel.html 静态存在）
 * - target=_blank / window.open 由主进程 setWindowOpenHandler 拦截后，
 *   通过 IPC 'app-open-tab' 通知本模块新建一个 <webview> 实例
 * - tabs.js 维护 tabId -> {webviewEl, title, url} 映射
 * - 切换 tab = display 切换 + 重新计算当前 webview 缩放
 * - 关闭 tab = removeChild webview
 *
 * ★ 关键前提（2026-08-11 实测确认）：
 *   <webview> 必须带**独立布尔属性** `allowpopups`，主进程的 setWindowOpenHandler 才会触发。
 *   写成 webpreferences="allowpopups" 完全无效（Electron 内部是 disablePopups = !params.allowpopups，
 *   webpreferences 字符串里的 allowpopups 不参与该判断），Chromium 会在渲染层直接吞掉弹窗请求，
 *   应用层任何事件都收不到 —— 表现为"点击按钮没有任何反应"。
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
/** 新 tab 请求去重（主进程 IPC 与兜底通道可能同时到达） */
let lastOpenReq = { url: '', ts: 0 };

function tabBarEl() { return document.getElementById('tabBar'); }
function tabPagesEl() { return document.getElementById('tabPages'); }

/** 初始化：注册主 tab + 订阅 main.js 推过来的 open-tab 事件 */
export function initTabs() {
  logMain('[tabs] initTabs called, tabBar ready=' + (!!document.getElementById('tabBar')));

  // 主 tab 注册到 map（用 panel.html 已有的 previewWebview）
  const mainWebview = document.getElementById('previewWebview');
  const mainPage = mainWebview ? mainWebview.closest('.webview-tab-page') : null;

  if (!mainWebview || !mainPage) {
    logMain('[tabs] 主 webview 不在 DOM，DOMContentLoaded 后重试');
    document.addEventListener('DOMContentLoaded', () => initTabs(), { once: true });
    return;
  }

  tabs.set('main', {
    id: 'main',
    url: mainWebview.src || '',
    title: '主页面',
    webviewEl: mainWebview,
    pageEl: mainPage,
  });

  // ★ 监听 main.js 推送的 'app-open-tab' 事件（target=_blank / window.open 拦截后开新 tab）
  if (!ipcBound && window.electronAPI && window.electronAPI.onAppOpenTab) {
    ipcBound = true;
    window.electronAPI.onAppOpenTab((payload) => {
      const url = payload && payload.url;
      logMain('[tabs] recv app-open-tab url=' + url);
      requestNewTab(url, 'window-open-handler');
    });
    logMain('[tabs] 已订阅 app-open-tab 事件');
  } else if (!window.electronAPI || !window.electronAPI.onAppOpenTab) {
    logMain('[tabs] electronAPI.onAppOpenTab 不可用（preload 未暴露？）');
  }

  // 兜底通道：老的 webview-new-window IPC
  if (window.electronAPI && window.electronAPI.onWebviewNewWindow) {
    window.electronAPI.onWebviewNewWindow((payload) => {
      const url = payload && payload.url;
      logMain('[tabs] recv webview-new-window url=' + url);
      requestNewTab(url, 'new-window-event');
    });
  }

  renderTabBar();
}

/** 新 tab 请求入口（带 1s 同 URL 去重，合并多条通道） */
export function requestNewTab(url, source) {
  if (!url) return null;
  const now = Date.now();
  if (url === lastOpenReq.url && now - lastOpenReq.ts < 1000) {
    logMain('[tabs] 忽略重复新 tab 请求(' + source + ') url=' + url);
    return null;
  }
  lastOpenReq = { url, ts: now };
  return openTab(url);
}

/** 打开新 tab（在 #tabPages 末尾追加 webview tag，激活它） */
export async function openTab(url) {
  if (!url) return null;
  const pagesEl = tabPagesEl();
  if (!pagesEl) {
    logMain('[tabs] openTab 失败：#tabPages 不存在');
    return null;
  }

  tabSeq += 1;
  const tabId = 'tab-' + tabSeq;
  const title = makeTabTitle(url);

  // 结构与主 tab 保持一致：tab-page > scroll-wrapper > scale-wrapper > webview
  const pageEl = document.createElement('div');
  pageEl.className = 'webview-tab-page';
  pageEl.dataset.tabId = tabId;

  const scrollWrapper = document.createElement('div');
  scrollWrapper.className = 'webview-scroll-wrapper';
  scrollWrapper.id = 'webviewScrollWrapper-' + tabId;
  if (appState.fitPageEnabled) scrollWrapper.classList.add('fit-mode');

  const scaleWrapper = document.createElement('div');
  scaleWrapper.className = 'webview-scale-wrapper';
  scaleWrapper.id = 'webviewScaleWrapper-' + tabId;

  const wv = document.createElement('webview');
  wv.id = 'previewWebview-' + tabId;
  wv.className = 'preview-webview-inner';
  wv.setAttribute('partition', 'persist:webview'); // 与主 tab 共享 session（登录态延续）
  // ★ 独立布尔属性，不能写进 webpreferences —— 否则新 tab 内再点 _blank 又会"没反应"
  wv.setAttribute('allowpopups', '');

  // ★ preload 必须在 appendChild（attach）之前设置，
  //    attach 之后再改 preload/partition/src 会触发 ERR_ABORTED (-3) 并销毁 webContents
  try {
    const preloadUrl = await api.getWebviewPreloadPath();
    if (preloadUrl) wv.setAttribute('preload', preloadUrl);
  } catch (e) {
    logMain('[tabs] 获取 webview preload 路径失败: ' + e.message);
  }
  wv.setAttribute('src', url);

  scaleWrapper.appendChild(wv);
  scrollWrapper.appendChild(scaleWrapper);
  pageEl.appendChild(scrollWrapper);
  pagesEl.appendChild(pageEl);

  tabs.set(tabId, { id: tabId, url, title, webviewEl: wv, pageEl });

  // ★ 给新 tab 绑定录制事件桥接 + 加载事件（使新 tab 内也能拾取元素 / 录制 HTML）
  bindTabWebview(wv, tabId);

  await activateTab(tabId, { force: true });
  renderTabBar();
  logMain('[tabs] openTab ' + tabId + ' url=' + url);
  return tabId;
}

/** 给某个 tab 的 webview 绑定录制 IPC 桥接与加载事件 */
async function bindTabWebview(wv, tabId) {
  try {
    const rec = await import('../recording/internal/webview-recording.js');
    // 录制事件（element-selected / login-form-detected 等）
    rec.setupWebviewIpcListener(wv);

    wv.addEventListener('did-finish-load', () => {
      logMain('[tabs] ' + tabId + ' did-finish-load');
      const loading = document.getElementById('previewLoading');
      if (loading) loading.classList.remove('active');
      // 导航后页面里的 helper 会失效，录制模式下重新注入
      wv._recHelperInjected = false;
      if (appState.webviewRecordingMode) {
        rec.injectWebviewElementHelper(wv).catch(() => {});
      }
      updateActiveTabScale();
    });

    wv.addEventListener('did-start-loading', () => {
      const loading = document.getElementById('previewLoading');
      if (loading && activeTabId === tabId) {
        loading.textContent = '加载中...';
        loading.classList.add('active');
      }
    });
    wv.addEventListener('did-stop-loading', () => {
      const loading = document.getElementById('previewLoading');
      if (loading) loading.classList.remove('active');
    });
    wv.addEventListener('did-fail-load', () => {
      const loading = document.getElementById('previewLoading');
      if (loading) loading.classList.remove('active');
    });

    // 页面标题就绪后更新 tab 名
    wv.addEventListener('page-title-updated', (e) => {
      const t = tabs.get(tabId);
      if (t && e.title) {
        t.title = e.title.length > 18 ? e.title.slice(0, 18) + '…' : e.title;
        renderTabBar();
      }
    });
  } catch (e) {
    logMain('[tabs] bindTabWebview 失败: ' + e.message);
  }
}

/** 切换到指定 tab（display 切换） */
export async function activateTab(tabId, opts) {
  if (!tabs.has(tabId)) return;
  if (tabId === activeTabId && !(opts && opts.force)) return;

  for (const [id, t] of tabs) {
    if (!t.pageEl) continue;
    const on = id === tabId;
    t.pageEl.classList.toggle('active', on);
    t.pageEl.style.display = on ? 'flex' : 'none';
  }

  activeTabId = tabId;
  appState.activeAppTabId = tabId;
  renderTabBar();
  updateActiveTabScale();
  logMain('[tabs] activateTab ' + tabId);
}

/** 重新计算当前激活 tab 的缩放 */
function updateActiveTabScale() {
  import('./webview-controls.js')
    .then((mod) => mod.updateWebviewScale())
    .catch(() => {});
}

/** 关闭 tab */
export async function closeTab(tabId) {
  if (tabId === 'main') return; // 主 tab 不可关
  const t = tabs.get(tabId);
  if (!t) return;
  if (t.pageEl && t.pageEl.parentNode) t.pageEl.parentNode.removeChild(t.pageEl);
  tabs.delete(tabId);
  if (activeTabId === tabId) {
    await activateTab('main', { force: true });
  }
  renderTabBar();
  logMain('[tabs] closeTab ' + tabId);
}

/** ★ 关闭除主 tab 外的所有 tab（重新导航 / 开启新录制时清场） */
export async function closeExtraTabs() {
  const ids = [];
  for (const id of tabs.keys()) if (id !== 'main') ids.push(id);
  for (const id of ids) {
    const t = tabs.get(id);
    if (t && t.pageEl && t.pageEl.parentNode) t.pageEl.parentNode.removeChild(t.pageEl);
    tabs.delete(id);
  }
  if (ids.length) logMain('[tabs] closeExtraTabs 关闭 ' + ids.length + ' 个 tab');
  await activateTab('main', { force: true });
  renderTabBar();
}

/** 供其它模块（banner / layout）在恢复 webview 显示后重算 tabBar 显隐 */
export function refreshTabBar() {
  renderTabBar();
}

/** 渲染 tabBar UI —— 只有一个主 tab 时整条隐藏，保持原有界面观感 */
function renderTabBar() {
  const bar = tabBarEl();
  if (!bar) return;

  if (tabs.size <= 1) {
    bar.style.display = 'none';
    bar.innerHTML = '';
    return;
  }
  bar.style.display = 'flex';
  bar.innerHTML = '';
  for (const [id, t] of tabs) {
    bar.appendChild(makeTabEl({ id, title: t.title, closable: id !== 'main' }));
  }
}

function makeTabEl({ id, title, closable }) {
  const el = document.createElement('div');
  el.className = 'tab-item' + (id === activeTabId ? ' active' : '');
  el.title = title;
  el.style.cssText = [
    'display:flex', 'align-items:center', 'gap:6px',
    'padding:4px 8px', 'border-radius:4px',
    'cursor:pointer', 'background:' + (id === activeTabId ? 'var(--accent-blue-bg, #e8f0fe)' : 'transparent'),
    'color:' + (id === activeTabId ? 'var(--accent-blue-light, #165dff)' : 'var(--text-secondary, #666)'),
    'font-size:12px', 'user-select:none',
    'white-space:nowrap', 'max-width:160px', 'flex-shrink:0',
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
    return String(url).substring(0, 30);
  }
}

/** 暴露当前激活 webview（供录制模块使用；未初始化时回退到主 webview） */
export function getActiveWebview() {
  const t = tabs.get(activeTabId);
  if (t && t.webviewEl) return t.webviewEl;
  return document.getElementById('previewWebview');
}

/** 暴露当前激活 tab 的页面容器（供缩放计算使用） */
export function getActiveTabPage() {
  const t = tabs.get(activeTabId);
  if (t && t.pageEl) return t.pageEl;
  const wv = document.getElementById('previewWebview');
  return wv ? wv.closest('.webview-tab-page') : null;
}

/** 暴露当前激活 tab id */
export function getActiveTabId() {
  return activeTabId;
}
