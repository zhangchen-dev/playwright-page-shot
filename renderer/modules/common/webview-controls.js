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

/** ★ 适配页面 — 按比例缩放 webview 到容器 */
export function applyFitPage(enabled) {
  appState.fitPageEnabled = enabled;
  const wrapper = document.getElementById('webviewScrollWrapper');
  const fitBtn = document.getElementById('fitPageBtn');
  const zoomSelect = document.getElementById('zoomSelect');

  if (!wrapper) return;

  if (enabled) {
    wrapper.classList.add('fit-mode');
    if (fitBtn) fitBtn.classList.add('active');
    if (zoomSelect) zoomSelect.disabled = true; // 适配模式下禁用手动缩放
  } else {
    wrapper.classList.remove('fit-mode');
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
  const webview = document.getElementById('previewWebview');
  const scaleWrapper = document.getElementById('webviewScaleWrapper');
  const scrollWrapper = document.getElementById('webviewScrollWrapper');
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

  // ★ 浏览器模式切换 — Switch 开关
  const switchInput = document.getElementById('browserModeSwitch');
  if (switchInput) {
    // 同步初始状态（默认 checked = 应用内）
    switchInput.checked = (appState.browserMode === 'in-app');

    switchInput.addEventListener('change', () => {
      const mode = switchInput.checked ? 'in-app' : 'external';
      if (mode === appState.browserMode) return;

      appState.browserMode = mode;

      // 更新 switch-option 高亮
      document.querySelectorAll('.switch-option').forEach((opt) => {
        opt.classList.toggle('active', opt.dataset.mode === mode);
      });

      // 切换到外层模式时隐藏工具栏操作
      if (mode === 'external') {
        const toolbarActions = document.getElementById('rightToolbarActions');
        if (toolbarActions) toolbarActions.style.display = 'none';
      }

      updateAlwaysOnTop();
      showToast(mode === 'external' ? '已切换到外层浏览器模式' : '已切换到应用内浏览器模式', 'info');
    });
  }

  // switch-option 点击也可切换
  document.querySelectorAll('.switch-option').forEach((opt) => {
    opt.addEventListener('click', () => {
      const mode = opt.dataset.mode;
      if (mode === appState.browserMode) return;
      if (switchInput) {
        switchInput.checked = (mode === 'in-app');
        switchInput.dispatchEvent(new Event('change'));
      }
    });
  });

  // 适配页面按钮
  const fitBtn = document.getElementById('fitPageBtn');
  if (fitBtn) {
    fitBtn.addEventListener('click', () => {
      applyFitPage(!appState.fitPageEnabled);
    });
  }

  // ★ 分辨率选择 — 切换标准尺寸
  const resolutionSelect = document.getElementById('resolutionSelect');
  if (resolutionSelect) {
    resolutionSelect.value = appState.currentResolution; // 同步初始值
    resolutionSelect.addEventListener('change', () => {
      appState.currentResolution = resolutionSelect.value;
      updateWebviewScale();
      const res = CONSTANTS.WEBVIEW_RESOLUTIONS[appState.currentResolution] || {};
      showToast('已切换到 ' + (res.label || '') + ' ' + (res.width || '') + '×' + (res.height || ''), 'info');
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
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => {
      toggleFullscreenPreview();
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
    });

    // did-finish-load — 页面完全加载
    webview.addEventListener('did-finish-load', () => {
      hideLoading();

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
      });
    });

    // ★ did-stop-loading — 加载停止（覆盖 did-finish-load 未触发的场景）
    webview.addEventListener('did-stop-loading', hideLoading);

    // ★ did-navigate — 导航完成后隐藏加载提示 + 同步预览步骤选择器
    webview.addEventListener('did-navigate', () => {
      hideLoading();
      syncPreviewStepSelector();
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
  }
}
