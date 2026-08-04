# 三栏布局重构 + 应用自有目录存储 + 后台管理 + 上传功能

## Context

当前应用是 380px 固定宽度的双栏布局（面板 + webview 预览），录制内容保存到用户手动选择的目录，且步骤记录显示在面板底部。用户需要：
1. 改为三栏布局（左侧菜单 + 中间内容 + 右侧可折叠面板），支持「页面录制」和「后台管理」两个视图
2. 录制内容保存到应用自有目录（用户不可选），跨重启持久化
3. 后台管理支持预览、删除、下载（拷贝文件夹）、上传功能
4. 最大化支持 + 错误 Toast 弹窗

核心设计原则：**保留所有现有录制逻辑**（recorder.js / export.js / html-capture.js / browser-manager.js 不动），改动集中在 6 个 UI/主进程文件。

---

## 1. HTML 结构重写（renderer/panel.html）

将 `<body>` 重写为三栏 `#layout` 容器，保留关键 id（`previewContainer`、`previewWebview`、`previewLoading`、`content`、`statusBar`、`urlInput`、`navigateBtn`）：

```html
<body>
  <div id="layout">
    <!-- ① 左侧菜单栏 (64px) -->
    <aside id="sidebar" class="sidebar">
      <div class="sidebar-logo">🎬</div>
      <div class="menu-item active" data-view="recording">
        <span class="menu-icon">🎥</span>
        <span class="menu-text">页面录制</span>
      </div>
      <div class="menu-item" data-view="management">
        <span class="menu-icon">🗂️</span>
        <span class="menu-text">后台管理</span>
      </div>
      <div class="sidebar-spacer"></div>
    </aside>

    <!-- ② 中间列 (380px，可折叠) -->
    <main id="mainColumn" class="main-column">
      <div class="middle-header">
        <span class="middle-title" id="middleTitle">页面录制</span>
        <button id="toggleRightBtn" class="toggle-right-btn" title="展开/收起侧栏">▶</button>
      </div>
      <div class="url-bar" id="urlBar">...</div>
      <div id="content" class="content-area"></div>
      <div id="statusBar" class="status-bar"></div>
    </main>

    <!-- ③ 右侧可折叠列 (默认收起) -->
    <aside id="rightColumn" class="right-column collapsed">
      <div class="right-toolbar">
        <span class="right-title" id="rightTitle">录制记录</span>
        <button id="closeRightBtn" class="right-close-btn">✕</button>
      </div>
      <div id="rightContent" class="right-content"></div>
      <div id="previewContainer" class="preview-container">
        <div class="preview-loading" id="previewLoading">加载中...</div>
        <webview id="previewWebview" class="preview-webview-inner" autosize="on"></webview>
      </div>
    </aside>
  </div>
  <div id="toastContainer" class="toast-container"></div>
  <script src="panel.js"></script>
</body>
```

要点：
- 移除原 `#app` 包裹层和 `.title-bar`（原生 frame 已有标题栏）
- `#previewContainer` 迁入 `#rightColumn`，id 和内部元素保持不变
- 右栏默认 `collapsed` 类

---

## 2. CSS 变更（renderer/panel.css）

保留现有 CSS 变量和组件样式，新增三栏布局、侧栏、折叠动画、Toast 样式。

### 2.1 三栏布局骨架
- `#layout`: `display: flex; flex-direction: row; height: 100vh; width: 100vw; overflow: hidden;`
- `.sidebar`: 64px 固定宽度，垂直排列菜单项（图标+文字）
- `.main-column`: 380px 默认宽度，`.collapsed` 时 `width: 0; min-width: 0; overflow: hidden;`
- `.right-column`: 默认 `collapsed`（width: 0），展开时 380px（步骤树）或 820px（预览模式 `.preview-mode`）
- 过渡动画：`transition: width 0.2s ease, min-width 0.2s ease, opacity 0.2s ease;`

### 2.2 菜单项样式
- `.menu-item`: 52px 宽，圆角，垂直排列图标(16px)和文字(10px)
- `.menu-item.active`: 蓝色背景高亮
- `.menu-item:hover`: 悬浮背景

### 2.3 右栏内显隐
- `.right-content`: 步骤树容器，`flex: 1; overflow-y: auto;`
- `.preview-container`: `display: none;` 默认隐藏，`.right-column.preview-mode .preview-container` 时 `display: flex;`
- `.right-column.preview-mode .right-content`: `display: none;`

