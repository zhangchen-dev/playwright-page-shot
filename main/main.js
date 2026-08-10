/**
 * Electron 主进程 - 应用入口
 */
const { app, BrowserWindow, screen, Tray, Menu, nativeImage, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { BrowserManager } = require('../src/browser-manager');
const { Recorder } = require('../src/recorder');
const { CredentialStore } = require('../src/credential-store');

let panelWindow = null;
let browserManager = null;
let recorder = null;
let credStore = null;
let tray = null;
let isQuitting = false;

function getOutputDir() {
  const dir = path.join(app.getPath('userData'), 'recordings');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn('[main] 创建 recordings 目录失败:', e.message);
  }
  return dir;
}

/** ★ 获取浏览器持久化配置目录（保存 cookies/session/登录状态） */
function getBrowserUserDataDir() {
  const dir = path.join(app.getPath('userData'), 'browser-profile');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn('[main] 创建 browser-profile 目录失败:', e.message);
  }
  return dir;
}

/** 从 icon.png 加载应用图标 */
function createAppIcon() {
  const iconPath = path.join(__dirname, '..', 'icon.png');
  try {
    if (fs.existsSync(iconPath)) {
      return nativeImage.createFromPath(iconPath);
    }
  } catch (e) {
    console.warn('[main] 加载 icon.png 失败:', e.message);
  }
  // 回退：程序生成简单图标
  return nativeImage.createFromBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAGASURBVHhe7ZbBDcMwDAVR6aoZIGWqZCCpah0gpWqABO5nYiTZeJLHyPb7IkUjEfYcSf9LrTFO45xznQe0cDjcE+gBLYA3YAu8rXDK5fsE1EpgDSwA3Sxx/g1MBF/HAa3ADdiGKuBCrMMVcCF26x6sAn+0ApbADiyANbAC1sAKWANr4AO8XQPYApvADiyBNbAC1sAKWANr4AO8XQPYApvADiyBNbAC1sAKWAM74AO8XQP4BmxjB3AnNnAH1sACOANr4AO8XQP4BmxjB3BntvADtwAHYANsCTOBNbAGFsAaWANr4AO8XQPYApvADiyBNbAC1sAKWANr4AO8XQP0lQfwa+0BdJUH8A3tAXSXB/BN4wG8aTyATzQG8KnGAD7VGMBnGgP4VGMAn2oM4NONBXyoMYBPNAZ+aDGAzzQGfmgxgM80Bn5oMYDPNAZ+aDGAzzQGfnAOP3wC7p0D7p0D7p0D7p0D7p0D7p0D7p37BH8CGJcAAAAAElFTkSuQmCC',
      'base64'
    )
  );
}

async function createPanelWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // ★ 默认笔记本尺寸 1366×768（用户明确要求）；不挤压侧栏+中间列+右栏
  const PANEL_DEFAULT_W = 1366;
  const PANEL_DEFAULT_H = 768;
  const panelWidth = Math.min(PANEL_DEFAULT_W, screenWidth - 40);
  const panelHeight = Math.min(PANEL_DEFAULT_H, screenHeight - 40);

  panelWindow = new BrowserWindow({
    width: panelWidth,
    height: panelHeight,
    minWidth: 1100, // ★ 至少容纳左栏+中间列+右栏
    minHeight: 600,
    center: true, // ★ 默认居中显示，不再强制贴右
    title: '场景录制助手',
    resizable: true,
    minimizable: true,
    maximizable: true, // ★ 支持最大化
    frame: true,
    autoHideMenuBar: true,
    alwaysOnTop: false, // ★ 默认不置顶，仅录制模式+浏览器打开时由渲染进程控制置顶
    skipTaskbar: false,
    show: false,  // 先隐藏，加载完再显示
    icon: createAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true, // ★ 启用 webview 标签（用于应用内预览）
    },
  });

  panelWindow.loadFile(path.join(__dirname, '..', 'renderer', 'panel.html'));

  // 加载完再显示，避免白屏闪烁
  panelWindow.once('ready-to-show', () => {
    panelWindow.show();
  });

  // ★ webview 新窗口处理 — 拦截 window.open / target="_blank" / form target="_blank"
  //   （Electron 22+ 已移除 <webview> 的 new-window 事件，统一用 setWindowOpenHandler）
  //
  //   ★★ 关键前提（2026-08-11 用 diag/harness 实测三种写法确认）：
  //      <webview> 必须带**独立布尔属性** allowpopups，本回调才会被调用。
  //      Electron 内部是 `disablePopups = !params.allowpopups`：
  //        · 不写 allowpopups            → window.open() 返回 null，handler 不触发
  //        · 写 webpreferences="allowpopups" → 同上，完全无效（该串不参与 disablePopups 判断）
  //        · 写独立属性 allowpopups      → handler 每次都触发（相对/绝对 _blank、window.open 均可）
  //      之前"点击某些按钮内部浏览器毫无反应"就是被 Chromium 在渲染层直接吞掉了弹窗请求，
  //      应用层（new-window / setWindowOpenHandler / DOM 注入）一个都收不到。
  panelWindow.webContents.on('did-attach-webview', (event, wc) => {
    console.log('[main] did-attach-webview 触发, webviewId:', wc.id);

    wc.setWindowOpenHandler((details) => {
      const newUrl = details.url;
      console.log('[main] setWindowOpenHandler 拦截新窗口:', newUrl, 'disposition=' + details.disposition);
      if (!newUrl || newUrl === 'about:blank') return { action: 'deny' };

      // 非 http(s) 协议：交给系统默认应用（mailto:/tel:/ftp: 等）
      if (!/^https?:\/\//i.test(newUrl)) {
        const { shell } = require('electron');
        shell.openExternal(newUrl).catch(() => {});
        return { action: 'deny' };
      }

      // ★ 通知渲染端开新 tab（由 tabs.js 创建新的 <webview>，主页面保持不变）
      if (panelWindow && !panelWindow.isDestroyed()) {
        panelWindow.webContents.send('app-open-tab', { url: newUrl, sourceWebviewId: wc.id });
        console.log('[main] 已通知渲染端开新 tab:', newUrl);
      }

      // deny 原生弹窗：不再另开脱离应用 UI 的 BrowserWindow
      return { action: 'deny' };
    });
  });

  if (process.argv.includes('--dev')) {
    panelWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // 关闭按钮 → 隐藏到托盘（而非退出）
  panelWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      panelWindow.hide();
    }
  });

  panelWindow.on('closed', () => {
    panelWindow = null;
  });
}

