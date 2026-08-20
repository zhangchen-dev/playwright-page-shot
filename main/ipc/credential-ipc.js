/**
 * IPC - 凭证管理 CRUD
 * 从原 ipc-handler.js 拆分
 */
const { ipcMain } = require('electron');

function registerCredentialIpc({ credStore }) {
  // 获取当前域名已保存的凭证列表（不含密码明文，用于 UI 展示）
  ipcMain.handle('get-credentials', (event, domain) => {
    try {
      if (!credStore) return [];
      return credStore.getCredentials(domain);
    } catch (err) {
      console.error('[IPC] get-credentials 失败:', err);
      return [];
    }
  });

  // 获取指定域名 + 用户名的完整凭证（含解密密码，用于自动填充）
  ipcMain.handle('get-credential', (event, { domain, username }) => {
    try {
      if (!credStore) return null;
      return credStore.getCredential(domain, username);
    } catch (err) {
      console.error('[IPC] get-credential 失败:', err);
      return null;
    }
  });

  // ★ 凭证填充：应用内模式由渲染进程的 webview executeJavaScript 完成
  //   （fillWebviewCredentials），不再经过主进程的 BrowserManager。

  // 保存凭证（新增或更新）
  ipcMain.handle('save-credential', (event, { domain, username, password }) => {
    try {
      if (!credStore) return { success: false, error: '凭证存储未初始化' };
      credStore.saveCredential(domain, username, password);
      return { success: true };
    } catch (err) {
      console.error('[IPC] save-credential 失败:', err);
      return { success: false, error: err.message };
    }
  });

  // 删除凭证
  ipcMain.handle('delete-credential', (event, { domain, username }) => {
    try {
      if (!credStore) return { success: false, error: '凭证存储未初始化' };
      credStore.deleteCredential(domain, username);
      return { success: true };
    } catch (err) {
      console.error('[IPC] delete-credential 失败:', err);
      return { success: false, error: err.message };
    }
  });

  // 获取所有域名的凭证（用于凭证管理 UI）
  ipcMain.handle('get-all-credentials', (event) => {
    try {
      if (!credStore) return [];
      return credStore.getAllDomains();
    } catch (err) {
      console.error('[IPC] get-all-credentials 失败:', err);
      return [];
    }
  });
}

module.exports = { registerCredentialIpc };
