/** 三栏布局视图管理：窗口置顶 / 布局计算 / 视图切换 / 菜单事件 */
import { appState, CONSTANTS } from './state.js';
import { api } from './api.js';
import { toggleFullscreenPreview, closeRightPanel } from '../preview/preview.js';
import { rerenderPanel } from '../app.js';
import { renderManagementView } from '../management/management-view.js';
import { renderSettingsView } from '../settings/settings-view.js';
import { renderDemoView } from '../demo/demo-view.js';
import { showBanner, hideBanner } from './banner.js';
import { showConfirmDialog } from './feedback.js';
import { updateWebviewScale } from './webview-controls.js';
import { applyMobileToAllTabs, reloadAllTabs } from './tabs.js';

// ★ 根据录制模式 + 浏览器状态 + 浏览器模式，条件控制窗口置顶
export function updateAlwaysOnTop() {
  const shouldOnTop = (appState.currentView === 'recording') && appState.browserLaunched && (appState.browserMode === 'external');
  if (shouldOnTop !== appState.isAlwaysOnTop) {
    appState.isAlwaysOnTop = shouldOnTop;
    api.setAlwaysOnTop(shouldOnTop);
  }
}

/** 计算当前布局总宽度 */
export function computeLayoutWidth() {
  let w = CONSTANTS.SIDEBAR_W;
  if (!appState.middleCollapsed) w += CONSTANTS.MIDDLE_W;
  w += CONSTANTS.DIVIDER_W; // 分界线始终存在
  if (appState.rightColumnOpen) {
    w += (appState.rightPanelMode === 'preview') ? CONSTANTS.RIGHT_PREVIEW_W : CONSTANTS.RIGHT_STEP_W;
  }
  return w;
}

/** 更新布局（切换 CSS 类 + 调整窗口） */
export function updateLayout() {
  const right = document.getElementById('rightColumn');
  const middle = document.getElementById('mainColumn');
  if (!right || !middle) return;

  right.classList.toggle('collapsed', !appState.rightColumnOpen);
  right.classList.toggle('preview-mode', appState.rightColumnOpen && appState.rightPanelMode === 'preview');
  middle.classList.toggle('collapsed', appState.middleCollapsed);

  // 更新右栏标题
  const rightTitle = document.getElementById('rightTitle');
  if (rightTitle) {
    rightTitle.textContent = appState.rightPanelMode === 'preview' ? '页面预览' : '录制记录';
  }

  // 调整窗口尺寸（最大化时由 IPC 守卫跳过）
  api.resizeWindow(computeLayoutWidth());
}

/** 切换视图（录制 / 管理 / 设置） */
export function switchView() {
  // ★ 防御：清理残留 dialog overlay（防止异常残留阻挡 UI）
  document.querySelectorAll('.dialog-overlay').forEach((o) => o.remove());

  // ★ 退出全屏（如果在全屏中）
  if (document.body.classList.contains('fullscreen-preview')) {
    toggleFullscreenPreview(false);
  }

  // 更新菜单高亮
  document.querySelectorAll('.menu-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === appState.currentView);
  });

  // ★ 不再重置右栏/中间列状态，保持窗口尺寸稳定（切换菜单不缩放）
  // 右栏内容由 updateRightPanelState 按优先级决定：当前预览 > 空闲Banner

  // 显隐 URL 栏
  const urlBar = document.getElementById('urlBar');
  if (urlBar) {
    urlBar.style.display = (appState.currentView === 'recording') ? '' : 'none';
  }

  // ★ 浏览器模式切换行仅在录制视图显示
  const browserModeRow = document.getElementById('browserModeRow');
  if (browserModeRow) {
    browserModeRow.style.display = (appState.currentView === 'recording') ? '' : 'none';
  }

  // 更新中间列标题
  const middleTitle = document.getElementById('middleTitle');
  if (middleTitle) {
    const titles = { recording: '页面录制', management: '场景管理', demo: '定制演示', settings: '设置' };
    middleTitle.textContent = titles[appState.currentView] || '页面录制';
  }

  // 渲染对应视图
  if (appState.currentView === 'recording') {
    rerenderPanel();
  } else if (appState.currentView === 'management') {
    renderManagementView();
  } else if (appState.currentView === 'demo') {
    renderDemoView();
  } else if (appState.currentView === 'settings') {
    renderSettingsView();
  }

  // ★ 更新右栏内容（保持打开，避免切换菜单时窗口缩放）
  updateRightPanelState({ preserveClosed: true });
  updateAlwaysOnTop(); // ★ 切换视图时更新窗口置顶状态

  // ★ 预览视图强制 PC：场景管理/定制演示/设置 等预览场景一律以 PC 展示，
  //   覆盖录制视图的移动端开关；切回录制视图后恢复录制移动端状态（isMobileMode 原样保留）。
  const willForcePC = (appState.currentView !== 'recording');
  if (appState.forcePCMode !== willForcePC) {
    appState.forcePCMode = willForcePC;
    const _pcContainer2 = document.getElementById('previewContainer');
    if (willForcePC) {
      // 切到非录制视图：强制 PC
      appState.currentResolution = '1920';
      applyMobileToAllTabs(false);
      if (_pcContainer2) _pcContainer2.classList.remove('mobile-frame-active');
    } else if (appState.isMobileMode) {
      // 切回录制视图且移动端开着：恢复移动端模拟
      appState.currentResolution = 'mobile';
      applyMobileToAllTabs(true);
      if (_pcContainer2) _pcContainer2.classList.add('mobile-frame-active');
    } else {
      // 切回录制视图且 PC：确保 PC UA（处理预览残留的双保险）
      applyMobileToAllTabs(false);
    }
    updateWebviewScale();
    // 重载所有 tab，让新的 UA / 视口在首屏生效
    try { reloadAllTabs(); } catch (e) {}
  }
}

