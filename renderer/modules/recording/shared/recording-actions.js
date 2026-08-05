/**
 * 录制共用动作：完成标记 / 结束保存 / 标记 UI 更新 / 选择模式切换
 */
import { appState } from '../../common/state.js';
import { api, sendAction } from '../../common/api.js';
import { updateStatus, showToast, showEnvConfigDialog } from '../../common/feedback.js';
import { switchView } from '../../common/layout.js';
import { openPreview } from '../../preview/preview.js';
import { captureWebviewData, enableWebviewSelectionMode, disableWebviewSelectionMode } from '../internal/webview-recording.js';
import { enableExternalSelection, disableExternalSelection } from '../external/external-recording.js';
import { collectIntroduction } from './recording-ui.js';

// ===== 完成标记 =====
export function doCompleteMark() {
  const mainTitleInput = document.getElementById('markMainTitleInput');
  const subTitleInput = document.getElementById('markSubTitleInput');
  const positionSelect = document.getElementById('markPositionSelect');
  const showNextCheckbox = document.getElementById('markShowNextStepInput');
  if (!mainTitleInput) return;

  const mainTitle = mainTitleInput.value.trim();
  if (!mainTitle) {
    showToast('请输入主标题', 'error');
    return;
  }

  const subTitle = subTitleInput ? subTitleInput.value.trim() : '';
  const position = positionSelect ? positionSelect.value : 'right';
  const showNextStep = showNextCheckbox ? showNextCheckbox.checked : true;

  sendAction('completeMark', {
    mainTitle,
    subTitle,
    elementId: appState.selectedElementData?.elementId || '',
    isInIframe: appState.selectedElementData?.isInIframe || false,
    iframeSrc: appState.selectedElementData?.iframeSrc || '',
    showNextStep,
    position,
    pageId: appState.browserMode === 'in-app' ? 'webview' : undefined, // ★ webview 模式使用固定 pageId
  });

  appState.hasSelectedElement = false;
  appState.selectedElementData = null;
  appState.isSelectingMode = false;
  mainTitleInput.value = '';
  if (subTitleInput) subTitleInput.value = '';
  updateMarkUI();
  updateStatus('标记成功！', 'var(--accent-green)');
}

// ===== 结束并保存流程 =====
export async function handleEndAndSave() {
  const mainTitleInput = document.getElementById('markMainTitleInput');
  if (appState.hasSelectedElement && mainTitleInput) {
    const mainTitle = mainTitleInput.value.trim();
    if (!mainTitle) {
      showToast('请先输入主标题再结束保存', 'error');
      return;
    }
    doCompleteMark();
  }

  // ★ 不再选择保存目录 — recorder.outputDir 已指向应用 userData/recordings

  // ★ 使用环境配置对话框
  const envConfig = await showEnvConfigDialog(appState.state.sceneCode || appState.state.sceneConfig.sceneName);

  const modNameInput = document.getElementById('modNameInput');
  const mainModNameInput = document.getElementById('mainModNameInput');
  const mainModDescInput = document.getElementById('mainModDescInput');
  const intro = collectIntroduction();

  updateStatus('正在处理和保存...', 'var(--accent-blue)');

  // ★ 应用内浏览器模式：先捕获 webview 页面数据
  let webviewData = null;
  if (appState.browserMode === 'in-app') {
    try {
      webviewData = await captureWebviewData();
    } catch (err) {
      console.warn('[panel] 捕获 webview 数据失败:', err.message);
    }
  }

  const result = await sendAction('endAndSave', {
    modName: modNameInput ? modNameInput.value.trim() : '',
    mainModName: mainModNameInput ? mainModNameInput.value.trim() : '',
    mainModDesc: mainModDescInput ? mainModDescInput.value.trim() : '',
    resourceBaseUrl: envConfig.envBaseUrl, // 向后兼容
    introduction: intro,
    environment: envConfig.environment,
    sceneCode: envConfig.sceneCode,
    envBaseUrl: envConfig.envBaseUrl,
    // ★ webview 模式数据 — 展开到顶层供 _nextStepWebview 使用
    pageId: appState.browserMode === 'in-app' ? 'webview' : undefined,
    ...(webviewData || {}),
    isWebviewMode: appState.browserMode === 'in-app',
  });

  if (result && result.type === 'error') {
    showToast('保存失败：' + (result.message || ''), 'error', 5000);
  } else if (result && result.type === 'saveComplete') {
    showToast('保存成功：' + result.fileCount + ' 个文件', 'success');
    // ★ 自动切换到管理视图并预览
    appState.currentView = 'management';
    switchView();
    const p = await api.previewExport();
    if (p && p.success) {
      // 获取录制文件列表用于步骤选择器
      const exportsResult = await api.getRecordedExports();
      if (exportsResult && exportsResult.success && exportsResult.exports.length > 0) {
        const latest = exportsResult.exports[0];
        await openPreview(p.filePath, latest.htmlFiles);
      } else {
        await openPreview(p.filePath);
      }
    }
  }
}

export function updateMarkUI() {
  const completeMarkBtn = document.getElementById('completeMarkBtn');
  const markBtn = document.getElementById('markBtn');
  const selectionHint = document.getElementById('selectionHint');

  if (completeMarkBtn) {
    completeMarkBtn.disabled = !appState.hasSelectedElement;
    completeMarkBtn.className = appState.hasSelectedElement ? 'btn btn-primary btn-sm' : 'btn btn-primary btn-sm btn-disabled';
  }
  if (markBtn) {
    if (appState.isSelectingMode) {
      markBtn.textContent = '取消选择';
      markBtn.className = 'btn btn-danger btn-sm';
    } else {
      markBtn.textContent = '选择元素';
      markBtn.className = 'btn btn-secondary btn-sm';
    }
  }
  if (selectionHint) {
    selectionHint.style.display = appState.isSelectingMode ? '' : 'none';
  }
}

/** ★ 切换元素选择模式（按浏览器模式分发到对内/对外） */
export async function toggleSelectionMode() {
  if (appState.isSelectingMode) {
    // 取消选择
    if (appState.browserMode === 'in-app') {
      await disableWebviewSelectionMode();
    } else {
      await disableExternalSelection();
    }
    appState.isSelectingMode = false;
    appState.hasSelectedElement = false;
    appState.selectedElementData = null;
  } else {
    appState.hasSelectedElement = false;
    appState.selectedElementData = null;
    appState.isSelectingMode = true;
    // ★ 根据浏览器模式调用不同的启用方法
    if (appState.browserMode === 'in-app') {
      await enableWebviewSelectionMode();
    } else {
      await enableExternalSelection();
    }
  }
  updateMarkUI();
}
