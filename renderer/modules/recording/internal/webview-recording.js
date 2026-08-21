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
import { getActiveWebview, closeExtraTabs } from '../../common/tabs.js';
import { applyMobileEmulation, effectiveMobileMode } from '../../common/webview-controls.js';

/**
 * ★ 取当前正在录制/浏览的 webview
 * 只有一个主 tab 时返回的就是 #previewWebview（与改造前完全一致）；
 * 用户点 target=_blank 开出新 tab 后，返回新 tab 的 webview，
 * 从而实现"新 tab 里同样能拾取元素、录制 HTML"。
 */
function recWebview() {
  return getActiveWebview() || document.getElementById('previewWebview');
}

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

  // ★ 从地址栏重新导航 = 新一轮录制，先回到主 tab 并清掉上一轮遗留的新 tab
  try {
    await closeExtraTabs();
  } catch (e) { /* ignore */ }

  // 加载 URL（地址栏导航固定落在主 tab）
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

  // ★ 导航前【断言当前生效模式对应的 UA】（预览 PC / 录制移动）。
  //    地址栏导航的 request 必须在发出前携带正确 UA，
  //    否则站点按桌面 UA 处理（PC 地址不跳移动端 / 移动地址刷新后跳回 PC）。
  try {
    applyMobileEmulation(webview, effectiveMobileMode());
  } catch (e) {}

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

/** 注入元素选择 + 凭证辅助脚本到 webview（不传参 = 当前激活 tab） */
export async function injectWebviewElementHelper(targetWebview) {
  const webview = targetWebview || recWebview();
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
  // ★ 逐 webview 记录注入状态（多 tab 下每个 webview 各自注入一次）
  webview._recHelperInjected = true;
  appState.webviewHelperInjected = true;
  console.log('[panel] 元素选择 + 凭证辅助脚本已注入 webview:', webview.id);
}

/**
 * ★ 设置 webview ipc-message 监听（元素选择 + 凭证事件）
 * 使用 ipcRenderer.sendToHost → webview 'ipc-message' 事件通信，
 * 替代之前不可靠的 console-message 方案。
 */
export function setupWebviewIpcListener(targetWebview) {
  const webview = targetWebview || document.getElementById('previewWebview');
  if (!webview || webview._recIpcBound) return;
  webview._recIpcBound = true;

  webview.addEventListener('ipc-message', (e) => {
    const channel = e.channel;
    const data = e.args && e.args.length > 0 ? e.args[0] : {};

    if (channel === 'element-selected') {
      appState.hasSelectedElement = true;
      appState.selectedElementData = data;
      appState.isSelectingMode = false;
      // ★ 禁用发出事件的那个 webview 的选择模式（多 tab 下要精确到来源 webview）
      disableWebviewSelectionMode(webview);
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
      disableWebviewSelectionMode(webview);
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
    } else if (channel === 'webview-navigate' || channel === 'rec-new-tab') {
      // ★ 页面内脚本兜底通道：请求打开新地址 → 统一开新 tab（不再覆盖当前页面）
      const newUrl = data && data.url;
      if (newUrl) {
        import('../../common/tabs.js')
          .then((m) => m.requestNewTab(newUrl, channel))
          .catch((err) => console.error('[panel] ' + channel + ' 开新 tab 失败:', err));
      }
    } else if (channel === 'preview-exit-fullscreen') {
      // ★ v20：地图预览内"退出演示" / "完成演示 → 返回演示中心" 触发 → 退出全屏预览
      import('../../preview/preview.js')
        .then((m) => {
          if (typeof m.toggleFullscreenPreview === 'function') {
            m.toggleFullscreenPreview(false);
          }
        })
        .catch((err) => console.warn('[panel] preview-exit-fullscreen 处理失败:', err));
    }
  });
}

/** 在 webview 中启用元素选择模式（作用于当前激活 tab） */
export async function enableWebviewSelectionMode() {
  const webview = recWebview();
  if (!webview) return;

  // ★ 逐 webview 判断是否已注入（新 tab 首次拾取时也能自动补注入）
  if (!webview._recHelperInjected) {
    await injectWebviewElementHelper(webview);
  }

  try {
    await webview.executeJavaScript('window.__recHelper && window.__recHelper.enableSelectionMode()');
  } catch (e) {
    console.warn('[panel] 启用 webview 选择模式失败:', e.message);
  }
}

