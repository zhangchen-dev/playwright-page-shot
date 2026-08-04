# Playwright 页面录制工具实现计划

## Context

用户有一个 Chrome 扩展项目 `google-single-page`，实现了网页录制功能（捕获页面快照、标记元素、多步骤导出），但**多标签页处理有 bug**——每个 tab 各自维护状态，通过 `chrome.storage.local` 合并时存在竞态条件。

目标：基于 Playwright 重新实现该功能，利用 Playwright 的多标签页天然感知能力解决状态同步问题，代码写在空的 `playwright-page-shot` 项目中。

## 核心设计

### 架构：集中状态 + WebSocket 通信

```
浏览器页面 (注入面板JS)
    ↕ WebSocket
Node.js 后端 (ws-server.js)
    ↕ 直接调用
Recorder (单一状态源) / BrowserManager / HtmlCapture / Exporter
```

**解决多标签页问题的关键**：所有录制状态集中在 Node.js 后端的 `Recorder` 对象中，面板仅负责渲染和发送操作指令，不存在竞态。

### 项目文件结构

```
playwright-page-shot/
├── package.json              # 项目依赖
├── README.md                 # 使用说明
├── src/
│   ├── index.js              # CLI 入口
│   ├── browser-manager.js    # 浏览器管理 + 页面追踪 + 面板注入
│   ├── recorder.js           # 录制状态机（核心业务逻辑）
│   ├── html-capture.js       # HTML快照捕获 + CSS/资源处理
│   ├── css-utils.js          # CSS URL修复 + 去重
│   ├── export.js             # 文件批量导出
│   ├── ws-server.js          # WebSocket服务（面板↔后端通信）
│   └── panel/
│       ├── panel-inject.js   # 面板注入脚本（运行在浏览器上下文）
│       └── panel-styles.js   # 面板样式（内联CSS字符串）
└── output/                   # 默认导出目录
```

### 依赖

| 包 | 用途 |
|---|------|
| playwright | 浏览器自动化 |
| ws | WebSocket 服务 |
| cheerio | HTML 解析（资源URL处理） |
| commander | CLI 参数解析 |
| fs-extra | 增强文件操作 |

## 实施步骤

### Step 1: 初始化项目 + package.json

创建 `package.json`，包含上述依赖，然后 `npm install`。

### Step 2: CLI 入口 `src/index.js`

- 使用 commander 解析参数：`--url`, `--port`(WS端口，默认9222), `--output`(输出目录)
- 创建并启动 Recorder → WsServer → BrowserManager
- 处理 SIGINT 优雅关闭

### Step 3: 浏览器管理 `src/browser-manager.js`

- 启动 Chromium（headed, 1920x1080）
- 为每个 page 分配唯一 pageId，维护 `pages: Map<pageId, {page, url}>`
- **多标签页支持**：`context.on('page')` 监听新标签页，自动注册并注入面板
- **导航重注入**：`page.on('load')` 后重新注入面板脚本
- 面板注入方式：`page.addScriptTag({ content })` ，脚本中替换 `__WS_URL__` 和 `__PAGE_ID__` 占位符
- 提供 `getActivePage()`, `getPageById(pageId)`, `getAllPages()` 等查询方法

### Step 4: WebSocket 服务 `src/ws-server.js`

**消息协议**：

面板→后端：
| type | 说明 |
|------|------|
| register | 面板初始化，注册 pageId |
| startRecording | 开始录制 (sceneTitle, sceneSubTitle, sceneName) |
| selectElement | 进入元素选择模式 |
| cancelSelect | 取消选择模式 |
| completeMark | 完成标记 (mainTitle, subTitle, elementId, isInIframe, iframeSrc) |
| deleteMark | 删除标记 (markIndex) |
| nextStep | 捕获当前步骤并进入下一步 |
| addSubModule | 新增主步骤 (modName) |
| addMainModule | 新增模块 (mainModName, mainModDesc) |
| endAndSave | 结束录制并保存 (resourceBaseUrl) |
| clearRecording | 清空录制 |

后端→面板：
| type | 说明 |
|------|------|
| stateSync | 完整状态同步 |
| captureProgress | 捕获进度 |
| error | 错误通知 |

### Step 5: 录制状态机 `src/recorder.js`

