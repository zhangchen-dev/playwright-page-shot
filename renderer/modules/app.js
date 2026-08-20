/**
 * 渲染层入口 — 运行在 Electron BrowserWindow 渲染进程中
 * 职责：事件监听 + rerenderPanel + 初始化
 * 顶层汇聚点：导入全部所需模块，是唯一在顶层执行函数调用的模块。
 */
import { api } from './common/api.js';
import { appState } from './common/state.js';
import { contentEl, urlInput, navigateBtn, showLoadingOverlay, hideLoadingOverlay } from './common/dom.js';
import { updateStatus, showToast } from './common/feedback.js';
import { saveInputValues, restoreInputValues } from './common/input-preserve.js';
import { initLayoutEvents, updateAlwaysOnTop, updateRightPanelState } from './common/layout.js';
import { initBrowserModeControls } from './common/webview-controls.js';
import { navigateToUrl } from './recording/shared/navigation.js';
import { renderConfigPhase, renderRecordingPhase, renderRightSteps } from './recording/shared/recording-ui.js';
import { updateMarkUI, handleEndAndSave } from './recording/shared/recording-actions.js';
import { showSavePasswordDialog } from './recording/shared/credentials-ui.js';
import { renderManagementView } from './management/management-view.js';

// ===== 事件监听 =====
api.onStateSync((newState) => {
  // ★ 当录制状态变为 config（已保存/已清空）时，清除继续录制模式标志
  if (newState.phase === 'config' && appState._continueRecordingMode) {
    appState._continueRecordingMode = false;
  }
  const wasProcessing = appState.isProcessing;
  appState.state = newState;
  if (urlInput && !urlInput.matches(':focus')) {
    urlInput.value = appState.state.activePageUrl || '';
  }
  if (wasProcessing) {
    appState.isProcessing = false;
    hideLoadingOverlay();
  }

  // ★ 继续录制/重录流程：stateSync 携带的 phase 已经是 'recording'，但 currentView 仍可能是 'management'/'settings'/'demo'。
  //    此时应自动同步切换到录制视图，避免与 renderManagementView 竞态覆盖录制表单。
  if (appState._continueRecordingMode && newState.phase === 'recording' && appState.currentView !== 'recording') {
    appState.currentView = 'recording';
    // 同步菜单高亮
    document.querySelectorAll('.menu-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.view === 'recording');
    });
    // URL 栏/浏览器模式行显隐
    const urlBar = document.getElementById('urlBar');
    if (urlBar) urlBar.style.display = '';
    const browserModeRow = document.getElementById('browserModeRow');
    if (browserModeRow) browserModeRow.style.display = '';
    // 中间列标题
    const middleTitle = document.getElementById('middleTitle');
    if (middleTitle) middleTitle.textContent = '页面录制';
    // 触发录制表单渲染
    rerenderPanel();
    return;
  }

  // ★ 管理视图下不重渲染录制面板（除非有场景卡片需要刷新）
  if (appState.currentView !== 'recording') {
    if (document.querySelector('.scenario-card')) renderManagementView();
    return;
  }
  rerenderPanel();
});

api.onElementSelected((data) => {
  appState.hasSelectedElement = true;
  appState.selectedElementData = data;
  appState.isSelectingMode = false;
  // ★ 应用内模式：元素选择由 webview 注入脚本自行关闭（disableWebviewSelectionMode）
  //    onSelectionCancelled 事件已在 webview 侧触发，无需再调用外部 disableSelectionMode
  // ★ 自动填充主标题（如果为空）
  const mtInput = document.getElementById('markMainTitleInput');
  if (mtInput && !mtInput.value && data.text) mtInput.value = data.text;
  updateMarkUI();
  updateStatus('已选择元素（' + (data.tagName || '') + '），请填写信息后标记', 'var(--accent-green)');
});

