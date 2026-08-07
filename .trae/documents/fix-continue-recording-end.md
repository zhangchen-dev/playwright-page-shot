# 修复"继续录制"后无法结束保存的问题

## Context（背景与原因）

用户在"场景管理"菜单点击"▶ 继续录制"后，进入"页面录制"视图，但**无法结束录制**：点击"结束并保存"按钮后无响应、UI 卡死。

### 根本原因（多重故障）

**主因（P0）— `captureWebviewData` 在未加载的 webview 上挂起**

- `renderer\modules\recording\internal\webview-recording.js:237-285` 的 `captureWebviewData`
- 继续录制后：`appState.state.phase = 'recording'`，但 `appState.browserLaunched` 仍为 `false`（用户从未在 URL 栏打开浏览器）
- 用户点"结束并保存" → `handleEndAndSave()`（`recording-actions.js:51-138`）弹出"环境配置"对话框
- 用户确认后，代码走到 `recording-actions.js:89-95`：
  ```js
  if (appState.browserMode === 'in-app') {
    webviewData = await captureWebviewData();  // ★ 永久挂起
  }
  ```
- `captureWebviewData` 在 `about:blank` 状态的 webview 上调用 `executeJavaScript`，由于未触发 `did-finish-load` 事件，**Promise 永远不会 resolve**
- UI 看起来"卡死"，因为后续 `sendAction('endAndSave')` 永远不被调用

**次因（P1）— 残留的 dialog overlay**

- `renderer\modules\common\feedback.js` 的 `showConfirmDialog` / `showDialog` 直接 `document.body.appendChild(overlay)`，未先清理已有 overlay
- CSS `z-index: 999999`，固定定位全屏
- 如果前一个 dialog 因异常未正确移除（叠加或回调异常），会阻挡所有 UI 元素

**辅因（P1）— 视图切换时未清理残留 overlay**

- `layout.js` 的 `requestSwitchView` / `switchView` 无清理逻辑
- `management-view.js` 的 `renderManagementView` 直接 `c.innerHTML = ''`，未清理 document.body 上的 overlay

### 期望效果

修复后：
- 继续录制后直接点"结束并保存"也能正常工作
- 若浏览器未开，自动跳过 webview 捕获，使用已有数据保存
- 若有异常残留的 dialog overlay，切换视图时自动清理
- 用户体验流畅，不会卡死

---

## 实施步骤

### 步骤 1：P0 — 修复 `captureWebviewData` 挂起问题

**文件**：`d:\code_prj\playwright-page-shot\renderer\modules\recording\internal\webview-recording.js`
**位置**：`captureWebviewData` 函数（第 237-285 行）

**修改内容**：
1. 函数入口增加双重守卫：
   - `!appState.browserLaunched` → 直接 `return null`
   - `webview.getURL() === 'about:blank'` 或空 → 直接 `return null`
2. 为两个 `executeJavaScript` 调用加 `Promise.race` 超时保护（3000ms）

```js
export async function captureWebviewData() {
  const webview = document.getElementById('previewWebview');
  if (!webview) return null;

  // ★ P0 防御：浏览器未启动或 webview 未加载内容时直接返回，避免 executeJavaScript 挂起
  if (!appState.browserLaunched) {
    console.log('[panel] 浏览器未启动，跳过 webview 数据捕获');
    return null;
  }
  const currentUrl = webview.getURL();
  if (!currentUrl || currentUrl === 'about:blank') {
    console.log('[panel] webview 未加载内容，跳过数据捕获');
    return null;
  }

  // ★ 超时保护：防止 executeJavaScript 永久挂起
  const withTimeout = (promise, ms, label) => Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(label + ' 超时 (' + ms + 'ms)')), ms)
    ),
  ]);

  // ... 原有 cleanupCode + cssFetchCode
  try {
    const html = await withTimeout(webview.executeJavaScript(cleanupCode), 3000, 'HTML 捕获');
    const cssJson = await withTimeout(webview.executeJavaScript(cssFetchCode), 3000, 'CSS 捕获');
    let cssContents = [];
    try { cssContents = JSON.parse(cssJson); } catch (e) {}
    return { url: currentUrl, html, cssContents };
  } catch (err) {
    console.warn('[panel] 捕获 webview 数据失败:', err.message);
    return null;
  }
}
```

---

### 步骤 2：P0 — 在 `handleEndAndSave` 增加软提示

**文件**：`d:\code_prj\playwright-page-shot\renderer\modules\recording\shared\recording-actions.js`
**位置**：`handleEndAndSave` 函数（第 51-138 行）

**修改内容**：在 `showEnvConfigDialog` 之后、捕获 webview 数据之前，根据 `browserLaunched` 决定是否捕获：

```js
// 在第 78 行（showEnvConfigDialog 之后）插入：

// ★ 警告：未打开浏览器时给出明确提示
if (!appState.browserLaunched) {
  showToast('提示：浏览器未打开，将使用已加载数据保存', 'info', 3000);
}

// 替换第 87-95 行的 webviewData 捕获块：
let webviewData = null;
if (appState.browserLaunched && appState.browserMode === 'in-app') {
  try {
    webviewData = await captureWebviewData();
  } catch (err) {
    console.warn('[panel] 捕获 webview 数据失败:', err.message);
  }
}
```

**说明**：
- `captureWebviewData` 现在自身已有守卫，这里再加一层冗余保护
- toast 提示让用户知道当前状态

---

### 步骤 3：P1 — 视图切换时清理残留 dialog overlay

