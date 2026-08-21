/**
 * 地图预览（仅预览，不影响导出）
 * 入口：场景卡片 "⛶ 全屏预览，展示地图" 按钮（合并了旧的全屏预览与展示地图）。
 * 行为：先打开右栏预览面板（复用布局），再请求主进程生成地图预览并把 URL 载入预览 webview，
 *      最后自动进入全屏模式（收起 sidebar + 中间列 + 顶部工具栏，仅留浮动展开按钮与地图预览本身）。
 * 整个流程只读录制数据、只写临时目录，「下载/导出」仍是原始 html 与配置。
 */
import { openPreview, toggleFullscreenPreview } from './preview.js';
import { appState } from '../common/state.js';
import { showToast } from '../common/feedback.js';
import { api } from '../common/api.js';

/**
 * 打开地图预览（合并到全屏预览入口）
 * @param {object} exp 场景卡片数据（含 dirPath / htmlFiles / dirName）
 * @param {object} [options]
 * @param {boolean} [options.enterFullscreen=true] 是否在地图 URL 加载后自动进入全屏预览模式
 */
export async function openMapPreview(exp, options = {}) {
  const { enterFullscreen = true } = options;
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

    // 4) ★ v19：合并到全屏预览入口——地图 URL 载入后自动进入全屏模式
    //    （收起 sidebar + 中间列 + 顶部工具栏，仅留浮动展开按钮与地图预览本身）。
    //    旧的全屏预览/展示地图两个按钮合并为一个入口，行为见 management-view.js。
    if (enterFullscreen) {
      // 等待地图页加载完成 + 窗口尺寸调整完成后再切全屏，避免布局抖动
      setTimeout(() => {
        try {
          toggleFullscreenPreview(true);
        } catch (e) {
          console.warn('[map-preview] enterFullscreen 失败（不阻断预览）:', e.message);
        }
      }, 400);
    }

    showToast('已开启地图预览（仅预览形式，导出不受影响）', 'info', 3000);
  } catch (e) {
    console.error('[map-preview] openMapPreview 失败:', e);
    showToast('地图预览出错：' + e.message, 'error');
  }
}