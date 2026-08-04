/**
 * 面板渲染逻辑 - 运行在 Electron BrowserWindow 渲染进程中
 * 优化：
 * - 按钮放在对应区域
 * - showNextStep 开关（per 元素）
 * - introduction 配置（per 主步骤）
 * - 新增模块/主步骤时清空表单
 * - 本地预览按钮
 */
const api = window.electronAPI;

// ===== 本地状态 =====
let state = {
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
};

// 本地 UI 状态
let hasSelectedElement = false;
let selectedElementData = null;
let isSelectingMode = false;
let browserLaunched = false;
let isAlwaysOnTop = true;
let _savedInputValues = {};
let _focusedInputId = null;
let _cursorPos = null;
let _isProcessing = false;
let _clearFormOnNextRender = false; // ★ 新增模块/主步骤时清空表单
// ★ 已录制内容展开面板状态
let isRecordedExportsExpanded = false;
let expandedExportDirs = new Set();
// ★ 应用内预览模式状态
let isPreviewMode = false;
const PANEL_WIDTH = 380;
const PREVIEW_WIDTH = 820;
// ★ 快捷登录状态
let loginFormDomain = null;       // 当前检测到登录表单的域名
let savedCredentials = [];        // 当前域名的已保存凭证列表
let isCredentialsExpanded = false; // 配置阶段"已保存账号"面板展开状态

// DOM 引用
const contentEl = document.getElementById('content');
const statusEl = document.getElementById('statusBar');
const urlInput = document.getElementById('urlInput');
const navigateBtn = document.getElementById('navigateBtn');

// ===== 事件监听 =====
api.onStateSync((newState) => {
  const wasProcessing = _isProcessing;
  state = newState;
  if (urlInput && !urlInput.matches(':focus')) {
    urlInput.value = state.activePageUrl || '';
  }
  if (wasProcessing) {
    _isProcessing = false;
    _hideLoadingOverlay();
  }
  rerenderPanel();
});

api.onElementSelected((data) => {
  hasSelectedElement = true;
  selectedElementData = data;
  isSelectingMode = false;
  api.disableSelectionMode();
  updateMarkUI();
  updateStatus('已选择元素（' + (data.tagName || '') + '），请填写信息后标记', 'var(--accent-green)');
});

api.onSelectionCancelled(() => {
  hasSelectedElement = false;
  selectedElementData = null;
  isSelectingMode = false;
  api.disableSelectionMode();
  updateMarkUI();
  updateStatus('', '');
});

api.onCaptureProgress((msg) => {
  _isProcessing = true;
  updateStatus(msg.message || '处理中...', 'var(--accent-blue)');
  _showLoadingOverlay();
});

api.onError((data) => {
  updateStatus('错误: ' + (data.message || '未知错误'), 'var(--accent-red)');
});

api.onSaveComplete((data) => {
  updateStatus('保存成功！' + (data.fileCount || '') + ' 个文件已保存到: ' + (data.outputDir || ''), 'var(--accent-green)');
});

// ★ 登录表单检测 — 页面中出现登录表单时触发
api.onLoginFormDetected((data) => {
  loginFormDomain = data.domain;
  // 加载该域名的已保存凭证
  api.getCredentials(data.domain).then((creds) => {
    savedCredentials = creds || [];
    rerenderPanel();
  });
});

// ★ 登录提交捕获 — 用户提交登录表单时弹出"保存密码"对话框
api.onLoginSubmit((data) => {
  showSavePasswordDialog(data.domain, data.username, data.password);
});

// ===== URL 导航 =====
if (urlInput) {
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); navigateToUrl(); }
  });
}
if (navigateBtn) {
  navigateBtn.addEventListener('click', () => navigateToUrl());
}

async function navigateToUrl() {
  let url = urlInput.value.trim();
  if (!url) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
    urlInput.value = url;
  }
  updateStatus('正在导航...', 'var(--accent-blue)');
  const result = await api.navigateTo(url);
  if (result && result.justLaunched) {
    browserLaunched = true;
    updateStatus('浏览器已启动', 'var(--accent-green)');
  } else if (result && result.success) {
    updateStatus('', '');
  } else {
    updateStatus('导航失败: ' + (result?.error || ''), 'var(--accent-red)');
  }
}

// ===== ★ 应用内预览（webview 嵌入） =====

/** 将本地文件路径转为 file:// URL */
function filePathToUrl(filePath) {
  let normalized = filePath.replace(/\\/g, '/');
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }
  return 'file://' + normalized;
}

/** 在应用内打开预览（webview） */
async function showInAppPreview(filePath) {
  const fileUrl = filePathToUrl(filePath);
  const filename = filePath.replace(/\\/g, '/').split('/').pop();

  if (!isPreviewMode) {
    isPreviewMode = true;
    await api.resizeWindow(PANEL_WIDTH + PREVIEW_WIDTH);
    document.getElementById('previewContainer').classList.add('active');
  }

  // 显示加载状态并导航
  const loading = document.getElementById('previewLoading');
  const webview = document.getElementById('previewWebview');
  if (loading) {
    loading.textContent = '加载中...';
    loading.classList.add('active');
  }
  webview.src = fileUrl;

  updateStatus('正在预览: ' + filename, 'var(--accent-blue)');
}

/** 关闭应用内预览 */
function hideInAppPreview() {
  isPreviewMode = false;
  const container = document.getElementById('previewContainer');
  if (container) container.classList.remove('active');
  const webview = document.getElementById('previewWebview');
  if (webview) webview.src = 'about:blank';
  api.resizeWindow(PANEL_WIDTH);
  updateStatus('预览已关闭', '');
}

// 关闭预览按钮
const _closePreviewBtn = document.getElementById('closePreviewBtn');
if (_closePreviewBtn) {
  _closePreviewBtn.addEventListener('click', () => hideInAppPreview());
}

// webview 加载事件
const _previewWebview = document.getElementById('previewWebview');
if (_previewWebview) {
  _previewWebview.addEventListener('did-start-loading', () => {
    const loading = document.getElementById('previewLoading');
    if (loading) {
      loading.textContent = '加载中...';
      loading.classList.add('active');
    }
  });
  _previewWebview.addEventListener('did-finish-load', () => {
    const loading = document.getElementById('previewLoading');
    if (loading) loading.classList.remove('active');
  });
  _previewWebview.addEventListener('did-fail-load', (e) => {
    const loading = document.getElementById('previewLoading');
    if (loading) {
      loading.textContent = '加载失败: ' + (e.errorDescription || '未知错误');
      loading.classList.add('active');
    }
  });
}

function sendAction(type, extraData = {}) {
  return api.sendAction(type, extraData);
}

