/**
 * Electron API 桥接 — 封装 window.electronAPI 与 sendAction
 */
const api = window.electronAPI;

export { api };

/** 发送录制动作到后端 */
export function sendAction(type, extraData = {}) {
  return api.sendAction(type, extraData);
}

/** 生成地图预览（仅临时目录，不影响导出） */
export function generateMapPreview(payload) {
  return api.generateMapPreview(payload);
}
