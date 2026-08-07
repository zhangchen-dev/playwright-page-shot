# 修复重录导航竞态 + 内置浏览器新Tab支持

## Context

用户报告两个问题需要修复：

**1.0 重录没有正确跳转到表单页面**

用户从管理视图的预览面板点击"🔄 重录该步骤"按钮后，菜单正确切换到"页面录制"，但中间栏没有正确显示录制表单（重录模式横幅 + 模块/步骤表单），反而显示管理视图的场景列表或处于加载中状态。

**根本原因**：竞态条件。
- 后端 `_startReRecord`（recorder.js:737-770）先调用 `_notifyStateChange()` 同步触发 `webContents.send('stateSync', state)`，再返回 IPC 响应
- 前端 `app.js:35-38` 的 stateSync 处理器按 `currentView` 判断：若还是 `management` 就调用 `renderManagementView()`，但 `renderManagementView()` 是 async 函数，先同步执行 `c.innerHTML = ''` 清空中间列内容，然后 await `api.getRecordedExports()`，最后再次 `c.innerHTML = ''` 渲染场景卡片
- 这两步 `c.innerHTML = ''` 都在 `doStartReRecord` 还没调用 `requestSwitchView('recording')` 之前完成，覆盖了 `requestSwitchView` 触发的 `renderRecordingPhase` 结果

**2.0 内置浏览器录制时点击需要打开新Tab的按钮无反应**

`renderer/panel.html:101` 的 webview 标签缺少 `webpreferences="allowpopups"` 属性，且 `webview-controls.js` 没有注册 `new-window` 事件监听器，导致 Electron 默认静默阻止 `window.open()` 和 `target="_blank"` 导航。

## 实现方案

### Fix 1: 重录导航竞态（三处协同修改）

#### 1.1 `renderer/modules/recording/rerecord/rerecord-flow.js`

在 `doStartReRecord` 中：
- **在 `await api.rerecordStep()` 之前**同步设置 `appState._continueRecordingMode = true`（后端在 invoke 响应返回前已经发送了 stateSync，提前设标志可让 stateSync 处理器识别流程）
- **失败时回滚** `appState._continueRecordingMode = false`
- 顶部新增 `import { rerenderPanel } from '../../app.js';`

#### 1.2 `renderer/modules/app.js`

修改 `api.onStateSync` 处理器（约 20-40 行）：
- 在原本"管理视图下不重渲染录制面板"分支之前，新增"继续录制/重录流程自动切换视图"分支：当 `appState._continueRecordingMode === true` 且 `newState.phase === 'recording'` 且 `appState.currentView !== 'recording'` 时，直接同步设置 `currentView = 'recording'`、更新菜单高亮、显示 URL 栏/浏览器模式行、调用 `rerenderPanel()` 后 return
- 失败时已有回滚

#### 1.3 `renderer/modules/management/management-view.js`

在 `renderManagementView` 函数顶部（`c.innerHTML = ''` 之前）加早期守卫：`if (appState.currentView !== 'management') return;`，防止视图已切换时还清空 content。已有的 await 之后守卫（line 25）保留作为双保险。

### Fix 2: 内置浏览器新Tab支持（四处协同修改）

#### 2.1 `renderer/panel.html`

修改 line 101 webview 标签为：
```html
<webview id="previewWebview" class="preview-webview-inner" partition="persist:webview" webpreferences="allowpopups"></webview>
```
HTML 属性是小写 `webpreferences`（不是 `webPreferences`）。`allowpopups` 是 `new-window` 事件能触发的必要条件。

#### 2.2 `renderer/modules/common/webview-controls.js`

在 `initBrowserModeControls()` 的 `if (webview)` 块内（最后一个 `did-fail-load` 监听器之后），新增 `new-window` 事件监听器：

```javascript
webview.addEventListener('new-window', (event) => {
  event.preventDefault();
  const newUrl = event.url;
  if (!newUrl) return;
  if (!/^https?:\/\//i.test(newUrl)) {
    // 非 http(s) 协议：邮件/电话/FTP 等用系统默认应用打开
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(newUrl).then((result) => {
        if (!result?.success) showToast('无法打开链接: ' + (result?.error || newUrl), 'error');
      });
    }
    return;
  }
  // http(s) 协议：当前 webview 导航到新 URL
  //    did-start-loading → did-finish-load 事件会触发，element-helper/credential-helper 会重新注入
  try { webview.loadURL(newUrl); } catch (err) {
    console.error('[panel] 导航新窗口 URL 失败:', err);
    showToast('导航失败: ' + err.message, 'error');
  }
});
```

`showToast` 已经在第 6 行导入，无需新增 import。

#### 2.3 `main/preload.js`

在 `electronAPI` 对象中暴露新 IPC：
```javascript
openExternal: (url) => ipcRenderer.invoke('open-external', url),
```

#### 2.4 `main/main.js`

