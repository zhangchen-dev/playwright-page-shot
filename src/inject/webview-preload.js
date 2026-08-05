/**
 * webview preload 脚本 — 在 webview 页面加载前注入
 *
 * 使用 contextBridge 将 __recSendToHost 暴露到页面主世界，
 * 这样通过 executeJavaScript 注入的 element-helper 脚本可以调用它。
 *
 * ★ 为什么用 contextBridge：
 *    Electron 默认 contextIsolation=true，preload 脚本运行在隔离世界中，
 *    直接 window.xxx = fn 设置的变量对主世界不可见。
 *    contextBridge.exposeInMainWorld 是官方推荐的跨隔离边界暴露 API 的方式。
 *
 * 通信链路：
 *   element-helper (主世界) → window.__recSendToHost(channel, data)
 *   → contextBridge 代理 → ipcRenderer.sendToHost(channel, data) (隔离世界)
 *   → 宿主页面的 webview 'ipc-message' 事件 (modules/recording/internal/webview-recording.js setupWebviewIpcListener)
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__recSendToHost', function (channel, data) {
  ipcRenderer.sendToHost(channel, data || {});
});
