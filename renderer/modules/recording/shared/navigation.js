/**
 * 录制导航 — 应用内 webview 模式（外部 Playwright 浏览器已移除）
 */
import { appState } from '../../common/state.js';
import { api } from '../../common/api.js';
import { urlInput } from '../../common/dom.js';
import { navigateInAppBrowser } from '../internal/webview-recording.js';

/** URL 导航 — 在右侧栏 webview 中加载 URL */
export async function navigateToUrl() {
  let url = urlInput.value.trim();
  if (!url) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
    urlInput.value = url;
  }

  // 应用内浏览器模式：在右侧栏 webview 中加载 URL
  // 先从 webview 共享的登录态同步 cookies（如有）
  try { await api.syncCookiesToWebview(); } catch (e) { /* ignore */ }
  await navigateInAppBrowser(url);
}
