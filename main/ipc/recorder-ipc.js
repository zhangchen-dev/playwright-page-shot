/**
 * IPC - 录制动作 + 元素选择 + 页面操作
 * 从原 ipc-handler.js 拆分
 *
 * ★ 2026-08-20：移除外部浏览器（Playwright）相关 handler
 *   （enable/disable-selection-mode、navigate-to、get-active-page-url、
 *    get-all-pages、set-active-page、close-browser）。
 *   应用仅保留"应用内 webview"录制模式，元素选择由 webview 注入脚本完成。
 */
const { ipcMain } = require('electron');

function registerRecorderIpc({ recorder }) {
  // ===== 录制操作（统一入口） =====
  ipcMain.handle('recorder-action', async (event, { type, ...msg }) => {
    try {
      const result = await recorder.handleAction(type, msg);
      return result?.response || null;
    } catch (err) {
      console.error('[IPC] recorder-action 失败:', err);
      return { type: 'error', message: err.message };
    }
  });
}

module.exports = { registerRecorderIpc };
