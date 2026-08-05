/**
 * IPC - webview 注入脚本/preload 路径/cookie 同步
 * 从原 ipc-handler.js 拆分
 */
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

function registerWebviewIpc({ browserManager }) {
  // ===== ★ 获取元素选择辅助脚本内容（用于应用内 webview 注入） =====
  ipcMain.handle('get-inject-script', async (event, scriptName) => {
    try {
      const scriptPath = path.join(__dirname, '..', '..', 'src', 'inject', scriptName + '.js');
      if (!fs.existsSync(scriptPath)) {
        return { success: false, error: '脚本不存在: ' + scriptName };
      }
      const content = fs.readFileSync(scriptPath, 'utf-8');
      return { success: true, content };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ===== ★ 获取 webview preload 脚本路径（返回 file:// URL） =====
  ipcMain.handle('get-webview-preload-path', () => {
    const preloadPath = path.join(__dirname, '..', '..', 'src', 'inject', 'webview-preload.js');
    // ★ 使用 pathToFileURL 生成正确的 file:/// URL（Windows 需要 file:///D:/... 而非 file://d:/...）
    const { pathToFileURL } = require('url');
    return pathToFileURL(preloadPath).href;
  });

  // ===== ★ Cookie 同步 — Playwright ↔ webview =====

  // 同步 cookies 从 Playwright 到 webview partition
  ipcMain.handle('sync-cookies-to-webview', async () => {
    try {
      if (!browserManager) return { success: false, error: '浏览器未启动' };
      const cookies = await browserManager.getCookies();
      if (cookies.length === 0) return { success: true, count: 0 };

      const { session } = require('electron');
      const webviewSession = session.fromPartition('persist:webview');

      let count = 0;
      for (const cookie of cookies) {
        try {
          // 构造 URL（Electron cookies.set 需要 url）
          const protocol = cookie.secure ? 'https://' : 'http://';
          const domain = cookie.domain.replace(/^\./, '');
          const url = protocol + domain + (cookie.path || '/');

          const sameSiteMap = { 'Strict': 'strict', 'Lax': 'lax', 'None': 'no_restriction' };
          await webviewSession.cookies.set({
            url,
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path || '/',
            secure: !!cookie.secure,
            httpOnly: !!cookie.httpOnly,
            sameSite: sameSiteMap[cookie.sameSite] || 'no_restriction',
            expirationDate: cookie.expires > 0 ? cookie.expires : undefined,
          });
          count++;
        } catch (e) {
          // 单条 cookie 失败不影响其他
        }
      }
      console.log(`[IPC] 已同步 ${count} 条 cookies 到 webview`);
      return { success: true, count };
    } catch (err) {
      console.error('[IPC] 同步 cookies 到 webview 失败:', err);
      return { success: false, error: err.message };
    }
  });

  // 同步 cookies 从 webview partition 到 Playwright
  ipcMain.handle('sync-cookies-from-webview', async () => {
    try {
      const { session } = require('electron');
      const webviewSession = session.fromPartition('persist:webview');
      const cookies = await webviewSession.cookies.get({});

      if (!browserManager || cookies.length === 0) return { success: true, count: 0 };

      // 转换 Electron cookie → Playwright cookie 格式
      const playwrightCookies = cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        secure: !!c.secure,
        httpOnly: !!c.httpOnly,
        expires: c.expirationDate > 0 ? c.expirationDate : -1,
      }));

      await browserManager.setCookies(playwrightCookies);
      console.log(`[IPC] 已同步 ${playwrightCookies.length} 条 cookies 到 Playwright`);
      return { success: true, count: playwrightCookies.length };
    } catch (err) {
      console.error('[IPC] 同步 cookies 从 webview 失败:', err);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerWebviewIpc };
