/**
 * Electron API 桥接 — 封装 window.electronAPI 与 sendAction
 */
const api = window.electronAPI;

export { api };

/** 发送录制动作到后端 */
export function sendAction(type, extraData = {}) {
  return api.sendAction(type, extraData);
}
