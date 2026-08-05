# 渲染层模块化重构计划

## 一、Summary（摘要）

按用户三条规则重构项目：
1. **按功能模块建文件夹，抽离组件/公共方法，单文件 ≤ 800 行**。
2. **录制功能「对内 / 对外」拆成两个文件夹，共用部分抽离到 shared / common**。
3. **优先按菜单功能（录制 / 后台管理 / 设置）建文件夹，其次按功能拆分**。

采用 **ES Modules**（`type="module"`）拆分 `renderer/panel.js`（约 2546 行）为 `renderer/modules/` 下的模块树；拆分 `renderer/panel.css`（1554 行）为 `renderer/styles/`；按功能拆分 `main/ipc-handler.js`（524 行）为 `main/ipc/`；删除已确认的死代码 `src/panel/`。**不改变任何运行功能**。

---

## 二、Current State Analysis（现状分析）

### 超标文件（>800 行）
| 文件 | 行数 | 处置 |
|---|---|---|
| `renderer/panel.js` | ~2546 | 拆分为 `renderer/modules/` ES Modules |
| `renderer/panel.css` | 1554 | 拆分为 `renderer/styles/` |
| `src/panel/panel-inject.js` | 1113 | **删除（死代码）** |
| `src/panel/panel-styles.js` | 179 | **删除（死代码）** |

### 死代码确认（关键发现）
`src/panel/panel-inject.js` 与 `panel-styles.js` 在全项目中**无任何引用**：
- `src/browser-manager.js` 的 `_registerPage`（L150-213）只通过 `addScriptTag` 注入 `src/inject/element-helper.js` 与 `credential-helper.js`，**不注入 panel-inject.js**。
- 全项目搜索 `panel-inject` / `panel-styles` / `__WS_URL__` / `__PAGE_ID__` 仅命中文件自身。
- 这是旧 CLI（WebSocket 注入浮动面板）架构的遗留物；当前 Electron 架构的录制 UI 全部在 `renderer/panel.js`，外置浏览器仅注入 element/credential helper。
- 用户已确认：**删除 `src/panel/` 整个目录**。

### 架构理解
- **对内录制（in-app / webview）**：右侧栏 `<webview>` 加载页面，元素选择/凭证填充通过 `webview.executeJavaScript` + `ipc-message`（preload `webview-preload.js` 暴露 `__recSendToHost`）。相关函数集中在 `panel.js` L200-483。
- **对外录制（external / Playwright）**：主进程 `browser-manager.js` 启动 Chromium，元素选择经 `exposeFunction` + 注入 `element-helper.js`。渲染层仅通过 `api.navigateTo` / `api.enableSelectionMode` 调用，渲染层代码很薄。
- **录制动作（mark / addModule / endSave）**：`doCompleteMark`、`handleEndAndSave`、`renderMarkList` 等通过 `browserMode === 'in-app'` 内部分支同时服务两种模式 → 属于 **shared**。
- **菜单**（`panel.html`）：`recording`（页面录制）/ `management`（后台管理）/ `settings`（设置）。

### 已合规文件（保持不动）
`src/` 下核心文件均 ≤ 544 行：`browser-manager.js`(496)、`recorder.js`(544)、`credential-store.js`(212)、`html-capture.js`(407)、`export.js`(165)、`css-utils.js`(97)、`config-transformer.js`(16)、`ws-server.js`(109)、`index.js`(72)、`inject/*`(≤174)。这些是共享后端基础设施，不按菜单划分，保持原位。

---

## 三、Target Folder Structure（目标结构）

