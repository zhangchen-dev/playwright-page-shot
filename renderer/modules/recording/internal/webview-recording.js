/**
 * 对内录制（应用内 webview 模式）
 * - 在右侧栏 webview 中加载页面
 * - 元素选择 / 凭证填充通过 webview.executeJavaScript + ipc-message 通信
 */
import { appState } from '../../common/state.js';
import { api } from '../../common/api.js';
import { updateStatus } from '../../common/feedback.js';
import { updateLayout, updateAlwaysOnTop } from '../../common/layout.js';
import { updateScenarioCardHighlight } from '../../preview/preview.js';
import { updateMarkUI } from '../shared/recording-actions.js';
import { showSavePasswordDialog } from '../shared/credentials-ui.js';
import { hideBanner } from '../../common/banner.js';
import { rerenderPanel } from '../../app.js';

/** 在右侧栏 webview 中打开 URL */
export async function navigateInAppBrowser(url) {
  // ★ 隐藏 Banner（恢复 webview 容器显示）
  hideBanner();

  // 打开右栏
  appState.rightColumnOpen = true;
  appState.rightPanelMode = 'preview';

  // 显示工具栏操作（适配/缩放）
  const toolbarActions = document.getElementById('rightToolbarActions');
  if (toolbarActions) toolbarActions.style.display = '';

  updateLayout();

  // 更新右栏标题
  const rightTitle = document.getElementById('rightTitle');
  if (rightTitle) rightTitle.textContent = '应用内浏览器';

  // 加载 URL
  const webview = document.getElementById('previewWebview');
  const loading = document.getElementById('previewLoading');
  if (loading) {
    loading.textContent = '加载中...';
    loading.classList.add('active');
  }

  // ★ 设置 preload 脚本（如果初始化时未设置，这里补设）
  if (!appState.webviewPreloadSet) {
    try {
      const preloadUrl = await api.getWebviewPreloadPath();
      if (preloadUrl) {
        webview.setAttribute('preload', preloadUrl);
        appState.webviewPreloadSet = true;
        console.log('[panel] webview preload 已设置:', preloadUrl);
      }
    } catch (e) {
      console.warn('[panel] 设置 webview preload 失败:', e.message);
    }
  }

  // ★ 先设置录制模式标志（did-finish-load 可能很快触发）
  appState.webviewRecordingMode = true;
  appState.browserLaunched = true;
  appState.webviewHelperInjected = false;

  // ★ 清除预览模式残留状态（隔离预览和录制）
  appState.currentPreviewDirName = null;
  appState.currentPreviewFiles = [];
  const oldSelector = document.querySelector('.preview-step-selector');
  if (oldSelector) oldSelector.remove();
  updateScenarioCardHighlight();

  webview.src = url;

  // ★ 重置登录检测状态（导航到新页面时清除旧域名的快捷登录区域）
  appState.loginFormDomain = null;
  appState.savedCredentials = [];
  if (appState.currentView === 'recording') rerenderPanel();
  updateAlwaysOnTop();

  // ★ 安全超时：15 秒后强制隐藏加载提示（防止事件未触发）
  if (webview._loadingTimer) clearTimeout(webview._loadingTimer);
  webview._loadingTimer = setTimeout(() => {
    if (loading) loading.classList.remove('active');
  }, 15000);

  updateStatus('应用内浏览器: ' + url, 'var(--accent-blue)');
}

