/**
 * IPC - 预览 + 保存目录选择
 * 从原 ipc-handler.js 拆分
 */
const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

function registerPreviewIpc({ recorder, panelWindowGetter }) {
  // ===== 保存目录选择 =====
  ipcMain.handle('select-save-directory', async (event) => {
    const win = panelWindowGetter();
    const result = await dialog.showOpenDialog(win, {
      title: '选择保存目录',
      properties: ['createDirectory', 'openDirectory'],
      defaultPath: recorder.outputDir,
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  // ===== 设置保存目录 =====
  ipcMain.handle('set-output-dir', async (event, dir) => {
    recorder.outputDir = dir;
    return { success: true };
  });

  // ===== ★ 获取上次导出的第一个 HTML 文件路径（用于应用内预览） =====
  ipcMain.handle('preview-export', async (event) => {
    try {
      const exportDir = recorder.lastExportDir;
      if (!exportDir || !fs.existsSync(exportDir)) {
        return { success: false, error: '没有可预览的导出文件，请先完成一次录制并保存' };
      }

      const files = fs.readdirSync(exportDir);
      const htmlFiles = files.filter((f) => f.endsWith('.html')).sort();
      if (htmlFiles.length === 0) {
        return { success: false, error: '导出目录中没有 HTML 文件' };
      }

      const firstHtml = path.join(exportDir, htmlFiles[0]);
      return { success: true, filePath: firstHtml };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ===== ★ 预览指定 HTML 文件（返回文件路径，由渲染进程 webview 加载） =====
  ipcMain.handle('preview-html-file', async (event, filePath) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        return { success: false, error: '文件不存在: ' + filePath };
      }
      return { success: true, filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerPreviewIpc };
