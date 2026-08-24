# 项目记忆：playwright-page-shot（Electron 内部 webview 录制）

## 关键约定 / 易错点
- 录制数据 `recording_data.json` 存放于 `%AppData%/Roaming/playwright-page-shot/recording-meta/<sceneCode>/`，与导出目录（`outputDir/<sceneCode>/`，如 `/d/shots-htmls/`）平级隔离。
- **"继续录制 / 重录" 保存时会重跑 `_sequentialRenumber`，会改写所有步骤的 htmlContent（清陈旧导航脚本 + 重注入 + 改 CSS 引用）。** 任何对导航脚本的正则都必须**只匹配本录制器注入的脚本**，否则会把页面正文一起删掉。
- ⚠️ 导航脚本移除正则必须用特征锚定（`var elementIds` 紧跟在 `<script>(function(){` 之后、中间不允许出现 `<`），**切勿**用 `/<script>\s*\(function\(\)\s*\{[\s\S]*?var nextStep=.../` 这类会从页面自身 IIFE（如 `__R_ORIGIN__` 加载器）一路吞到本脚本、误删整个 `<body>` 的写法。该回归曾导致"原本可预览的步骤在继续录制后变空白"。
- 捕获侧空 body 根因多为 qiankun 微前端 `did-finish-load` 后 JS 才填 body；前端 `captureWebviewData` 有 `_waitForBodyContent`/`bodyEmpty` 守卫。
- elementId 所有页面固定为 `auto_step_elementId`；stepId 由 `_sequentialRenumber` 保证 step1..N 唯一连续。

## 地图预览（src/map-template + src/map-preview.js）
- 地图模板打包在 `src/map-template`（index.html/app.js/styles.css/img），主进程 `src/map-preview.js` 用 `copyAsarSafe` 复制到临时目录 `os.tmpdir()/map-preview-<sceneName>/map`，仅写临时目录、绝不碰源录制/导出。
- 移动端判定（v23 起 + **v24 per-step 重构**）：**每一步独立判断，用户显式意图为唯一权威**。
  - **per-step 存储（新录制 v24+）**：recorder 的 `_nextStep` / `_nextStepWebview` 接收 `msg.isMobile`（来自前端 nextStep 点击时的 checkbox 真实状态），写入 `snapshot.isMobileGuide`。
  - **判定链（map-preview.js transformRecordingToMockConfig + export.js）**：`step.isMobileGuide`（per-step，权威）→ `subMod.introduction.isMobileGuide`（兼容旧录制）→ 场景级 `recData.isMobileMode` / `recorder.isMobileMode`。
  - **用户行为**：每一步录制时用户可独立切换 📱 开关——这一步开→该步 mobile，下一步关→该步 PC，**支持混合录制**（同一 subModule 内可同时含 PC 步骤与移动步骤）。
  - **`detectMobileMode` 也扫 per-step**：任一子步骤 `isMobileGuide===true` → 场景视为含 mobile（混合场景能正确识别）。
  - **不再依赖 `subMod.introduction.isMobileGuide` 整段共享**：旧逻辑下"一开全开"的根因——`Object.assign` 把 `isMobile` 写到整段 introduction 后，导出再据此套所有 mark。v24 per-step 后该字段仅作回退。
  - ⚠️ 历史：v16 内容反推置顶→PC 被误升级；v22 内容只降级→显式 mobile 被误降级；v23 显式意图唯一权威但仍是整段共享；v24 per-step 独立存储→彻底解决"混合录制一开全开"。
  - `detectMobileFromContent(html)` 函数仍保留（导出、地图模板等处），但 **`transformRecordingToMockConfig` 已不再调用它做判定**。
  - 端到端链路（v24+）：录制每步时 📱 checkbox → `recording-ui.js` `nextStep` handler 写 `webviewData.isMobile` → IPC `nextStepWebview` → `recorder._nextStepWebview(msg)` 写 `snapshot.isMobileGuide` → `export.js` 据此写 `selectorObj.isMobileGuide`（每个 mark 独立）→ `map-preview.js` 按 `snapshot.isMobileGuide` 决定手机壳。
  - **保存时开关状态防御（v23+）**：`recording-actions.js` 结束保存时不再仅读 `appState.isMobileMode`，而是**直接读 checkbox DOM 真实状态**（`document.getElementById('mobileModeSwitch').checked`）与 appState 取 OR——只要 UI 显示是 ON 就按移动端录制，杜绝"用户开了开关却因视图切换/异步导致 appState 短暂失同步而存成 PC"的丢失。
- app.js `transformData()` 改为：subStep 自带 `selector.isMobileGuide` 时优先使用，否则回退父 `introduction.isMobileGuide`
- 移动端手机壳尺寸：`handleMobileResize` 用 `document.documentElement.clientHeight`（**不要**用 `body.clientHeight`——`.pageBody` 是 `position:absolute` 不撑开 body，在 Electron webview 里 body 高度趋近 0，会被 min/max 钳成 280×450 过小壳子）。
- FIT_SCRIPT **始终注入**，但脚本内用 `isMobileScene()` 守卫按当前步骤跳过等比缩放（移动步骤跳过，PC 步骤仍缩放）。
- 缓存版本标记 `MAP_PREVIEW_VERSION`（当前 `'24'`；generator 检测到旧版本标记即删除重建，改检测/注入逻辑后务必 +1 使缓存失效）。
- 场景故事按钮：`#sceneStoryBtn` → `toggleSceneStory()`，展示时按钮置灰（`btnDisabled`）；`updateSceneStoryBtn()` 在 `init/startDemo/jumpStep/show·hideSceneStory` 同步状态。
- ⚠️ 渲染层 `preview.js` 的 `openPreview` 强制 `forcePCMode=true`（PC UA），地图预览内嵌内容用 PC UA 渲染；真·移动端 UA 渲染需改共享预览基建（未做）。

## 常用路径
- 录制导出根：`/d/shots-htmls/`
- 录制元数据：`C:/Users/123/AppData/Roaming/playwright-page-shot/recording-meta/`
