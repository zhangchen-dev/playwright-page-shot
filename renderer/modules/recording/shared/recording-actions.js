/**
 * 录制共用动作：完成标记 / 结束保存 / 标记 UI 更新 / 选择模式切换
 */
import { appState } from '../../common/state.js';
import { api, sendAction } from '../../common/api.js';
import { updateStatus, showToast, showEnvConfigDialog, showConfirmDialog } from '../../common/feedback.js';
import { captureWebviewData, enableWebviewSelectionMode, disableWebviewSelectionMode } from '../internal/webview-recording.js';
import { enableExternalSelection, disableExternalSelection } from '../external/external-recording.js';
import { collectIntroduction } from './recording-ui.js';
import { confirmAndSaveReRecord } from '../rerecord/rerecord-flow.js';

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
  // ★ 从 appState 读取用户最新设置（录制面板已持久化，跨步骤/重渲染保留，期间用户改动即生效）
  const position = appState.markPosition || 'right';
  const showNextStep = appState.markShowNext !== false;

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

  // ★ 重录模式：在保存前弹出"覆盖/插入"选择对话框
  const inReRecord = !!(appState.state.reRecord && appState.state.reRecord.active);
  if (inReRecord) {
    const decision = await confirmAndSaveReRecord();
    if (!decision.proceed) {
      // 用户取消
      showToast('已取消保存', 'info', 2000);
      return;
    }
    // 将 saveMode 暂存到 appState，sendAction 不会用到（后端用 msg.reRecordSaveMode）
    appState._reRecordSaveMode = decision.saveMode;
  }

  // ★ 使用环境配置对话框
  //   - defaultSceneCode 优先使用 state.sceneCode（正常录制已由后端生成 sen_code_ 场景码）
  //   - 兜底使用 sceneTitle / sceneName（来自继续录制的 sceneConfig，二者已合并）
  //   - 再兜底使用 sen_code_ + 6 位随机（与后端 _genRandomSuffix 同规则，避免空字符串卡死）
  const genFallbackSceneCode = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return 'sen_code_' + s;
  };
  const cfg = appState.state.sceneConfig || {};
  const fallbackCode = appState.state.sceneCode
    || cfg.sceneTitle
    || cfg.sceneName
    || genFallbackSceneCode();
  const envConfig = await showEnvConfigDialog(fallbackCode);

  // ★ 关键修复：用户取消（按 Esc / 点取消按钮 / 点遮罩）→ 直接退出保存流程
  //   防止 await showEnvConfigDialog 解析为 null 后下面的 sendAction 误用空字段
  if (!envConfig) {
    showToast('已取消保存', 'info', 2000);
    updateStatus('', '');
    return;
  }

  // ★ P0 防御：未打开浏览器时给出明确提示，避免后续 captureWebviewData 挂起
  if (!appState.browserLaunched) {
    showToast('提示：浏览器未打开，将使用已加载数据保存', 'info', 3000);
  }

  const modNameInput = document.getElementById('modNameInput');
  const mainModNameInput = document.getElementById('mainModNameInput');
  const mainModDescInput = document.getElementById('mainModDescInput');
  const intro = collectIntroduction();

  updateStatus('正在处理和保存...', 'var(--accent-blue)');

  // ★ 应用内浏览器模式：先捕获 webview 页面数据
  //    增加 browserLaunched 守卫：未启动浏览器时跳过，避免在 about:blank 上 executeJavaScript 挂起
  let webviewData = null;
  if (appState.browserLaunched && appState.browserMode === 'in-app') {
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
    // ★ 重录模式：传递保存模式（'replace' / 'insert' / 'replace-single'）
    reRecordSaveMode: inReRecord ? (appState._reRecordSaveMode || 'replace') : undefined,
  });
  // 清理临时状态
  appState._reRecordSaveMode = null;

  if (result && result.type === 'error') {
    showToast('保存失败：' + (result.message || ''), 'error', 5000);
  } else if (result && result.type === 'saveComplete') {
    showToast('保存成功：' + result.fileCount + ' 个文件', 'success');
    // ★ 留在录制页面，询问是否关闭浏览器（登录功能未完善，默认保持打开）
    showConfirmDialog(
      '录制已完成',
      '是否关闭浏览器？',
      async () => {
        // 确认 → 关闭浏览器（onBrowserClosed 会触发右栏 Banner）
        await api.closeBrowser();
      },
      {
        confirmText: '关闭浏览器',
        cancelText: '保持打开',
        onCancel: () => {
          // 保持打开：浏览器内容继续显示，可继续浏览或输入新地址
          updateStatus('浏览器保持打开，可继续浏览或输入新地址', 'var(--text-secondary)');
        },
      }
    );
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