/** 注入元素选择 + 凭证辅助脚本到 webview */
export async function injectWebviewElementHelper() {
  const webview = document.getElementById('previewWebview');
  if (!webview) return;

  // ★ 同时获取元素选择脚本 + 凭证辅助脚本
  const [elementResult, credResult] = await Promise.all([
    api.getInjectScript('element-helper'),
    api.getInjectScript('credential-helper'),
  ]);

  if (!elementResult || !elementResult.success) {
    console.error('[panel] 获取元素选择脚本失败:', elementResult?.error);
    return;
  }

  // ★ 定义回调桥接：所有注入脚本通过 preload 暴露的 __recSendToHost
  //    (ipcRenderer.sendToHost) 将事件可靠地发送到宿主页面（panel）
  const wrapperCode = [
    '(function(){',
    // 元素选择回调
    '  window.__recOnElementSelected = function(data) {',
    '    if (window.__recSendToHost) window.__recSendToHost("element-selected", data);',
    '  };',
    '  window.__recOnSelectionCancelled = function() {',
    '    if (window.__recSendToHost) window.__recSendToHost("selection-cancelled");',
    '  };',
    '  window.__recOnPageFocus = function(data) {',
    '    if (window.__recSendToHost) window.__recSendToHost("page-focus", data);',
    '  };',
    // 凭证回调（登录表单检测 + 登录提交捕获）
    '  window.__recOnLoginFormDetected = function(data) {',
    '    if (window.__recSendToHost) window.__recSendToHost("login-form-detected", data);',
    '  };',
    '  window.__recOnLoginSubmit = function(data) {',
    '    if (window.__recSendToHost) window.__recSendToHost("login-submit", data);',
    '  };',
    '})();',
    elementResult.content,
    credResult && credResult.success ? credResult.content : '',
  ].join('\n');

  await webview.executeJavaScript(wrapperCode);
  appState.webviewHelperInjected = true;
  console.log('[panel] 元素选择 + 凭证辅助脚本已注入 webview');
}

/**
 * ★ 设置 webview ipc-message 监听（元素选择 + 凭证事件）
 * 使用 ipcRenderer.sendToHost → webview 'ipc-message' 事件通信，
 * 替代之前不可靠的 console-message 方案。
 */
export function setupWebviewIpcListener() {
  const webview = document.getElementById('previewWebview');
  if (!webview || webview._recIpcBound) return;
  webview._recIpcBound = true;

  webview.addEventListener('ipc-message', (e) => {
    const channel = e.channel;
    const data = e.args && e.args.length > 0 ? e.args[0] : {};

    if (channel === 'element-selected') {
      appState.hasSelectedElement = true;
      appState.selectedElementData = data;
      appState.isSelectingMode = false;
      // ★ 禁用 webview 选择模式（确保页面恢复正常可交互状态）
      disableWebviewSelectionMode();
      // ★ 自动填充主标题（如果为空）
      const mtInput = document.getElementById('markMainTitleInput');
      if (mtInput && !mtInput.value && data.text) mtInput.value = data.text;
      updateMarkUI();
      updateStatus('已选择元素（' + (data.tagName || '') + '），请填写信息后标记', 'var(--accent-green)');
    } else if (channel === 'selection-cancelled') {
      appState.hasSelectedElement = false;
      appState.selectedElementData = null;
      appState.isSelectingMode = false;
      // ★ 禁用 webview 选择模式
      disableWebviewSelectionMode();
      updateMarkUI();
      updateStatus('', '');
    } else if (channel === 'login-form-detected') {
      // ★ 检测到登录表单 — 加载已保存凭证并显示快捷登录区域
      appState.loginFormDomain = data.domain;
      api.getCredentials(data.domain).then((creds) => {
        appState.savedCredentials = creds || [];
        if (appState.currentView === 'recording') rerenderPanel();
      });
    } else if (channel === 'login-submit') {
      // ★ 捕获到登录提交 — 弹出保存密码对话框
      showSavePasswordDialog(data.domain, data.username, data.password);
    }
  });
}

/** 在 webview 中启用元素选择模式 */
export async function enableWebviewSelectionMode() {
  const webview = document.getElementById('previewWebview');
  if (!webview) return;

  if (!appState.webviewHelperInjected) {
    await injectWebviewElementHelper();
  }

  try {
    await webview.executeJavaScript('window.__recHelper && window.__recHelper.enableSelectionMode()');
  } catch (e) {
    console.warn('[panel] 启用 webview 选择模式失败:', e.message);
  }
}

/** 在 webview 中禁用元素选择模式 */
export async function disableWebviewSelectionMode() {
  const webview = document.getElementById('previewWebview');
  if (!webview) return;
  try {
    await webview.executeJavaScript('window.__recHelper && window.__recHelper.disableSelectionMode()');
  } catch (e) {
    // ignore
  }
}

