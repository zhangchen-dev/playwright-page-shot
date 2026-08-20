/**
 * Webview 适配/缩放控件 + 浏览器模式控件初始化
 */
import { appState, CONSTANTS } from './state.js';
import { api } from './api.js';
import { showToast } from './feedback.js';
import { updateAlwaysOnTop } from './layout.js';
import { toggleFullscreenPreview, } from '../preview/preview.js';
import { syncPreviewStepSelector } from '../preview/step-selector.js';
import { setupWebviewIpcListener, injectWebviewElementHelper } from '../recording/internal/webview-recording.js';
import { initTabs, getActiveTabPage, applyMobileToAllTabs, reloadAllTabs, reloadActiveWebview } from './tabs.js';

/**
 * ★ 移动端设备模拟：固定 UA + 触摸模拟
 * 配合 state.js 的 WEBVIEW_RESOLUTIONS['mobile']（390×844）使用——
 * webview 元素尺寸切到移动端视口后，响应式布局即按移动端渲染；
 * UA + 触摸模拟进一步逼近真机（UA 嗅探站点、tap 事件）。
 */
export const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

// ★ 桌面端兜底 UA：无法可靠捕获"原始 UA"时，用它还原（站点 isMobile() 仅检测 Mobile/iPhone 等关键字，
//   标准桌面 UA 必被判定为 PC，故硬编一个即可保证"退出移动端 → 回到 PC"）
const DEFAULT_PC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ★ 判断 UA 是否为移动端（关键字与用户站点 isMobile() 保持一致）。
//   用途：捕获"原始 UA"时排除已设置的移动 UA —— 这是"关掉移动端仍跳移动端"的根因防线。
function isMobileUA(ua) {
  return /Mobi|Mobile|iPhone|iPad|iPod|Android|HarmonyOS|OpenHarmonyOS/i.test(ua || '');
}

/**
 * ★ 当前【生效】的移动端模式：录制意图 ∧ 非预览强制 PC。
 *   - 录制视图（forcePCMode=false）：effective = isMobileMode（受顶部📱开关控制）
 *   - 预览视图（forcePCMode=true）：effective = false（预览永远 PC，不受录制开关影响）
 * 所有 webview UA / 视口 / 手机框 / 置灰状态都以此为准 —— 这样预览场景强制 PC，
 * 录制场景尊重开关，切回录制时 forcePCMode 自动清零，isMobileMode 状态被原样保留。
 */
export function effectiveMobileMode() {
  return !!(appState.isMobileMode && !appState.forcePCMode);
}

/**
 * ★ applyMobileEmulation：对指定 webview 应用/撤销移动端模拟。
 *  根因（真实 Chromium 实测确认）：站点 isMobile() 仅判断 navigator.userAgent 字符串，
 *  含 iPhone/Android 即移动端，否则 checkAgent() 跳转 PC。→ 必须以【同步、持久】方式设置 UA，
 *  确保每次导航/reload/F5 的【首请求】都是移动端 UA。
 *  主机制：webContents.setUserAgent() —— 会话级、同步、跨 reload/新 tab 持久，Electron 在
 *          每次请求构造时读取，不存在 CDP debugger 的异步时序竞态（这正是"首次对、刷新错"的旧根因）。
 *  兜底：<webview useragent> 属性 —— 声明式持久 UA，webview 每次导航都按它发请求。
 *  全程失败静默忽略。 */
