/**
 * 预览功能（跨菜单共用）：打开/关闭预览、全屏、场景卡片高亮
 */
import { appState } from '../common/state.js';
import { updateStatus, showToast } from '../common/feedback.js';
import { updateLayout } from '../common/layout.js';
import { applyFitPage, updateWebviewScale } from '../common/webview-controls.js';
import { disableWebviewSelectionMode } from '../recording/internal/webview-recording.js';
import { renderPreviewStepSelector } from './step-selector.js';

/** 将本地文件路径转为 file:// URL */
export function filePathToUrl(filePath) {
  let normalized = filePath.replace(/\\/g, '/');
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }
  return 'file://' + normalized;
}

/** 在右栏打开预览（webview） */
export async function openPreview(filePath, htmlFiles, dirName) {
  const fileUrl = filePathToUrl(filePath);
  const filename = filePath.replace(/\\/g, '/').split('/').pop();

  // 保存当前预览文件列表（用于步骤切换下拉框）
  if (htmlFiles) appState.currentPreviewFiles = htmlFiles;

  // ★ 预览模式：不注入元素选择脚本，页面可正常交互
  appState.webviewRecordingMode = false;
  appState.browserLaunched = false;
  // ★ 确保退出元素选择模式（如果之前在录制中启用了）
  disableWebviewSelectionMode();
  // ★ 清除录制状态
  appState.hasSelectedElement = false;
  appState.selectedElementData = null;
  appState.isSelectingMode = false;
  appState.loginFormDomain = null;
  appState.savedCredentials = [];

  // ★ 记录当前预览的场景目录名（用于中间栏高亮）
  appState.currentPreviewDirName = dirName || null;
  // ★ 计算当前步骤索引
  if (appState.currentPreviewFiles) {
    appState.currentPreviewStepIndex = appState.currentPreviewFiles.findIndex((f) => f.filePath === filePath);
    if (appState.currentPreviewStepIndex < 0) appState.currentPreviewStepIndex = 0;
  }

  // ★ 更新场景卡片高亮
  updateScenarioCardHighlight();

  appState.rightColumnOpen = true;
  appState.rightPanelMode = 'preview';

  // ★ 显示工具栏操作（适配/缩放）— 预览模式也支持
  const toolbarActions = document.getElementById('rightToolbarActions');
  if (toolbarActions) toolbarActions.style.display = '';

  updateLayout();

  // 渲染步骤选择器
  renderPreviewStepSelector();

  // 显示加载状态并导航
  const loading = document.getElementById('previewLoading');
  const webview = document.getElementById('previewWebview');
  if (loading) {
    loading.textContent = '加载中...';
    loading.classList.add('active');
  }
  webview.src = fileUrl;

  updateStatus('正在预览: ' + filename, 'var(--accent-blue)');
}

/** ★ 更新场景卡片高亮 — 当前预览的场景在中间栏高亮显示 */
export function updateScenarioCardHighlight() {
  document.querySelectorAll('.scenario-card').forEach((card) => {
    card.classList.toggle('scenario-card-active', card.dataset.dirname === appState.currentPreviewDirName);
  });
}

/** 兼容旧调用 — 转发到 openPreview */
export async function showInAppPreview(filePath) {
  await openPreview(filePath);
}

/** 关闭右栏 */
export function closeRightPanel() {
  // ★ 直接移除全屏类（避免重复 updateLayout）
  document.body.classList.remove('fullscreen-preview');
  const fsBtn = document.getElementById('fullscreenBtn');
  if (fsBtn) fsBtn.classList.remove('active');

  appState.rightColumnOpen = false;
  appState.middleCollapsed = false;
  const webview = document.getElementById('previewWebview');
  if (webview) webview.src = 'about:blank';

  // ★ 隐藏工具栏操作
  const toolbarActions = document.getElementById('rightToolbarActions');
  if (toolbarActions) toolbarActions.style.display = 'none';

  // ★ 重置适配/缩放状态
  if (appState.fitPageEnabled) applyFitPage(false);
  appState.currentZoom = 1.0;
  const zoomSelect = document.getElementById('zoomSelect');
  if (zoomSelect) zoomSelect.value = '1.0';

  // 移除步骤选择器
  const oldSelector = document.querySelector('.preview-step-selector');
  if (oldSelector) oldSelector.remove();

  // ★ 清除预览状态和高亮
  appState.currentPreviewDirName = null;
  appState.webviewRecordingMode = false;
  updateScenarioCardHighlight();

  updateLayout();
  updateStatus('', '');
}

/** ★ 全屏预览切换 — 隐藏左栏+中间列，右栏占满 */
export function toggleFullscreenPreview(force) {
  const isFullscreen = document.body.classList.contains('fullscreen-preview');
  const shouldEnter = (force === undefined) ? !isFullscreen : force;

  const fsBtn = document.getElementById('fullscreenBtn');

  if (shouldEnter) {
    // 进入全屏：确保右栏已打开且为预览模式
    if (!appState.rightColumnOpen || appState.rightPanelMode !== 'preview') {
      showToast('请先打开预览页面', 'info');
      return;
    }
    document.body.classList.add('fullscreen-preview');
    if (fsBtn) fsBtn.classList.add('active');
    // 全屏后重新计算缩放（容器尺寸变大）
    requestAnimationFrame(() => updateWebviewScale());
  } else {
    // 退出全屏：恢复布局
    document.body.classList.remove('fullscreen-preview');
    if (fsBtn) fsBtn.classList.remove('active');
    updateLayout();
    // 等待窗口尺寸恢复后重新计算缩放
    setTimeout(() => updateWebviewScale(), 250);
  }
}

/** 兼容旧调用 */
export function hideInAppPreview() {
  closeRightPanel();
}