/** 在 webview 中移除元素 ID */
export async function removeWebviewElementId(elementId) {
  const webview = document.getElementById('previewWebview');
  if (!webview) return;
  try {
    await webview.executeJavaScript(
      'window.__recHelper && window.__recHelper.removeElementId && window.__recHelper.removeElementId("' + elementId + '")'
    );
  } catch (e) {
    // ignore
  }
}

/** ★ 在 webview 中填充登录凭证 */
export async function fillWebviewCredentials(username, password) {
  const webview = document.getElementById('previewWebview');
  if (!webview) return false;
  try {
    const result = await webview.executeJavaScript(
      'window.__recCredHelper && window.__recCredHelper.fillCredentials(' +
      JSON.stringify(username) + ', ' + JSON.stringify(password) + ')'
    );
    return result;
  } catch (e) {
    console.warn('[panel] webview 填充凭证失败:', e.message);
    return false;
  }
}

/** ★ 捕获 webview 页面数据（用于录制快照） */
export async function captureWebviewData() {
  const webview = document.getElementById('previewWebview');
  if (!webview) return null;

  // ★ P0 防御：浏览器未启动时直接返回，避免在未初始化的 webview 上 executeJavaScript 永久挂起
  if (!appState.browserLaunched) {
    console.log('[panel] 浏览器未启动，跳过 webview 数据捕获');
    return null;
  }

  // 1. 获取 URL
  const url = webview.getURL();
  // ★ 防御：webview 未加载真实页面时直接返回（about:blank 上 executeJavaScript 也可能挂起）
  if (!url || url === 'about:blank' || url.startsWith('chrome-error')) {
    console.log('[panel] webview 未加载有效页面（' + url + '），跳过数据捕获');
    return null;
  }

  // ★ 超时保护：防止 executeJavaScript 永久挂起（如 webview 内部异常）
  const withTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(label + ' 超时 (' + ms + 'ms)')), ms)
    ),
  ]);

  // 2. 获取清理后的 HTML（移除 script、事件处理器等）
  const cleanupCode = [
    '(function(){',
    '  var clone = document.documentElement.cloneNode(true);',
    '  clone.querySelectorAll("#__rec_panel,#__rec_panel_overlay,#__rec_highlight_overlay,#__rec_selection_style,#__rec_selection_tooltip").forEach(function(el){el.remove()});',
    '  clone.querySelectorAll("script,noscript").forEach(function(el){el.remove()});',
    '  clone.querySelectorAll(\'meta[http-equiv="Content-Security-Policy"]\').forEach(function(el){el.remove()});',
    '  clone.querySelectorAll("base").forEach(function(el){el.remove()});',
    '  clone.querySelectorAll("*").forEach(function(el){',
    '    Array.from(el.attributes).forEach(function(attr){',
    '      if(attr.name.startsWith("on")) el.removeAttribute(attr.name);',
    '    });',
    '  });',
    '  return "<!DOCTYPE html>\\n" + clone.outerHTML;',
    '})()',
  ].join('\n');

  // 3. 获取 CSS 内容（通过 fetch 获取外部样式表）
  const cssFetchCode = [
    '(async function(){',
    '  var links = Array.from(document.querySelectorAll(\'link[rel="stylesheet"]\'));',
    '  var results = [];',
    '  for(var i=0; i<links.length; i++){',
    '    var href = links[i].href;',
    '    if(!href || href.startsWith("data:")) continue;',
    '    try{',
    '      var resp = await fetch(href);',
    '      var text = await resp.text();',
    '      results.push({url: href, content: text});',
    '    }catch(e){}',
    '  }',
    '  return JSON.stringify(results);',
    '})()',
  ].join('\n');

  try {
    const html = await withTimeout(webview.executeJavaScript(cleanupCode), 3000, 'HTML 捕获');
    const cssJson = await withTimeout(webview.executeJavaScript(cssFetchCode), 3000, 'CSS 捕获');
    let cssContents = [];
    try { cssContents = JSON.parse(cssJson); } catch (e) {}
    return { url, html, cssContents };
  } catch (err) {
    console.warn('[panel] 捕获 webview 数据失败:', err.message);
    return null;
  }
}