```
d:\code_prj\playwright-page-shot\
├── main/                              # 主进程
│   ├── main.js                        # 保持（仅改 require 路径 './ipc'）
│   ├── preload.js                     # 保持
│   └── ipc/                           # ★ 新：ipc-handler.js 按功能拆分
│       ├── index.js                   # setupIpc 聚合入口
│       ├── recorder-ipc.js            # 录制动作 + 元素选择 + 页面操作
│       ├── window-ipc.js              # 窗口控制（最小化/置顶/缩放/启动状态）
│       ├── webview-ipc.js             # 注入脚本/preload路径/cookie同步
│       ├── credential-ipc.js          # 凭证 CRUD
│       ├── recording-mgmt-ipc.js      # 已录制列表/删除/下载/上传/同步
│       └── preview-ipc.js             # 预览/保存目录
├── renderer/
│   ├── panel.html                     # 改：type="module" + 多 <link> 样式
│   ├── panel.css                      # 删除（内容拆到 styles/）或保留为空占位
│   ├── styles/                        # ★ 新：CSS 按功能拆分
│   │   ├── theme.css                  # :root tokens + 基础重置 + body
│   │   ├── layout.css                 # 三栏布局/侧栏/分割线/右栏/webview容器/全屏
│   │   ├── components.css             # 按钮/输入框/section-box/field-label/toast/对话框/empty-state/loading
│   │   ├── recording.css              # 录制面板/mark UI/模块列表/快捷登录
│   │   ├── management.css             # 场景卡片/已录制内容
│   │   └── settings.css               # 凭证管理 cred-*
│   └── modules/                       # ★ 新：渲染层 ES Modules
│       ├── app.js                     # 入口：事件监听 + rerenderPanel + 初始化
│       ├── common/                    # 公共方法/组件
│       │   ├── state.js               # appState（共享可变状态）+ CONSTANTS
│       │   ├── api.js                 # api = window.electronAPI + sendAction
│       │   ├── dom.js                 # DOM 引用 + el/labelEl/_shortenUrl/loading遮罩
│       │   ├── feedback.js            # updateStatus/showToast/showConfirmDialog/showEnvConfigDialog
│       │   ├── layout.js              # computeLayoutWidth/updateLayout/switchView/initLayoutEvents/updateAlwaysOnTop
│       │   ├── webview-controls.js    # applyFitPage/updateWebviewScale/initBrowserModeControls
│       │   └── input-preserve.js      # _saveInputValues/_restoreInputValues
│       ├── recording/                 # ★ 菜单：页面录制（规则2.0 内/外分开）
│       │   ├── internal/              # 对内录制（webview）
│       │   │   └── webview-recording.js  # navigateInAppBrowser/inject/IPC监听/选择/捕获/凭证填充
│       │   ├── external/              # 对外录制（Playwright）
│       │   │   └── external-recording.js # navigateExternal/enableExternalSelection/disableExternalSelection
│       │   └── shared/                # 录制共用
│       │       ├── navigation.js          # navigateToUrl 分发器（按 browserMode 分支）
│       │       ├── recording-actions.js   # doCompleteMark/handleEndAndSave/updateMarkUI/toggleSelectionMode
│       │       ├── recording-ui.js        # renderConfigPhase/renderRecordingPhase/_collectIntroduction/renderMarkList/renderModuleList/renderRightSteps
│       │       ├── recorded-exports.js    # renderRecordedExportsSection/loadRecordedExports
│       │       └── credentials-ui.js      # renderQuickLoginSection/showSavePasswordDialog/renderCredentialManagementSection/loadAllCredentials
│       ├── management/                # ★ 菜单：后台管理
│       │   └── management-view.js     # renderManagementView/buildScenarioCard
│       ├── settings/                  # ★ 菜单：设置
│       │   └── settings-view.js       # renderSettingsView/loadAllCredentialsToContent
│       └── preview/                   # 跨菜单共用预览功能
│           ├── preview.js             # openPreview/closeRightPanel/toggleFullscreenPreview/filePathToUrl/updateScenarioCardHighlight
│           └── step-selector.js       # renderPreviewStepSelector/syncPreviewStepSelector
└── src/                               # 核心后端（保持，均已 ≤800 行）
    ├── browser-manager.js
    ├── recorder.js
    ├── credential-store.js
    ├── html-capture.js / export.js / css-utils.js / config-transformer.js
    ├── index.js / ws-server.js        # 遗留 CLI（不在本次范围）
    └── inject/                        # 内/外共用注入脚本
        ├── element-helper.js
        ├── credential-helper.js
        └── webview-preload.js
```

> `src/panel/` 删除后不再出现。

---

## 四、Refactoring Conventions（重构约定）

### 4.1 ES Modules + 共享状态模式
- `panel.html`：`<script type="module" src="modules/app.js"></script>`。CSP `script-src 'self'` 已支持本地 ES 模块，**无需改 CSP**。
- 模块默认 deferred，DOM 已就绪，`document.getElementById` 可直接用（与现状行为一致）。
- **共享可变状态**：原顶层 `let xxx` 全部迁入 `common/state.js` 的单一 `appState` 对象。各模块 `import { appState, CONSTANTS } from '../common/state.js'`，以 `appState.xxx` 读写。因对象引用共享，跨模块修改即时可见。
- **常量**：`PANEL_WIDTH` 等入 `CONSTANTS`。
- **DOM 引用**：`contentEl`/`statusEl`/`urlInput`/`navigateBtn` 作为 `const` 从 `common/dom.js` 导出（不再赋值，live binding 安全）。
- **api**：`common/api.js` 导出 `api = window.electronAPI` 与 `sendAction`。

### 4.2 状态迁移表（`let X` → `appState.X`）
| 原变量 | 新访问 | 原变量 | 新访问 |
|---|---|---|---|
| `state` | `appState.state` | `currentView` | `appState.currentView` |
| `hasSelectedElement` | `appState.hasSelectedElement` | `rightColumnOpen` | `appState.rightColumnOpen` |
| `selectedElementData` | `appState.selectedElementData` | `rightPanelMode` | `appState.rightPanelMode` |
| `isSelectingMode` | `appState.isSelectingMode` | `middleCollapsed` | `appState.middleCollapsed` |
| `browserLaunched` | `appState.browserLaunched` | `currentPreviewFiles` | `appState.currentPreviewFiles` |
| `isAlwaysOnTop` | `appState.isAlwaysOnTop` | `currentPreviewDirName` | `appState.currentPreviewDirName` |
| `browserMode` | `appState.browserMode` | `currentPreviewStepIndex` | `appState.currentPreviewStepIndex` |
| `_savedInputValues` | `appState.savedInputValues` | `_webviewHelperInjected` | `appState.webviewHelperInjected` |
| `_focusedInputId` | `appState.focusedInputId` | `_webviewPreloadSet` | `appState.webviewPreloadSet` |
| `_cursorPos` | `appState.cursorPos` | `_webviewRecordingMode` | `appState.webviewRecordingMode` |
| `_isProcessing` | `appState.isProcessing` | `_fitPageEnabled` | `appState.fitPageEnabled` |
| `_clearFormOnNextRender` | `appState.clearFormOnNextRender` | `_currentZoom` | `appState.currentZoom` |
| `isRecordedExportsExpanded` | `appState.isRecordedExportsExpanded` | `_currentResolution` | `appState.currentResolution` |
| `expandedExportDirs` | `appState.expandedExportDirs` (Set) | `loginFormDomain` | `appState.loginFormDomain` |
| `isPreviewMode` | `appState.isPreviewMode` | `savedCredentials` | `appState.savedCredentials` |
| `isCredentialsExpanded` | `appState.isCredentialsExpanded` | | |

`CONSTANTS`：`PANEL_WIDTH`/`PREVIEW_WIDTH`/`SIDEBAR_W`/`MIDDLE_W`/`RIGHT_STEP_W`/`RIGHT_PREVIEW_W`/`DIVIDER_W`/`WEBVIEW_RESOLUTIONS`。