export function applyMobileEmulation(webview, enabled) {
  if (!webview) return;
  const wc = webview.getWebContents ? webview.getWebContents() : null;
  try {
    if (enabled) {
      // ★ 仅当当前 UA 确为「非移动端」时才记为原始 UA。
      //   若 useragent 属性已先行设为移动 UA（例如先开开关后开浏览器），getUserAgent() 会返回移动 UA，
      //   此时绝不能把它存成"原始 UA"，否则退出移动端时会还原成移动 UA → 仍跳移动端。
      if (appState._originalUA === undefined && wc) {
        try {
          const cur = wc.getUserAgent();
          if (cur && !isMobileUA(cur)) appState._originalUA = cur;
        } catch (e) {}
      }
      // 主机制：会话级 UA（同步、跨 reload 持久）
      if (wc) { try { wc.setUserAgent(MOBILE_UA); } catch (e) {} }
      // 兜底：useragent 属性（声明式，覆盖 reload 首请求）
      try { webview.setAttribute('useragent', MOBILE_UA); } catch (e) {}
      // 触摸模拟（逼近真机 tap 行为）
      if (wc && typeof wc.setTouchEmulationEnabled === 'function') {
        try { wc.setTouchEmulationEnabled(true, { maxTouchPoints: 5 }); } catch (e) {}
      }
    } else {
      // ★ 还原 UA：优先用捕获到的真实原始 UA；若未捕获到、或捕获到的其实是（残留）移动 UA，
      //   一律回退到标准桌面 UA，确保"退出移动端 → 回到 PC"。
      const pcUA = (appState._originalUA && appState._originalUA !== '' && !isMobileUA(appState._originalUA))
        ? appState._originalUA
        : DEFAULT_PC_UA;
      // ★ 关键修复：必须【显式把 useragent 属性写回 PC UA】，而不是 removeAttribute。
      //   对已创建的 <webview> guest，removeAttribute 在 reload 后仍可能因属性粘性保持移动 UA，
      //   导致"关掉移动端却仍跳移动端"。改用 setAttribute 覆盖为 PC UA，与 wc.setUserAgent 双保险。
      if (wc) { try { wc.setUserAgent(pcUA); } catch (e) {} }
      try { webview.setAttribute('useragent', pcUA); } catch (e) {}
      if (wc && typeof wc.setTouchEmulationEnabled === 'function') {
        try { wc.setTouchEmulationEnabled(false); } catch (e) {}
      }
    }
  } catch (err) {
    console.warn('[panel] 应用移动端模拟失败（已忽略）:', err && err.message);
  }
}

/**
 * ★ 取当前激活 tab 的三层结构元素
 * 主 tab 时返回的就是 #previewWebview / #webviewScaleWrapper / #webviewScrollWrapper，
 * 与改造前行为完全一致；新 tab 时返回该 tab 自己的一组元素。
 */
function getActiveWebviewParts() {
  const page = getActiveTabPage();
  if (page) {
    const webview = page.querySelector('.preview-webview-inner');
    const scaleWrapper = page.querySelector('.webview-scale-wrapper');
    const scrollWrapper = page.querySelector('.webview-scroll-wrapper');
    if (webview && scaleWrapper && scrollWrapper) return { webview, scaleWrapper, scrollWrapper };
  }
  return {
    webview: document.getElementById('previewWebview'),
    scaleWrapper: document.getElementById('webviewScaleWrapper'),
    scrollWrapper: document.getElementById('webviewScrollWrapper'),
  };
}

/** ★ 适配页面 — 按比例缩放 webview 到容器 */
export function applyFitPage(enabled) {
  appState.fitPageEnabled = enabled;
  const fitBtn = document.getElementById('fitPageBtn');
  const zoomSelect = document.getElementById('zoomSelect');

  // ★ 所有 tab 的滚动容器统一切换 fit-mode，避免切 tab 后模式不一致
  const wrappers = document.querySelectorAll('.webview-scroll-wrapper');
  wrappers.forEach((w) => w.classList.toggle('fit-mode', !!enabled));

  if (enabled) {
    if (fitBtn) fitBtn.classList.add('active');
    if (zoomSelect) zoomSelect.disabled = true; // 适配模式下禁用手动缩放
  } else {
    if (fitBtn) fitBtn.classList.remove('active');
    if (zoomSelect) zoomSelect.disabled = false;
  }
  updateWebviewScale();
}

/** ★ 计算并应用 webview 缩放 — 修正 transform 布局问题
 *
 * 核心原理：
 * - webview 设为标准分辨率（如 1920×1080），页面在该尺寸下渲染
 * - transform: scale() 视觉缩放 webview
 * - scale-wrapper 设为视觉尺寸（origW×scale）+ overflow:hidden
 *   → 裁剪 webview 布局溢出，滚动区域 = 视觉尺寸，无空白
 */