### 2.4 Toast 样式
- `.toast-container`: 固定右上角，`z-index: 1000000`
- `.toast`: 最小 220px，圆角，阴影，`animation: toast-in 0.2s ease`
- `.toast.error`: 红色边框+背景
- `.toast.success`: 绿色边框+背景
- `.toast.info`: 蓝色边框

### 2.5 最大化适配
- 所有列 `height: 100vh`，最大化时自动撑满
- `.middle-header` 保留 `-webkit-app-region: drag` 拖拽
- `.preview-container` 改为 `flex: 1`（由右列 flex 控制）

---

## 3. 窗口管理（main/main.js）

### 3.1 最大化支持
- `maximizable: false` → `maximizable: true`
- 保留 `alwaysOnTop: true`

### 3.2 默认尺寸调整
- 默认 `width = 460`（侧栏 64 + 中间 380 + 余量），`minWidth = 400`
- `x = screenWidth - 460 - 10`

### 3.3 存储路径改为应用自有目录（单点改动）
```javascript
function getOutputDir() {
  const dir = path.join(app.getPath('userData'), 'recordings');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  return dir;
}
```
此改动让 `recorder.outputDir`、`Exporter`、`get-recorded-exports` 全部指向 `userData/recordings`，录制内容跨重启持久化。

---

## 4. 视图状态管理（renderer/panel.js）

新增渲染层 UI 状态（与 recorder 的 `state.phase` 解耦）：
```javascript
let currentView = 'recording';        // 'recording' | 'management'
let rightColumnOpen = false;          // 右栏是否展开
let rightPanelMode = 'steps';         // 'steps'(步骤树) | 'preview'(webview)
let middleCollapsed = false;          // 中间列是否折叠
const SIDEBAR_W = 64, MIDDLE_W = 380, RIGHT_STEP_W = 380, RIGHT_PREVIEW_W = 820;
```

### 4.1 菜单切换 `switchView()`
- 切换 `currentView`，更新 `.menu-item.active`
- 录制视图：显示 url-bar，调 `rerenderPanel()`
- 管理视图：隐藏 url-bar，调 `renderManagementView()`
- 重置右栏状态，调 `updateLayout()`

### 4.2 `updateLayout()` — 核心布局调度
- 切换 `#rightColumn` 的 `collapsed` / `preview-mode` 类
- 切换 `#mainColumn` 的 `collapsed` 类
- 更新右栏标题和切换按钮图标
- 调 `api.resizeWindow(computeLayoutWidth())` 调整窗口（最大化时由 IPC 守卫跳过）

### 4.3 `onStateSync` 守卫
```javascript
api.onStateSync((newState) => {
  state = newState;
  // ... url 更新等 ...
  if (currentView !== 'recording') {
    // 管理视图下若保存刚完成，刷新列表
    if (document.querySelector('.scenario-card')) renderManagementView();
    return;
  }
  rerenderPanel();
});
```

---

## 5. 录制模式：右栏步骤列表

### 5.1 移除中间列底部的「录制记录」
`renderRecordingPhase()` 末尾的录制记录块（`section-title` + `renderModuleList`）删除，不再渲染到中间列。

### 5.2 右栏渲染步骤树 `renderRightSteps()`
- 复用现有 `renderModuleList(list)` 函数
- 在 `rerenderPanel()` 末尾、右栏展开且为步骤模式时调用
- 配置阶段移除 `renderRecordedExportsSection()` 调用（迁至管理视图）

### 5.3 折叠/展开
- 默认折叠（`rightColumnOpen = false`）
- `#toggleRightBtn` 点击 → 切换右栏展开/收起
- `#closeRightBtn` 点击 → 收起右栏

---

## 6. 管理模式：场景列表 + 预览 + 删除 + 下载 + 上传

### 6.1 `renderManagementView()`
调 `api.getRecordedExports()`（复用现有 IPC，现扫描 `userData/recordings`），为每个场景生成卡片。

### 6.2 场景卡片 `buildScenarioCard(exp)`
显示：场景标题、副标题、步骤数、修改时间
按钮组：
- **🔍 预览**：`openPreview(exp.htmlFiles[0].filePath)` → 展开右栏 webview，提供步骤下拉框切换预览页面
- **📥 下载**：`await api.downloadRecording(exp.dirPath)` → Toast 结果
- **🗑️ 删除**：确认对话框 → `await api.deleteRecording(exp.dirPath)` → 刷新列表 + Toast
- **📤 上传**：`await api.uploadRecording(exp.dirPath)` → Toast 结果（详见 §8）