### 4.3 行为不变约束
- 不改任何业务逻辑、IPC 通道名、函数行为。
- 仅做：物理拆分 + `let→appState.*` 机械替换 + `import/export` 接线。
- 保留所有 ★ 注释与函数名（便于回溯）。

---

## 五、Detailed Changes（详细变更）

### 5.A 删除死代码
- 删除 `src/panel/panel-inject.js`、`src/panel/panel-styles.js` 及 `src/panel/` 目录。
- 不动 `src/index.js`、`src/ws-server.js`（遗留 CLI，均 ≤800 行，不在确认范围）。

### 5.B `renderer/panel.js` → `renderer/modules/`（行号→目标文件）

| 源行号 (panel.js) | 函数/内容 | 目标文件 |
|---|---|---|
| L10 | `const api` | `common/api.js` |
| L13-27 | `state` 初始对象 | `common/state.js`（`appState.state` 初值） |
| L30-58 | UI 状态 `let` + 常量 | `common/state.js` |
| L61-64 | `contentEl/statusEl/urlInput/navigateBtn` | `common/dom.js` |
| L67-145 | `api.onStateSync/onElementSelected/...` 9 个监听 | `app.js` |
| L147-155 | URL 输入框/按钮监听 | `app.js` |
| L157-189 | `navigateToUrl`（分发器） | `recording/shared/navigation.js` |
| L173-188 | （外部分支抽取为 `navigateExternal`） | `recording/external/external-recording.js` |
| L192-198 | `updateAlwaysOnTop` | `common/layout.js` |
| L200-214 | webview 状态 `let` + `WEBVIEW_RESOLUTIONS` | `common/state.js` |
| L217-281 | `navigateInAppBrowser` | `recording/internal/webview-recording.js` |
| L284-328 | `injectWebviewElementHelper` | `recording/internal/webview-recording.js` |
| L330-375 | `setupWebviewIpcListener` | `recording/internal/webview-recording.js` |
| L378-402 | `enable/disableWebviewSelectionMode` | `recording/internal/webview-recording.js` |
| L405-415 | `removeWebviewElementId` | `recording/internal/webview-recording.js` |
| L418-431 | `fillWebviewCredentials` | `recording/internal/webview-recording.js` |
| L434-483 | `captureWebviewData` | `recording/internal/webview-recording.js` |
| L486-555 | `applyFitPage`/`updateWebviewScale` | `common/webview-controls.js` |
| L557-711 | `initBrowserModeControls` | `common/webview-controls.js` |
| L716-722 | `filePathToUrl` | `preview/preview.js` |
| L725-777 | `openPreview` | `preview/preview.js` |
| L780-843 | `renderPreviewStepSelector` | `preview/step-selector.js` |
| L846-874 | `syncPreviewStepSelector` | `preview/step-selector.js` |
| L877-886 | `updateScenarioCardHighlight`/`showInAppPreview` | `preview/preview.js` |
| L889-953 | `closeRightPanel`/`toggleFullscreenPreview`/`hideInAppPreview` | `preview/preview.js` |
| L957-973 | webview `did-start-loading`/`did-fail-load` 监听 | `common/webview-controls.js`（并入 `initBrowserModeControls`） |
| L975-977 | `sendAction` | `common/api.js` |
| L979-984 | `updateStatus` | `common/feedback.js` |
| L986-1005 | `_showLoadingOverlay`/`_hideLoadingOverlay` | `common/dom.js` |
| L1008-1032 | `rerenderPanel` | `app.js` |
| L1034-1068 | `_saveInputValues`/`_restoreInputValues` | `common/input-preserve.js` |
| L1071-1147 | `renderConfigPhase` | `recording/shared/recording-ui.js` |
| L1150-1253 | `renderRecordedExportsSection`/`loadRecordedExports` | `recording/shared/recorded-exports.js` |
| L1256-1365 | `renderQuickLoginSection`/`showSavePasswordDialog` | `recording/shared/credentials-ui.js` |
| L1368-1443 | `renderCredentialManagementSection`/`loadAllCredentials` | `recording/shared/credentials-ui.js` |
| L1446-1791 | `renderRecordingPhase` | `recording/shared/recording-ui.js` |
| L1792-1805 | `_collectIntroduction` | `recording/shared/recording-ui.js` |
| L1806-1873 | `handleEndAndSave` | `recording/shared/recording-actions.js` |
| L1876-1911 | `doCompleteMark` | `recording/shared/recording-actions.js` |
| L1913-1934 | `updateMarkUI` | `recording/shared/recording-actions.js` |
| （新增抽取） | `toggleSelectionMode`（mark 按钮分支） | `recording/shared/recording-actions.js` |
| L1936-2017 | `renderMarkList`/`renderModuleList` | `recording/shared/recording-ui.js` |
| L2019-2035 | `showConfirmDialog` | `common/feedback.js` |
| L2037-2134 | `showEnvConfigDialog` | `common/feedback.js` |
| L2137-2149 | `el`/`labelEl` | `common/dom.js` |
| L2151-2161 | `_shortenUrl` | `common/dom.js` |
| L2163-2185 | 全局键盘快捷键 | `app.js` |
| L2188-2200 | `showToast` | `common/feedback.js` |
| L2205-2233 | `computeLayoutWidth`/`updateLayout` | `common/layout.js` |
| L2236-2282 | `switchView` | `common/layout.js` |
| L2285-2293 | `renderRightSteps` | `recording/shared/recording-ui.js` |
| L2296-2305 | `renderSettingsView` | `settings/settings-view.js` |
| L2308-2357 | `loadAllCredentialsToContent` | `settings/settings-view.js` |
| L2360-2383 | `renderManagementView` | `management/management-view.js` |
| L2386-2510 | `buildScenarioCard` | `management/management-view.js` |
| L2513-2539 | `initLayoutEvents` | `common/layout.js` |
| L2541-2546 | `initLayoutEvents()/initBrowserModeControls()/rerenderPanel()` 调用 | `app.js` |

