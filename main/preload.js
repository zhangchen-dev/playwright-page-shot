/**
 * 预加载脚本 - 安全地暴露 IPC 接口给面板渲染进程
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ===== 录制操作 =====
  sendAction: (type, msg) => ipcRenderer.invoke('recorder-action', { type, ...msg }),

  // ===== 元素选择 =====
  enableSelectionMode: () => ipcRenderer.invoke('enable-selection-mode'),
  disableSelectionMode: () => ipcRenderer.invoke('disable-selection-mode'),

  // ===== 页面操作 =====
  getActivePageUrl: () => ipcRenderer.invoke('get-active-page-url'),
  navigateTo: (url) => ipcRenderer.invoke('navigate-to', url),
  getAllPages: () => ipcRenderer.invoke('get-all-pages'),
  setActivePage: (pageId) => ipcRenderer.invoke('set-active-page', pageId),

  // ===== 保存目录 =====
  selectSaveDirectory: () => ipcRenderer.invoke('select-save-directory'),
  setOutputDir: (dir) => ipcRenderer.invoke('set-output-dir', dir),

  // ===== 窗口控制 =====
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('set-always-on-top', flag),
  resizeWindow: (width) => ipcRenderer.invoke('resize-window', width),

  // ===== 浏览器状态 =====
  isBrowserLaunched: () => ipcRenderer.invoke('is-browser-launched'),

  // ===== 本地预览（应用内 Playwright 浏览器） =====
  previewExport: () => ipcRenderer.invoke('preview-export'),
  previewHtmlFile: (filePath) => ipcRenderer.invoke('preview-html-file', filePath),
  getRecordedExports: () => ipcRenderer.invoke('get-recorded-exports'),

  // ★ 后台管理：删除 / 下载 / 上传 / 获取存储目录
  deleteRecording: (dirPath) => ipcRenderer.invoke('delete-recording', dirPath),
  downloadRecording: (dirPath) => ipcRenderer.invoke('download-recording', dirPath),
  uploadRecording: (dirPath) => ipcRenderer.invoke('upload-recording', dirPath),
  getAppRecordingsDir: () => ipcRenderer.invoke('get-app-recordings-dir'),

  // ★ 凭证管理（密码快捷登录）
  getCredentials: (domain) => ipcRenderer.invoke('get-credentials', domain),
  getCredential: (data) => ipcRenderer.invoke('get-credential', data),
  fillCredentials: (data) => ipcRenderer.invoke('fill-credentials', data),
  saveCredential: (data) => ipcRenderer.invoke('save-credential', data),
  deleteCredential: (data) => ipcRenderer.invoke('delete-credential', data),
  getAllCredentials: () => ipcRenderer.invoke('get-all-credentials'),

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

  // ===== 清理 =====
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