export function updateWebviewScale() {
  const { webview, scaleWrapper, scrollWrapper } = getActiveWebviewParts();
  if (!webview || !scaleWrapper || !scrollWrapper) return;

  const res = CONSTANTS.WEBVIEW_RESOLUTIONS[appState.currentResolution] || CONSTANTS.WEBVIEW_RESOLUTIONS['1920'];
  const origW = res.width;
  const origH = res.height;

  // 计算缩放比例
  let scale = 1.0;
  if (appState.fitPageEnabled) {
    // 适配模式：按容器宽高取最小缩放比，确保完整展示
    const containerWidth = scrollWrapper.clientWidth;
    const containerHeight = scrollWrapper.clientHeight;
    const widthScale = containerWidth / origW;
    const heightScale = containerHeight / origH;
    scale = Math.min(widthScale, heightScale);
    scale = Math.max(scale, 0.1); // 最低 10%
  } else if (appState.currentZoom !== 1.0) {
    scale = appState.currentZoom;
  }

  // ★ webview 始终设为标准分辨率（页面在此尺寸下渲染）
  webview.style.width = origW + 'px';
  webview.style.height = origH + 'px';

  // ★ scale-wrapper 设为视觉尺寸 = 原始尺寸 × 缩放比
  //    overflow:hidden 裁剪 webview 的布局溢出 → 滚动区域精准匹配视觉区域
  const visualW = Math.round(origW * scale);
  const visualH = Math.round(origH * scale);
  scaleWrapper.style.width = visualW + 'px';
  scaleWrapper.style.height = visualH + 'px';

  // ★ transform 缩放 webview（视觉缩放，不影响页面渲染逻辑）
  if (scale !== 1.0) {
    webview.style.transform = 'scale(' + scale + ')';
  } else {
    webview.style.transform = '';
  }
}