**外部模式薄层说明**：`recording/external/external-recording.js` 抽取：
- `navigateExternal(url)`：原 `navigateToUrl` 的 L173-188 外部分支（`syncCookiesFromWebview` + `api.navigateTo` + `browserLaunched` + `updateAlwaysOnTop`）。
- `enableExternalSelection()`/`disableExternalSelection()`：封装 `api.enableSelectionMode()`/`api.disableSelectionMode()`。
- `navigation.js` 的 `navigateToUrl` 按 `appState.browserMode` 分发到 `navigateInAppBrowser`（internal）或 `navigateExternal`（external）。
- `recording-actions.js` 的 `toggleSelectionMode` 按模式分发到 `enableWebviewSelectionMode` 或 `enableExternalSelection`。
> 对外录制的主体逻辑在后端 `src/browser-manager.js`（保持原位），渲染层仅薄封装，符合实际架构。

### 5.C `renderer/panel.css` → `renderer/styles/`
按选择器语义分配（执行时通读 panel.css 逐段归入）：
- `theme.css`：`:root` tokens、`*` 重置、`body`、`input/button/select/textarea{font-family:inherit}`。
- `layout.css`：`#layout`/`.sidebar`/`.menu-item`/`.main-column`/`.column-divider`/`.right-column`/`.preview-container`/`.webview-scroll-wrapper`/`.webview-scale-wrapper`/`.preview-webview-inner`/`.fullscreen-preview`/`.middle-header`/`.url-bar`/`.browser-mode-row`。
- `components.css`：`.btn*`/`.input-field`/`.url-input`/`.section-box`/`.section-title`/`.field-label`/`.toast*`/`.dialog*`/`.empty-state`/`.loading-spinner`/`.switch-*`。
- `recording.css`：`.mark-*`/`.module-*`/`.sub-module-*`/`.step-*`/`.intro-badge`/`.quick-login*`/`.cred-domain-*`(录制配置阶段)。
- `management.css`：`.scenario-card*`/`.recorded-exports-*`/`.scenario-action-btn*`。
- `settings.css`：`.cred-list`/`.cred-item*`/`.cred-delete-btn`（设置视图凭证）。
- `panel.html` 改为多个 `<link rel="stylesheet" href="styles/xxx.css">`；删除 `panel.css`（或保留空文件占位，推荐删除）。