api.onSelectionCancelled(() => {
  appState.hasSelectedElement = false;
  appState.selectedElementData = null;
  appState.isSelectingMode = false;
  // ★ 应用内模式：选择取消由 webview 注入脚本处理，无需调用外部 disableSelectionMode
  updateMarkUI();
  updateStatus('', '');
});

api.onCaptureProgress((msg) => {
  appState.isProcessing = true;
  updateStatus(msg.message || '处理中...', 'var(--accent-blue)');
  showLoadingOverlay();
});

api.onError((data) => {
  const msg = data.message || '未知错误';
  updateStatus('错误: ' + msg, 'var(--accent-red)');
  showToast('错误：' + msg, 'error', 5000);
});

api.onSaveComplete((data) => {
  updateStatus('保存成功！' + (data.fileCount || '') + ' 个文件已保存到: ' + (data.outputDir || ''), 'var(--accent-green)');
});

// ★ 登录表单检测 — 页面中出现登录表单时触发
api.onLoginFormDetected((data) => {
  appState.loginFormDomain = data.domain;
  // 加载该域名的已保存凭证
  api.getCredentials(data.domain).then((creds) => {
    appState.savedCredentials = creds || [];
    rerenderPanel();
  });
});

// ★ 登录提交捕获 — 用户提交登录表单时弹出"保存密码"对话框
api.onLoginSubmit((data) => {
  showSavePasswordDialog(data.domain, data.username, data.password);
});

// ★ 浏览器关闭 — 重置浏览器状态并更新窗口置顶
api.onBrowserClosed(() => {
  appState.browserLaunched = false;
  appState.loginFormDomain = null;
  appState.savedCredentials = [];
  updateAlwaysOnTop();
  updateStatus('浏览器已关闭', 'var(--text-secondary)');
  if (appState.currentView === 'recording') {
    rerenderPanel();
    // ★ 浏览器关闭后右栏展示 Banner（空闲态）
    updateRightPanelState();
  }
});

// ===== URL 导航 =====
if (urlInput) {
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); navigateToUrl(); }
  });
}
if (navigateBtn) {
  navigateBtn.addEventListener('click', () => navigateToUrl());
}

// ===== 渲染面板 =====
export function rerenderPanel() {
  if (!contentEl) return;

  if (appState.clearFormOnNextRender) {
    appState.savedInputValues = {};
    appState.focusedInputId = null;
    appState.cursorPos = null;
    appState.clearFormOnNextRender = false;
  } else {
    saveInputValues();
  }

  if (appState.state.phase === 'config') {
    renderConfigPhase();
  } else if (appState.state.phase === 'recording') {
    renderRecordingPhase();
  }

  restoreInputValues();

  // ★ 右栏步骤树同步渲染（录制视图 + 右栏展开 + 步骤模式）
  if (appState.currentView === 'recording' && appState.rightColumnOpen && appState.rightPanelMode === 'steps') {
    renderRightSteps();
  }
}

// ===== 全局快捷键 =====
document.addEventListener('keydown', (e) => {
  if (e.altKey) {
    if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      if (appState.state.phase === 'recording' && appState.state.isRecording) {
        const markBtn = document.getElementById('markBtn');
        if (markBtn) markBtn.click();
      }
    } else if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      if (appState.state.phase === 'recording' && appState.state.isRecording) {
        const nextStepBtn = document.getElementById('nextStepBtn');
        if (nextStepBtn && !nextStepBtn.disabled) nextStepBtn.click();
      }
    } else if (e.key === 'q' || e.key === 'Q') {
      e.preventDefault();
      if (appState.state.phase === 'recording' && appState.state.isRecording) {
        handleEndAndSave();
      }
    }
  }
});

// ===== 初始化 =====
initLayoutEvents();
initBrowserModeControls();

// ★ 调试用：将 appState 暴露到 window（CDP 验证脚本需要访问）
window.appState = appState;

// ===== 初始渲染 =====
rerenderPanel();
// ★ 启动时录制视图空闲态：右栏展示 Banner
updateRightPanelState();