**文件**：`d:\code_prj\playwright-page-shot\renderer\modules\common\layout.js`
**位置**：`requestSwitchView`（第 189 行）和 `switchView`（第 53 行）

**修改内容**：在两个函数入口添加清理逻辑：

```js
// requestSwitchView 第 190 行后插入：
export function requestSwitchView(view) {
  if (!view) return;
  // ★ 防御：清理可能残留的 dialog overlay（防止异常残留阻挡 UI）
  document.querySelectorAll('.dialog-overlay').forEach((o) => o.remove());
  if (view === appState.currentView) return;
  // ... 原有逻辑
}

// switchView 第 53 行后插入：
export function switchView() {
  // ★ 防御：清理残留 dialog overlay
  document.querySelectorAll('.dialog-overlay').forEach((o) => o.remove());
  // ... 原有逻辑
}
```

---

### 步骤 4：P1 — 防止 dialog 叠加

**文件**：`d:\code_prj\playwright-page-shot\renderer\modules\common\feedback.js`
**位置**：`showConfirmDialog`（第 30 行）、`showDialog`（第 52 行）、`showEnvConfigDialog`（第 91 行）

**修改内容**：在每个 `document.body.appendChild(overlay)` 之前先清理已有 overlay。

```js
// showConfirmDialog 第 48 行前插入：
// ★ 防止叠加：清理已有 dialog overlay
document.querySelectorAll('.dialog-overlay').forEach((o) => o.remove());
document.body.appendChild(overlay);

// showDialog 第 86 行前同样插入：
document.querySelectorAll('.dialog-overlay').forEach((o) => o.remove());
document.body.appendChild(overlay);
return overlay;

// showEnvConfigDialog 第 185 行前同样插入：
document.querySelectorAll('.dialog-overlay').forEach((o) => o.remove());
document.body.appendChild(overlay);
setTimeout(() => sceneCodeInput.focus(), 50);
```

**说明**：可以提取为辅助函数 `cleanDialogOverlays()`，但为简化直接内联即可。

---

### 步骤 5：P1 — `renderManagementView` 入口清理

**文件**：`d:\code_prj\playwright-page-shot\renderer\modules\management\management-view.js`
**位置**：`renderManagementView` 函数（第 12 行）

**修改内容**：在清空 content 前清理所有 overlay：

```js
export async function renderManagementView() {
  // ★ 防御：清理所有残留 dialog overlay（防止跨视图切换时残留的 dialog 阻挡 UI）
  document.querySelectorAll('.dialog-overlay').forEach((o) => o.remove());
  const c = document.getElementById('content');
  if (!c) return;
  // ... 原有逻辑
}
```

---

## 关键文件清单

| 优先级 | 文件 | 修改内容 |
|---|---|---|
| **P0** | `renderer\modules\recording\internal\webview-recording.js` | `captureWebviewData` 入口守卫 + 超时 |
| **P0** | `renderer\modules\recording\shared\recording-actions.js` | `handleEndAndSave` 增加 `browserLaunched` 检查 + toast 提示 |
| **P1** | `renderer\modules\common\layout.js` | `requestSwitchView` + `switchView` 入口清理 overlay |
| **P1** | `renderer\modules\common\feedback.js` | 三个 dialog 函数防叠加 |
| **P1** | `renderer\modules\management\management-view.js` | `renderManagementView` 入口清理 overlay |

---

## 验证方案

### 前置：清理旧进程 + 启动调试

```powershell
# 清理可能残留的 electron 进程
Stop-Process -Name electron -Force -ErrorAction SilentlyContinue
```

```bash
cd d:\code_prj\playwright-page-shot
npm start
```
（确认应用启动后，用 CDP 调试脚本验证）

### CDP 验证脚本

**文件**：`d:\code_prj\playwright-page-shot\cdp-verify-fix.js`（新增）

**验证步骤**：
1. 连接 `http://127.0.0.1:9222`，找到 panel.html 页面
2. 切到"场景管理"菜单
3. 点击"继续录制"按钮
4. 验证：当前视图 = recording，phase = recording，无 overlay 残留
5. 点击"结束并保存"按钮
6. 验证：弹出"资源配置"对话框（最多 1 个）
7. 输入场景码 → 点击确认
8. **关键**：等待 5 秒，验证 UI 不卡死（可继续交互）
9. 检查控制台无 "executeJavaScript 超时" 错误
10. 截图存档到 `cdp-fix-verify.png`

**通过标准**：
- ✅ 步骤 8 后 `overlayCount` < 3（正常 0 或 1）
- ✅ 控制台无 `executeJavaScript 超时` 错误
- ✅ 用户能看到 toast 提示或保存完成提示

### 手动验证清单

- [ ] 场景管理 → 点"继续录制" → 切到录制视图正常
- [ ] 录制视图 → 点"结束并保存" → 出现"资源配置"对话框
- [ ] 填场景码 → 确认 → 5 秒内出现保存成功 toast 或"是否关闭浏览器"对话框
- [ ] 重复点击菜单快速切换，无 dialog overlay 残留
- [ ] 浏览器未打开时点"结束并保存"，能正常保存（不卡死）

---

## 风险与回滚

### 风险评估
- **P0 修改**：仅在已有 `try/catch` 内增加早返回和超时，最小风险
- **P1 修改**：清理逻辑可能误删正在使用的 dialog，但 `requestSwitchView` / `switchView` 触发时通常意味着用户主动操作，对话框交互已结束

### 回滚方案
- 所有修改集中在 `renderer\modules\` 下，不涉及后端
- 可通过 git 回滚到上一个提交
- 如果 P1 修改造成问题，可仅保留 P0 修复（已能解决主因）
