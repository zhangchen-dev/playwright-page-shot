# 录制功能增强计划

## Context（背景）

用户提出四项录制功能增强需求：
1. **统一元素ID和HTML命名**：元素ID统一为 `stepElementId`，HTML文件命名为 `step1.html`、`step2.html`（去掉随机码）
2. **自定义场景码**：录制配置阶段场景码改为用户自填（可编辑），加"?"tooltip
3. **继续录制**：预览场景时可"继续录制"，加载已保存数据回填录制器，完成后覆盖原场景
4. **第三栏Banner**：录制视图且未开浏览器时，右栏显示图片轮播Banner；录制完成后询问是否关闭浏览器

用户已确认：保存后留在录制页面（不切换到管理）；输入新地址点击跳转则直接导航（不关浏览器）；继续录制保存完整 `recording_data.json`。

---

## 一、统一元素ID和HTML命名

### 1.1 元素ID：`stepElementId`（[element-helper.js](file:///d:/code_prj/playwright-page-shot/src/inject/element-helper.js)）

**当前**（L82）：`'__rec_el_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8)`

**改为**：以 `stepElementId` 为基础名，自动检测重复并追加序号：
```javascript
var baseId = 'stepElementId';
var elementId = baseId;
var counter = 1;
while (document.getElementById(elementId)) {
  counter++;
  elementId = baseId + '_' + counter;
}
e.target.id = elementId;
```
- 同一步骤内多个标记：`stepElementId`、`stepElementId_2`、`stepElementId_3`
- 删除标记时 `removeElementId(id)` 已按ID移除，无需改动
- 此脚本同时服务 Playwright 外部模式 和 webview 内部模式

### 1.2 HTML文件命名：`step1`、`step2`（[recorder.js](file:///d:/code_prj/playwright-page-shot/src/recorder.js)）

**当前**（`_generateStepId` L475-490）：`'step' + stepCount + '_' + timestamp + '_' + random`

**改为**：
```javascript
_generateStepId() {
  this.stepCount++;
  return 'step' + this.stepCount;
}
```

**影响链自动适配**（无需额外改动）：
- `html-capture.js`：`htmlFilename = stepId + '.html'`、`cssFilename = stepId + '.css'` → `step1.html`、`step1.css`
- `_buildNavScript()`：`window.location.href = baseUrl + nextStep + '.html'` → 跳转到 `step2.html`
- `_fixStepNavigationLinks()`：用 `nextStepId` 字符串替换导航脚本 → 自动适配
- `export.js` `_buildConfig()`：`snapshot.htmlFile` 已用 stepId → 自动适配
- `feedback.js` `showEnvConfigDialog` URL预览：已硬编码 `step1.html`，无需改动

---

## 二、自定义场景码 + Tooltip

### 2.1 修改配置表单（[recording-ui.js](file:///d:/code_prj/playwright-page-shot/src/renderering/modules/recording/shared/recording-ui.js) `renderConfigPhase` L43-74）

**当前**：场景码只读、自动生成（`sceneName + '_' + random`）

**改为**：
- 场景码输入框：移除 `readOnly`、`style.opacity`，placeholder 改为 "请输入场景码（建议英文）"
- 标签改为 "场景码" + `<span class="tooltip-icon" title="该场景的编码，建议使用场景名称对应的英文单词">?</span>`
- 删除 `nameInput.addEventListener('input', ...)` 自动生成逻辑
- `updateStartBtn()` 增加场景码必填校验：`!titleInput.value.trim() || !nameInput.value.trim() || !sceneCodeInput.value.trim()`
- `startRecording` 传参不变（已有 `sceneCode: sceneCodeInput.value.trim()`）

### 2.2 Tooltip CSS（[components.css](file:///d:/code_prj/playwright-page-shot/renderer/styles/components.css)）

添加 `.tooltip-icon` 样式：蓝色圆形小图标，hover 显示 title 提示。

---

## 三、继续录制功能

### 3.1 导出时保存 `recording_data.json`（[export.js](file:///d:/code_prj/playwright-page-shot/src/export.js)）

在 `exportRecording()` 末尾（写完 demo_config.json 后），额外写入：
```javascript
const recordingData = {
  sceneConfig: recorder.sceneConfig,
  sceneCode: recorder.sceneCode,
  mainModules: recorder.mainModules, // 含完整快照（htmlContent/cssContent/marks等）
  currentMainModuleIndex: recorder.currentMainModuleIndex,
  currentSubModuleIndex: recorder.currentSubModuleIndex,
  stepCount: recorder.stepCount,
  environment: recorder.environment,
  envBaseUrl: recorder.envBaseUrl,
};
await fs.writeFile(path.join(exportDir, 'recording_data.json'), JSON.stringify(recordingData), 'utf-8');
```

### 3.2 继续录制时覆盖原目录（[export.js](file:///d:/code_prj/playwright-page-shot/src/export.js)）

