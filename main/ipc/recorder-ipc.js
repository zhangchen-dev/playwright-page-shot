/**
 * IPC - 录制动作 + 元素选择 + 页面操作
 * 从原 ipc-handler.js 拆分
 */
const { ipcMain } = require('electron');

function registerRecorderIpc({ recorder, browserManager }) {
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

  // ===== 元素选择 =====
  ipcMain.handle('enable-selection-mode', async (event) => {
    try {
      await browserManager.enableSelectionMode();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('disable-selection-mode', async (event) => {
    try {
      await browserManager.disableSelectionMode();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ===== 页面操作 =====
  ipcMain.handle('get-active-page-url', async (event) => {
    const active = browserManager.getActivePage();
    return active ? active.url : null;
  });

  ipcMain.handle('navigate-to', async (event, url) => {
    try {
      if (!browserManager.isLaunched()) {
        await browserManager.launch(url);
        return { success: true, justLaunched: true };
      }

      const active = browserManager.getActivePage();
      if (active && active.page) {
        await active.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        return { success: true };
      }
      return { success: false, error: '没有活跃页面' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ★ 获取所有标签页（含焦点标识）
  ipcMain.handle('get-all-pages', async (event) => {
    const activePageId = browserManager._activePageId;
    return browserManager.getAllPages().map((p) => ({
      pageId: p.pageId,
      url: p.url,
      isActive: p.pageId === activePageId,
    }));
  });

  // ★ 手动切换焦点页面
  ipcMain.handle('set-active-page', async (event, pageId) => {
    browserManager.setActivePageId(pageId);
    return { success: true };
  });
}

module.exports = { registerRecorderIpc };