function createTray() {
  const icon = createAppIcon();
  tray = new Tray(icon);
  tray.setToolTip('场景录制助手 - 双击恢复');

  const contextMenu = Menu.buildFromTemplate([
    { label: '🎬 显示面板', click: () => showPanel() },
    { type: 'separator' },
    { label: '❌ 退出', click: () => { isQuitting = true; cleanupAndQuit(); } },
  ]);

  tray.setContextMenu(contextMenu);

  // 单击也显示面板（Windows 习惯）
  tray.on('click', () => {
    showPanel();
  });

  tray.on('double-click', () => {
    showPanel();
  });
}

function showPanel() {
  if (panelWindow) {
    panelWindow.show();
    panelWindow.focus();
    // ★ 不强制置顶，由渲染进程根据录制模式+浏览器状态控制
  } else {
    // 窗口已被销毁，重新创建
    createPanelWindow();
  }
}

function notifyPanel(channel, data) {
  if (panelWindow && !panelWindow.isDestroyed()) {
    panelWindow.webContents.send(channel, data);
  }
}

async function cleanupAndQuit() {
  try {
    if (browserManager) await browserManager.close();
  } catch (e) { /* ignore */ }
  if (tray) tray.destroy();
  app.quit();
}

app.whenReady().then(async () => {
  console.log('[main] 应用启动中...');

  await createPanelWindow();
  createTray();

  recorder = new Recorder({
    outputDir: getOutputDir(),
    onStateChange: (state) => {
      notifyPanel('stateSync', state);
    },
    onCaptureProgress: (msg) => {
      notifyPanel('captureProgress', msg);
    },
  });

  // ★ 初始化凭证存储（加密保存账号密码）
  credStore = new CredentialStore(path.join(app.getPath('userData'), 'credentials.json'));

  browserManager = new BrowserManager({
    recorder,
    onStateChange: (state) => {
      notifyPanel('stateSync', state);
    },
    onElementSelected: (data) => {
      notifyPanel('elementSelected', data);
    },
    onSelectionCancelled: () => {
      notifyPanel('selectionCancelled', {});
    },
    panelWindowGetter: () => panelWindow,
    userDataDir: getBrowserUserDataDir(), // ★ 持久化浏览器配置目录
    // ★ 登录表单检测 — 通知面板显示快捷登录区域
    onLoginFormDetected: (data) => {
      notifyPanel('loginFormDetected', data);
    },
    // ★ 登录提交捕获 — 通知面板弹出"保存密码"对话框
    onLoginSubmit: (data) => {
      notifyPanel('loginSubmit', data);
    },
    // ★ 浏览器关闭 — 通知面板更新窗口置顶状态
    onBrowserClosed: () => {
      notifyPanel('browserClosed', {});
    },
  });
  recorder.setBrowserManager(browserManager);

  const { setupIpc } = require('./ipc');
  setupIpc({ recorder, browserManager, panelWindowGetter: () => panelWindow, credStore });

  // ★ 渲染进程日志桥 —— 渲染进程 stdout 不连终端，排查多 tab 链路必须走这条桥
  ipcMain.on('renderer-log', (event, msg) => {
    console.log('[renderer]', msg);
  });

  // ★ 打开外部 URL（mailto:/tel:/ftp: 等非 http 协议），由 webview new-window 调用
  ipcMain.handle('open-external', async (event, url) => {
    try {
      if (typeof url !== 'string' || !url) {
        return { success: false, error: '无效的 URL' };
      }
      const { shell } = require('electron');
      await shell.openExternal(url);
      return { success: true };
    } catch (err) {
      console.error('[main] open-external 失败:', err);
      return { success: false, error: err.message };
    }
  });

  notifyPanel('stateSync', recorder.getState());

  console.log('[main] 应用启动完成（浏览器待用户输入URL后启动）');
});

// 不退出应用，保持托盘运行
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') {
    // macOS 保持运行
  }
  // Windows 也保持运行，用户通过托盘退出
});

app.on('before-quit', async () => {
  isQuitting = true;
  await cleanupAndQuit();
});

app.on('activate', () => {
  showPanel();
});