function updateStatus(text, color) {
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.style.color = color || 'var(--text-secondary)';
  }
}

function _showLoadingOverlay() {
  let overlay = document.getElementById('loadingOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'loadingOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.3);z-index:9999;display:flex;align-items:center;justify-content:center;pointer-events:all;';
    const spinner = document.createElement('div');
    spinner.style.cssText = 'background:var(--bg-card);padding:20px 32px;border-radius:8px;color:var(--text-primary);font-size:14px;display:flex;align-items:center;gap:10px;';
    spinner.innerHTML = '<span class="loading-spinner"></span>处理中...';
    overlay.appendChild(spinner);
    document.body.appendChild(overlay);
  } else {
    overlay.style.display = 'flex';
  }
}

function _hideLoadingOverlay() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.style.display = 'none';
}

// ===== 渲染面板 =====
function rerenderPanel() {
  if (!contentEl) return;

  if (_clearFormOnNextRender) {
    _savedInputValues = {};
    _focusedInputId = null;
    _cursorPos = null;
    _clearFormOnNextRender = false;
  } else {
    _saveInputValues();
  }

  if (state.phase === 'config') {
    renderConfigPhase();
  } else if (state.phase === 'recording') {
    renderRecordingPhase();
  }

  _restoreInputValues();
}

function _saveInputValues() {
  const inputs = contentEl.querySelectorAll('input, textarea, select');
  inputs.forEach((input) => {
    if (input.id) _savedInputValues[input.id] = input.value;
  });
  const activeEl = document.activeElement;
  if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && activeEl.id) {
    _focusedInputId = activeEl.id;
    _cursorPos = activeEl.selectionStart;
  } else {
    _focusedInputId = null;
    _cursorPos = null;
  }
}

function _restoreInputValues() {
  Object.keys(_savedInputValues).forEach((id) => {
    const input = document.getElementById(id);
    if (input && input.value !== _savedInputValues[id]) {
      input.value = _savedInputValues[id];
    }
  });
  if (_focusedInputId) {
    const el = document.getElementById(_focusedInputId);
    if (el) {
      el.focus();
      if (_cursorPos !== null && el.setSelectionRange) {
        try { el.setSelectionRange(_cursorPos, _cursorPos); } catch (e) {}
      }
    }
  }
  _savedInputValues = {};
  _focusedInputId = null;
  _cursorPos = null;
}

// ===== 渲染：配置阶段 =====
function renderConfigPhase() {
  contentEl.innerHTML = '';

  contentEl.appendChild(el('div', 'section-title', '场景配置'));
  const configBox = el('div', 'section-box');

  configBox.appendChild(labelEl('场景主标题', true));
  const titleInput = el('input', 'input-field');
  titleInput.type = 'text';
  titleInput.placeholder = '请输入场景主标题';
  titleInput.value = state.sceneConfig.sceneTitle;
  titleInput.id = 'sceneTitleInput';
  configBox.appendChild(titleInput);

  configBox.appendChild(labelEl('场景副标题', false));
  const subtitleInput = el('input', 'input-field');
  subtitleInput.type = 'text';
  subtitleInput.placeholder = '请输入场景副标题（选填）';
  subtitleInput.value = state.sceneConfig.sceneSubTitle;
  subtitleInput.id = 'sceneSubTitleInput';
  configBox.appendChild(subtitleInput);

  configBox.appendChild(labelEl('场景名称', true));
  const nameInput = el('input', 'input-field');
  nameInput.type = 'text';
  nameInput.placeholder = '请输入场景名称（英文/拼音）';
  nameInput.value = state.sceneConfig.sceneName;
  nameInput.id = 'sceneNameInput';
  configBox.appendChild(nameInput);

  // ★ 场景码（自动生成，只读）
  configBox.appendChild(labelEl('场景码（自动生成）', false));
  const sceneCodeInput = el('input', 'input-field');
  sceneCodeInput.type = 'text';
  sceneCodeInput.id = 'sceneCodeInput';
  sceneCodeInput.placeholder = '输入场景名称后自动生成';
  sceneCodeInput.readOnly = true;
  sceneCodeInput.style.opacity = '0.7';
  sceneCodeInput.style.fontFamily = "'Courier New', monospace";
  configBox.appendChild(sceneCodeInput);

  contentEl.appendChild(configBox);

  const startBtn = el('button', 'btn btn-primary btn-full');
  startBtn.textContent = '开始录制';
  startBtn.id = 'startRecordingBtn';
  function updateStartBtn() {
    startBtn.disabled = !titleInput.value.trim() || !nameInput.value.trim();
  }
  titleInput.addEventListener('input', updateStartBtn);

  // ★ 监听场景名称输入，自动生成场景码
  nameInput.addEventListener('input', () => {
    const name = nameInput.value.trim();
    if (name) {
      const random = Math.random().toString(36).substring(2, 6).toUpperCase();
      sceneCodeInput.value = name + '_' + random;
    } else {
      sceneCodeInput.value = '';
    }
    updateStartBtn();
  });

  updateStartBtn();
  startBtn.addEventListener('click', () => {
    const title = titleInput.value.trim();
    const name = nameInput.value.trim();
    if (!title || !name) return;
    sendAction('startRecording', {
      sceneTitle: title,
      sceneSubTitle: subtitleInput.value.trim(),
      sceneName: name,
      sceneCode: sceneCodeInput.value.trim(), // ★ 传递场景码
    });
  });
  contentEl.appendChild(startBtn);

  // ★ 已录制内容（可展开面板）
  renderRecordedExportsSection();

  // ★ 已保存账号管理（可展开面板）
  renderCredentialManagementSection();
}

// ===== 渲染：已录制内容（可展开面板） =====
function renderRecordedExportsSection() {
  const sectionBox = el('div', 'section-box recorded-exports-section');

  // 可展开/收起的标题
  const header = el('div', 'recorded-exports-header');
  const arrow = el('span', 'module-arrow', isRecordedExportsExpanded ? '\u25be' : '\u25b8');
  const title = el('span', 'module-name', '已录制内容');
  header.appendChild(arrow);
  header.appendChild(title);

  const content = el('div', 'recorded-exports-content');
  content.style.display = isRecordedExportsExpanded ? 'block' : 'none';

  header.addEventListener('click', () => {
    isRecordedExportsExpanded = !isRecordedExportsExpanded;
    arrow.textContent = isRecordedExportsExpanded ? '\u25be' : '\u25b8';
    content.style.display = isRecordedExportsExpanded ? 'block' : 'none';

    // 首次展开时加载数据
    if (isRecordedExportsExpanded && content.children.length === 0) {
      loadRecordedExports(content);
    }
  });

  // 如果之前是展开状态，自动加载
  if (isRecordedExportsExpanded) {
    loadRecordedExports(content);
  }

  sectionBox.appendChild(header);
  sectionBox.appendChild(content);
  contentEl.appendChild(sectionBox);
}