### 5.D `main/ipc-handler.js` → `main/ipc/`
- `main/ipc/index.js`：`setupIpc({ recorder, browserManager, panelWindowGetter, credStore })` → 依次调用各模块 `register*` 并打印「处理器已注册」。导出 `{ setupIpc }`。
- 各子模块导出 `registerXxx(deps)`，内部 `ipcMain.handle(...)`，逻辑**原样搬迁**：
  - `recorder-ipc.js`：`recorder-action`/`enable-selection-mode`/`disable-selection-mode`/`get-active-page-url`/`navigate-to`/`get-all-pages`/`set-active-page`。
  - `window-ipc.js`：`minimize-to-tray`/`set-always-on-top`/`resize-window`/`is-browser-launched`。
  - `webview-ipc.js`：`get-inject-script`/`get-webview-preload-path`/`sync-cookies-to-webview`/`sync-cookies-from-webview`。
  - `credential-ipc.js`：`get-credentials`/`get-credential`/`fill-credentials`/`save-credential`/`delete-credential`/`get-all-credentials`。
  - `recording-mgmt-ipc.js`：`get-recorded-exports`/`delete-recording`/`download-recording`/`upload-recording`/`get-app-recordings-dir`/`sync-to-prd`。
  - `preview-ipc.js`：`preview-export`/`preview-html-file`/`select-save-directory`/`set-output-dir`。
- `main/main.js` L208：`require('./ipc-handler')` → `require('./ipc')`；`setupIpc` 签名不变。

### 5.E `renderer/panel.html`
- `<link rel="stylesheet" href="panel.css">` → 多个 `<link href="styles/*.css">`。
- `<script src="panel.js">` → `<script type="module" src="modules/app.js">`。
- 删除 `renderer/panel.js`（内容已迁入 modules/）。

---

## 六、Implementation Phases（实施阶段，按序执行，每阶段后验证）

> **Windows 进程陷阱（来自 project_memory）**：改动主进程代码后须 `Stop-Process -Name electron -Force`（需关闭沙箱）杀全部 electron，再 `npm start`，否则旧代码仍在运行。验证用 `(Get-Process -Name electron).Count`（≈4 = 一个干净实例）。

### Phase 0：准备 + 删除死代码
1. 删除 `src/panel/`。
2. `npm start` 验证应用正常启动、录制/预览/管理/设置四条链路无回归（确认删除未影响功能）。

### Phase 1：CSS 拆分（低风险，独立）
1. 建 `renderer/styles/`，通读 `panel.css` 按上述分类搬迁选择器。
2. 改 `panel.html` 为多 `<link>`，删除 `panel.css`。
3. 验证：UI 视觉无变化。

### Phase 2：IPC 拆分（主进程，独立）
1. 建 `main/ipc/`，搬迁 `ipc-handler.js` 各 `ipcMain.handle` 到子模块，`index.js` 聚合。
2. 改 `main/main.js` require 路径。
3. 杀 electron 重启，验证录制动作/凭证/管理/预览/cookie 同步全链路。

