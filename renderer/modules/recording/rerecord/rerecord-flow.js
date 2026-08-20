/**
 * 重录该步骤 — 流程编排
 *
 * 流程：
 * 1. 用户在预览页点击 "🔄 重录该步骤" 按钮
 * 2. 弹出确认对话框
 * 3. 调用 IPC: rerecord-step 加载已保存场景并定位到目标步骤
 * 4. 切换到录制视图（自动从预览模式切换到录制模式）
 * 5. 提示用户：浏览器应已打开，引导跳转至目标 URL
 * 6. 用户录制 N 步后点 "保存"：
 *    - N=1 → 直接 "一步替换" 确认
 *    - N>1 → 弹出对话框询问 "覆盖" / "插入"
 * 7. 后端按选定模式修改 mainModules，重新编号 stepId 并修复 nextStep 链接
 */
import { appState } from '../../common/state.js';
import { api } from '../../common/api.js';
import { showToast, showConfirmDialog, showDialog } from '../../common/feedback.js';
import { updateStatus } from '../../common/feedback.js';
import { requestSwitchView } from '../../common/layout.js';
import { navigateInAppBrowser } from '../internal/webview-recording.js';
import { rerenderPanel } from '../../app.js'; // ★ 新增：用于重录流程同步刷新中间栏表单

/** 启动重录流程（由 step-selector 调用） */
export async function startReRecord({ dirName, filePath, fileIndex }) {
  if (!dirName || !filePath) {
    showToast('缺少场景信息', 'error');
    return;
  }

  // 1. 询问确认
  showConfirmDialog(
    '🔄 重录该步骤',
    '确定要重新录制该步骤吗？\n\n将加载该场景的所有数据并切换到录制模式。\n加载后请在浏览器中调整页面，点击"录制"开始替换。',
    async () => {
      await doStartReRecord({ dirName, filePath, fileIndex });
    },
    { confirmText: '开始重录', cancelText: '取消' }
  );
}

async function doStartReRecord({ dirName, filePath, fileIndex }) {
  try {
    // ★ 防御：若已处于重录/继续录制流程中，避免重复触发
    if (appState._continueRecordingMode) {
      showToast('重录流程进行中，请稍候', 'warning');
      return;
    }

    // 2. 提取 fileName（从 filePath 末尾）
    const fileName = (filePath || '').split(/[\\/]/).pop();

    updateStatus('正在加载场景数据...', 'var(--accent-blue)');

    // 3. ★ 在 await 之前同步设置继续录制模式标志
    //    后端 _startReRecord 会先 webContents.send('stateSync') 再返回 invoke 响应。
    //    stateSync 可能比 await 更早到达渲染层。提前设置标志可让 app.js 的 stateSync
    //    处理器识别"重录/继续录制流程"，自动切换到录制视图，避免与 renderManagementView
    //    竞态覆盖录制表单。
    appState._continueRecordingMode = true;

    // 4. 调用 IPC 启动重录（后端解析 fileName → stepId → 定位）
    const result = await api.rerecordStep({
      dirName,
      fileName,
      fileIndex,
    });

    if (!result || !result.success) {
      // ★ 失败时回滚标志
      appState._continueRecordingMode = false;
      showToast('启动重录失败：' + (result?.error || '未知错误'), 'error', 5000);
      updateStatus('重录启动失败', 'var(--accent-red)');
      return;
    }

    // 5. ★ 同步设置 currentView 为 recording
    //    即便 stateSync 早于本行执行并触发了视图切换（app.js stateSync 处理器会
    //    在 _continueRecordingMode 命中时设置 currentView），再次显式设置保证状态一致。
    //    这避免 requestSwitchView 因 view 相同而 no-op。
    if (appState.currentView !== 'recording') {
      appState.currentView = 'recording';
    }

    // 6. 关闭预览面板状态（保留 step selector 但重置 preview 标识）
    closePreviewState();

    // 7. 切换到录制视图
    //    requestSwitchView 在 view 相同时直接返回；如已通过 stateSync 切到 recording，
    //    这里仅做菜单高亮等 UI 同步。为保险起见，强制触发一次 rerenderPanel 以确保表单渲染。
    requestSwitchView('recording');
    // ★ 兜底：若 stateSync 已触发视图切换但表单未及时渲染，再强制刷一次
    rerenderPanel();

    // 8. 提示用户：场景已加载
    const targetUrl = result.info?.targetStepUrl || '';
    const targetStepTitle = result.info?.targetStepTitle || '';
    const targetModuleTitle = result.info?.targetModuleTitle || '';
    const targetSubStepTitle = result.info?.targetSubStepTitle || '';
    showRerecordReadyToast(targetUrl, targetStepTitle, targetModuleTitle, targetSubStepTitle);
    updateStatus(
      `重录模式: 模块「${targetModuleTitle || '(未命名)'}」步骤「${targetStepTitle || '(未命名)'}」— 请在浏览器中调整页面后开始录制`,
      'var(--accent-blue)'
    );
  } catch (err) {
    // ★ 异常时也回滚标志
    appState._continueRecordingMode = false;
    console.error('[rerecord] 启动重录失败:', err);
    showToast('启动重录失败：' + err.message, 'error', 5000);
  }
}

