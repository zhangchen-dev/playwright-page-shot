/**
 * 三栏布局视图管理：窗口置顶 / 布局计算 / 视图切换 / 菜单事件
 */
import { appState, CONSTANTS } from './state.js';
import { api } from './api.js';
import { toggleFullscreenPreview, closeRightPanel } from '../preview/preview.js';
import { rerenderPanel } from '../app.js';
import { renderManagementView } from '../management/management-view.js';
import { renderSettingsView } from '../settings/settings-view.js';

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
  // ★ 退出全屏（如果在全屏中）
  if (document.body.classList.contains('fullscreen-preview')) {
    toggleFullscreenPreview(false);
  }

  // 更新菜单高亮
  document.querySelectorAll('.menu-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === appState.currentView);
  });

  // 重置右栏状态
  appState.rightColumnOpen = false;
  appState.middleCollapsed = false;
  appState.rightPanelMode = 'steps';

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
    const titles = { recording: '页面录制', management: '后台管理', settings: '设置' };
    middleTitle.textContent = titles[appState.currentView] || '页面录制';
  }

  // 渲染对应视图
  if (appState.currentView === 'recording') {
    rerenderPanel();
  } else if (appState.currentView === 'management') {
    renderManagementView();
  } else if (appState.currentView === 'settings') {
    renderSettingsView();
  }

  updateLayout();
  updateAlwaysOnTop(); // ★ 切换视图时更新窗口置顶状态
}

/** ★ 菜单 + 按钮事件初始化 */
export function initLayoutEvents() {
  // 菜单项点击
  document.querySelectorAll('.menu-item').forEach((item) => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      if (view && view !== appState.currentView) {
        appState.currentView = view;
        switchView();
      }
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