/** ★ 设置右栏标题 */
function setRightTitle(text) {
  const el = document.getElementById('rightTitle');
  if (el) el.textContent = text;
}

/** ★ 恢复 webview 显示（多 tab：整体恢复 #tabPages） */
function restoreWebview() {
  const pages = document.getElementById('tabPages');
  if (pages) pages.style.display = '';
  const w = document.getElementById('webviewScrollWrapper');
  if (w) w.style.display = '';
  import('./tabs.js').then((m) => m.refreshTabBar()).catch(() => {});
}

/**
 * ★ 右栏状态统一更新（保持窗口尺寸稳定，不因切换菜单而缩放）
 * 优先级：录制中浏览器 > 当前预览 > 空闲Banner
 * @param {object} opts.preserveClosed - 切换菜单时保持右栏关闭状态（不强制展开）
 */
/** ★ 移动端开关仅在「录制视图（应用内浏览器）」显示；场景管理/定制演示等预览场景不需要该开关 */
export function updateMobileControlVisibility() {
  const mobileControl = document.getElementById('mobileModeControl');
  if (!mobileControl) return;
  mobileControl.style.display = (appState.currentView === 'recording') ? '' : 'none';
}

export function updateRightPanelState(opts) {
  opts = opts || {};
  const toolbarActions = document.getElementById('rightToolbarActions');
  // ★ 移动端开关仅在录制视图显示（场景管理预览等不需要）
  updateMobileControlVisibility();

  // 切换菜单时若用户已收起右栏，保持收起（避免缩放）；其他场景强制展开
  if (!appState.rightColumnOpen && opts.preserveClosed) {
    hideBanner();
    updateLayout();
    return;
  }

  // 确保右栏打开
  appState.rightColumnOpen = true;

  // 1. 录制视图 + 浏览器已打开 → webview（应用内）/ 步骤树（外层）
  if (appState.currentView === 'recording' && appState.browserLaunched) {
    hideBanner();
    if (appState.browserMode === 'in-app') {
      appState.rightPanelMode = 'preview';
      if (toolbarActions) toolbarActions.style.display = '';
      restoreWebview();
      updateLayout();
      setRightTitle('应用内浏览器');
    } else {
      appState.rightPanelMode = 'steps';
      if (toolbarActions) toolbarActions.style.display = 'none';
      updateLayout();
      rerenderPanel();
    }
    return;
  }

  // 2. 有当前预览 → 保持预览
  if (appState.currentPreviewDirName) {
    hideBanner();
    appState.rightPanelMode = 'preview';
    restoreWebview();
    if (toolbarActions) toolbarActions.style.display = '';
    updateLayout();
    setRightTitle('页面预览');
    return;
  }

  // 3. 空闲 → Banner
  showRecordingBanner();
}

/** ★ 显示 Banner（无预览/未录制时在右栏展示说明海报） */
export function showRecordingBanner() {
  appState.rightColumnOpen = true;
  appState.rightPanelMode = 'preview';
  updateLayout();
  setRightTitle('使用说明');
  showBanner();
}

/**
 * ★ 判断录制是否处于"未完成"状态
 * - 配置阶段：未开始
 * - 录制阶段：已开始但还没结束保存（保留浏览器会话）
 * @returns {boolean}
 */
export function isRecordingUnsaved() {
  return appState.state.phase === 'recording';
}

/**
 * ★ 切换菜单的统一入口（带录制未完成提示）
 * @param {string} view 目标视图
 */
export function requestSwitchView(view) {
  if (!view) return;
  // ★ 防御：清理可能残留的 dialog overlay（防止异常残留阻挡 UI）
  document.querySelectorAll('.dialog-overlay').forEach((o) => o.remove());
  if (view === appState.currentView) return;

  // ★ 如果当前在录制中（未保存），切换菜单时提醒
  //    但在继续录制模式下跳过该对话框（用户来自管理视图，已确认要继续）
  if (appState.currentView === 'recording' && isRecordingUnsaved() && !appState._continueRecordingMode) {
    showConfirmDialog(
      '录制未完成',
      '当前录制尚未保存。\n切换菜单后浏览器会话会保留，您可以随时切回继续录制。\n\n确定要切换菜单吗？',
      () => doSwitchView(view),
      {
        confirmText: '确定切换',
        cancelText: '留在录制',
        danger: false,
      }
    );
    return;
  }
  doSwitchView(view);
}

function doSwitchView(view) {
  appState.currentView = view;
  switchView();
}

/** ★ 菜单 + 按钮事件初始化 */
export function initLayoutEvents() {
  // 菜单项点击
  document.querySelectorAll('.menu-item').forEach((item) => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      if (view) requestSwitchView(view);
    });
  });

  // ★ 分界线按钮 — 只控制中间列展开/收起
  const dividerBtn = document.getElementById('dividerToggleBtn');
  if (dividerBtn) {
    dividerBtn.addEventListener('click', () => {
      appState.middleCollapsed = !appState.middleCollapsed;
      updateLayout();
    });
  }

  // 关闭右栏按钮
  const closeBtn = document.getElementById('closeRightBtn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => closeRightPanel());
  }
}