/** 初始化浏览器模式切换 + 适配/缩放控件 */
export function initBrowserModeControls() {
  // ★ 尽早设置 webview preload 脚本 — 确保无论先预览还是先录制，preload 都已就绪
  //    preload 通过 contextBridge 暴露 __recSendToHost，供注入脚本与宿主通信
  const _wv = document.getElementById('previewWebview');
  // ★ 尽早捕获真实桌面 UA（在任何移动端模拟之前），供退出移动端时还原。
  //   若 webview 此刻尚无 webContents（未加载），则交给下方 did-finish-load 兜底捕获。
  if (_wv) {
    try {
      const _wc0 = _wv.getWebContents ? _wv.getWebContents() : null;
      if (_wc0) {
        const cur = _wc0.getUserAgent();
        if (cur && !isMobileUA(cur)) appState._originalUA = cur;
      }
    } catch (e) {}
  }
  if (_wv && !appState.webviewPreloadSet) {
    api.getWebviewPreloadPath().then((preloadUrl) => {
      if (preloadUrl) {
        _wv.setAttribute('preload', preloadUrl);
        appState.webviewPreloadSet = true;
        console.log('[panel] webview preload 已在初始化时设置:', preloadUrl);
      }
    }).catch((e) => {
      console.warn('[panel] 初始化设置 webview preload 失败:', e.message);
    });
  }

  // ★ 浏览器模式切换已移除：应用固定为"应用内 webview"模式（外部 Playwright 浏览器已删除）。

  // 适配页面按钮
  const fitBtn = document.getElementById('fitPageBtn');
  if (fitBtn) {
    fitBtn.addEventListener('click', () => {
      applyFitPage(!appState.fitPageEnabled);
    });
  }

  // ★ 分辨率选择 — 切换标准尺寸
  const resolutionSelect = document.getElementById('resolutionSelect');
  // ★ 全屏按钮（函数级作用域，供下方移动端开关 + 点击监听共用，避免重复声明）
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  if (resolutionSelect) {
    resolutionSelect.value = appState.currentResolution; // 同步初始值
    resolutionSelect.addEventListener('change', () => {
      appState.currentResolution = resolutionSelect.value;
      updateWebviewScale();
      // ★ 切换屏幕大小后刷新当前页面，让站点按新视口重新渲染
      reloadActiveWebview();
      const res = CONSTANTS.WEBVIEW_RESOLUTIONS[appState.currentResolution] || {};
      showToast('已切换到 ' + (res.label || '') + ' ' + (res.width || '') + '×' + (res.height || ''), 'info');
    });
  }

  // ★ 移动端录制/预览开关
  const mobileSwitch = document.getElementById('mobileModeSwitch');
  const mobileControl = document.getElementById('mobileModeControl');
  if (mobileSwitch) {
    // 同步初始状态
    mobileSwitch.checked = appState.isMobileMode;
    // ★ UI 状态（按钮置灰 / 手机框 / active 高亮）使用 effectiveMobileMode，
    //   这样预览视图强制 PC 时这些状态也跟着复位；开关本身仍反映录制意图 isMobileMode。
    const eff = effectiveMobileMode();
    if (mobileControl) mobileControl.classList.toggle('active', eff);
    if (resolutionSelect) resolutionSelect.disabled = eff;
    // ★ 移动端为固定视口，屏幕尺寸切换 + 全屏仅适用于 PC 页面，故同步置灰
    if (fullscreenBtn) fullscreenBtn.disabled = eff;
    // ★ 初始即同步「手机框」状态（刷新页面后若仍处于移动端，框也应存在）
    const _previewContainer = document.getElementById('previewContainer');
    if (_previewContainer) _previewContainer.classList.toggle('mobile-frame-active', eff);

    mobileSwitch.addEventListener('change', () => {
      const on = mobileSwitch.checked;
      appState.isMobileMode = on;
      if (on) {
        // ★ 进入移动端：固定视口 390×844 + 移动 UA + 触摸模拟
        appState._prevResolution = appState.currentResolution;
        appState.currentResolution = 'mobile';
        updateWebviewScale();
        // ★ 对所有已存在的 tab 统一应用（含主 tab 与新开的 tab）
        applyMobileToAllTabs(true);
        // ★ 刷新所有 tab，让站点按移动端 UA 重新渲染（含 m. 域名跳转）
        reloadAllTabs();
        if (mobileControl) mobileControl.classList.add('active');
        if (resolutionSelect) resolutionSelect.disabled = true; // 视口已固定，禁止选桌面分辨率
        if (fullscreenBtn) fullscreenBtn.disabled = true; // ★ 移动端为固定视口，全屏仅 PC 页面需要
        if (_previewContainer) _previewContainer.classList.add('mobile-frame-active'); // ★ 显示手机框
        // (effectiveMobileMode 在此分支为 true；保留显式赋值以与 else 分对称)
        const m = CONSTANTS.WEBVIEW_RESOLUTIONS['mobile'] || {};
        showToast('已切换到移动端预览（' + (m.width || 390) + '×' + (m.height || 844) + '）', 'info');
      } else {
        // ★ 退出移动端：还原上次桌面分辨率 + 原始 UA
        appState.currentResolution = appState._prevResolution || '1920';
        updateWebviewScale();
        // ★ 所有 tab 统一撤销移动端模拟
        applyMobileToAllTabs(false);
        // ★ 刷新所有 tab，让站点按桌面 UA 重新渲染
        reloadAllTabs();
        if (mobileControl) mobileControl.classList.remove('active');
        if (resolutionSelect) { resolutionSelect.disabled = false; resolutionSelect.value = appState.currentResolution; }
        if (fullscreenBtn) fullscreenBtn.disabled = false;
        if (_previewContainer) _previewContainer.classList.remove('mobile-frame-active'); // ★ 移除手机框
        // (effectiveMobileMode 在此分支为 false)
        showToast('已切换回桌面预览', 'info');
      }
    });
  }

  // 缩放比例选择
  const zoomSelect = document.getElementById('zoomSelect');
  if (zoomSelect) {
    zoomSelect.addEventListener('change', () => {
      appState.currentZoom = parseFloat(zoomSelect.value);
      if (!appState.fitPageEnabled) {
        updateWebviewScale();
      }
    });
  }

  // 窗口大小变化时重新计算缩放（适配模式下需要重新计算比例）
  window.addEventListener('resize', () => {
    if (appState.fitPageEnabled) {
      requestAnimationFrame(() => updateWebviewScale());
    }
  });

  // ★ 全屏预览按钮
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => {
      toggleFullscreenPreview();
    });
  }

  // ★ 预览控件收起 / 展开（仅隐藏工具栏控件，预览内容 + 应用壳子保持）
  const rightColumnEl = document.getElementById('rightColumn');
  const collapseBtn = document.getElementById('collapseControlsBtn');
  const expandBtn = document.getElementById('previewExpandBtn');
  if (rightColumnEl && collapseBtn) {
    collapseBtn.addEventListener('click', () => {
      // 收起：隐藏标题/操作组/关闭/收起按钮，仅留预览 + 壳子
      rightColumnEl.classList.add('controls-collapsed');
    });
  }
  if (rightColumnEl && expandBtn) {
    expandBtn.addEventListener('click', () => {
      // 展开：恢复工具栏控件
      rightColumnEl.classList.remove('controls-collapsed');
    });
  }

  // ★ ESC 退出全屏
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('fullscreen-preview')) {
      e.preventDefault();
      toggleFullscreenPreview(false);
    }
  });

  // ★ 设置 webview ipc-message 监听（元素选择事件）
  setupWebviewIpcListener();

  // ★ 多 tab 初始化（target=_blank 拦截后开新 tab）
  initTabs();

  // webview 加载事件
  const webview = document.getElementById('previewWebview');
  if (webview) {
    // ★ 隐藏加载提示的通用函数
    const hideLoading = () => {
      const loading = document.getElementById('previewLoading');
      if (loading) loading.classList.remove('active');
    };

    // did-start-loading — 显示加载提示
    webview.addEventListener('did-start-loading', () => {
      const loading = document.getElementById('previewLoading');
      if (loading) {
        loading.textContent = '加载中...';
        loading.classList.add('active');
      }
      // ★ 每次导航开始即【断言当前生效模式对应的 UA】：预览视图强制 PC；录制视图受📱开关控制。
      //   effectiveMobileMode=false 时强制写回 PC UA，覆盖上一轮可能残留的移动 useragent 属性。
      applyMobileEmulation(webview, effectiveMobileMode());
    });

    // did-finish-load — 页面完全加载
    webview.addEventListener('did-finish-load', () => {
      hideLoading();

      // ★ 首次以 PC 形态加载完成时，记录真实桌面 UA（退出移动端时还原用）。
      //   仅当从未成功捕获过、且当前确为桌面 UA 时才存，避免被移动 UA 污染。
      if (!appState.isMobileMode && appState._originalUA === undefined) {
        try {
          const wc0 = webview.getWebContents ? webview.getWebContents() : null;
          if (wc0) {
            const cur = wc0.getUserAgent();
            if (cur && !isMobileUA(cur)) appState._originalUA = cur;
          }
        } catch (e) {}
      }

      // ★ 等待布局完成后再计算缩放（确保容器尺寸已就绪）
      requestAnimationFrame(() => {
        if (appState.webviewRecordingMode) {
          // 录制模式：注入元素选择 + 凭证辅助脚本
          injectWebviewElementHelper().then(() => {
            updateWebviewScale();
          });
        } else {
          // 预览模式：不注入脚本，页面可正常交互
          updateWebviewScale();
        }
        // ★ 缩放后【断言当前生效模式对应的 UA】（预览 PC / 录制移动）。
        applyMobileEmulation(webview, effectiveMobileMode());
      });
    });

    // ★ did-stop-loading — 加载停止（覆盖 did-finish-load 未触发的场景）
    webview.addEventListener('did-stop-loading', hideLoading);

    // ★ did-navigate — 导航完成后隐藏加载提示 + 同步预览步骤选择器
    webview.addEventListener('did-navigate', () => {
      hideLoading();
      syncPreviewStepSelector();
      // ★ 导航完成后【断言当前生效模式对应的 UA】（预览 PC / 录制移动），
      //   覆盖新页面默认恢复桌面态后可能残留的移动模拟。
      applyMobileEmulation(webview, effectiveMobileMode());
    });
    webview.addEventListener('did-navigate-in-page', hideLoading);

    // ★ did-fail-load — 加载失败也隐藏
    webview.addEventListener('did-fail-load', hideLoading);
    // did-fail-load — 显示错误信息（与上方 hideLoading 并存，保留原两处监听行为）
    webview.addEventListener('did-fail-load', (e) => {
      const loading = document.getElementById('previewLoading');
      if (loading) {
        loading.textContent = '加载失败: ' + (e.errorDescription || '未知错误');
        loading.classList.add('active');
      }
    });

    // ★ 新窗口处理 — 统一走"主进程 setWindowOpenHandler → IPC → tabs.js 开新 tab"
    //    前提是 <webview> 上带独立布尔属性 allowpopups（见 panel.html / tabs.js 注释）。
    //    这里的 webview-open-window 是历史兜底通道：同样转成"开新 tab"，不再原地 loadURL
    //    （原地 loadURL 会覆盖当前页面，也是之前"点了像没反应"的观感来源之一）。
    if (window.electronAPI && window.electronAPI.onWebviewOpenWindow) {
      window.electronAPI.onWebviewOpenWindow((data) => {
        const newUrl = data && data.url;
        if (!newUrl) return;
        import('./tabs.js')
          .then((m) => m.requestNewTab(newUrl, 'webview-open-window'))
          .catch((err) => showToast('打开新标签页失败: ' + err.message, 'error'));
      });
    }
  }
}