### 6.3 预览交互
- 点击预览 → `rightColumnOpen = true; rightPanelMode = 'preview'; updateLayout();`
- webview 加载第一个 HTML
- 步骤下拉框（`exp.htmlFiles`）切换预览某一步
- 「折叠列表」按钮 → `middleCollapsed = true; updateLayout();` 中间列收起，预览撑满
- 「展开列表」按钮 → `middleCollapsed = false; updateLayout();`
- 关闭右栏 → `rightColumnOpen = false; middleCollapsed = false; updateLayout();`

---

## 7. 保存流程变更

### 7.1 `handleEndAndSave()` 改造
删除 `selectSaveDirectory` + `setOutputDir` 两步（`recorder.outputDir` 已是 `userData/recordings`）：
```javascript
async function handleEndAndSave() {
  // ... 完成未标记元素 ...
  const envConfig = await showEnvConfigDialog(state.sceneCode || state.sceneConfig.sceneName);
  const result = await sendAction('endAndSave', { /* 同现有字段 */ });
  if (result?.type === 'error') {
    showToast('保存失败：' + (result.message||''), 'error', 5000);
  } else if (result?.type === 'saveComplete') {
    showToast('保存成功：' + result.fileCount + ' 个文件', 'success');
    // ★ 自动切换到管理视图并预览
    currentView = 'management';
    switchView();
    const p = await api.previewExport();
    if (p?.success) openPreview(p.filePath);
  }
}
```
原 `showSaveResultDialog` 用 Toast 替代。

---

## 8. 上传功能（新增 IPC + 转换方法）

### 8.1 JSON 配置转换方法（src/config-transformer.js — 新文件）
```javascript
/**
 * JSON 配置转换器 — 占位实现
 * 后续在此处添加具体的转换逻辑
 * 目前原样返回
 */
function transformConfig(config) {
  // TODO: 后续实现具体的转换逻辑
  return config;
}

module.exports = { transformConfig };
```

### 8.2 上传 IPC（main/ipc-handler.js）
```javascript
// 上传 HTML/CSS 文件 + 转换后的 JSON 配置
ipcMain.handle('upload-recording', async (event, dirPath) => {
  try {
    const { transformConfig } = require('../src/config-transformer');
    
    // 1. 读取目录中所有 HTML 和 CSS 文件
    const files = fs.readdirSync(dirPath);
    const htmlCssFiles = files.filter(f => f.endsWith('.html') || f.endsWith('.css'));
    
    // 2. 读取并转换 demo_config.json
    const configPath = path.join(dirPath, 'demo_config.json');
    let transformedConfig = null;
    if (fs.existsSync(configPath)) {
      const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      transformedConfig = transformConfig(rawConfig); // ★ 转换方法（目前原样返回）
    }
    
    // 3. TODO: 上传 HTML/CSS 文件到资源接口（接口地址待定）
    // await uploadFiles(htmlCssFiles, dirPath, UPLOAD_RESOURCE_API);
    
    // 4. TODO: 上传转换后的 JSON 配置到配置接口（接口地址待定）
    // await uploadConfig(transformedConfig, UPLOAD_CONFIG_API);
    
    return { 
      success: true, 
      fileCount: htmlCssFiles.length,
      configUploaded: !!transformedConfig,
      message: '上传功能待接口配置（当前为占位实现）'
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
```

### 8.3 preload.js 暴露
```javascript
uploadRecording: (dirPath) => ipcRenderer.invoke('upload-recording', dirPath),
```

---

## 9. 新增 IPC 汇总（main/ipc-handler.js + main/preload.js）

| IPC 通道 | 功能 | 实现要点 |
|----------|------|----------|
| `delete-recording` | 删除场景 | 路径安全校验（必须在 recordings 目录内），`fs.rm` 递归删除 |
| `download-recording` | 下载场景 | `dialog.showOpenDialog` 选目录 → `fs.cp` 递归拷贝 |
| `upload-recording` | 上传场景 | 读取 HTML/CSS + 转换 JSON（占位）+ 上传接口（待定） |
| `get-app-recordings-dir` | 获取存储目录 | 返回 `recorder.outputDir`（可选，用于 UI 展示） |
| `resize-window` | 窗口尺寸 | 增加 `isMaximized()` 守卫，最大化时跳过 |

preload.js 对应暴露：`deleteRecording`、`downloadRecording`、`uploadRecording`、`getAppRecordingsDir`

旧 IPC（`select-save-directory`、`set-output-dir`）保留不删，向后兼容。

---

## 10. Toast 错误提示系统（renderer/panel.js）

### 10.1 `showToast(message, type, duration)`
- `type`: `'error'` | `'success'` | `'info'`
- 自动 3.2 秒后淡出移除（error 类型 5 秒）
- 添加到 `#toastContainer`