/** ★ 异步加载已录制内容列表 */
async function loadRecordedExports(container) {
  container.innerHTML = '';
  container.appendChild(el('div', 'empty-state', '加载中...'));

  const result = await api.getRecordedExports();
  if (!result || !result.success) {
    container.innerHTML = '';
    container.appendChild(el('div', 'empty-state', '加载失败: ' + (result ? result.error : '未知错误')));
    return;
  }

  container.innerHTML = '';

  if (!result.exports || result.exports.length === 0) {
    container.appendChild(el('div', 'empty-state', '暂无已录制的内容'));
    return;
  }

  result.exports.forEach((exp) => {
    const isExpanded = expandedExportDirs.has(exp.dirPath);
    const exportHeader = el('div', 'recorded-export-header');
    const expArrow = el('span', 'module-arrow', isExpanded ? '\u25be' : '\u25b8');
    const expName = el('span', 'recorded-export-name',
      exp.sceneTitle + (exp.sceneSubTitle ? ' - ' + exp.sceneSubTitle : '') + ' (' + exp.stepCount + '\u6b65)');
    exportHeader.appendChild(expArrow);
    exportHeader.appendChild(expName);

    const stepList = el('div', 'recorded-step-list');
    stepList.style.display = isExpanded ? 'block' : 'none';

    if (exp.htmlFiles && exp.htmlFiles.length > 0) {
      exp.htmlFiles.forEach((file) => {
        const stepItem = el('div', 'recorded-step-item');
        const labelText = file.index + '. ' + (file.mainTitle || file.stepTitle || file.filename);
        const label = el('span', 'recorded-step-label', labelText);
        label.title = file.filename +
          (file.moduleTitle ? '\n\u6a21\u5757: ' + file.moduleTitle : '') +
          (file.stepTitle ? '\n\u4e3b\u6b65\u9aa4: ' + file.stepTitle : '');

        const previewBtn = el('button', 'recorded-step-preview-btn', '\ud83d\udd0d \u9884\u89c8');
        previewBtn.addEventListener('click', async () => {
          previewBtn.disabled = true;
          previewBtn.textContent = '\u6253\u5f00\u4e2d...';
          await showInAppPreview(file.filePath);
          previewBtn.disabled = false;
          previewBtn.textContent = '\ud83d\udd0d \u9884\u89c8';
        });

        stepItem.appendChild(label);
        stepItem.appendChild(previewBtn);
        stepList.appendChild(stepItem);
      });
    }

    exportHeader.addEventListener('click', () => {
      const isOpen = stepList.style.display !== 'none';
      stepList.style.display = isOpen ? 'none' : 'block';
      expArrow.textContent = isOpen ? '\u25b8' : '\u25be';
      if (isOpen) {
        expandedExportDirs.delete(exp.dirPath);
      } else {
        expandedExportDirs.add(exp.dirPath);
      }
    });

    container.appendChild(exportHeader);
    container.appendChild(stepList);
  });
}

// ===== ★ 快捷登录区域（录制阶段） =====
function renderQuickLoginSection() {
  contentEl.appendChild(el('div', 'section-title', '快捷登录'));
  const loginBox = el('div', 'section-box quick-login-section');

  // 域名提示
  const domainInfo = el('div', 'quick-login-domain', '检测到登录页: ' + loginFormDomain);
  loginBox.appendChild(domainInfo);

  if (savedCredentials.length === 0) {
    // 无已保存凭证 — 提示用户手动登录后自动保存
    const hint = el('div', 'empty-state', '暂无已保存账号\n请手动登录，登录后将自动提示保存密码');
    hint.style.whiteSpace = 'pre-wrap';
    hint.style.padding = '12px';
    loginBox.appendChild(hint);
  } else {
    // 显示已保存的账号列表
    savedCredentials.forEach((cred) => {
      const item = el('div', 'quick-login-item');
      const icon = el('span', 'quick-login-icon', '👤');
      const info = el('div', 'quick-login-info');
      info.appendChild(el('div', 'quick-login-username', cred.username));
      if (cred.lastUsed) {
        const date = new Date(cred.lastUsed);
        const dateStr = date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' +
          date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        info.appendChild(el('div', 'quick-login-lastused', '上次使用: ' + dateStr));
      }
      const fillBtn = el('button', 'quick-login-fill-btn', '填充登录');
      fillBtn.addEventListener('click', async () => {
        fillBtn.disabled = true;
        fillBtn.textContent = '填充中...';
        // 获取完整凭证（含密码）
        const fullCred = await api.getCredential({ domain: loginFormDomain, username: cred.username });
        if (fullCred) {
          const result = await api.fillCredentials({ username: fullCred.username, password: fullCred.password });
          if (result && result.success) {
            updateStatus('已填充账号: ' + cred.username + '，请在页面中点击登录按钮', 'var(--accent-green)');
          } else {
            updateStatus('填充失败，请检查页面是否仍为登录页', 'var(--accent-red)');
          }
        }
        fillBtn.disabled = false;
        fillBtn.textContent = '填充登录';
      });
      item.appendChild(icon);
      item.appendChild(info);
      item.appendChild(fillBtn);
      loginBox.appendChild(item);
    });
  }

  contentEl.appendChild(loginBox);
}

