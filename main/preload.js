/**
 * 预加载脚本 - 安全地暴露 IPC 接口给面板渲染进程
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ===== 录制操作 =====
  sendAction: (type, msg) => ipcRenderer.invoke('recorder-action', { type, ...msg }),

  // ★ 元素选择由应用内 webview 注入脚本完成（enableWebviewSelectionMode /
  //   disableWebviewSelectionMode），不再提供外部浏览器选择模式 IPC。

  // ===== 保存目录 =====
  selectSaveDirectory: () => ipcRenderer.invoke('select-save-directory'),
  setOutputDir: (dir) => ipcRenderer.invoke('set-output-dir', dir),

  // ===== 窗口控制 =====
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('set-always-on-top', flag),
  resizeWindow: (width) => ipcRenderer.invoke('resize-window', width),

  // ★ 获取注入脚本内容（用于应用内 webview 元素选择）
  getInjectScript: (scriptName) => ipcRenderer.invoke('get-inject-script', scriptName),

  // ★ Cookie 同步 — Playwright ↔ webview
  syncCookiesToWebview: () => ipcRenderer.invoke('sync-cookies-to-webview'),
  syncCookiesFromWebview: () => ipcRenderer.invoke('sync-cookies-from-webview'),

  // ★ 获取 webview preload 脚本路径
  getWebviewPreloadPath: () => ipcRenderer.invoke('get-webview-preload-path'),

  // ===== 本地预览（应用内 Playwright 浏览器） =====
  previewExport: () => ipcRenderer.invoke('preview-export'),
  previewHtmlFile: (filePath) => ipcRenderer.invoke('preview-html-file', filePath),
  // ★ 地图预览：将录制场景转换为地图 + 步骤内容的预览（仅临时目录，不影响导出）
  generateMapPreview: (payload) => ipcRenderer.invoke('generate-map-preview', payload),
  getRecordedExports: () => ipcRenderer.invoke('get-recorded-exports'),

  // ★ 后台管理：删除 / 下载 / 上传 / 同步到生产 / 获取存储目录
  deleteRecording: (dirPath) => ipcRenderer.invoke('delete-recording', dirPath),
  downloadRecording: (dirPath) => ipcRenderer.invoke('download-recording', dirPath),
  uploadRecording: (dirPath) => ipcRenderer.invoke('upload-recording', dirPath),
  syncToPrd: (dirPath) => ipcRenderer.invoke('sync-to-prd', dirPath),
  getAppRecordingsDir: () => ipcRenderer.invoke('get-app-recordings-dir'),

  // ★ 继续录制
  continueRecording: (dirPath) => ipcRenderer.invoke('continue-recording', dirPath),

  // ★ 重录该步骤
  rerecordStep: (payload) => ipcRenderer.invoke('rerecord-step', payload),
  cancelRerecord: () => ipcRenderer.invoke('cancel-rerecord'),
  reloadRecording: (dirPath) => ipcRenderer.invoke('reload-recording', dirPath),

  // ★ 打开外部 URL（系统默认应用，处理 mailto:/tel:/ftp: 等非 http 协议）
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // ★ 渲染进程日志转主进程终端（渲染进程 console.log 在终端不可见）
  logMain: (msg) => ipcRenderer.send('renderer-log', String(msg)),

  // ★ webview 新窗口事件 — 主进程 setWindowOpenHandler 拦截后通过 IPC 通知渲染进程
  onWebviewOpenWindow: (callback) => {
    ipcRenderer.on('webview-open-window', (event, data) => callback(data));
  },

  // ★ 凭证管理（密码快捷登录）
  getCredentials: (domain) => ipcRenderer.invoke('get-credentials', domain),
  getCredential: (data) => ipcRenderer.invoke('get-credential', data),
  saveCredential: (data) => ipcRenderer.invoke('save-credential', data),
  deleteCredential: (data) => ipcRenderer.invoke('delete-credential', data),
  getAllCredentials: () => ipcRenderer.invoke('get-all-credentials'),
  // ★ 凭证填充走应用内 webview 注入（fillWebviewCredentials），不再经主进程 BrowserManager。

  // ===== 事件监听 =====
  onStateSync: (callback) => {
    ipcRenderer.on('stateSync', (event, state) => callback(state));
  },
  onElementSelected: (callback) => {
    ipcRenderer.on('elementSelected', (event, data) => callback(data));
  },
  onSelectionCancelled: (callback) => {
    ipcRenderer.on('selectionCancelled', (event) => callback());
  },
  onCaptureProgress: (callback) => {
    ipcRenderer.on('captureProgress', (event, msg) => callback(msg));
  },
  onError: (callback) => {
    ipcRenderer.on('error', (event, data) => callback(data));
  },
  onSaveComplete: (callback) => {
    ipcRenderer.on('saveComplete', (event, data) => callback(data));
  },
  // ★ 登录表单检测事件
  onLoginFormDetected: (callback) => {
    ipcRenderer.on('loginFormDetected', (event, data) => callback(data));
  },
  // ★ 登录提交捕获事件
  onLoginSubmit: (callback) => {
    ipcRenderer.on('loginSubmit', (event, data) => callback(data));
  },
  // ★ 浏览器关闭事件
  onBrowserClosed: (callback) => {
    ipcRenderer.on('browserClosed', (event) => callback());
  },

  // ===== 多 tab（target=_blank 拦截后由 tabs.js 开新 webview tag） =====
  // ★ 监听主进程推送的 open-tab 事件
  onAppOpenTab: (callback) => {
    ipcRenderer.on('app-open-tab', (event, data) => callback(data));
  },
  // 兜底：旧 webview-new-window 事件
  onWebviewNewWindow: (callback) => {
    ipcRenderer.on('webview-new-window', (event, data) => callback(data));
  },

  // ===== 清理 =====
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
