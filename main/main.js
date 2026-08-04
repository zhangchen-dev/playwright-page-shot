/**
 * Electron 主进程 - 应用入口
 */
const { app, BrowserWindow, screen, Tray, Menu, nativeImage, dialog } = require('electron');
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
  return path.join(app.getPath('documents'), 'playwright-page-shot', 'output');
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
  const { height: screenHeight } = primaryDisplay.workAreaSize;
  const { width: screenWidth } = primaryDisplay.workAreaSize;

  const panelWidth = 380;
  const panelHeight = Math.min(screenHeight - 40, 780);

  panelWindow = new BrowserWindow({
    width: panelWidth,
    height: panelHeight,
    x: screenWidth - panelWidth - 10,
    y: 20,
    title: '场景录制助手',
    resizable: true,
    minimizable: true,
    maximizable: false,
    frame: true,
    autoHideMenuBar: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,  // 先隐藏，加载完再显示
    icon: createAppIcon(),
    minWidth: 380, // ★ 最小宽度 = 面板宽度
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
    panelWindow.setAlwaysOnTop(true);
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
  });
  recorder.setBrowserManager(browserManager);

  const { setupIpc } = require('./ipc-handler');
  setupIpc({ recorder, browserManager, panelWindowGetter: () => panelWindow, credStore });

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