- 集中管理所有录制状态：phase, sceneConfig, mainModules, currentStepId, nextStepId 等
- `handleAction(type, msg)` 统一入口处理所有面板操作
- `getState()` 返回深拷贝状态
- **每个页面的标记按 pageId 隔离**：`pageMarks: Map<pageId, Mark[]>`
- `_nextStep()` 调用 HtmlCapture 捕获页面快照
- `_endAndSave()` 调用 Exporter 导出文件
- ID 生成逻辑移植自 google-single-page 的 `generateStepId`/`generateElementId`

### Step 6: HTML 捕获 `src/html-capture.js`

核心方法 `captureStep({ stepId, nextStepId, marks, isEndRecording })`：

1. **DOM 清理**（浏览器上下文）：`page.evaluate()` 中 clone DOM → 移除面板元素/scripts/CSP meta/事件处理器
2. **CSS 处理**（Node.js 端 + 浏览器上下文）：
   - 用 cheerio 解析 HTML
   - 外部 CSS：`page.evaluate(() => fetch(url))` 获取内容（利用页面cookie/鉴权）
   - 内联 style：cheerio 提取
   - fixCssUrls + deduplicateCSS
3. **资源 URL 修复**：相对路径转绝对路径（img/video/audio/iframe 等）
4. **iframe 捕获**：`page.frames()` 直接访问各 frame 内容，无需中转
5. **步骤跳转脚本**：标记元素绑定点击跳转到下一步
6. **返回快照对象**：`{ stepId, htmlContent, cssContent, htmlFile, cssFile, marks, iframeFiles }`

### Step 7: CSS 工具 `src/css-utils.js`

直接移植 google-single-page content.js 的 `fixCssUrls` 和 `deduplicateCSS` 函数（约80行代码）。

### Step 8: 文件导出 `src/export.js`

- `_fixStepNavigationLinks()`: 修正跨模块步骤跳转链接
- `_applyResourceBaseUrl()`: 替换相对路径为完整路径
- `exportRecording()`: 写入所有 HTML/CSS/iframe/config 文件
- 直接用 `fs-extra.writeFile` 写文件，无需 Chrome 扩展的 File System Access API 降级

### Step 9: 面板注入脚本 `src/panel/panel-inject.js`

**工作量最大**（约2000+行），移植 google-single-page content.js 的面板 UI。

**保留不变的部分**：
- 所有样式定义 (styles, compactStyles)
- 面板 DOM 创建、拖拽、展开/收起
- renderConfigPhase / renderRecordingPhase 的 DOM 结构
- 元素选择模式的事件拦截逻辑
- 键盘快捷键 (Alt+A/S/Q)
- 确认对话框、资源配置对话框

**改造核心**：
- 添加 WebSocket 客户端（自动重连）
- 所有状态变量从 `stateSync` 消息获取
- 按钮点击改为 `sendAction()` 发送 WebSocket 消息
- 移除所有 `chrome.runtime.sendMessage` / `chrome.storage.local` 调用
- 移除所有 `saveSession()` / `loadSession()` 调用
- 元素选择后设置 DOM element.id，完成标记时发送 elementId 到后端

### Step 10: 面板样式 `src/panel/panel-styles.js`

将 content.js 中的 styles/compactStyles 对象导出为 JS 模块。

## 与 Chrome 扩展的关键差异

| 维度 | Chrome 扩展 | Playwright 方案 |
|------|------------|----------------|
| 状态管理 | 各tab独立 + chrome.storage 合并（有竞态） | Node.js 后端单一数据源 |
| 多标签页 | tabs.sendMessage + webNavigation 注入 | context.on('page') 自动注册 |
| iframe | chrome.scripting.executeScript 中转 | page.frames() 直接访问 |
| CSS 获取 | fetch (页面上下文) | page.evaluate(() => fetch()) (保留cookie) |
| 文件保存 | File System Access API + chrome.downloads | fs-extra 直接写文件 |
| 面板通信 | chrome.runtime.sendMessage | WebSocket |

## 验证方法

1. `npm install && npx playwright install chromium`
2. `node src/index.js --url https://example.com`
3. 验证：浏览器启动 → 面板出现 → 配置场景 → 选择元素标记 → 下一步 → 结束保存
4. 检查 output/ 目录下的 HTML/CSS/config 文件
5. 打开新标签页测试多标签页场景
6. 测试键盘快捷键
