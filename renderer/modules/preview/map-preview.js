/**
 * 地图预览（仅预览，不影响导出）
 * 点击「展示地图」时：先打开右栏预览面板（复用现有布局/状态），
 * 再请求主进程把录制场景转换成「地图 + 步骤内容」的预览，并把返回的地图页 URL 载入预览 webview。
 * 整个流程只读录制数据、只写临时目录，因此「下载/导出」仍是原始 html 与配置。
 */
import { openPreview } from './preview.js';
import { appState } from '../common/state.js';
import { showToast } from '../common/feedback.js';
import { api } from '../common/api.js';

/**
 * 打开地图预览
 * @param {object} exp 场景卡片数据（含 dirPath / htmlFiles / dirName）
 */
export async function openMapPreview(exp) {
  try {
    if (!exp || !exp.dirPath) {
      showToast('缺少场景目录信息，无法展示地图', 'error');
      return;
    }

    // 1) 打开右栏预览面板（复用布局、关闭多余 tab、设置高亮）
    const firstFile = (exp.htmlFiles && exp.htmlFiles.length) ? exp.htmlFiles[0].filePath : '';
    await openPreview(firstFile, exp.htmlFiles || [], exp.dirName);
    appState.rightPanelMode = 'preview';

    // 2) 请求主进程生成地图预览（写入临时目录）
    const res = await api.generateMapPreview({ dirPath: exp.dirPath });
    if (!res || !res.success) {
      showToast('地图预览生成失败：' + (res && res.error ? res.error : '未知错误'), 'error', 4500);
      return;
    }

    // 3) 把地图页载入预览 webview
    const webview = document.getElementById('previewWebview');
    if (webview) webview.src = res.url;

    showToast('已开启地图预览（仅预览形式，导出不受影响）', 'info', 3000);
  } catch (e) {
    console.error('[map-preview] openMapPreview 失败:', e);
    showToast('地图预览出错：' + e.message, 'error');
  }
}