/** 在 webview 中禁用元素选择模式 */
export async function disableWebviewSelectionMode(targetWebview) {
  const webview = targetWebview || recWebview();
  if (!webview) return;
  try {
    await webview.executeJavaScript('window.__recHelper && window.__recHelper.disableSelectionMode()');
  } catch (e) {
    // ignore
  }
}

/** 在 webview 中移除元素 ID */
export async function removeWebviewElementId(elementId) {
  const webview = recWebview();
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
  const webview = recWebview();
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

/**
 * ★ 捕获前就绪等待 — 根因修复：SPA / 异步页面（尤其 qiankun 微前端 + BPM 画布这类重页面）在
 *   did-finish-load 之后 body 可能尚未渲染出内容，此时若直接克隆 documentElement，会录到
 *   「空 body」的快照，导致该步骤预览空白（如"公文·薪福通"末步、sen_code_tyoCtt 末步、
 *   sen_code_vl98MI 第 1/2 步的历史损坏）。
 *   仅当 body 明显为空时才等待；正常已加载页面第一次检测即返回，不影响性能。
 */
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function _isBodyReady(webview) {
  try {
    return await webview.executeJavaScript(
      '(function(){var b=document.body;if(!b)return false;' +
      'if(document.readyState==="loading")return false;' + // DOM 尚未解析完成
      'var text=(b.innerText||"").trim();' +
      'var kids=b.children.length;' +
      'var media=b.querySelectorAll("img,svg,canvas,video,iframe,table").length;' +
      'return (text.length>15) || (kids>3) || (media>0 && kids>0);})()'
    );
  } catch (e) {
    return true; // 检测失败不阻断，放行
  }
}

/**
 * ★ 等待同源 iframe（如 xft 的 SimulatorRenderer / 文档预览）也渲染出内容。
 *   主壳 body 可能很快就有内容，但真正要录的文档/流程画布还在 iframe 里异步加载；
 *   跨域 iframe 无法读取 contentDocument，直接跳过（本来就录不到）。
 */
async function _waitForIframesReady(webview, maxMs) {
  maxMs = maxMs || 8000;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    let ready = true;
    try {
      ready = await webview.executeJavaScript(
        '(function(){' +
        'var ifs=Array.from(document.querySelectorAll("iframe"));' +
        'for(var i=0;i<ifs.length;i++){' +
        '  var src=ifs[i].src||"";' +
        '  if(src==="about:blank"||src.indexOf("data:")===0)continue;' +
        '  try{' +
        '    var d=ifs[i].contentDocument;' +
        '    if(d&&d.body){' +
        '      var t=(d.body.innerText||"").trim();' +
        '      if(t.length>0||d.body.children.length>3)continue;' +
        '      return false;' + // 同源 iframe 还是空的 → 再等等
        '    }' +
        '  }catch(e){/* 跨域 iframe 无法读取，跳过 */}' +
        '}' +
        'return true;' +
        '})()'
      );
    } catch (e) { return; }
    if (ready) return;
    await _sleep(400);
  }
}

async function _waitForBodyContent(webview, maxMs) {
  maxMs = maxMs || 15000; // 重页面（qiankun 微前端 + BPM 编辑器）加载慢，放宽到 15s
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    let ready = false;
    try { ready = await _isBodyReady(webview); } catch (e) { return; }
    if (ready) return;
    await _sleep(400);
  }
}

