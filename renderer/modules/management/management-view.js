/**
 * 后台管理视图：已录制场景列表 + 场景卡片（预览/下载/上传/同步/删除）
 */
import { appState } from '../common/state.js';
import { api } from '../common/api.js';
import { el } from '../common/dom.js';
import { showToast, showConfirmDialog } from '../common/feedback.js';
import { openPreview, toggleFullscreenPreview } from '../preview/preview.js';
import { openMapPreview } from '../preview/map-preview.js';
import { requestSwitchView } from '../common/layout.js';

// ===== ★ 管理模式：场景列表 =====
export async function renderManagementView() {
  // ★ 防御：清理所有残留 dialog overlay（防止跨视图切换时残留的 dialog 阻挡 UI）
  document.querySelectorAll('.dialog-overlay').forEach((o) => o.remove());

  // ★ 早期守卫：如果视图已切换（例如重录流程中状态同步触发了自动切换到 recording 视图），
  //    立即返回，不清空 content，避免覆盖录制视图的表单。
  if (appState.currentView !== 'management') return;

  const c = document.getElementById('content');
  if (!c) return;
  c.innerHTML = '';

  // ★ 标题 + 计数徽章（先占位，加载完成后再回填）
  const titleEl = el('div', 'section-title', '已录制场景');
  const countBadge = el('span', 'scenario-count-badge', '');
  titleEl.appendChild(countBadge);
  c.appendChild(titleEl);

  // 加载占位（带 spinner）
  const placeholder = el('div', 'scenario-empty');
  placeholder.innerHTML = '<div class="loading-spinner"></div>';
  c.appendChild(placeholder);

  const result = await api.getRecordedExports();

  // ★ 检查视图是否已切换（例如重录流程中状态同步后用户已切到录制视图）
  //    如果已不在管理视图，放弃渲染防止覆盖录制UI
  if (appState.currentView !== 'management') return;

  placeholder.remove();

  if (!result || !result.success) {
    showScenarioEmpty(c, '⚠️', '加载失败', (result ? result.error : '未知错误'));
    return;
  }

  if (!result.exports || result.exports.length === 0) {
    showScenarioEmpty(c, '🎬', '暂无已录制内容', '录制一个场景后会显示在这里');
    return;
  }

  // 回填计数徽章
  countBadge.textContent = result.exports.length + ' 个';

  result.exports.forEach((exp) => {
    c.appendChild(buildScenarioCard(exp));
  });
}

/** ★ 场景列表空/错误状态 */
function showScenarioEmpty(container, emoji, title, subtitle) {
  const wrap = el('div', 'scenario-empty');
  wrap.appendChild(el('span', 'empty-emoji', emoji));
  wrap.appendChild(el('div', 'empty-title', title));
  if (subtitle) wrap.appendChild(el('div', 'empty-subtitle', subtitle));
  container.appendChild(wrap);
}

/** 构建场景卡片 */
export function buildScenarioCard(exp) {
  const card = el('div', 'scenario-card');
  // ★ 标记目录名（用于预览高亮）
  card.dataset.dirname = exp.dirName;
  const isActive = exp.dirName === appState.currentPreviewDirName;
  if (isActive) card.classList.add('scenario-card-active');

  // ─── 头部：标题 / 副标题 / 元信息 + 当前预览徽章 ───
  const header = el('div', 'scenario-card-header');
  const info = el('div', 'scenario-card-info');
  info.appendChild(el('div', 'scenario-card-title', exp.sceneTitle || exp.dirName));
  if (exp.sceneSubTitle) {
    info.appendChild(el('div', 'scenario-card-subtitle', exp.sceneSubTitle));
  }
  // 元信息：步数 / 目录名（独立胶囊样式）
  const meta = el('div', 'scenario-card-meta');
  meta.appendChild(el('span', 'scenario-card-meta-item', '📊 ' + exp.stepCount + ' 步'));
  meta.appendChild(el('span', 'scenario-card-meta-item', '📂 ' + exp.dirName));
  info.appendChild(meta);
  header.appendChild(info);

  if (isActive) {
    header.appendChild(el('div', 'scenario-card-badge', '● 当前预览'));
  }
  card.appendChild(header);

  // ─── 操作区（两行布局：第 1 行 = 预览 + 录制；第 2 行 = 分发 + 删除） ───
  const actions = el('div', 'scenario-card-actions');

  // Row 1 ── 预览 + 录制
  const row1 = el('div', 'action-group-row');

  // —— 预览组：常规预览 / 全屏预览 / 展示地图 ——
  const previewGroup = el('div', 'action-group');
  previewGroup.appendChild(el('span', 'action-group-label', '预览'));

  const previewBtn = el('button', 'scenario-action-btn preview', '🔍 预览');
  previewBtn.addEventListener('click', async () => {
    if (exp.htmlFiles && exp.htmlFiles.length > 0) {
      await openPreview(exp.htmlFiles[0].filePath, exp.htmlFiles, exp.dirName);
    } else {
      showToast('该场景没有可预览的文件', 'error');
    }
  });
  previewGroup.appendChild(previewBtn);

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
  previewGroup.appendChild(fullscreenPreviewBtn);

  // ★ 展示地图（仅预览：将录制步骤作为内容展示在地图页 iframe 中，不影响导出）
  const mapBtn = el('button', 'scenario-action-btn preview', '🗺️ 展示地图');
  mapBtn.addEventListener('click', async () => {
    await openMapPreview(exp);
  });
  previewGroup.appendChild(mapBtn);
  row1.appendChild(previewGroup);

  // —— 录制组：继续录制（仅有录制元数据的场景显示） ——
  if (exp.canContinue) {
    const recGroup = el('div', 'action-group');
    recGroup.appendChild(el('span', 'action-group-label', '录制'));

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
        // ★ 设置继续录制模式标志（跳过视图切换时的"录制未完成"确认对话框）
        appState._continueRecordingMode = true;
        // ★ 切换到录制视图
        requestSwitchView('recording');
      } else {
        showToast('继续录制失败：' + (result?.error || '未知错误'), 'error', 5000);
      }
    });
    recGroup.appendChild(continueBtn);
    row1.appendChild(recGroup);
  }
  actions.appendChild(row1);

  // Row 2 ── 分发 + 删除
  const row2 = el('div', 'action-group-row');

  // —— 分发组：下载 / 上传 / 同步到生产 ——
  const distGroup = el('div', 'action-group');
  distGroup.appendChild(el('span', 'action-group-label', '分发'));

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
  distGroup.appendChild(downloadBtn);

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
  distGroup.appendChild(uploadBtn);

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
    distGroup.appendChild(syncBtn);
  }
  row2.appendChild(distGroup);

  // —— 删除组（右对齐）——
  const dangerGroup = el('div', 'action-group danger');
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
  dangerGroup.appendChild(deleteBtn);
  row2.appendChild(dangerGroup);

  actions.appendChild(row2);
  card.appendChild(actions);
  return card;
}
