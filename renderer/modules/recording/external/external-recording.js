/**
 * 对外录制（外层 Playwright 浏览器模式）
 * 渲染层仅薄封装：导航 / 元素选择通过 IPC 调用主进程 browser-manager。
 * 对外录制主体逻辑在后端 src/browser-manager.js（保持原位）。
 */
import { appState } from '../../common/state.js';
import { api } from '../../common/api.js';
import { updateStatus, showToast } from '../../common/feedback.js';
import { updateAlwaysOnTop } from '../../common/layout.js';

/** ★ 外层浏览器模式：使用 Playwright 启动/导航 */
export async function navigateExternal(url) {
  // 先从 webview 同步 cookies 到 Playwright（共享登录状态）
  try { await api.syncCookiesFromWebview(); } catch (e) { /* ignore */ }

  updateStatus('正在导航...', 'var(--accent-blue)');
  const result = await api.navigateTo(url);
  if (result && result.justLaunched) {
    appState.browserLaunched = true;
    updateStatus('浏览器已启动', 'var(--accent-green)');
  } else if (result && result.success) {
    updateStatus('', '');
  } else {
    updateStatus('导航失败: ' + (result?.error || ''), 'var(--accent-red)');
    showToast('导航失败: ' + (result?.error || ''), 'error');
  }
  updateAlwaysOnTop();
}

/** 启用外层浏览器元素选择模式 */
export async function enableExternalSelection() {
  await api.enableSelectionMode();
}

/** 禁用外层浏览器元素选择模式 */
export async function disableExternalSelection() {
  await api.disableSelectionMode();
}