/** 关闭预览状态 */
function closePreviewState() {
  appState.currentPreviewDirName = null;
  appState.currentPreviewFiles = [];
  appState.currentPreviewStepIndex = 0;
  // 不移除 step-selector（重录完成后用户可能想跳回预览）
}

/** 在右栏底部弹出"重录就绪"提示，并引导用户跳转到目标 URL */
function showRerecordReadyToast(targetUrl, targetStepTitle, targetModuleTitle, targetSubStepTitle) {
  const desc =
    `场景已加载到录制模式。\n` +
    `目标步骤: 模块「${targetModuleTitle || '(未命名)'}」/` +
    `主步骤「${targetSubStepTitle || '(未命名)'}」/` +
    `步骤「${targetStepTitle || '(未命名)'}」\n` +
    (targetUrl ? `目标 URL: ${targetUrl}\n` : '') +
    `\n请确认浏览器已打开并跳转到该 URL，然后开始录制。`;

  showDialog({
    title: '🔄 重录模式就绪',
    desc,
    width: '420px',
    buttons: [
      {
        text: targetUrl ? '🚀 自动跳转' : '好的',
        className: 'dialog-confirm-btn blue',
        onClick: () => {
          if (targetUrl) autoNavigateBrowser(targetUrl);
        },
      },
    ],
  });
}

/** 自动导航到目标 URL（应用内 webview 模式） */
async function autoNavigateBrowser(url) {
  try {
    // 应用内浏览器模式：webview 始终可用，直接导航
    await navigateInAppBrowser(url);
    showToast('已导航到目标页面，请开始录制', 'success', 3000);
  } catch (err) {
    console.warn('[rerecord] 自动导航失败:', err.message);
  }
}

/**
 * ★ 保存时的二次确认（由 recording-actions.js 中的 handleEndAndSave 调用）
 * - N == 0：直接保存（相当于取消重录）
 * - N == 1：单步替换（直接确认 "该步骤变更"）
 * - N > 1：弹出 覆盖 / 插入 选项
 * @returns {Promise<{proceed: boolean, saveMode?: string}>}
 */
export async function confirmAndSaveReRecord() {
  const newCount = (appState.state.reRecord && appState.state.reRecord.newStepCount) || 0;
  if (newCount === 0) {
    return { proceed: false, reason: 'no-new-steps' };
  }

  if (newCount === 1) {
    return new Promise((resolve) => {
      showConfirmDialog(
        '确认重录',
        `已录制 ${newCount} 步新内容。\n点击"替换"将用新内容替换原目标步骤（后续步骤保留）。\n点击"取消"将放弃重录。`,
        () => resolve({ proceed: true, saveMode: 'replace-single' }),
        { confirmText: '替换该步骤', cancelText: '取消', danger: false }
      );
    });
  }

  // 多步：覆盖 或 插入
  return new Promise((resolve) => {
    showDialog({
      title: '确认重录',
      desc: `已录制 ${newCount} 步新内容。\n请选择保存方式：\n\n• 覆盖：从原目标步骤起，用新内容替换原步骤\n• 插入：在原目标步骤之后插入新内容，原步骤保留\n• 取消：放弃重录`,
      width: '420px',
      buttons: [
        {
          text: '🔁 覆盖（原步骤替换）',
          className: 'dialog-confirm-btn',
          onClick: () => resolve({ proceed: true, saveMode: 'replace' }),
        },
        {
          text: '➕ 插入（追加新步骤）',
          className: 'dialog-confirm-btn blue',
          onClick: () => resolve({ proceed: true, saveMode: 'insert' }),
        },
        {
          text: '取消',
          className: 'dialog-cancel-btn',
          onClick: () => resolve({ proceed: false }),
        },
      ],
    });
  });
}
