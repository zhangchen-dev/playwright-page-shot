/**
 * IPC 处理器聚合入口 - 按功能拆分后统一注册
 * 原 ipc-handler.js 拆分为 main/ipc/ 下各功能模块
 */
const { registerRecorderIpc } = require('./recorder-ipc');
const { registerWindowIpc } = require('./window-ipc');
const { registerWebviewIpc } = require('./webview-ipc');
const { registerCredentialIpc } = require('./credential-ipc');
const { registerRecordingMgmtIpc } = require('./recording-mgmt-ipc');
const { registerPreviewIpc } = require('./preview-ipc');

function setupIpc(deps) {
  // deps: { recorder, browserManager, panelWindowGetter, credStore }
  registerRecorderIpc(deps);
  registerWindowIpc(deps);
  registerWebviewIpc(deps);
  registerCredentialIpc(deps);
  registerRecordingMgmtIpc(deps);
  registerPreviewIpc(deps);

  console.log('[IPC] 处理器已注册');
}

module.exports = { setupIpc };
