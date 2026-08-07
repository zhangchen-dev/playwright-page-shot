/**
 * 共享可变状态 + 常量
 * 各模块通过 `appState.xxx` 读写，对象引用共享，跨模块修改即时可见。
 */

// ===== 应用共享状态（原 panel.js 顶层 let/const 变量迁移至此） =====
export const appState = {
  // 录制后端同步状态
  state: {
    phase: 'config',
    sceneConfig: { sceneTitle: '', sceneSubTitle: '', sceneName: '' },
    mainModules: [],
    currentMainModuleIndex: -1,
    currentSubModuleIndex: -1,
    currentStepId: null,
    nextStepId: null,
    isRecording: false,
    stepCount: 0,
    markedElements: [],
    resourceBaseUrl: '',
    sceneCode: '', // ★ 场景码
    activePageUrl: '',
  },

  // 元素选择 / 录制 UI 状态
  hasSelectedElement: false,
  selectedElementData: null,
  isSelectingMode: false,
  browserLaunched: false,
  isAlwaysOnTop: false, // ★ 默认不置顶，仅录制模式+外置浏览器时置顶
  browserMode: 'in-app', // ★ 'external'（外层窗口） | 'in-app'（应用内右侧栏），默认应用内

  // 表单输入保留
  savedInputValues: {},
  focusedInputId: null,
  cursorPos: null,
  isProcessing: false,
  clearFormOnNextRender: false, // ★ 新增模块/主步骤时清空表单

  // 已录制内容展开面板状态
  isRecordedExportsExpanded: false,
  expandedExportDirs: new Set(),

  // 应用内预览模式状态
  isPreviewMode: false,

  // 快捷登录状态
  loginFormDomain: null,       // 当前检测到登录表单的域名
  savedCredentials: [],        // 当前域名的已保存凭证列表
  isCredentialsExpanded: false, // 配置阶段"已保存账号"面板展开状态

  // 三栏布局视图状态
  currentView: 'recording',        // 'recording' | 'management' | 'settings'
  rightColumnOpen: false,          // 右栏是否展开
  rightPanelMode: 'steps',         // 'steps'(步骤树) | 'preview'(webview)
  middleCollapsed: false,          // 中间列是否折叠
  currentPreviewFiles: [],         // 当前预览场景的文件列表

  // webview 状态
  webviewHelperInjected: false, // 元素选择脚本是否已注入
  webviewPreloadSet: false,     // webview preload 脚本是否已设置
  webviewRecordingMode: false,  // ★ webview 是否处于录制模式（非预览模式）
  fitPageEnabled: false,        // 适配页面模式
  currentZoom: 1.0,             // 当前缩放比例
  currentPreviewDirName: null,  // ★ 当前正在预览的场景目录名（用于高亮）
  currentPreviewStepIndex: 0,   // ★ 当前预览步骤索引
  currentResolution: '1920',    // 默认桌面 1920×1080

  // ★ 继续录制模式标志（管理视图点击"继续录制"后设置，用于跳过视图切换确认对话框）
  _continueRecordingMode: false,
};

// ===== 常量 =====
export const CONSTANTS = {
  PANEL_WIDTH: 380,
  PREVIEW_WIDTH: 820,
  SIDEBAR_W: 64,
  MIDDLE_W: 380,
  RIGHT_STEP_W: 380,
  RIGHT_PREVIEW_W: 820,
  DIVIDER_W: 6,
  // ★ 标准分辨率预设
  WEBVIEW_RESOLUTIONS: {
    '1920': { width: 1920, height: 1080, label: '桌面' },
    '1366': { width: 1366, height: 768,  label: '笔记本' },
  },
};
