/**
 * 录制导航分发器 — 按 browserMode 分发到对内 / 对外导航
 */
import { appState } from '../../common/state.js';
import { api } from '../../common/api.js';
import { urlInput } from '../../common/dom.js';
import { navigateInAppBrowser } from '../internal/webview-recording.js';
import { navigateExternal } from '../external/external-recording.js';

/** URL 导航 — 根据浏览器模式分发 */
export async function navigateToUrl() {
  let url = urlInput.value.trim();
  if (!url) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
    urlInput.value = url;
  }

  // ★ 应用内浏览器模式：在右侧栏 webview 中加载 URL
  if (appState.browserMode === 'in-app') {
    // 先从 Playwright 同步 cookies 到 webview（共享登录状态）
    try { await api.syncCookiesToWebview(); } catch (e) { /* ignore */ }
    await navigateInAppBrowser(url);
    return;
  }

  // ★ 外层浏览器模式：使用 Playwright 启动/导航
  await navigateExternal(url);
}