// ===== ★ 保存密码对话框 =====
function showSavePasswordDialog(domain, username, password) {
  if (!domain || !username || !password) return;

  // 检查是否已存在相同用户名的凭证
  const existing = savedCredentials.find((c) => c.username === username);
  const isUpdate = !!existing;

  const overlay = el('div', 'dialog-overlay');
  const dialog = el('div', 'dialog');

  dialog.appendChild(el('div', 'dialog-title', isUpdate ? '🔄 更新密码？' : '🔑 保存密码？'));
  dialog.appendChild(el('div', 'dialog-desc',
    (isUpdate ? '检测到账号 "' + username + '" 的密码已变更。\n' : '检测到登录账号：\n') +
    '域名: ' + domain + '\n' +
    '账号: ' + username + '\n\n' +
    '是否保存以便下次快捷登录？'));

  const btnRow = el('div', 'dialog-btn-row');

  const neverBtn = el('button', 'dialog-cancel-btn', '永不保存');
  neverBtn.addEventListener('click', () => overlay.remove());

  const skipBtn = el('button', 'dialog-cancel-btn', '本次不保存');
  skipBtn.addEventListener('click', () => overlay.remove());

  const saveBtn = el('button', 'dialog-confirm-btn blue', isUpdate ? '更新' : '保存');
  saveBtn.addEventListener('click', async () => {
    overlay.remove();
    const result = await api.saveCredential({ domain, username, password });
    if (result && result.success) {
      updateStatus(isUpdate ? '密码已更新' : '密码已保存', 'var(--accent-green)');
      // 刷新已保存凭证列表
      savedCredentials = await api.getCredentials(domain) || [];
      rerenderPanel();
    } else {
      updateStatus('保存失败: ' + (result ? result.error : ''), 'var(--accent-red)');
    }
  });

  btnRow.appendChild(neverBtn);
  btnRow.appendChild(skipBtn);
  btnRow.appendChild(saveBtn);
  dialog.appendChild(btnRow);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

// ===== ★ 已保存账号管理（配置阶段，可展开面板） =====
function renderCredentialManagementSection() {
  const sectionBox = el('div', 'section-box recorded-exports-section');

  const header = el('div', 'recorded-exports-header');
  const arrow = el('span', 'module-arrow', isCredentialsExpanded ? '\u25be' : '\u25b8');
  const title = el('span', 'module-name', '已保存账号');
  header.appendChild(arrow);
  header.appendChild(title);

  const content = el('div', 'recorded-exports-content');
  content.style.display = isCredentialsExpanded ? 'block' : 'none';

  header.addEventListener('click', () => {
    isCredentialsExpanded = !isCredentialsExpanded;
    arrow.textContent = isCredentialsExpanded ? '\u25be' : '\u25b8';
    content.style.display = isCredentialsExpanded ? 'block' : 'none';
    if (isCredentialsExpanded && content.children.length === 0) {
      loadAllCredentials(content);
    }
  });

  if (isCredentialsExpanded) {
    loadAllCredentials(content);
  }

  sectionBox.appendChild(header);
  sectionBox.appendChild(content);
  contentEl.appendChild(sectionBox);
}

/** ★ 异步加载所有已保存的账号凭证 */
async function loadAllCredentials(container) {
  container.innerHTML = '';
  container.appendChild(el('div', 'empty-state', '加载中...'));

  const domains = await api.getAllCredentials();
  container.innerHTML = '';

  if (!domains || domains.length === 0) {
    container.appendChild(el('div', 'empty-state', '暂无已保存的账号'));
    return;
  }

  domains.forEach((domainInfo) => {
    const domainHeader = el('div', 'cred-domain-header');
    domainHeader.appendChild(el('span', 'cred-domain-name', domainInfo.domain));
    domainHeader.appendChild(el('span', 'cred-domain-count', domainInfo.count + ' 个账号'));

    const credList = el('div', 'cred-list');
    domainInfo.credentials.forEach((cred) => {
      const item = el('div', 'cred-item');
      const info = el('div', 'cred-item-info');
      info.appendChild(el('div', 'cred-item-username', '👤 ' + cred.username));
      if (cred.lastUsed) {
        const date = new Date(cred.lastUsed);
        const dateStr = date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' +
          date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        info.appendChild(el('div', 'cred-item-lastused', '上次使用: ' + dateStr));
      }
      const deleteBtn = el('button', 'cred-delete-btn', '删除');
      deleteBtn.addEventListener('click', async () => {
        showConfirmDialog('删除账号', '确认删除 ' + domainInfo.domain + ' 下的账号 "' + cred.username + '" 吗？', async () => {
          await api.deleteCredential({ domain: domainInfo.domain, username: cred.username });
          updateStatus('已删除账号: ' + cred.username, 'var(--accent-green)');
          loadAllCredentials(container);
        });
      });
      item.appendChild(info);
      item.appendChild(deleteBtn);
      credList.appendChild(item);
    });

    container.appendChild(domainHeader);
    container.appendChild(credList);
  });
}

// ===== 渲染：录制阶段 =====
function renderRecordingPhase() {
  contentEl.innerHTML = '';

  const currentMainMod = state.currentMainModuleIndex >= 0 && state.currentMainModuleIndex < state.mainModules.length
    ? state.mainModules[state.currentMainModuleIndex]
    : null;
  const currentSubMod = currentMainMod && state.currentSubModuleIndex >= 0 && state.currentSubModuleIndex < currentMainMod.subModules.length
    ? currentMainMod.subModules[state.currentSubModuleIndex]
    : null;

  // ── 标签页列表 ──
  const tabSection = el('div', 'tab-section');
  tabSection.id = 'tabSection';
  api.getAllPages().then((pages) => {
    const tabSectionEl = document.getElementById('tabSection');
    if (!tabSectionEl) return;
    tabSectionEl.innerHTML = '';
    if (pages.length <= 1) {
      const info = el('div', 'page-info');
      info.innerHTML = '当前页面: <span class="page-info-url">' + (state.activePageUrl || '空白页') + '</span>';
      tabSectionEl.appendChild(info);
    } else {
      tabSectionEl.appendChild(el('div', 'section-title', '标签页'));
      pages.forEach((p) => {
        const tabItem = el('div', p.isActive ? 'tab-item active' : 'tab-item');
        tabItem.appendChild(el('span', 'tab-url', _shortenUrl(p.url)));
        if (p.isActive) tabItem.appendChild(el('span', 'tab-badge', '当前'));
        tabItem.addEventListener('click', () => api.setActivePage(p.pageId));
        tabSectionEl.appendChild(tabItem);
      });
    }
  });
  contentEl.appendChild(tabSection);

  // ★ 快捷登录区域 — 检测到登录表单且有已保存凭证时显示
  if (loginFormDomain) {
    renderQuickLoginSection();
  }

  // ── 当前模块 + 新增模块按钮 ──
  contentEl.appendChild(el('div', 'section-title', '当前模块'));
  const mainModuleBox = el('div', 'section-box');

  mainModuleBox.appendChild(labelEl('模块主标题', true));
  const mainModNameInput = el('input', 'input-field');
  mainModNameInput.type = 'text';
  mainModNameInput.placeholder = '请输入模块主标题';
  mainModNameInput.value = currentMainMod ? currentMainMod.mainModuleName : '';
  mainModNameInput.id = 'mainModNameInput';
  mainModuleBox.appendChild(mainModNameInput);

  mainModuleBox.appendChild(labelEl('模块描述', false));
  const mainModDescInput = el('input', 'input-field');
  mainModDescInput.type = 'text';
  mainModDescInput.placeholder = '请输入模块描述（选填）';
  mainModDescInput.value = currentMainMod ? currentMainMod.mainModuleDesc : '';
  mainModDescInput.id = 'mainModDescInput';
  mainModuleBox.appendChild(mainModDescInput);

  // ★ 新增模块按钮放在模块区域内
  const addMainModuleBtn = el('button', 'btn btn-secondary btn-sm btn-full');
  addMainModuleBtn.textContent = '+ 新增模块';
  addMainModuleBtn.style.marginTop = '8px';
  addMainModuleBtn.addEventListener('click', async () => {
    const mainModName = mainModNameInput ? mainModNameInput.value.trim() : '';
    const mainModDesc = mainModDescInput ? mainModDescInput.value.trim() : '';
    const modName = document.getElementById('modNameInput') ? document.getElementById('modNameInput').value.trim() : '';
    const intro = _collectIntroduction();
    _clearFormOnNextRender = true;
    updateStatus('正在处理...', 'var(--accent-blue)');
    await sendAction('addMainModule', { mainModName, mainModDesc, modName, introduction: intro });
  });
  mainModuleBox.appendChild(addMainModuleBtn);

  contentEl.appendChild(mainModuleBox);

  // ── 当前主步骤 + introduction + 新增主步骤按钮 ──
  contentEl.appendChild(el('div', 'section-title', '当前主步骤'));
  const subModuleBox = el('div', 'section-box');

  subModuleBox.appendChild(labelEl('主步骤标题', true));
  const modNameInput = el('input', 'input-field');
  modNameInput.type = 'text';
  modNameInput.placeholder = '请输入主步骤标题';
  modNameInput.value = currentSubMod ? currentSubMod.mainStepTitle : '';
  modNameInput.id = 'modNameInput';
  subModuleBox.appendChild(modNameInput);

  // ★ introduction 配置（可展开/收起）
  const introToggleRow = el('div', 'intro-toggle-row');
  const introToggleBtn = el('button', 'btn btn-link btn-sm');
  const hasIntro = currentSubMod && currentSubMod.introduction;
  introToggleBtn.textContent = hasIntro ? '▼ 编辑介绍 (introduction)' : '▶ 添加介绍 (introduction)';
  introToggleBtn.id = 'introToggleBtn';
  subModuleBox.appendChild(introToggleRow);
  introToggleRow.appendChild(introToggleBtn);

  const introBox = el('div', 'intro-box');
  introBox.id = 'introBox';
  introBox.style.display = hasIntro ? 'block' : 'none';

  introBox.appendChild(labelEl('问题 (question)', false));
  const introQuestionInput = el('input', 'input-field');
  introQuestionInput.type = 'text';
  introQuestionInput.placeholder = '请输入问题';
  introQuestionInput.value = hasIntro ? (currentSubMod.introduction.question || '') : '';
  introQuestionInput.id = 'introQuestionInput';
  introBox.appendChild(introQuestionInput);

  introBox.appendChild(labelEl('答案 (answer)', false));
  const introAnswerInput = el('input', 'input-field');
  introAnswerInput.type = 'text';
  introAnswerInput.placeholder = '请输入答案';
  introAnswerInput.value = hasIntro ? (currentSubMod.introduction.answer || '') : '';
  introAnswerInput.id = 'introAnswerInput';
  introBox.appendChild(introAnswerInput);

  subModuleBox.appendChild(introBox);

  introToggleBtn.addEventListener('click', () => {
    const isVisible = introBox.style.display !== 'none';
    introBox.style.display = isVisible ? 'none' : 'block';
    introToggleBtn.textContent = isVisible ? '▶ 添加介绍 (introduction)' : '▼ 编辑介绍 (introduction)';
  });

  // ★ 新增主步骤按钮放在主步骤区域内
  const addSubModuleBtn = el('button', 'btn btn-secondary btn-sm btn-full');
  addSubModuleBtn.textContent = '+ 新增主步骤';
  addSubModuleBtn.style.marginTop = '8px';
  addSubModuleBtn.addEventListener('click', async () => {
    const modName = modNameInput ? modNameInput.value.trim() : '';
    const intro = _collectIntroduction();
    _clearFormOnNextRender = true;
    updateStatus('正在处理...', 'var(--accent-blue)');
    await sendAction('addSubModule', { modName, introduction: intro });
  });
  subModuleBox.appendChild(addSubModuleBtn);

  contentEl.appendChild(subModuleBox);

  // ── 元素标记 ──
  contentEl.appendChild(el('div', 'section-title', '元素标记'));
  const markBox = el('div', 'section-box');

  // 选择模式提示
  const selectionHint = el('div', 'selection-active-hint');
  selectionHint.id = 'selectionHint';
  selectionHint.textContent = '请在浏览器中点击要标记的元素 | Esc退出';
  selectionHint.style.display = isSelectingMode ? '' : 'none';
  markBox.appendChild(selectionHint);

  const shortcutHint = el('div', 'shortcut-hint');
  shortcutHint.textContent = '快捷键: Alt+A 选择元素';
  markBox.appendChild(shortcutHint);

  // 标记操作行
  const markRow = el('div', 'btn-row');

  const markBtn = el('button', 'btn btn-secondary btn-sm');
  markBtn.textContent = isSelectingMode ? '取消选择' : '选择元素';
  markBtn.className = isSelectingMode ? 'btn btn-danger btn-sm' : 'btn btn-secondary btn-sm';
  markBtn.id = 'markBtn';
  markBtn.addEventListener('click', async () => {
    if (isSelectingMode) {
      await api.disableSelectionMode();
      isSelectingMode = false;
      hasSelectedElement = false;
      selectedElementData = null;
      markBtn.textContent = '选择元素';
      markBtn.className = 'btn btn-secondary btn-sm';
      selectionHint.style.display = 'none';
    } else {
      hasSelectedElement = false;
      selectedElementData = null;
      isSelectingMode = true;
      await api.enableSelectionMode();
      markBtn.textContent = '取消选择';
      markBtn.className = 'btn btn-danger btn-sm';
      selectionHint.style.display = '';
    }
  });
  markRow.appendChild(markBtn);

  const mainTitleInput = el('input', 'input-field');
  mainTitleInput.type = 'text';
  mainTitleInput.placeholder = '主标题 (mainTitle)';
  mainTitleInput.style.marginBottom = '0';
  mainTitleInput.style.flex = '1';
  mainTitleInput.id = 'markMainTitleInput';
  if (selectedElementData) mainTitleInput.value = selectedElementData.text || '';
  markRow.appendChild(mainTitleInput);

  const completeMarkBtn = el('button', 'btn btn-primary btn-sm');
  completeMarkBtn.textContent = '标记';
  completeMarkBtn.id = 'completeMarkBtn';
  completeMarkBtn.disabled = !hasSelectedElement;
  completeMarkBtn.className = hasSelectedElement ? 'btn btn-primary btn-sm' : 'btn btn-primary btn-sm btn-disabled';
  completeMarkBtn.addEventListener('click', () => doCompleteMark());
  markRow.appendChild(completeMarkBtn);

  markBox.appendChild(markRow);

  // 副标题
  markBox.appendChild(labelEl('副标题 (title)', false));
  const subTitleInput = el('input', 'input-field');
  subTitleInput.type = 'text';
  subTitleInput.placeholder = '请输入副标题（选填）';
  subTitleInput.id = 'markSubTitleInput';
  markBox.appendChild(subTitleInput);

  // ★ position 下拉选择
  markBox.appendChild(labelEl('位置 (position)', false));
  const positionSelect = el('select', 'input-field');
  positionSelect.id = 'markPositionSelect';
  ['right', 'bottom', 'left', 'top'].forEach((pos) => {
    const opt = el('option', null, pos);
    opt.value = pos;
    positionSelect.appendChild(opt);
  });
  markBox.appendChild(positionSelect);

  // ★ showNextStep 开关
  const showNextRow = el('div', 'toggle-row');
  const showNextLabel = el('span', 'toggle-label', '显示下一步按钮 (showNextStep)');
  const showNextToggle = el('label', 'switch');
  const showNextCheckbox = el('input');
  showNextCheckbox.type = 'checkbox';
  showNextCheckbox.id = 'markShowNextStepInput';
  showNextCheckbox.checked = true;
  const showNextSlider = el('span', 'slider');
  showNextToggle.appendChild(showNextCheckbox);
  showNextToggle.appendChild(showNextSlider);
  showNextRow.appendChild(showNextLabel);
  showNextRow.appendChild(showNextToggle);
  markBox.appendChild(showNextRow);

  // 标记列表
  const markListEl = el('div', 'mark-list');
  markListEl.id = 'markList';
  renderMarkList(markListEl);
  markBox.appendChild(markListEl);

  contentEl.appendChild(markBox);

  // ── 操作 ──
  contentEl.appendChild(el('div', 'section-title', '操作'));
  const stepBox = el('div', 'section-box');

  const stepInfo = el('div', 'step-info');
  stepInfo.textContent = state.currentStepId ? '当前步骤: ' + state.currentStepId : '';
  stepBox.appendChild(stepInfo);

  const stepShortcutHint = el('div', 'shortcut-hint');
  stepShortcutHint.textContent = '快捷键: Alt+S 下一步 | Alt+Q 结束保存';
  stepBox.appendChild(stepShortcutHint);

  const btnRow = el('div', 'btn-row');

  const nextStepBtn = el('button', 'btn btn-primary btn-sm');
  nextStepBtn.textContent = '下一步';
  nextStepBtn.id = 'nextStepBtn';
  nextStepBtn.disabled = !(state.markedElements.length > 0 || hasSelectedElement);
  nextStepBtn.className = nextStepBtn.disabled ? 'btn btn-primary btn-sm btn-disabled' : 'btn btn-primary btn-sm';
  nextStepBtn.addEventListener('click', async () => {
    if (nextStepBtn.disabled) return;
    if (hasSelectedElement && mainTitleInput) {
      const mainTitle = mainTitleInput.value.trim();
      if (!mainTitle) {
        updateStatus('请先输入主标题再进行下一步', 'var(--accent-red)');
        return;
      }
      doCompleteMark();
    }
    nextStepBtn.disabled = true;
    nextStepBtn.textContent = '处理中...';
    updateStatus('正在捕获页面...', 'var(--accent-blue)');
    await sendAction('nextStep');
  });
  btnRow.appendChild(nextStepBtn);

  const endSaveBtn = el('button', 'btn btn-danger btn-sm');
  endSaveBtn.textContent = '结束并保存';
  endSaveBtn.addEventListener('click', () => handleEndAndSave());
  btnRow.appendChild(endSaveBtn);

  const clearBtn = el('button', 'btn btn-warning btn-sm');
  clearBtn.textContent = '清空录制';
  clearBtn.addEventListener('click', () => {
    showConfirmDialog('确认清空录制', '清空后将丢失本次所有录制数据，且无法恢复。确定要清空吗？', () => sendAction('clearRecording'));
  });
  btnRow.appendChild(clearBtn);

  stepBox.appendChild(btnRow);
  contentEl.appendChild(stepBox);

  // ── 录制记录 ──
  contentEl.appendChild(el('div', 'section-title', '录制记录'));
  const moduleListEl = el('div', 'module-list');
  renderModuleList(moduleListEl);
  contentEl.appendChild(moduleListEl);
}

/** ★ 收集 introduction 数据 */
function _collectIntroduction() {
  const introBox = document.getElementById('introBox');
  if (!introBox || introBox.style.display === 'none') return null;

  const questionInput = document.getElementById('introQuestionInput');
  const answerInput = document.getElementById('introAnswerInput');
  const question = questionInput ? questionInput.value.trim() : '';
  const answer = answerInput ? answerInput.value.trim() : '';

  if (!question && !answer) return null;
  return { question, answer };
}

// ===== 结束并保存流程 =====
async function handleEndAndSave() {
  const mainTitleInput = document.getElementById('markMainTitleInput');
  if (hasSelectedElement && mainTitleInput) {
    const mainTitle = mainTitleInput.value.trim();
    if (!mainTitle) {
      updateStatus('请先输入主标题再结束保存', 'var(--accent-red)');
      return;
    }
    doCompleteMark();
  }

  const saveDir = await api.selectSaveDirectory();
  if (!saveDir) {
    updateStatus('已取消保存', 'var(--text-muted)');
    return;
  }
  await api.setOutputDir(saveDir);

  // ★ 使用环境配置对话框替代原 showBaseUrlDialog
  const envConfig = await showEnvConfigDialog(state.sceneCode || state.sceneConfig.sceneName);

  const modNameInput = document.getElementById('modNameInput');
  const mainModNameInput = document.getElementById('mainModNameInput');
  const mainModDescInput = document.getElementById('mainModDescInput');
  const intro = _collectIntroduction();

  updateStatus('正在处理和保存...', 'var(--accent-blue)');
  const result = await sendAction('endAndSave', {
    modName: modNameInput ? modNameInput.value.trim() : '',
    mainModName: mainModNameInput ? mainModNameInput.value.trim() : '',
    mainModDesc: mainModDescInput ? mainModDescInput.value.trim() : '',
    resourceBaseUrl: envConfig.envBaseUrl, // 向后兼容
    introduction: intro,
    environment: envConfig.environment,   // ★ 新增
    sceneCode: envConfig.sceneCode,       // ★ 新增
    envBaseUrl: envConfig.envBaseUrl,     // ★ 新增
  });

  if (result && result.type === 'error') {
    updateStatus('保存失败: ' + (result.message || ''), 'var(--accent-red)');
  } else if (result && result.type === 'saveComplete') {
    // ★ 保存成功后弹出预览选项
    showSaveResultDialog(result.fileCount, result.outputDir);
  }
}

/** ★ 保存成功后显示结果对话框（含预览按钮） */
function showSaveResultDialog(fileCount, outputDir) {
  const overlay = el('div', 'dialog-overlay');
  const dialog = el('div', 'dialog');

  dialog.appendChild(el('div', 'dialog-title', '✅ 保存成功'));
  const desc = el('div', 'dialog-desc', fileCount + ' 个文件已保存到：\n' + outputDir);
  desc.style.whiteSpace = 'pre-wrap';
  dialog.appendChild(desc);

  const btnRow = el('div', 'dialog-btn-row');

  const previewBtn = el('button', 'dialog-confirm-btn blue', '🔍 在应用内预览');
  previewBtn.addEventListener('click', async () => {
    overlay.remove();
    const previewResult = await api.previewExport();
    if (previewResult && previewResult.success) {
      await showInAppPreview(previewResult.filePath);
    } else {
      updateStatus('预览失败: ' + (previewResult ? previewResult.error : ''), 'var(--accent-red)');
    }
  });

  const closeBtn = el('button', 'dialog-cancel-btn', '关闭');
  closeBtn.addEventListener('click', () => overlay.remove());

  btnRow.appendChild(previewBtn);
  btnRow.appendChild(closeBtn);
  dialog.appendChild(btnRow);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  updateStatus('保存成功！' + fileCount + ' 个文件已保存', 'var(--accent-green)');
}

// ===== 完成标记 =====
function doCompleteMark() {
  const mainTitleInput = document.getElementById('markMainTitleInput');
  const subTitleInput = document.getElementById('markSubTitleInput');
  const positionSelect = document.getElementById('markPositionSelect');
  const showNextCheckbox = document.getElementById('markShowNextStepInput');
  if (!mainTitleInput) return;

  const mainTitle = mainTitleInput.value.trim();
  if (!mainTitle) {
    updateStatus('请输入主标题', 'var(--accent-red)');
    return;
  }

  const subTitle = subTitleInput ? subTitleInput.value.trim() : '';
  const position = positionSelect ? positionSelect.value : 'right';
  const showNextStep = showNextCheckbox ? showNextCheckbox.checked : true;

  sendAction('completeMark', {
    mainTitle,
    subTitle,
    elementId: selectedElementData?.elementId || '',
    isInIframe: selectedElementData?.isInIframe || false,
    iframeSrc: selectedElementData?.iframeSrc || '',
    showNextStep,
    position,
  });

  hasSelectedElement = false;
  selectedElementData = null;
  isSelectingMode = false;
  mainTitleInput.value = '';
  if (subTitleInput) subTitleInput.value = '';
  updateMarkUI();
  updateStatus('标记成功！', 'var(--accent-green)');
}

function updateMarkUI() {
  const completeMarkBtn = document.getElementById('completeMarkBtn');
  const markBtn = document.getElementById('markBtn');
  const selectionHint = document.getElementById('selectionHint');

  if (completeMarkBtn) {
    completeMarkBtn.disabled = !hasSelectedElement;
    completeMarkBtn.className = hasSelectedElement ? 'btn btn-primary btn-sm' : 'btn btn-primary btn-sm btn-disabled';
  }
  if (markBtn) {
    if (isSelectingMode) {
      markBtn.textContent = '取消选择';
      markBtn.className = 'btn btn-danger btn-sm';
    } else {
      markBtn.textContent = '选择元素';
      markBtn.className = 'btn btn-secondary btn-sm';
    }
  }
  if (selectionHint) {
    selectionHint.style.display = isSelectingMode ? '' : 'none';
  }
}

function renderMarkList(container) {
  container = container || document.getElementById('markList');
  if (!container) return;
  container.innerHTML = '';
  const marks = state.markedElements || [];
  if (marks.length === 0) return;
  marks.forEach((markData, idx) => {
    const item = el('div', 'mark-item');
    const text = el('span', 'mark-text', markData.mainTitle + (markData.showNextStep === false ? ' (无下一步)' : ''));
    item.appendChild(text);
    const deleteBtn = el('button', 'mark-delete-btn', '\u00d7');
    deleteBtn.addEventListener('click', () => sendAction('deleteMark', { markIndex: idx }));
    item.appendChild(deleteBtn);
    container.appendChild(item);
  });
}

function renderModuleList(container) {
  container = container || document.getElementById('moduleListEl');
  if (!container) return;
  container.innerHTML = '';
  if (!state.mainModules || state.mainModules.length === 0) {
    container.appendChild(el('div', 'empty-state', '暂无模块'));
    return;
  }
  state.mainModules.forEach((mainMod, mainIdx) => {
    const isCurrentMain = mainIdx === state.currentMainModuleIndex;
    const totalSteps = mainMod.subModules.reduce((sum, sm) => sum + (sm.steps ? sm.steps.length : 0), 0);
    const header = el('div', 'module-header' + (isCurrentMain ? ' active' : ''));
    const arrow = el('span', 'module-arrow', '\u25b8');
    const name = el('span', 'module-name', (mainMod.mainModuleName || '未命名模块') + ' (' + totalSteps + '步)');
    header.appendChild(arrow);
    header.appendChild(name);
    const subList = el('div', 'sub-module-list');
    mainMod.subModules.forEach((subMod, subIdx) => {
      const isCurrentSub = isCurrentMain && subIdx === state.currentSubModuleIndex;
      const stepCnt = subMod.steps ? subMod.steps.length : 0;
      const subHeader = el('div', 'sub-module-header' + (isCurrentSub ? ' active' : ''));
      const subArrow = el('span', 'sub-module-arrow', '\u25b8');
      const subName = el('span', 'sub-module-name', (subMod.mainStepTitle || '未命名主步骤') + ' (' + stepCnt + '步)');
      subHeader.appendChild(subArrow);
      subHeader.appendChild(subName);
      if (subMod.introduction) {
        const introBadge = el('span', 'intro-badge', 'intro');
        subHeader.appendChild(introBadge);
      }
      const stepList = el('div', 'step-list');
      if (subMod.steps && subMod.steps.length > 0) {
        subMod.steps.forEach((step, sIdx) => {
          const marksText = step.marks && step.marks.length > 0
            ? step.marks.map((m) => m.mainTitle).join(', ')
            : '无标记';
          const stepItem = el('div', 'step-item', (sIdx + 1) + '. ' + marksText);
          stepList.appendChild(stepItem);
        });
      }
      subHeader.addEventListener('click', () => {
        const isOpen = stepList.style.display !== 'none';
        stepList.style.display = isOpen ? 'none' : 'block';
        subArrow.textContent = isOpen ? '\u25b8' : '\u25be';
      });
      subList.appendChild(subHeader);
      subList.appendChild(stepList);
    });
    header.addEventListener('click', () => {
      const isOpen = subList.style.display !== 'none';
      subList.style.display = isOpen ? 'none' : 'block';
      arrow.textContent = isOpen ? '\u25b8' : '\u25be';
    });
    container.appendChild(header);
    container.appendChild(subList);
  });
}

function showConfirmDialog(title, desc, onConfirm) {
  const overlay = el('div', 'dialog-overlay');
  const dialog = el('div', 'dialog');
  dialog.appendChild(el('div', 'dialog-title', title));
  dialog.appendChild(el('div', 'dialog-desc', desc));
  const btnRow = el('div', 'dialog-btn-row');
  const cancelBtn = el('button', 'dialog-cancel-btn', '取消');
  cancelBtn.addEventListener('click', () => overlay.remove());
  const confirmBtn = el('button', 'dialog-confirm-btn', '确认');
  confirmBtn.addEventListener('click', () => { overlay.remove(); onConfirm(); });
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(confirmBtn);
  dialog.appendChild(btnRow);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

/** ★ 环境配置对话框（替代原 showBaseUrlDialog） */
function showEnvConfigDialog(defaultSceneCode) {
  return new Promise((resolve) => {
    const ENV_URLS = {
      dev: 'https://xft-service-marketing.paas.cmbchina.cn/resource/file/demonstration/',
      prd: 'https://xft-service-marketing.paas.cmbchina.cn/resource/file/demonstration/',
    };

    const overlay = el('div', 'dialog-overlay');
    const dialog = el('div', 'dialog');
    dialog.style.width = '380px';

    dialog.appendChild(el('div', 'dialog-title', '资源配置'));

    // 环境选择
    dialog.appendChild(labelEl('选择环境', true));
    const envGroup = el('div', 'env-radio-group');

    const envs = [
      { value: 'local', label: '\ud83c\udfe0 \u672c\u5730\u9884\u89c8\uff08\u76f8\u5bf9\u8def\u5f84\uff09' },
      { value: 'dev', label: '\ud83d\udd27 \u5f00\u53d1\u73af\u5883 (dev)' },
      { value: 'prd', label: '\ud83d\ude80 \u751f\u4ea7\u73af\u5883 (prd)' },
    ];

    let selectedEnv = 'local';

    envs.forEach((env) => {
      const radioLabel = el('label', 'env-radio-item');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'envSelect';
      radio.value = env.value;
      radio.checked = env.value === 'local';
      radio.addEventListener('change', () => {
        selectedEnv = env.value;
        updateUrlPreview();
        // 远端环境必须填写场景码
        sceneCodeInput.required = selectedEnv !== 'local';
      });
      radioLabel.appendChild(radio);
      radioLabel.appendChild(el('span', '', env.label));
      envGroup.appendChild(radioLabel);
    });
    dialog.appendChild(envGroup);

    // 场景码输入
    dialog.appendChild(labelEl('场景码', true));
    const sceneCodeInput = el('input', 'dialog-input');
    sceneCodeInput.type = 'text';
    sceneCodeInput.value = defaultSceneCode || '';
    sceneCodeInput.placeholder = '请输入场景码';
    sceneCodeInput.style.fontFamily = "'Courier New', monospace";
    sceneCodeInput.addEventListener('input', updateUrlPreview);
    dialog.appendChild(sceneCodeInput);

    // URL 预览
    const previewLabel = el('div', 'field-label', 'URL 预览');
    previewLabel.style.marginTop = '12px';
    dialog.appendChild(previewLabel);
    const previewBox = el('div', 'env-url-preview');
    dialog.appendChild(previewBox);

    function updateUrlPreview() {
      const code = sceneCodeInput.value.trim() || '\u573a\u666f\u7801';
      if (selectedEnv === 'local') {
        previewBox.textContent = '\u672c\u5730: ./step1.html';
      } else {
        const base = ENV_URLS[selectedEnv];
        previewBox.textContent = '\u8fdc\u7aef: ' + base + code + '/step1.html';
      }
    }
    updateUrlPreview();

    // 按钮
    const btnRow = el('div', 'dialog-btn-row');
    const confirmBtn = el('button', 'dialog-confirm-btn blue', '\u786e\u8ba4');
    confirmBtn.addEventListener('click', () => {
      const sceneCode = sceneCodeInput.value.trim();
      if (selectedEnv !== 'local' && !sceneCode) {
        sceneCodeInput.style.borderColor = 'var(--accent-red)';
        sceneCodeInput.focus();
        return;
      }
      overlay.remove();
      resolve({
        environment: selectedEnv,
        sceneCode: sceneCode,
        envBaseUrl: selectedEnv === 'local' ? '' : ENV_URLS[selectedEnv],
      });
    });
    btnRow.appendChild(confirmBtn);
    dialog.appendChild(btnRow);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    setTimeout(() => sceneCodeInput.focus(), 50);
  });
}

// ===== DOM 辅助 =====
function el(tag, className, textContent) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (textContent) element.textContent = textContent;
  return element;
}

function labelEl(text, required) {
  const label = el('label', 'field-label');
  label.textContent = text;
  if (required) label.appendChild(el('span', 'required', '*'));
  return label;
}

function _shortenUrl(url) {
  if (!url || url === 'about:blank') return '空白页';
  try {
    const u = new URL(url);
    let display = u.hostname + u.pathname;
    if (display.length > 40) display = display.substring(0, 37) + '...';
    return display;
  } catch (e) {
    return url.substring(0, 40);
  }
}

// ===== 全局快捷键 =====
document.addEventListener('keydown', (e) => {
  if (e.altKey) {
    if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      if (state.phase === 'recording' && state.isRecording) {
        const markBtn = document.getElementById('markBtn');
        if (markBtn) markBtn.click();
      }
    } else if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      if (state.phase === 'recording' && state.isRecording) {
        const nextStepBtn = document.getElementById('nextStepBtn');
        if (nextStepBtn && !nextStepBtn.disabled) nextStepBtn.click();
      }
    } else if (e.key === 'q' || e.key === 'Q') {
      e.preventDefault();
      if (state.phase === 'recording' && state.isRecording) {
        handleEndAndSave();
      }
    }
  }
});

// ===== 初始渲染 =====
rerenderPanel();
