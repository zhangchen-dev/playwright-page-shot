/**
 * 后台管理视图：已录制场景列表 + 场景卡片（预览/下载/上传/同步/删除）
 */
import { appState } from '../common/state.js';
import { api } from '../common/api.js';
import { el } from '../common/dom.js';
import { showToast, showConfirmDialog } from '../common/feedback.js';
import { openPreview, toggleFullscreenPreview } from '../preview/preview.js';

// ===== ★ 管理模式：场景列表 =====
export async function renderManagementView() {
  const c = document.getElementById('content');
  if (!c) return;
  c.innerHTML = '';
  c.appendChild(el('div', 'section-title', '已录制场景'));
  c.appendChild(el('div', 'empty-state', '加载中...'));

  const result = await api.getRecordedExports();
  c.innerHTML = '';

  if (!result || !result.success) {
    c.appendChild(el('div', 'empty-state', '加载失败: ' + (result ? result.error : '未知错误')));
    return;
  }

  if (!result.exports || result.exports.length === 0) {
    c.appendChild(el('div', 'empty-state', '暂无已录制的内容'));
    return;
  }

  result.exports.forEach((exp) => {
    c.appendChild(buildScenarioCard(exp));
  });
}

/** 构建场景卡片 */
export function buildScenarioCard(exp) {
  const card = el('div', 'scenario-card');
  // ★ 标记目录名（用于预览高亮）
  card.dataset.dirname = exp.dirName;
  if (exp.dirName === appState.currentPreviewDirName) card.classList.add('scenario-card-active');

  // 头部信息
  const header = el('div', 'scenario-card-header');
  const info = el('div', 'scenario-card-info');
  info.appendChild(el('div', 'scenario-card-title', exp.sceneTitle || exp.dirName));
  if (exp.sceneSubTitle) {
    info.appendChild(el('div', 'scenario-card-subtitle', exp.sceneSubTitle));
  }

  // 修改时间
  try {
    const stat = { mtime: new Date() }; // 后端已排序，仅展示步骤数
    info.appendChild(el('div', 'scenario-card-meta', exp.stepCount + ' 步 | 目录: ' + exp.dirName));
  } catch (e) {
    info.appendChild(el('div', 'scenario-card-meta', exp.stepCount + ' 步'));
  }
  header.appendChild(info);
  card.appendChild(header);

  // 操作按钮
  const actions = el('div', 'scenario-card-actions');

  // 预览
  const previewBtn = el('button', 'scenario-action-btn preview', '🔍 预览');
  previewBtn.addEventListener('click', async () => {
    if (exp.htmlFiles && exp.htmlFiles.length > 0) {
      await openPreview(exp.htmlFiles[0].filePath, exp.htmlFiles, exp.dirName);
    } else {
      showToast('该场景没有可预览的文件', 'error');
    }
  });
  actions.appendChild(previewBtn);

  // ★ 继续录制（仅有 recording_data.json 的场景显示）
  if (exp.canContinue) {
    const continueBtn = el('button', 'scenario-action-btn', '▶ 继续录制');
    continueBtn.style.background = 'var(--accent-blue-bg)';
    continueBtn.style.color = 'var(--accent-blue)';
    continueBtn.style.borderColor = 'var(--border-accent)';
    continueBtn.addEventListener('click', async () => {
      continueBtn.disabled = true;
      continueBtn.textContent = '加载中...';
      const result = await api.continueRecording(exp.dirPath);
      continueBtn.disabled = false;
      continueBtn.textContent = '▶ 继续录制';
      if (result && result.success) {
        showToast('已加载场景数据，可继续录制', 'success');
        // ★ 模拟点击"页面录制"菜单项切换视图（避免循环依赖）
        const recordingMenuItem = document.querySelector('.menu-item[data-view="recording"]');
        if (recordingMenuItem) recordingMenuItem.click();
      } else {
        showToast('继续录制失败：' + (result?.error || '未知错误'), 'error', 5000);
      }
    });
    actions.appendChild(continueBtn);
  }

  // ★ 全屏预览
  const fullscreenPreviewBtn = el('button', 'scenario-action-btn preview', '⛶ 全屏预览');
  fullscreenPreviewBtn.addEventListener('click', async () => {
    if (exp.htmlFiles && exp.htmlFiles.length > 0) {
      await openPreview(exp.htmlFiles[0].filePath, exp.htmlFiles, exp.dirName);
      // 等待窗口尺寸调整完成后进入全屏
      setTimeout(() => toggleFullscreenPreview(true), 300);
    } else {
      showToast('该场景没有可预览的文件', 'error');
    }
  });
  actions.appendChild(fullscreenPreviewBtn);

  // 下载
  const downloadBtn = el('button', 'scenario-action-btn download', '📥 下载');
  downloadBtn.addEventListener('click', async () => {
    downloadBtn.disabled = true;
    downloadBtn.textContent = '下载中...';
    const result = await api.downloadRecording(exp.dirPath);
    downloadBtn.disabled = false;
    downloadBtn.textContent = '📥 下载';
    if (result && result.success) {
      showToast('下载成功：已拷贝到 ' + result.destination, 'success', 5000);
    } else if (result && result.canceled) {
      // 用户取消，不提示
    } else {
      showToast('下载失败：' + (result ? result.error : '未知错误'), 'error', 5000);
    }
  });
  actions.appendChild(downloadBtn);

  // 上传
  const uploadBtn = el('button', 'scenario-action-btn upload', '📤 上传');
  uploadBtn.addEventListener('click', async () => {
    uploadBtn.disabled = true;
    uploadBtn.textContent = '上传中...';
    const result = await api.uploadRecording(exp.dirPath);
    uploadBtn.disabled = false;
    uploadBtn.textContent = '📤 上传';
    if (result && result.success) {
      showToast('上传完成：' + result.fileCount + ' 个文件' + (result.message ? '\n' + result.message : ''), 'success', 5000);
    } else {
      showToast('上传失败：' + (result ? result.error : '未知错误'), 'error', 5000);
    }
  });
  actions.appendChild(uploadBtn);

  // ★ 同步到生产（仅非 prd_copy 的场景显示）
  if (!exp.dirName.endsWith('_prd_copy')) {
    const syncBtn = el('button', 'scenario-action-btn', '🔄 同步到生产');
    syncBtn.style.background = 'var(--accent-blue-bg)';
    syncBtn.style.color = 'var(--accent-blue)';
    syncBtn.style.borderColor = 'var(--border-accent)';
    syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true;
      syncBtn.textContent = '同步中...';
      const result = await api.syncToPrd(exp.dirPath);
      syncBtn.disabled = false;
      syncBtn.textContent = '🔄 同步到生产';
      if (result && result.success) {
        showToast('同步成功：已创建 "' + result.newName + '"', 'success', 5000);
        renderManagementView();
      } else {
        showToast('同步失败：' + (result ? result.error : '未知错误'), 'error', 5000);
      }
    });
    actions.appendChild(syncBtn);
  }

  // 删除
  const deleteBtn = el('button', 'scenario-action-btn delete', '🗑️ 删除');
  deleteBtn.addEventListener('click', () => {
    showConfirmDialog('确认删除', '确认删除场景 "' + (exp.sceneTitle || exp.dirName) + '" 吗？\n删除后无法恢复。', async () => {
      const result = await api.deleteRecording(exp.dirPath);
      if (result && result.success) {
        showToast('已删除场景: ' + (exp.sceneTitle || exp.dirName), 'success');
        renderManagementView();
      } else {
        showToast('删除失败：' + (result ? result.error : '未知错误'), 'error', 5000);
      }
    });
  });
  actions.appendChild(deleteBtn);

  card.appendChild(actions);
  return card;
}