在 `exportRecording()` 开头，`fs.ensureDir` 之前，如果目录已存在则清空：
```javascript
if (fs.existsSync(exportDir)) {
  await fs.emptyDir(exportDir); // fs-extra 方法，删除目录内所有内容但保留目录
}
```

### 3.3 Recorder 加载/继续方法（[recorder.js](file:///d:/code_prj/playwright-page-shot/src/recorder.js)）

新增 `continueRecording(data)` 方法：
```javascript
continueRecording(data) {
  this.sceneConfig = data.sceneConfig;
  this.sceneCode = data.sceneCode;
  this.mainModules = data.mainModules;
  this.currentMainModuleIndex = data.currentMainModuleIndex;
  this.currentSubModuleIndex = data.currentSubModuleIndex;
  this.stepCount = data.stepCount;
  this.environment = data.environment || 'local';
  this.envBaseUrl = data.envBaseUrl || '';
  this.phase = 'recording';
  this.currentStepId = this._generateStepId(); // 新步骤ID
  this.nextStepId = this._generateStepId();
  this.pageMarks.clear();
  this._notifyStateChange();
  return { stateChanged: true };
}
```

在 `handleAction` 中添加 case：`case 'continueRecording': return this.continueRecording(msg.data);`

### 3.4 IPC 处理器（[recording-mgmt-ipc.js](file:///d:/code_prj/playwright-page-shot/main/ipc/recording-mgmt-ipc.js)）

新增 `continue-recording` handler：
```javascript
ipcMain.handle('continue-recording', async (event, dirPath) => {
  const dataPath = path.join(dirPath, 'recording_data.json');
  if (!fs.existsSync(dataPath)) {
    return { success: false, error: '该场景不支持继续录制（缺少录制数据文件）' };
  }
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const result = await recorder.handleAction('continueRecording', { data });
  return { success: true, state: recorder.getState() };
});
```

在 `get-recorded-exports` handler 中，为每个场景添加 `canContinue` 字段：
```javascript
canContinue: fs.existsSync(path.join(exportDir, 'recording_data.json')),
```

### 3.5 Preload API（[preload.js](file:///d:/code_prj/playwright-page-shot/main/preload.js)）

添加：`continueRecording: (dirPath) => ipcRenderer.invoke('continue-recording', dirPath),`

### 3.6 场景卡片添加"继续录制"按钮（[management-view.js](file:///d:/code_prj/playwright-page-shot/renderer/modules/management/management-view.js)）

在 `buildScenarioCard` 中，仅当 `exp.canContinue` 为 true 时显示"继续录制"按钮：
```javascript
if (exp.canContinue) {
  const continueBtn = el('button', 'scenario-action-btn', '▶ 继续录制');
  continueBtn.addEventListener('click', async () => {
    const result = await api.continueRecording(exp.dirPath);
    if (result && result.success) {
      appState.currentView = 'recording';
      switchView(); // 切换到录制视图，stateSync 会自动同步状态
      showToast('已加载场景数据，可继续录制', 'success');
    } else {
      showToast('继续录制失败：' + (result?.error || '未知错误'), 'error');
    }
  });
  actions.appendChild(continueBtn);
}
```

---

## 四、第三栏 Banner + 录制完成询问关闭浏览器

### 4.1 新增状态字段（[state.js](file:///d:/code_prj/playwright-page-shot/renderer/modules/common/state.js)）

- `rightPanelMode` 新增值：`'banner'`

### 4.2 Banner 组件（新文件：`renderer/modules/common/banner.js`）

创建轮播 Banner 组件：
- `renderBanner()`：在 `#bannerContainer` 中渲染轮播
- 图片数组（初始为空，用户后续添加），无图时显示占位提示"说明海报区域"
- 自动轮播 + 底部圆点导航
- 导出 `showBanner()` / `hideBanner()` 控制显隐

### 4.3 HTML 结构（[panel.html](file:///d:/code_prj/playwright-page-shot/renderer/panel.html)）

在 `#previewContainer` 内、`#previewLoading` 旁添加：
```html
<div id="bannerContainer" class="banner-container" style="display:none;"></div>
```

### 4.4 布局适配（[layout.js](file:///d:/code_prj/playwright-page-shot/renderer/modules/common/layout.js)）

修改 `updateLayout()`：当 `rightPanelMode === 'banner'` 时，显示 bannerContainer、隐藏 webview 相关元素、隐藏工具栏。

修改 `switchView()`：切换到 recording 视图时：
- 如果 `!appState.browserLaunched`（未开浏览器）：设置 `rightColumnOpen = true`、`rightPanelMode = 'banner'`，调用 `renderBanner()`
- 如果浏览器已开：正常显示（右栏显示浏览器内容或关闭）