### 10.2 接入点
- `api.onError` → `showToast('错误：' + msg, 'error', 5000)`（同时保留 `updateStatus`）
- 导航失败、保存失败、标记空标题 → `showToast(..., 'error')`
- 保存成功、删除成功、下载成功、上传完成 → `showToast(..., 'success')`
- 过程进度（"正在捕获..."、"处理中"）→ 仍用 `updateStatus` + loading overlay，不用 Toast

---

## 11. 文件改动清单

| 文件 | 改动类型 | 主要改动 |
|------|----------|----------|
| `renderer/panel.html` | 重写 body | 三栏 `#layout` + 侧栏 + 中间列 + 右栏(含迁入 webview) + Toast 容器 |
| `renderer/panel.css` | 新增 | 三栏 flex、`.sidebar`/`.menu-item`、`.right-column` 折叠过渡、`.toast`、`.middle-header` |
| `renderer/panel.js` | 较大重构 | 视图状态机、`switchView`/`updateLayout`/`renderRightSteps`/`renderManagementView`/`buildScenarioCard`/`openPreview`/`showToast`；`handleEndAndSave` 去选目录+自动跳管理；`onStateSync` 加视图守卫 |
| `main/main.js` | 小改 | `maximizable:true`、默认宽 460/minWidth 400、`getOutputDir()` 改 `userData/recordings` |
| `main/ipc-handler.js` | 新增 | `delete-recording`、`download-recording`、`upload-recording`、`get-app-recordings-dir`；`resize-window` 加 `isMaximized` 守卫 |
| `main/preload.js` | 新增 | 暴露 `deleteRecording`/`downloadRecording`/`uploadRecording`/`getAppRecordingsDir` |
| `src/config-transformer.js` | **新文件** | JSON 配置转换方法（占位实现，原样返回） |
| `src/recorder.js` | **不动** | outputDir 由 main 注入 |
| `src/export.js` | **不动** | 通过 `recorder.outputDir` 自然落到 userData |
| `src/browser-manager.js` / `html-capture.js` / `credential-store.js` | **不动** | 录制/捕获/凭证功能保持 |

---

## 12. 实施顺序

1. **main.js**：`getOutputDir` 改路径 + 最大化 + 默认尺寸
2. **ipc-handler.js + preload.js**：新增 4 个 IPC + resize 守卫
3. **config-transformer.js**：新建转换方法文件
4. **panel.html + panel.css**：三栏骨架 + Toast 容器（静态可见）
5. **panel.js**：状态机 + `updateLayout` + 菜单切换 + 录制右栏步骤树
6. **panel.js**：`renderManagementView` + 卡片 + 预览/删除/下载/上传
7. **panel.js**：`handleEndAndSave` 去选目录 + Toast 接入 + 自动跳管理视图
8. 联调测试

---

## 13. 验证步骤

1. 启动应用 → 确认三栏布局（侧栏 + 中间 + 右栏收起）
2. 点击「页面录制」→ 确认配置表单正常，场景码自动生成
3. 开始录制 → 录制 2-3 步 → 点击右栏展开按钮 → 确认步骤树显示在右侧
4. 结束保存 → 确认无目录选择弹窗 → 确认自动跳转管理视图 + 预览展开
5. 管理视图中 → 确认场景列表显示刚保存的录制
6. 点击预览 → 确认 webview 加载 → 折叠中间列 → 确认预览撑满 → 展开恢复
7. 点击下载 → 选择目录 → 确认文件夹拷贝成功 → Toast 提示
8. 点击删除 → 确认对话框 → 确认删除后列表刷新
9. 点击上传 → 确认占位返回成功 + Toast 提示
10. 点击最大化 → 确认三栏自适应撑满 → 切换视图正常
11. 重启应用 → 确认管理视图中仍能看到之前的录制场景
12. 触发错误（如空标题标记）→ 确认 Toast 弹窗显示错误信息

---

## 关键设计决策

1. **视图状态放在渲染进程**：`currentView` 不进 recorder，避免改动核心状态机
2. **存储路径单点改动**：只改 `getOutputDir()`，Exporter/IPC/预览全部自然继承
3. **保存后自动跳管理视图**：用户确认，立即展示录制结果
4. **下载用文件夹拷贝**：用户确认，简单直接
5. **预览时中间列手动折叠**：用户确认，保留场景列表可见性
6. **上传接口留空**：HTML/CSS 上传接口和 JSON 配置接口地址待定，转换方法原样返回
7. **Toast 与状态栏并存**：错误/成功用 Toast（醒目），过程进度用状态栏（不打扰）