在 `app.whenReady().then(...)` 内部（`setupIpc` 之后）注册 `open-external` handler：
```javascript
ipcMain.handle('open-external', async (event, url) => {
  try {
    if (typeof url !== 'string' || !url) {
      return { success: false, error: '无效的 URL' };
    }
    const { shell } = require('electron');
    await shell.openExternal(url);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
```

## 关键复用

- `appState._continueRecordingMode`（state.js:70）— 已有标志，本次仅调整使用时机
- `appState.currentView`（state.js:53）— 已有字段
- `rerenderPanel()`（app.js:119-143）— 已有渲染入口
- `appState.state.phase`（state.js:9）— 后端通过 `getState()` 同步
- `webview.loadURL()` — Electron 内置 API，等同于 `webview.src = url` 但更可靠
- `webContents.send('stateSync', ...)` — main.js:147-151 已有 `notifyPanel` 工具
- `did-start-loading` / `did-finish-load` 处理器（webview-controls.js:208-232）— 已有，导航后会自动重新注入 element-helper/credential-helper

## 涉及文件

| 文件 | 改动行数 | 用途 |
|------|---------|------|
| `renderer/modules/recording/rerecord/rerecord-flow.js` | ~15 行 | Fix 1.1：调整标志位设置时机 |
| `renderer/modules/app.js` | ~25 行 | Fix 1.2：stateSync 处理器自动切视图 |
| `renderer/modules/management/management-view.js` | ~4 行 | Fix 1.3：早期守卫 |
| `renderer/panel.html` | 1 行 | Fix 2.1：webpreferences 属性 |
| `renderer/modules/common/webview-controls.js` | ~25 行 | Fix 2.2：new-window 监听器 |
| `main/preload.js` | ~2 行 | Fix 2.3：暴露 openExternal |
| `main/main.js` | ~12 行 | Fix 2.4：注册 IPC handler |

所有文件修改后均不超过 800 行约束。

## 验证步骤

### 重录表单 (Fix 1) 验证

1. 启动应用：`cd d:\code_prj\playwright-page-shot && npm start`
2. 切换到"🗂️ 场景管理"菜单
3. 点击任一场景的"🔍 预览"
4. 在右栏步骤选择器中点击"🔄 重录该步骤"
5. 确认对话框点"开始重录"
6. **期望**：
   - 左菜单切到"页面录制"（高亮）
   - 中间列显示重录模式横幅（顶部蓝色横条 + "放弃重录"按钮）
   - 横幅下方显示模块/主步骤表单
   - 弹出"🔄 重录模式就绪"对话框
   - 状态栏显示"重录模式: 模块「...」步骤「...」"
7. DevTools Console 无错误
8. 验证 state：
   ```javascript
   window.appState.currentView      // 'recording'
   window.appState.state.phase      // 'recording'
   window.appState.state.reRecord?.active  // true
   document.querySelector('.rerecord-banner')  // 存在
   ```

### 新Tab (Fix 2) 验证

1. 启动应用，在中间栏 URL 输入 `https://example.com` 点击 →
2. 浏览器加载后，在 DevTools console 注入测试链接并点击：
   ```javascript
   const w = document.getElementById('previewWebview');
   await w.executeJavaScript(`
     (function() {
       const a = document.createElement('a');
       a.href = 'https://example.org';
       a.target = '_blank';
       a.textContent = 'Test';
       a.id = '__t';
       document.body.appendChild(a);
       a.click();
     })();
   `);
   ```
3. **期望**：
   - webview 在原位置导航到 `https://example.org`（不打开新窗口）
   - 状态栏 URL 同步更新
   - `did-finish-load` 事件触发，element-helper 脚本重新注入
   - 控制台日志：`[panel] 元素选择 + 凭证辅助脚本已注入 webview`
4. 测试 `window.open`：在 webview 控制台运行 `window.open('https://example.com')`，应同样在当前 webview 中导航
5. 测试 `mailto:`：在 webview 页面中点击 `<a href="mailto:test@test.com">` 链接，应调用系统默认邮件客户端

### 退出代码状态检查

- 杀旧 electron 进程：`Stop-Process -Name electron -Force`（需 sandbox 关闭）
- 重新启动：`npm start`
- 验证进程数：`(Get-Process -Name electron).Count` 应约 4

## 风险与边界

**Fix 1**:
- 快速双击重录：确认对话框是模态的，第二次点击被忽略。如观察到可加 `if (appState._continueRecordingMode) return;` 守卫
- 重录期间用户点"放弃重录"：cancel IPC 与 rerecordStep 独立，可能被后端接受或拒绝，UI 状态自洽
- 失败回滚：rerecordStep 失败时 `_continueRecordingMode` 设为 false
- view 已是 'recording'：stateSync 处理器跳过新分支，落到正常 `rerenderPanel()`

**Fix 2**:
- 同一 webview 中替换会丢失原页面：符合单 webview 设计
- `about:blank` URL：会清空当前 webview，符合预期
- CSP：仅作用于 panel 页，webview 内部内容不受影响
- partition 持久化：与 URL 无关，cookies/session 保留
