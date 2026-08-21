# 项目记忆：playwright-page-shot（Electron 内部 webview 录制）

## 关键约定 / 易错点
- 录制数据 `recording_data.json` 存放于 `%AppData%/Roaming/playwright-page-shot/recording-meta/<sceneCode>/`，与导出目录（`outputDir/<sceneCode>/`，如 `/d/shots-htmls/`）平级隔离。
- **"继续录制 / 重录" 保存时会重跑 `_sequentialRenumber`，会改写所有步骤的 htmlContent（清陈旧导航脚本 + 重注入 + 改 CSS 引用）。** 任何对导航脚本的正则都必须**只匹配本录制器注入的脚本**，否则会把页面正文一起删掉。
- ⚠️ 导航脚本移除正则必须用特征锚定（`var elementIds` 紧跟在 `<script>(function(){` 之后、中间不允许出现 `<`），**切勿**用 `/<script>\s*\(function\(\)\s*\{[\s\S]*?var nextStep=.../` 这类会从页面自身 IIFE（如 `__R_ORIGIN__` 加载器）一路吞到本脚本、误删整个 `<body>` 的写法。该回归曾导致"原本可预览的步骤在继续录制后变空白"。
- 捕获侧空 body 根因多为 qiankun 微前端 `did-finish-load` 后 JS 才填 body；前端 `captureWebviewData` 有 `_waitForBodyContent`/`bodyEmpty` 守卫。
- elementId 所有页面固定为 `auto_step_elementId`；stepId 由 `_sequentialRenumber` 保证 step1..N 唯一连续。

## 常用路径
- 录制导出根：`/d/shots-htmls/`
- 录制元数据：`C:/Users/123/AppData/Roaming/playwright-page-shot/recording-meta/`
