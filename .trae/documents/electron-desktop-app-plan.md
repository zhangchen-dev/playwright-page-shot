# 将页面录制工具改造为 Electron 桌面应用

## Context

当前项目是 CLI + WebSocket 架构：用户通过命令行启动，面板以浮动窗口注入到 Playwright 浏览器页面中。用户希望将其改造为一个**可下载安装的桌面应用**，拥有独立的操作界面窗口（参考 Chrome 插件的面板样式），同时打开 Playwright 浏览器供用户浏览页面。

## 核心架构变化

```
现有：CLI → Playwright浏览器（注入浮动面板）↕ WebSocket → Node.js后端
新的：Electron桌面应用 → 控制面板窗口(Electron BrowserWindow) ↕ IPC → 主进程 → Playwright浏览器（注入轻量元素选择脚本）
```

**关键变化**：
1. 面板从浏览器内注入的浮窗 → Electron 独立窗口（更稳定、不依赖页面）
2. WebSocket → Electron IPC（面板在同一进程中，通信更高效）
3. 元素选择：通过 `page.exposeFunction` 桥接 Playwright 页面到主进程

## 新文件结构

```
playwright-page-shot/
├── package.json                    # 新增 electron, electron-builder
├── electron-builder.yml            # 打包配置
├── main/                           # Electron 主进程
│   ├── main.js                     # 应用入口：窗口创建、生命周期
│   ├── ipc-handler.js              # IPC 消息中转（替代 ws-server.js）
│   └── preload.js                  # 安全 IPC 接口暴露
├── renderer/                       # 面板渲染进程
│   ├── panel.html                  # 面板 HTML
│   ├── panel.css                   # 面板样式（暗色+蓝调，从 panel-styles.js 转换）
│   └── panel.js                    # 面板逻辑（从 panel-inject.js 迁移，改用 IPC）
├── src/                            # 核心业务逻辑（保留+适配）
│   ├── browser-manager.js          # [适配] 移除wsServer依赖，加IPC回调+元素选择桥接
│   ├── recorder.js                 # [适配] broadcast→回调，handleAction保留
│   ├── html-capture.js             # [保留] 不变
│   ├── css-utils.js                # [保留] 不变
│   ├── export.js                   # [保留] 不变
│   └── inject/
│       └── element-helper.js       # [新增] 轻量注入脚本：仅负责元素选择/高亮
└── output/
```

## 实施步骤

### Step 1: 安装 Electron 依赖 + 更新 package.json

- 新增 `electron` 和 `electron-builder` 为 devDependencies
- 移除 `ws` 和 `commander`（不再需要）
- `main` 字段改为 `main/main.js`
- 添加 `start`, `build:win` 等脚本

### Step 2: 创建 Electron 主进程 `main/main.js`

- `app.whenReady()` 后创建控制面板 BrowserWindow（宽400px，放在屏幕左侧）
- 创建 Recorder、BrowserManager 实例
- 启动 Playwright 浏览器
- 注册 IPC 处理
- 支持窗口位置联动（Playwright 浏览器在面板右侧）

### Step 3: 创建预加载脚本 `main/preload.js`

通过 `contextBridge.exposeInMainWorld('electronAPI', ...)` 暴露：
- `sendAction(type, msg)` → ipcRenderer.invoke
- `enableSelectionMode()` / `disableSelectionMode()`
- `getActivePageUrl()` / `navigateTo(url)`
- `onStateSync` / `onElementSelected` / `onCaptureProgress` 事件监听

### Step 4: 创建 IPC 处理 `main/ipc-handler.js`

替代 ws-server.js，注册：
- `ipcMain.handle('recorder-action')` → `recorder.handleAction()`
- `ipcMain.handle('enable-selection-mode')` → `browserManager.enableSelectionMode()`
- `ipcMain.handle('disable-selection-mode')` → `browserManager.disableSelectionMode()`
- `ipcMain.handle('navigate-to')` → Playwright page.goto

### Step 5: 适配 `src/browser-manager.js`

- 构造函数参数：`wsServer` → `{ onStateChange, onCaptureProgress }`
- 添加 `enableSelectionMode()` / `disableSelectionMode()`：调用 `page.evaluate()` 触发 element-helper
- 新增 `_injectElementHelper(page)` + `_exposeFunctions(page, pageId)`：注入选择脚本并桥接回调
- `page.exposeFunction('__recOnElementSelected')` → 通知面板窗口
- 导航重注入：`page.on('load')` 时重新注入 element-helper
- 打包后 Chromium 路径处理：`app.isPackaged` 判断

### Step 6: 适配 `src/recorder.js`

- 构造函数新增 `onStateChange` / `onCaptureProgress` 回调
- `_nextStep` 中的 `wsServer.broadcast` → `onCaptureProgress()` / `onStateChange()`
- `handleAction` 接口不变

### Step 7: 创建元素选择注入脚本 `src/inject/element-helper.js`

仅负责 DOM 层面交互：
- 高亮遮罩 overlay
- 选择模式的事件拦截（click → 设置 elementId → 调用 `window.__recOnElementSelected()`)
- Esc 退出选择
- 暴露 `window.__recHelper` 对象供主进程调用

### Step 8: 创建面板 UI `renderer/panel.html` + `panel.css` + `panel.js`

从 `panel-inject.js` 迁移，核心改造：
- DOM 动态创建 → 静态 HTML + CSS 分离
- `sendMsg()` → `window.electronAPI.sendAction()`
- `ws.onmessage` → `window.electronAPI.onStateSync()`
- 元素选择：面板点击按钮 → IPC → 主进程 → Playwright 页面启用选择 → 用户点击 → exposeFunction → 主进程 → IPC → 面板更新
- 面板样式：暗色主题 + 蓝调高亮（从 panel-styles.js 的内联样式转换为 CSS 类）
- 新增 URL 导航栏（面板顶部，可直接输入URL导航）
- 窗口可拖拽（`-webkit-app-region: drag`）

### Step 9: 配置打包 `electron-builder.yml`

- 包含 Playwright Chromium 作为 extraResources
- Windows NSIS 安装包
- 应用图标

### Step 10: 测试验证

1. `npm start` 启动 Electron 应用
2. 验证：面板窗口 + Playwright 浏览器同时出现
3. 完整录制流程测试
4. `npm run build:win` 打包测试

## 关键文件对照

| 旧文件 | 新文件 | 变化 |
|--------|--------|------|
| src/index.js (CLI入口) | main/main.js (Electron入口) | 重写 |
| src/ws-server.js | main/ipc-handler.js | 通信方式替换 |
| src/panel/panel-inject.js | renderer/panel.js + panel.html | DOM注入→独立窗口 |
| src/panel/panel-styles.js | renderer/panel.css | 内联样式→CSS类 |
| src/browser-manager.js | src/browser-manager.js | 适配IPC+元素选择桥接 |
| src/recorder.js | src/recorder.js | broadcast→回调 |
| (无) | src/inject/element-helper.js | 新增轻量注入脚本 |
| src/html-capture.js | 不变 | - |
| src/css-utils.js | 不变 | - |
| src/export.js | 不变 | - |
