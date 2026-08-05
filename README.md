# 场景录制助手 - 基于 Playwright 的网页录制桌面工具

Electron 桌面应用，支持捕获页面快照、标记元素、多步骤导出。

## 功能特性

- 🖥️ **桌面应用**：独立 Electron 窗口作为操作面板，Playwright 浏览器作为浏览窗口
- 🎬 **场景录制**：配置场景信息后，逐步捕获页面快照
- 🏷️ **元素标记**：选择页面元素并添加标记（主标题 + 副标题），导出后点击标记可跳转到下一步
- 📁 **模块管理**：支持多模块 → 多主步骤 → 多步骤的层级结构
- 🔄 **多标签页支持**：基于 Playwright 原生多页面追踪，自动处理新标签页
- 💾 **静态导出**：导出为独立的 HTML + CSS 文件，可在任何浏览器中查看
- 🔗 **URL 导航**：面板顶部地址栏可直接输入 URL 导航

## 安装与启动

### 1. 安装依赖

```bash
# 确保 Node.js >= 20（使用 nvm 切换版本）
nvm use 20

# 安装 npm 依赖
npm install
```

### 2. 安装 Playwright Chromium 浏览器

```bash
# 使用国内镜像（推荐）
npm run install:browser

# 或直接运行
npx playwright install chromium
```

> 如果遇到锁文件冲突，删除后重试：
> ```powershell
> rmdir /s /q "%LOCALAPPDATA%\ms-playwright\__dirlock"
> npx playwright install chromium
> ```

### 3. 启动应用

```bash
npm start

# 开发模式（打开 DevTools）
npm run dev
```

## 录制流程

1. **场景配置**：在面板中输入场景主标题和场景名称，点击"开始录制"
2. **标记元素**：
   - 点击"选择元素"按钮
   - 在 Playwright 浏览器中点击要标记的元素
   - 回到面板输入主标题，点击"标记"完成
3. **下一步**：标记完成后，点击"下一步"捕获当前步骤
4. **继续录制**：重复标记 → 下一步的流程
5. **结束保存**：点击"结束并保存"，选择资源路径后导出

## 打包分发

### 打包为 Windows 安装包

```bash
npm run build:win
```

生成的安装包在 `dist/` 目录下，文件名格式：`场景录制助手-1.0.0-setup.exe`

### 打包为免安装目录（调试用）

```bash
npm run build:dir
```

### 其他平台

```bash
npm run build:mac    # macOS DMG
npm run build:linux  # Linux AppImage
```

### 打包说明

- 打包时会自动将 Playwright Chromium 包含在安装包中（约 200MB）
- 最终安装包大小约 300-400MB
- 安装后用户无需额外安装浏览器，直接打开即可使用

## 项目结构

```
main/                              # Electron 主进程
├── main.js                        # 应用入口：窗口创建、生命周期
├── preload.js                     # 安全 IPC 接口暴露
└── ipc/                           # IPC 处理器（按功能拆分）
    ├── index.js                   # 聚合注册入口
    ├── recorder-ipc.js            # 录制动作 + 元素选择 + 页面操作
    ├── window-ipc.js              # 窗口控制（最小化/置顶/缩放）
    ├── webview-ipc.js             # 注入脚本/preload路径/cookie同步
    ├── credential-ipc.js          # 凭证 CRUD
    ├── recording-mgmt-ipc.js      # 已录制列表/删除/下载/上传/同步
    └── preview-ipc.js             # 预览/保存目录

renderer/                          # 面板渲染进程（ES Modules）
├── panel.html                     # 面板 HTML
├── styles/                        # 样式（按功能拆分）
│   ├── theme.css                  # 设计令牌 + 基础重置
│   ├── layout.css                 # 三栏布局/侧栏/右栏/webview容器
│   ├── components.css             # 按钮/输入框/对话框/toast
│   ├── recording.css              # 录制面板/mark UI/快捷登录
│   ├── management.css             # 场景卡片/已录制内容
│   └── settings.css               # 凭证管理
└── modules/                       # 渲染层逻辑（按菜单功能拆分）
    ├── app.js                     # 入口：事件监听 + 面板渲染 + 初始化
    ├── common/                    # 公共方法/状态
    │   ├── state.js  api.js  dom.js  feedback.js
    │   ├── layout.js  webview-controls.js  input-preserve.js
    ├── recording/                 # 菜单：页面录制
    │   ├── internal/              # 对内录制（webview）
    │   ├── external/              # 对外录制（Playwright）
    │   └── shared/                # 录制共用（UI/动作/导航/凭证）
    ├── management/                # 菜单：后台管理
    ├── settings/                  # 菜单：设置
    └── preview/                   # 跨菜单共用预览功能

src/                               # 核心业务逻辑
├── browser-manager.js             # Playwright 浏览器管理 + 元素选择桥接
├── recorder.js                    # 录制状态机（单一数据源）
├── credential-store.js            # 凭证加密存储（DPAPI/Keychain）
├── html-capture.js                # HTML 快照捕获 + CSS/资源处理
├── css-utils.js                   # CSS URL 修复 + 去重
├── export.js                      # 文件批量导出
└── inject/                        # 内/外共用注入脚本
    ├── element-helper.js          # 元素选择辅助
    ├── credential-helper.js       # 登录表单检测 + 凭证填充
    └── webview-preload.js         # webview contextBridge 桥接
```

## 架构

```
┌──────────────────────────────────────────┐
│  Electron 主进程 (main/main.js)          │
│  ├── 控制面板窗口 (BrowserWindow)        │
│  ├── Playwright 浏览器（独立进程）        │
│  ├── IPC 消息中转                        │
│  └── Recorder / BrowserManager          │
├──────────────────────────────────────────┤
│  控制面板 (renderer/)                    │
│  ↕ Electron IPC                          │
├──────────────────────────────────────────┤
│  Playwright 浏览器页面                   │
│  └── 注入 element-helper.js             │
│      ↕ page.exposeFunction              │
└──────────────────────────────────────────┘
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm start` | 启动应用 |
| `npm run dev` | 启动应用（开发模式） |
| `npm run install:browser` | 安装 Playwright Chromium |
| `npm run build:win` | 打包 Windows 安装包 |
| `npm run build:dir` | 打包 Windows 免安装目录 |
| `npm run build:mac` | 打包 macOS DMG |
| `npm run build:linux` | 打包 Linux AppImage |

## 导出结构

```
Documents/playwright-page-shot/output/
└── 场景名称/
    ├── step1_20260728_180000_abc123.html
    ├── step1_20260728_180000_abc123.css
    ├── step1_20260728_180000_abc123_iframe_1.html
    ├── step2_20260728_180100_def456.html
    ├── step2_20260728_180100_def456.css
    └── recording_config.json
```
