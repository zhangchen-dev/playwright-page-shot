# 项目记忆：playwright-page-shot（Electron 内部 webview 录制）

## 关键约定 / 易错点
- 录制数据 `recording_data.json` 存放于 `%AppData%/Roaming/playwright-page-shot/recording-meta/<sceneCode>/`，与导出目录（`outputDir/<sceneCode>/`，如 `/d/shots-htmls/`）平级隔离。
- **"继续录制 / 重录" 保存时会重跑 `_sequentialRenumber`，会改写所有步骤的 htmlContent（清陈旧导航脚本 + 重注入 + 改 CSS 引用）。** 任何对导航脚本的正则都必须**只匹配本录制器注入的脚本**，否则会把页面正文一起删掉。
- ⚠️ 导航脚本移除正则必须用特征锚定（`var elementIds` 紧跟在 `<script>(function(){` 之后、中间不允许出现 `<`），**切勿**用 `/<script>\s*\(function\(\)\s*\{[\s\S]*?var nextStep=.../` 这类会从页面自身 IIFE（如 `__R_ORIGIN__` 加载器）一路吞到本脚本、误删整个 `<body>` 的写法。该回归曾导致"原本可预览的步骤在继续录制后变空白"。
- 捕获侧空 body 根因多为 qiankun 微前端 `did-finish-load` 后 JS 才填 body；前端 `captureWebviewData` 有 `_waitForBodyContent`/`bodyEmpty` 守卫。
- elementId 所有页面固定为 `auto_step_elementId`；stepId 由 `_sequentialRenumber` 保证 step1..N 唯一连续。

## 地图预览（src/map-template + src/map-preview.js）
- 地图模板打包在 `src/map-template`（index.html/app.js/styles.css/img），主进程 `src/map-preview.js` 用 `copyAsarSafe` 复制到临时目录 `os.tmpdir()/map-preview-<sceneName>/map`，仅写临时目录、绝不碰源录制/导出。
- 移动端判定 v16 起以「**页面内容**」为权威（recorder 端全局 isMobileMode 会污染每步 introduction.isMobileGuide，无法依赖）：
  - `detectMobileFromContent(html)` 启发式（map-preview.js）：viewport meta 解析
    - 强移动端：`user-scalable=no` + `maximum-scale=1`（缩放锁定），或含 `viewport-fit=cover`（刘海屏适配）
    - 强 PC：仅 `width=device-width, initial-scale=1`（无缩放锁定）
    - 无 viewport meta → 默认 PC（recorder 不注入此 meta，全部来自被录制页面；纯桌面/SSR 站点通常无此 meta）
  - 优先级：**内容反推 > 子步骤自身 introduction.isMobileGuide > 场景级 isMobileMode**
  - 每个 subStep 独立计算 `selector.isMobileGuide`（不是只算 subModule 级），解决同一 subModule 内既有 PC 页又有移动页的混合场景
- app.js `transformData()` 改为：subStep 自带 `selector.isMobileGuide` 时优先使用，否则回退父 `introduction.isMobileGuide`
- 移动端手机壳尺寸：`handleMobileResize` 用 `document.documentElement.clientHeight`（**不要**用 `body.clientHeight`——`.pageBody` 是 `position:absolute` 不撑开 body，在 Electron webview 里 body 高度趋近 0，会被 min/max 钳成 280×450 过小壳子）。
- FIT_SCRIPT **始终注入**，但脚本内用 `isMobileScene()` 守卫按当前步骤跳过等比缩放（移动步骤跳过，PC 步骤仍缩放）。
- 缓存版本标记 `MAP_PREVIEW_VERSION`（当前 `'16'`，统一无后缀——按内容判定后 `-m/-p` 后缀失效不再需要）。
- 场景故事按钮：`#sceneStoryBtn` → `toggleSceneStory()`，展示时按钮置灰（`btnDisabled`）；`updateSceneStoryBtn()` 在 `init/startDemo/jumpStep/show·hideSceneStory` 同步状态。
- ⚠️ 渲染层 `preview.js` 的 `openPreview` 强制 `forcePCMode=true`（PC UA），地图预览内嵌内容用 PC UA 渲染；真·移动端 UA 渲染需改共享预览基建（未做）。

## 常用路径
- 录制导出根：`/d/shots-htmls/`
- 录制元数据：`C:/Users/123/AppData/Roaming/playwright-page-shot/recording-meta/`