### Phase 3：渲染层骨架（state/common/app）
1. 建 `common/state.js`（`appState`+`CONSTANTS`）、`api.js`、`dom.js`、`feedback.js`、`layout.js`、`webview-controls.js`、`input-preserve.js`。
2. 建 `app.js`：迁入 9 个事件监听 + URL 栏监听 + 键盘快捷键 + `rerenderPanel` + 初始化调用；`let→appState.*`。
3. 此时 `app.js` 引用的 recording/management/settings/preview 模块尚未创建 → 先建空占位导出，或直接进入 Phase 4-6 一起做。**建议 Phase 3-6 一气呵成**，因为 `app.js` 依赖全部模块导出。

### Phase 4：recording 模块
1. `internal/webview-recording.js`、`external/external-recording.js`、`shared/{navigation,recording-actions,recording-ui,recorded-exports,credentials-ui}.js`。
2. 抽取 `navigateExternal`、`toggleSelectionMode` 分发器。
3. `let→appState.*`，加 import/export。

### Phase 5：management / settings / preview 模块
1. `management/management-view.js`、`settings/settings-view.js`、`preview/{preview,step-selector}.js`。
2. `let→appState.*`，加 import/export。

### Phase 6：接线 + 切换入口
1. `panel.html` 改 `type="module" src="modules/app.js"`。
2. 删除 `renderer/panel.js`。
3. 通检所有 `import` 路径正确、循环依赖无（common 不 import recording；recording/shared 可 import common + internal/external；app.js 顶层 import 全部所需）。
4. 杀 electron 重启，全链路验证。

---

## 七、Verification Steps（验证步骤）

每阶段后执行：
1. **启动**：`npm start`，应用正常打开，无控制台报错。
2. **录制-对内**：应用内浏览器 → 输入 URL → 页面加载 → 选择元素 → 标记 → 加主步骤/子步骤 → 结束保存 → 自动转管理视图并预览。
3. **录制-对外**：切外层窗口 → 输入 URL → 浏览器启动（窗口置顶）→ 选择元素 → 标记 → 保存。
4. **登录存储**：对内/对外登录某站 → 弹保存密码 → 重开自动检测并一键填充。
5. **预览**：管理视图 → 预览场景 → 步骤选择器上一步/下一步 → 页面内导航同步选择器 → 全屏预览（ESC 退出）→ 适配/缩放。
6. **管理**：场景卡片 下载/上传/同步到生产/删除。
7. **设置**：账号管理列表 删除凭证。
8. **模式隔离**：预览 ↔ 录制切换互不残留（currentPreviewFiles、步骤选择器、选择模式状态清空）。
9. **快捷键**：Alt+A（标记）/Alt+S（下一步）/Alt+Q（结束保存）。
10. **行数检查**：`Get-ChildItem renderer/modules -Recurse *.js | ForEach { (Get-Content $_.FullName).Count }` 全部 ≤ 800；`main/ipc/*.js` 同理。

---

## 八、Assumptions & Decisions（假设与决策）

1. **模块方案**：ES Modules（用户确认）。共享可变状态用单一 `appState` 对象跨模块共享。
2. **死代码**：删除 `src/panel/`（用户确认）；不动 `src/index.js`/`ws-server.js`（遗留 CLI，未在确认范围，且 ≤800 行）。
3. **src/ 后端不重组**：`browser-manager.js` 等均 ≤544 行且为内/外共用基础设施，不按菜单划分，保持原位。内/外拆分在渲染层（`recording/internal` vs `recording/external`）落实；对外录制的主体逻辑在后端 `browser-manager.js`（保持原位）。
4. **行为不变**：仅物理拆分 + `let→appState.*` + import/export 接线，不改逻辑/IPC 通道/函数名。
5. **CSS 拆分**：用多 `<link>` 而非 `@import`（加载更快，Electron 本地无影响）。
6. **循环依赖规避**：`common/` 不 import `recording/`；`recording/shared` 可 import `common` 与 `internal/external`；`app.js` 为顶层汇聚点。
7. **占位兼容函数保留**：`showInAppPreview`/`hideInAppPreview` 等兼容旧调用一并迁入 `preview/preview.js`。
