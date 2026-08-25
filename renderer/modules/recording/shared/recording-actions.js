/**
 * 录制共用动作：完成标记 / 结束保存 / 标记 UI 更新 / 选择模式切换
 */
import { appState } from '../../common/state.js';
import { api, sendAction } from '../../common/api.js';
import { updateStatus, showToast } from '../../common/feedback.js';
import { showLoadingOverlay, hideLoadingOverlay } from '../../common/dom.js';
import { captureWebviewData, enableWebviewSelectionMode, disableWebviewSelectionMode } from '../internal/webview-recording.js';
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
    pageId: 'webview', // ★ webview 模式使用固定 pageId
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
  // ★ 兼容：若「选择即标记」的异步链路尚未落库（hasSelectedElement 已被自动标记清空但 _pendingMark 仍在），
  //   用 _pendingMark 兜底恢复选择并补提交，确保末步指引不丢。
  if (appState.hasSelectedElement && !appState._pendingMark) {
    appState._pendingMark = appState.selectedElementData
      ? { elementId: appState.selectedElementData.elementId, isInIframe: appState.selectedElementData.isInIframe, iframeSrc: appState.selectedElementData.iframeSrc, text: appState.selectedElementData.text }
      : null;
  }
  if (appState.hasSelectedElement || appState._pendingMark) {
    if (appState._pendingMark && !appState.hasSelectedElement) {
      appState.selectedElementData = appState._pendingMark;
      if (mainTitleInput && !mainTitleInput.value) mainTitleInput.value = appState._pendingMark.text || '';
    }
    const mainTitle = mainTitleInput ? mainTitleInput.value.trim() : '';
    if (!mainTitle) {
      showToast('请先输入主标题再结束保存', 'error');
      return;
    }
    doCompleteMark();
  }
  appState._pendingMark = null;

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

  // ★ 环境配置：默认使用「生产环境 (prd)」，不再弹出选择框。
  //   - sceneCode 优先使用 state.sceneCode（正常录制已由后端生成 sen_code_ 场景码）
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
  // ★ 默认生产环境，无需用户选择（dev/prd 的 envBaseUrl 实测为同一地址，见 feedback.js ENV_URLS）
  const envConfig = {
    environment: 'prd',
    sceneCode: fallbackCode,
    envBaseUrl: 'https://xft-service-marketing.paas.cmbchina.cn/resource/file/demonstration/',
  };

  // ★ P0 防御：未打开浏览器时给出明确提示，避免后续 captureWebviewData 挂起
  if (!appState.browserLaunched) {
    showToast('提示：浏览器未打开，将使用已加载数据保存', 'info', 3000);
  }

  const modNameInput = document.getElementById('modNameInput');
  const mainModNameInput = document.getElementById('mainModNameInput');
  const mainModDescInput = document.getElementById('mainModDescInput');
  const intro = collectIntroduction();

  updateStatus('正在处理和保存...', 'var(--accent-blue)');
  // ★ 保存中：显示全局 loading 遮罩，阻止用户操作，直到保存完成
  //    （isProcessing 交由 onCaptureProgress/onStateSync 管理，这里只显式控制遮罩）
  showLoadingOverlay();

  let webviewData = null;
  let result = null;
  try {
    // ★ 应用内浏览器模式：先捕获 webview 页面数据
    //    增加 browserLaunched 守卫：未启动浏览器时跳过，避免在 about:blank 上 executeJavaScript 挂起
    if (appState.browserLaunched && appState.browserMode === 'in-app') {
      try {
        webviewData = await captureWebviewData();
        if (webviewData && webviewData.bodyEmpty) {
          showToast('末步页面内容可能为空，正在尝试保存其余步骤…', 'info', 4000);
        }
      } catch (err) {
        console.warn('[panel] 捕获 webview 数据失败:', err.message);
      }
    }

    // ★ 移动端录制标记：以 checkbox DOM 真实状态为权威（UI 显示啥就存啥），appState 兜底。
    //   防止 appState 因视图切换 / 异步渲染等出现短暂不同步时，"用户开了📱移动端却被存成 PC"。
    //   只要开关实际是 ON（或 appState 已为 true）→ 一律按移动端录制，绝不丢失。
    //   （注意：const 声明必须在对象字面量外侧，对象里只能放键值对/展开，不能放语句）
    const _mobileSwitchCb = document.getElementById('mobileModeSwitch');
    const _mobileSwitchChecked = !!(appState.isMobileMode || (_mobileSwitchCb && _mobileSwitchCb.checked));

    result = await sendAction('endAndSave', {
      modName: modNameInput ? modNameInput.value.trim() : '',
      mainModName: mainModNameInput ? mainModNameInput.value.trim() : '',
      mainModDesc: mainModDescInput ? mainModDescInput.value.trim() : '',
      resourceBaseUrl: envConfig.envBaseUrl, // 向后兼容
      introduction: intro,
      environment: envConfig.environment,
      sceneCode: envConfig.sceneCode,
      envBaseUrl: envConfig.envBaseUrl,
      // ★ webview 模式数据 — 展开到顶层供 _nextStepWebview 使用
      pageId: 'webview',
      ...(webviewData || {}),
      isWebviewMode: true,
      // ★ 重录模式：传递保存模式（'replace' / 'insert' / 'replace-single'）
      reRecordSaveMode: inReRecord ? (appState._reRecordSaveMode || 'replace') : undefined,
      // ★ 移动端录制标记：透传给 recorder，供导出 selector.isMobileGuide 使用（值在对象外侧已计算）
      isMobile: _mobileSwitchChecked,
    });
  } finally {
    // ★ 结束保存：隐藏 loading 遮罩，恢复交互
    hideLoadingOverlay();
  }
  // 清理临时状态
  appState._reRecordSaveMode = null;

  if (result && result.type === 'error') {
    showToast('保存失败：' + (result.message || ''), 'error', 5000);
  } else if (result && result.type === 'saveComplete') {
    let status = '🎉 录制完成！已保存 ' + result.fileCount + ' 个文件，可前往「场景管理」预览';
    if (result.skippedEmptyLastStep) {
      status += '（末步内容为空已跳过，可在场景管理重录该步）';
    }
    updateStatus(status, 'var(--accent-green)');
    // ★ 优化：结束录制不再弹出「是否关闭浏览器/弹窗」选择框，默认不关闭浏览器，
    //   仅以 message 信息提醒用户录制完成（浏览器保持打开，可继续浏览或输入新地址继续录制）。
    showToast('录制完成，已保存 ' + result.fileCount + ' 个文件' + (result.skippedEmptyLastStep ? '（末步为空已跳过）' : ''), 'success', 4000);
  }
}

export function updateMarkUI() {
  const markBtn = document.getElementById('markBtn');
  const selectionHint = document.getElementById('selectionHint');
  const nextStepBtn = document.getElementById('nextStepBtn');

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
  // ★ 选中元素或已存在标记时即时启用「下一步」，避免依赖异步 stateSync 才解锁按钮
  if (nextStepBtn) {
    const canNext = !!(appState.hasSelectedElement || (appState.state.markedElements && appState.state.markedElements.length > 0));
    nextStepBtn.disabled = !canNext;
    nextStepBtn.className = canNext ? 'btn btn-primary btn-sm' : 'btn btn-primary btn-sm btn-disabled';
  }
}

/** ★ 切换元素选择模式（应用内 webview 模式，由注入脚本完成选择） */
export async function toggleSelectionMode() {
  if (appState.isSelectingMode) {
    // 取消选择
    await disableWebviewSelectionMode();
    appState.isSelectingMode = false;
    appState.hasSelectedElement = false;
    appState.selectedElementData = null;
  } else {
    appState.hasSelectedElement = false;
    appState.selectedElementData = null;
    appState.isSelectingMode = true;
    await enableWebviewSelectionMode();
  }
}
