/**
 * IPC - 窗口控制（最小化/置顶/缩放/浏览器启动状态）
 * 从原 ipc-handler.js 拆分
 */
const { ipcMain } = require('electron');

function registerWindowIpc({ recorder, browserManager, panelWindowGetter }) {
  // ===== 窗口控制 =====
  ipcMain.handle('minimize-to-tray', async (event) => {
    const win = panelWindowGetter();
    if (win) win.hide();
    return { success: true };
  });

  ipcMain.handle('set-always-on-top', async (event, flag) => {
    const win = panelWindowGetter();
    if (win) win.setAlwaysOnTop(flag);
    return { success: true };
  });

  // ===== 检查浏览器是否已启动 =====
  ipcMain.handle('is-browser-launched', async (event) => {
    return browserManager.isLaunched();
  });

  // ===== ★ 窗口尺寸控制（用于应用内预览模式） =====
  ipcMain.handle('resize-window', async (event, width) => {
    const win = panelWindowGetter();
    if (!win) return { success: false };

    // ★ 最大化时不强制改尺寸，由 flex 布局自适应
    if (win.isMaximized()) return { success: true, maximized: true };

    // ★ 仅调整宽度，保留用户拖动后的位置；窗口不会因点击菜单而回到右侧
    const { screen } = require('electron');
    const workArea = screen.getDisplayNearestPoint(win.getBounds()).workArea;
    const [currentX, currentY] = win.getPosition();
    const [, currentHeight] = win.getSize();

    // 仅当新宽度使窗口超出工作区右边界时才向左收缩，避免溢出屏幕
    const maxX = workArea.x + workArea.width - width;
    const newX = Math.min(currentX, Math.max(workArea.x, maxX));

    win.setBounds({ x: newX, y: currentY, width, height: currentHeight });
    return { success: true };
  });
}

module.exports = { registerWindowIpc };
