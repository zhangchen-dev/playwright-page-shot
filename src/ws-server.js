/**
 * WebSocket 服务 - 面板↔后端实时通信
 */
const { WebSocketServer } = require('ws');

class WsServer {
  constructor({ port, recorder }) {
    this.port = port;
    this.recorder = recorder;
    this.wss = null;
    this.clients = new Map(); // ws -> { pageId }
  }

  start() {
    this.wss = new WebSocketServer({ port: this.port });

    this.wss.on('connection', (ws) => {
      console.log('[WsServer] 新连接');

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          // 使用 Promise.catch 处理异步操作的错误
          Promise.resolve(this._handleMessage(ws, msg)).catch((err) => {
            console.error('[WsServer] 异步消息处理失败:', err);
          });
        } catch (err) {
          console.warn('[WsServer] 消息解析失败:', err.message);
        }
      });

      ws.on('close', () => {
        const clientInfo = this.clients.get(ws);
        if (clientInfo) {
          console.log(`[WsServer] 连接关闭: pageId=${clientInfo.pageId}`);
        }
        this.clients.delete(ws);
      });

      ws.on('error', (err) => {
        console.warn('[WsServer] 连接错误:', err.message);
        this.clients.delete(ws);
      });
    });

    console.log(`[WsServer] WebSocket 服务已启动: ws://localhost:${this.port}`);
  }

  async _handleMessage(ws, msg) {
    const { type } = msg;

    // 注册 pageId
    if (type === 'register') {
      this.clients.set(ws, { pageId: msg.pageId });
      console.log(`[WsServer] 面板已注册: pageId=${msg.pageId}`);
      // 发送当前录制状态给新连接的面板
      const state = this.recorder.getState();
      this._send(ws, { type: 'stateSync', state });
      return;
    }

    try {
      // 路由所有操作消息到 Recorder（支持异步操作）
      const result = await this.recorder.handleAction(type, msg);

      // 广播状态变更给所有面板
      if (result && result.stateChanged) {
        const state = this.recorder.getState();
        this.broadcast({ type: 'stateSync', state });
      }

      // 发送操作结果回发起者
      if (result && result.response) {
        this._send(ws, result.response);
      }
    } catch (err) {
      console.error('[WsServer] 处理消息失败:', err);
      this._send(ws, { type: 'error', message: err.message });
    }
  }

  _send(ws, data) {
    if (ws.readyState === 1) {
      // OPEN
      try {
        ws.send(JSON.stringify(data));
      } catch (e) {
        // ignore
      }
    }
  }

  /**
   * 广播消息到所有连接的面板
   * @param {object} data - 要广播的数据
   */
  broadcast(data) {
    const msg = JSON.stringify(data);
    for (const ws of this.clients.keys()) {
      if (ws.readyState === 1) {
        try {
          ws.send(msg);
        } catch (e) {
          // ignore
        }
      }
    }
  }

  close() {
    if (this.wss) {
      for (const ws of this.clients.keys()) {
        try {
          ws.close();
        } catch (e) {
          // ignore
        }
      }
      this.wss.close();
      this.clients.clear();
    }
  }
}

module.exports = { WsServer };