/** ★ 捕获 webview 页面数据（用于录制快照） */
export async function captureWebviewData() {
  // ★ 捕获当前激活 tab 的页面（新 tab 内录制 HTML 依赖这里）
  const webview = recWebview();
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

  // ★ 捕获前就绪等待：避免在页面 body 尚未渲染完成时捕获到空页面
  try { await _waitForBodyContent(webview); } catch (e) { /* ignore */ }
  // ★ 同源 iframe 内容就绪等待（如 xft SimulatorRenderer 里渲染的文档/流程内容）
  try { await _waitForIframesReady(webview); } catch (e) { /* ignore */ }

  // 2. 获取清理后的 HTML（移除 script、事件处理器等）
  //    ★ 在克隆前，先将所有 canvas 元素转为 <img>（SpreadJS/canvas 页面无法用纯 HTML 展示）
  //    canvas.toDataURL() 直接在 webview 内执行，无需外部库
  const canvasReplaceCode = [
    '(function(){',
    '  var canvases = document.querySelectorAll("canvas");',
    '  var count = 0;',
    '  canvases.forEach(function(canvas){',
    '    try{',
    '      var dataUrl = canvas.toDataURL("image/png");',
    '      var img = document.createElement("img");',
    '      img.src = dataUrl;',
    '      img.style.cssText = canvas.style.cssText || ("width:" + canvas.width + "px;height:" + canvas.height + "px;");',
    '      img.setAttribute("data-rec-canvas-replaced", "true");',
    '      img.width = canvas.width;',
    '      img.height = canvas.height;',
    '      // 保留 canvas 的 class 和 id（用于元素选择和样式）',
    '      if(canvas.className) img.className = canvas.className;',
    '      if(canvas.id) img.id = canvas.id + "_img";',
    '      canvas.parentNode.replaceChild(img, canvas);',
    '      count++;',
    '    }catch(e){',
    '      console.warn("[rec] canvas 转图片失败:", e.message);',
    '    }',
    '  });',
    '  return count;',
    '})()',
  ].join('\n');

  // ★ 先替换 canvas，再克隆 HTML
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
    '  var result = { html: "<!DOCTYPE html>\\n" + clone.outerHTML, baseURI: document.baseURI };',
    '  return JSON.stringify(result);',
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

  // ★ 4. 捕获所有同域 iframe 的 HTML 和 CSS
  //    必须在 webview 内执行（继承 cookie 和同源环境），后端无法 fetch
  //    跨域 iframe 因同源策略无法访问 contentDocument，会被跳过
  const iframeCaptureCode = [
    '(async function(){',
    '  var iframes = Array.from(document.querySelectorAll("iframe"));',
    '  var results = [];',
    '  for(var i=0; i<iframes.length; i++){',
    '    var iframe = iframes[i];',
    '    var src = iframe.src || "";',
    '    if(src === "about:blank" || src.indexOf("data:") === 0) continue;',
    '    try{',
    '      var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);',
    '      if(!doc || !doc.documentElement) continue;',
    '      // ★ 先将 iframe 内的 canvas 转为图片',
    '      var iframeCanvases = doc.querySelectorAll("canvas");',
    '      iframeCanvases.forEach(function(canvas){',
    '        try{',
    '          var dataUrl = canvas.toDataURL("image/png");',
    '          var img = doc.createElement("img");',
    '          img.src = dataUrl;',
    '          img.style.cssText = canvas.style.cssText || ("width:" + canvas.width + "px;height:" + canvas.height + "px;");',
    '          img.width = canvas.width;',
    '          img.height = canvas.height;',
    '          if(canvas.className) img.className = canvas.className;',
    '          if(canvas.id) img.id = canvas.id + "_img";',
    '          canvas.parentNode.replaceChild(img, canvas);',
    '        }catch(e){}',
    '      });',
    '      var clone = doc.documentElement.cloneNode(true);',
    '      clone.querySelectorAll("script,noscript").forEach(function(el){el.remove()});',
    '      clone.querySelectorAll(\'meta[http-equiv="Content-Security-Policy"]\').forEach(function(el){el.remove()});',
    '      clone.querySelectorAll("base").forEach(function(el){el.remove()});',
    '      clone.querySelectorAll("*").forEach(function(el){',
    '        Array.from(el.attributes).forEach(function(attr){',
    '          if(attr.name.startsWith("on")) el.removeAttribute(attr.name);',
    '        });',
    '      });',
    '      var html = "<!DOCTYPE html>\\n" + clone.outerHTML;',
    '      var cssContents = [];',
    '      var links = Array.from(doc.querySelectorAll(\'link[rel="stylesheet"]\'));',
    '      for(var j=0; j<links.length; j++){',
    '        var href = links[j].href;',
    '        if(!href || href.indexOf("data:") === 0) continue;',
    '        try{',
    '          var resp = await fetch(href);',
    '          var text = await resp.text();',
    '          cssContents.push({url: href, content: text});',
    '        }catch(e){}',
    '      }',
    '      var styles = Array.from(doc.querySelectorAll("style"));',
    '      var inlineCss = "";',
    '      styles.forEach(function(s){ inlineCss += s.textContent + "\\n"; });',
    '      results.push({index: i, src: src, html: html, cssContents: cssContents, inlineCss: inlineCss, baseURI: doc.baseURI});',
    '    }catch(e){',
    '      console.warn("[rec iframe] capture failed:", src, e.message);',
    '    }',
    '  }',
    '  return JSON.stringify(results);',
    '})()',
  ].join('\n');

  // ★ 单次捕获：清理 HTML（canvas 转图片 + 移除脚本/事件）+ CSS + iframe + body 空检测
  async function _doCapture() {
    // ★ 先将 canvas 转为图片（SpreadJS 等 canvas 页面无法用纯 HTML 展示）
    try {
      const canvasCount = await withTimeout(webview.executeJavaScript(canvasReplaceCode), 3000, 'canvas 替换');
      if (canvasCount > 0) console.log('[panel] 已将 ' + canvasCount + ' 个 canvas 转为图片');
    } catch (e) {
      console.warn('[panel] canvas 替换失败（不阻断主流程）:', e.message);
    }

    // ★ cleanupCode 现返回 {html, baseURI} JSON，解析出真实基准地址（含 <base href>）
    const cleanupResult = await withTimeout(webview.executeJavaScript(cleanupCode), 3000, 'HTML 捕获');
    let html = '';
    let baseURI = '';
    try {
      const parsed = JSON.parse(cleanupResult);
      html = parsed.html || '';
      baseURI = typeof parsed.baseURI === 'string' ? parsed.baseURI : '';
    } catch (e) {
      // 兼容：若返回纯字符串 HTML
      html = cleanupResult || '';
    }
    const cssJson = await withTimeout(webview.executeJavaScript(cssFetchCode), 3000, 'CSS 捕获');
    let cssContents = [];
    try { cssContents = JSON.parse(cssJson); } catch (e) {}

    // ★ 捕获 iframe 内容（允许较长超时，因为可能 fetch 多个 iframe 的 CSS）
    let iframes = [];
    try {
      const iframeJson = await withTimeout(webview.executeJavaScript(iframeCaptureCode), 6000, 'iframe 捕获');
      iframes = JSON.parse(iframeJson || '[]');
      console.log('[panel] 捕获到 ' + iframes.length + ' 个 iframe');
    } catch (e) {
      console.warn('[panel] iframe 捕获失败（不阻断主流程）:', e.message);
    }

    // ★ 检测 body 是否仍为空（就绪等待后仍为空 → 上层提示用户重录该步）
    let bodyEmpty = false;
    try {
      bodyEmpty = await withTimeout(webview.executeJavaScript(
        '(function(){var b=document.body;if(!b)return true;' +
        'var text=(b.innerText||"").trim();' +
        'return text.length===0 && b.children.length===0;})()'
      ), 1500, 'body 空检测').catch(() => false);
    } catch (e) {}

    return { url, html, cssContents, iframes, baseURI, bodyEmpty: !!bodyEmpty };
  }

  try {
    let result = await _doCapture();
    // ★ 自动重试：首次捕获 body 为空（偶发页面尚未渲染完）时，再等一段时间重新捕获，最多 2 次。
    //   从源头把「录出无法预览的空步骤」的概率降到极低；若重试后仍为空，才返回 bodyEmpty:true 交给上层。
    let retries = 0;
    while (result && result.bodyEmpty && retries < 2) {
      retries++;
      console.warn('[panel] 首次捕获 body 为空，第 ' + retries + ' 次重试（再等 5s）...');
      await _waitForBodyContent(webview, 5000);
      result = await _doCapture();
    }
    return result;
  } catch (err) {
    console.warn('[panel] 捕获 webview 数据失败:', err.message);
    return null;
  }
}
