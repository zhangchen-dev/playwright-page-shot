/**
 * 已录制内容（可展开面板）— 配置阶段展示已录制场景列表
 */
import { appState } from '../../common/state.js';
import { api } from '../../common/api.js';
import { contentEl, el } from '../../common/dom.js';
import { showInAppPreview } from '../../preview/preview.js';

export function renderRecordedExportsSection() {
  const sectionBox = el('div', 'section-box recorded-exports-section');

  // 可展开/收起的标题
  const header = el('div', 'recorded-exports-header');
  const arrow = el('span', 'module-arrow', appState.isRecordedExportsExpanded ? '\u25be' : '\u25b8');
  const title = el('span', 'module-name', '已录制内容');
  header.appendChild(arrow);
  header.appendChild(title);

  const content = el('div', 'recorded-exports-content');
  content.style.display = appState.isRecordedExportsExpanded ? 'block' : 'none';

  header.addEventListener('click', () => {
    appState.isRecordedExportsExpanded = !appState.isRecordedExportsExpanded;
    arrow.textContent = appState.isRecordedExportsExpanded ? '\u25be' : '\u25b8';
    content.style.display = appState.isRecordedExportsExpanded ? 'block' : 'none';

    // 首次展开时加载数据
    if (appState.isRecordedExportsExpanded && content.children.length === 0) {
      loadRecordedExports(content);
    }
  });

  // 如果之前是展开状态，自动加载
  if (appState.isRecordedExportsExpanded) {
    loadRecordedExports(content);
  }

  sectionBox.appendChild(header);
  sectionBox.appendChild(content);
  contentEl.appendChild(sectionBox);
}

/** ★ 异步加载已录制内容列表 */
export async function loadRecordedExports(container) {
  container.innerHTML = '';
  container.appendChild(el('div', 'empty-state', '加载中...'));

  const result = await api.getRecordedExports();
  if (!result || !result.success) {
    container.innerHTML = '';
    container.appendChild(el('div', 'empty-state', '加载失败: ' + (result ? result.error : '未知错误')));
    return;
  }

  container.innerHTML = '';

  if (!result.exports || result.exports.length === 0) {
    container.appendChild(el('div', 'empty-state', '暂无已录制的内容'));
    return;
  }

  result.exports.forEach((exp) => {
    const isExpanded = appState.expandedExportDirs.has(exp.dirPath);
    const exportHeader = el('div', 'recorded-export-header');
    const expArrow = el('span', 'module-arrow', isExpanded ? '\u25be' : '\u25b8');
    const expName = el('span', 'recorded-export-name',
      exp.sceneTitle + (exp.sceneSubTitle ? ' - ' + exp.sceneSubTitle : '') + ' (' + exp.stepCount + '\u6b65)');
    exportHeader.appendChild(expArrow);
    exportHeader.appendChild(expName);

    const stepList = el('div', 'recorded-step-list');
    stepList.style.display = isExpanded ? 'block' : 'none';

    if (exp.htmlFiles && exp.htmlFiles.length > 0) {
      exp.htmlFiles.forEach((file) => {
        const stepItem = el('div', 'recorded-step-item');
        const labelText = file.index + '. ' + (file.mainTitle || file.stepTitle || file.filename);
        const label = el('span', 'recorded-step-label', labelText);
        label.title = file.filename +
          (file.moduleTitle ? '\n\u6a21\u5757: ' + file.moduleTitle : '') +
          (file.stepTitle ? '\n\u4e3b\u6b65\u9aa4: ' + file.stepTitle : '');

        const previewBtn = el('button', 'recorded-step-preview-btn', '\ud83d\udd0d \u9884\u89c8');
        previewBtn.addEventListener('click', async () => {
          previewBtn.disabled = true;
          previewBtn.textContent = '\u6253\u5f00\u4e2d...';
          await showInAppPreview(file.filePath);
          previewBtn.disabled = false;
          previewBtn.textContent = '\ud83d\udd0d \u9884\u89c8';
        });

        stepItem.appendChild(label);
        stepItem.appendChild(previewBtn);
        stepList.appendChild(stepItem);
      });
    }

    exportHeader.addEventListener('click', () => {
      const isOpen = stepList.style.display !== 'none';
      stepList.style.display = isOpen ? 'none' : 'block';
      expArrow.textContent = isOpen ? '\u25b8' : '\u25be';
      if (isOpen) {
        appState.expandedExportDirs.delete(exp.dirPath);
      } else {
        appState.expandedExportDirs.add(exp.dirPath);
      }
    });

    container.appendChild(exportHeader);
    container.appendChild(stepList);
  });
}