### 4.5 录制完成询问关闭浏览器（[recording-actions.js](file:///d:/code_prj/playwright-page-shot/renderer/modules/recording/shared/recording-actions.js)）

修改 `handleEndAndSave()` 的成功分支：
- **删除**自动切换到 management 视图和自动打开预览的逻辑
- **新增**：弹窗询问"录制已完成。是否关闭浏览器？"
  - "关闭浏览器"：调用 `api.closeBrowser()` → `onBrowserClosed` 触发 → 显示 banner
  - "保持打开"：不关闭浏览器，右栏继续显示浏览器内容

### 4.6 关闭浏览器 IPC（[recorder-ipc.js](file:///d:/code_prj/playwright-page-shot/main/ipc/recorder-ipc.js) + [browser-manager.js](file:///d:/code_prj/playwright-page-shot/src/browser-manager.js)）

BrowserManager 新增 `close()` 方法：
```javascript
async close() {
  if (this.context) {
    await this.context.close(); // 触发 context 'close' 事件 → onBrowserClosed
  }
}
```

新增 IPC handler：
```javascript
ipcMain.handle('close-browser', async () => {
  await browserManager.close();
  return { success: true };
});
```

Preload 添加：`closeBrowser: () => ipcRenderer.invoke('close-browser'),`

**In-app 模式**：在渲染层直接处理（重置 webview、设 `browserLaunched = false`、显示 banner），不需要 IPC。

### 4.7 浏览器关闭后显示 Banner（[app.js](file:///d:/code_prj/playwright-page-shot/renderer/modules/app.js)）

修改 `onBrowserClosed` 回调：关闭后如果 `currentView === 'recording'`，显示 banner。

### 4.8 导航时隐藏 Banner（[navigation.js](file:///d:/code_prj/playwright-page-shot/renderer/modules/recording/shared/navigation.js)）

`navigateToUrl()` 调用时（无论内/外部模式），设置 `rightPanelMode = 'preview'`，隐藏 banner。

### 4.9 Banner CSS（[layout.css](file:///d:/code_prj/playwright-page-shot/renderer/styles/layout.css)）

添加 `.banner-container` 样式：全高 flex 居中，轮播项绝对定位切换。

---

## 五、文件变更清单

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/inject/element-helper.js` | 改 | 元素ID改为 `stepElementId` |
| `src/recorder.js` | 改 | stepId 改为 `step1`；新增 `continueRecording` |
| `src/export.js` | 改 | 保存 `recording_data.json`；清空旧目录 |
| `src/browser-manager.js` | 改 | 新增 `close()` 方法 |
| `main/preload.js` | 改 | 新增 `continueRecording`、`closeBrowser` API |
| `main/ipc/recorder-ipc.js` | 改 | 新增 `close-browser` handler |
| `main/ipc/recording-mgmt-ipc.js` | 改 | 新增 `continue-recording` handler；`canContinue` 字段 |
| `renderer/modules/common/state.js` | 改 | `rightPanelMode` 新增 `'banner'` 值 |
| `renderer/modules/common/banner.js` | **新** | Banner 轮播组件 |
| `renderer/modules/common/layout.js` | 改 | `updateLayout`/`switchView` 支持 banner 模式 |
| `renderer/modules/recording/shared/recording-ui.js` | 改 | 场景码改为可编辑 + tooltip |
| `renderer/modules/recording/shared/recording-actions.js` | 改 | `handleEndAndSave` 改为询问关闭浏览器 |
| `renderer/modules/recording/shared/navigation.js` | 改 | 导航时隐藏 banner |
| `renderer/modules/management/management-view.js` | 改 | 添加"继续录制"按钮 |
| `renderer/modules/app.js` | 改 | `onBrowserClosed` 显示 banner |
| `renderer/panel.html` | 改 | 添加 `#bannerContainer` |
| `renderer/styles/layout.css` | 改 | Banner 样式 |
| `renderer/styles/components.css` | 改 | Tooltip 样式 |

---

## 六、验证方案

1. **元素ID + HTML命名**：录制一个场景 → 检查导出目录中 HTML 文件名为 `step1.html`、`step2.html` → 打开 HTML 检查元素 ID 为 `stepElementId` → 点击元素能跳转到下一步
2. **场景码**：配置阶段场景码可编辑 → "?"tooltip 显示正确文字 → 不填场景码无法开始录制
3. **继续录制**：录制并保存场景A → 在管理视图场景A卡片看到"继续录制"按钮 → 点击 → 切换到录制视图、数据回填 → 添加新步骤 → 结束保存 → 场景A被覆盖（旧文件清除、新文件写入）
4. **Banner**：启动应用、在录制视图未开浏览器 → 右栏显示 banner → 输入URL导航 → banner 消失、浏览器显示 → 录制完成 → 弹窗询问 → "关闭浏览器" → banner 显示 → "保持打开" → 浏览器内容显示
