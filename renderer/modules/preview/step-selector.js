/**
 * 预览步骤选择器（上一步/下一步 + 下拉框 + 重录该步骤）
 */
import { appState } from '../common/state.js';
import { el } from '../common/dom.js';
import { filePathToUrl } from './preview.js';
import { startReRecord } from '../recording/rerecord/rerecord-flow.js';

/** 渲染预览步骤选择器（含上一步/下一步按钮 + 重录按钮） */
export function renderPreviewStepSelector() {
  // 移除旧的选择器
  const oldSelector = document.querySelector('.preview-step-selector');
  if (oldSelector) oldSelector.remove();

  // 仅多于1个文件时显示步骤选择器
  if (!appState.currentPreviewFiles || appState.currentPreviewFiles.length <= 1) return;

  const rightCol = document.getElementById('rightColumn');
  const selector = el('div', 'preview-step-selector');

  // ★ 上一步按钮
  const prevBtn = el('button', 'preview-step-btn', '◀');
  prevBtn.title = '上一步';
  prevBtn.disabled = (appState.currentPreviewStepIndex <= 0);

  // 步骤下拉框
  const select = el('select');
  appState.currentPreviewFiles.forEach((file, idx) => {
    const opt = el('option', null, file.index + '. ' + (file.mainTitle || file.stepTitle || file.filename));
    opt.value = file.filePath;
    if (idx === appState.currentPreviewStepIndex) opt.selected = true;
    select.appendChild(opt);
  });

  // ★ 下一步按钮
  const nextBtn = el('button', 'preview-step-btn', '▶');
  nextBtn.title = '下一步';
  nextBtn.disabled = (appState.currentPreviewStepIndex >= appState.currentPreviewFiles.length - 1);

  // 导航到指定步骤
  function navigateToStep(idx) {
    if (idx < 0 || idx >= appState.currentPreviewFiles.length) return;
    appState.currentPreviewStepIndex = idx;
    const webview = document.getElementById('previewWebview');
    const loading = document.getElementById('previewLoading');
    if (loading) {
      loading.textContent = '加载中...';
      loading.classList.add('active');
    }
    webview.src = filePathToUrl(appState.currentPreviewFiles[idx].filePath);
    // 更新按钮状态
    prevBtn.disabled = (idx <= 0);
    nextBtn.disabled = (idx >= appState.currentPreviewFiles.length - 1);
    select.selectedIndex = idx;
    // ★ 同步重录按钮的 enabled 状态
    if (rerecordBtn) updateRerecordBtnState();
  }

  select.addEventListener('change', () => {
    const idx = select.selectedIndex;
    navigateToStep(idx);
  });
  prevBtn.addEventListener('click', () => navigateToStep(appState.currentPreviewStepIndex - 1));
  nextBtn.addEventListener('click', () => navigateToStep(appState.currentPreviewStepIndex + 1));

  // ★ 重录该步骤按钮（需要该场景存在录制元数据才可点击）
  const rerecordBtn = el('button', 'preview-rerecord-btn', '🔄 重录该步骤');
  rerecordBtn.title = '将该步骤的录制内容重新录制（加载场景数据）';

  function updateRerecordBtnState() {
    if (!rerecordBtn) return;
    const hasRecordingData = appState.currentPreviewDirName &&
      appState.currentPreviewFiles &&
      appState.currentPreviewFiles.length > 0 &&
      appState.currentPreviewFiles[appState.currentPreviewStepIndex];
    rerecordBtn.disabled = !hasRecordingData;
  }
  updateRerecordBtnState();

  rerecordBtn.addEventListener('click', () => {
    const file = appState.currentPreviewFiles[appState.currentPreviewStepIndex];
    if (!file) return;
    // 调用重录流程
    startReRecord({
      dirName: appState.currentPreviewDirName,
      filePath: file.filePath,
      fileIndex: appState.currentPreviewStepIndex,
    });
  });

  selector.appendChild(prevBtn);
  selector.appendChild(select);
  selector.appendChild(nextBtn);
  selector.appendChild(rerecordBtn);

  // 插入到 right-toolbar 之后
  const toolbar = rightCol.querySelector('.right-toolbar');
  if (toolbar) {
    toolbar.after(selector);
  }
}

/** ★ 同步预览步骤选择器 — 页面导航后更新下拉框和按钮状态 */
export function syncPreviewStepSelector() {
  if (!appState.currentPreviewFiles || appState.currentPreviewFiles.length === 0) return;
  const webview = document.getElementById('previewWebview');
  if (!webview) return;
  const currentUrl = webview.getURL();
  // 从 file:// URL 中提取文件路径
  let currentPath = currentUrl.replace(/^file:\/\//, '');
  // 处理 Windows 路径 (file:///D:/... → D:/...)
  currentPath = currentPath.replace(/^\//, '');

  // 查找匹配的步骤
  const idx = appState.currentPreviewFiles.findIndex((f) => {
    const normalizedFp = f.filePath.replace(/\\/g, '/');
    const normalizedCp = currentPath.replace(/\\/g, '/');
    return normalizedFp.toLowerCase() === normalizedCp.toLowerCase();
  });

  if (idx >= 0 && idx !== appState.currentPreviewStepIndex) {
    appState.currentPreviewStepIndex = idx;
    // 更新下拉框
    const select = document.querySelector('.preview-step-selector select');
    if (select) select.selectedIndex = idx;
    // 更新按钮状态
    const prevBtn = document.querySelector('.preview-step-selector button:first-child');
    const nextBtn = document.querySelector('.preview-step-selector button:nth-child(3)');
    if (prevBtn) prevBtn.disabled = (idx <= 0);
    if (nextBtn) nextBtn.disabled = (idx >= appState.currentPreviewFiles.length - 1);
  }
}
