/**
 * 录制共用 UI：配置阶段 / 录制阶段 / introduction / 标记列表 / 模块列表 / 右栏步骤树
 */
import { appState } from '../../common/state.js';
import { api, sendAction } from '../../common/api.js';
import { contentEl, el, labelEl, formField, shortenUrl, urlInput } from '../../common/dom.js';
import { createSelectDropdown } from '../../common/select-dropdown.js';
import { updateStatus, showToast, showConfirmDialog } from '../../common/feedback.js';
import { captureWebviewData, removeWebviewElementId } from '../internal/webview-recording.js';
import { doCompleteMark, handleEndAndSave, toggleSelectionMode } from './recording-actions.js';
import { renderQuickLoginSection } from './credentials-ui.js';

// ===== 渲染：配置阶段 =====
export function renderConfigPhase() {
  contentEl.innerHTML = '';

  // ★ 进入配置阶段即重置「下一步按钮 / 气泡位置」为默认，
  //   保证每次新录制从干净状态开始；录制中用户的改动仍会在录制面板内持久保留。
  appState.markShowNext = true;
  appState.markPosition = 'right';

  contentEl.appendChild(el('div', 'section-title', '解决方案配置'));
  const configBox = el('div', 'section-box');

  // ★ 场景主标题
  const titleField = formField({
    label: '解决方案主标题',
    required: true,
    placeholder: '例如：企业网银登录流程',
    id: 'sceneTitleInput',
    value: appState.state.sceneConfig.sceneTitle,
  });
  configBox.appendChild(titleField.wrapper);

  // ★ 场景副标题
  const subtitleField = formField({
    label: '解决方案副标题',
    placeholder: '选填，例如：支持指纹/人脸登录',
    id: 'sceneSubTitleInput',
    value: appState.state.sceneConfig.sceneSubTitle,
  });
  configBox.appendChild(subtitleField.wrapper);

  // ★ 场景码由系统自动生成（sen_code_ + 6 位随机），无需用户填写，此处仅作提示
  const codeHint = el('div', 'code-preview');
  codeHint.id = 'sceneCodePreview';
  codeHint.style.marginTop = '4px';
  codeHint.style.fontSize = '12px';
  codeHint.style.color = 'var(--text-muted)';
  codeHint.style.minHeight = '16px';
  codeHint.textContent = '场景码由系统自动生成（格式：sen_code_ + 6 位随机字符）';
  configBox.appendChild(codeHint);

  // ★ 提前取出各输入引用（必须在下方 updateCodePreview / addEventListener 之前声明，
  //   否则 const 的暂时性死区会触发 ReferenceError，导致整个配置面板渲染中断）
  const titleInput = titleField.input;
  const subtitleInput = subtitleField.input;

  // ★ 场景码预览节点已在上方创建（codeHint），此处仅保留兼容引用

  contentEl.appendChild(configBox);

  const startBtn = el('button', 'btn btn-primary btn-full');
  startBtn.textContent = '🎬  开始录制';
  startBtn.id = 'startRecordingBtn';

  function updateStartBtn() {
    // ★ 必填项：场景主标题 + 浏览器已打开（场景名称已合并到场景主标题）
    const fieldsValid = !!(titleInput.value.trim());
    startBtn.disabled = !fieldsValid || !appState.browserLaunched;
    startBtn.title = appState.browserLaunched ? '' : '请先在上方输入 URL 并打开浏览器';
  }
  titleInput.addEventListener('input', updateStartBtn);

  // ★ 监听浏览器状态变化（打开/关闭）
  const browserWatcher = () => updateStartBtn();
  // 轮询浏览器状态（依赖 stateSync 中 browserLaunched 变化）
  const intervalId = setInterval(browserWatcher, 500);
  // 切换/卸载时清理
  const cleanup = () => clearInterval(intervalId);
  // 兜底：3 秒后停止轮询（用 mutation 监听更准确）
  setTimeout(cleanup, 10000);

  updateStartBtn();
  startBtn.addEventListener('click', () => {
    // ★ 二次拦截：未开浏览器禁止开始录制
    if (!appState.browserLaunched) {
      showToast('请先在顶部 URL 栏输入 URL 并打开浏览器，再开始录制', 'error', 4000);
      urlInput.focus();
      return;
    }
    const title = titleInput.value.trim();
    if (!title) return;
    sendAction('startRecording', {
      sceneTitle: title,
      sceneSubTitle: subtitleInput.value.trim(),
      // ★ 场景名称 == 场景主标题（后端会令 sceneName = sceneTitle），无需前端单独传入
      // ★ 场景码由后端直接生成（sen_code_ + 6 位随机），无需前端传入
    });
  });
  contentEl.appendChild(startBtn);
}

// ===== 渲染：录制阶段 =====
export function renderRecordingPhase() {
  contentEl.innerHTML = '';

  // ★ 重录模式横幅 — 顶部醒目标识
  if (appState.state.reRecord && appState.state.reRecord.active) {
    const reRecord = appState.state.reRecord;
    const banner = el('div', 'rerecord-banner');
    const bannerText = el('div', 'rerecord-banner-text');
    const titleLine = el('div', 'rerecord-banner-title');
    titleLine.textContent = '🔄 重录模式 — 正在重录第 ' + (reRecord.targetStepIndex + 1) + ' 步';
    const subLine = el('div', 'rerecord-banner-sub');
    const targetMod = reRecord.targetModuleTitle || '(未命名模块)';
    const targetSub = reRecord.targetSubStepTitle || '(未命名主步骤)';
    const targetStep = reRecord.targetStepTitle || '(未命名步骤)';
    subLine.textContent = '模块: ' + targetMod + ' / 主步骤: ' + targetSub + ' / 步骤: ' + targetStep;
    const newStepLine = el('div', 'rerecord-banner-count');
    newStepLine.textContent = '已录制新步骤: ' + (reRecord.newStepCount || 0) + ' 步';
    bannerText.appendChild(titleLine);
    bannerText.appendChild(subLine);
    bannerText.appendChild(newStepLine);
    banner.appendChild(bannerText);

    // 取消重录按钮
    const cancelBtn = el('button', 'rerecord-banner-cancel-btn', '放弃重录');
    cancelBtn.addEventListener('click', async () => {
      cancelBtn.disabled = true;
      try {
        const result = await api.cancelRerecord();
        if (result && result.success) {
          showToast('已放弃重录，场景已恢复', 'info', 2500);
        } else {
          showToast('取消失败：' + (result?.error || '未知错误'), 'error');
        }
      } catch (err) {
        showToast('取消失败：' + err.message, 'error');
      } finally {
        cancelBtn.disabled = false;
      }
    });
    banner.appendChild(cancelBtn);
    contentEl.appendChild(banner);
  }

  const currentMainMod = appState.state.currentMainModuleIndex >= 0 && appState.state.currentMainModuleIndex < appState.state.mainModules.length
    ? appState.state.mainModules[appState.state.currentMainModuleIndex]
    : null;
  const currentSubMod = currentMainMod && appState.state.currentSubModuleIndex >= 0 && appState.state.currentSubModuleIndex < currentMainMod.subModules.length
    ? currentMainMod.subModules[appState.state.currentSubModuleIndex]
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
      info.innerHTML = '当前页面: <span class="page-info-url">' + (appState.state.activePageUrl || '空白页') + '</span>';
      tabSectionEl.appendChild(info);
    } else {
      tabSectionEl.appendChild(el('div', 'section-title', '标签页'));
      pages.forEach((p) => {
        const tabItem = el('div', p.isActive ? 'tab-item active' : 'tab-item');
        tabItem.appendChild(el('span', 'tab-url', shortenUrl(p.url)));
        if (p.isActive) tabItem.appendChild(el('span', 'tab-badge', '当前'));
        tabItem.addEventListener('click', () => api.setActivePage(p.pageId));
        tabSectionEl.appendChild(tabItem);
      });
    }
  });
  contentEl.appendChild(tabSection);

  // ★ 快捷登录区域 — 检测到登录表单且有已保存凭证时显示
  if (appState.loginFormDomain) {
    renderQuickLoginSection();
  }

  // ── 当前模块 + 新增模块按钮 ──
  contentEl.appendChild(el('div', 'section-title', '当前模块'));
  const mainModuleBox = el('div', 'section-box');

  // ★ 默认文案：模块主标题为空时自动填充“模块N”（N=当前模块序号，从1开始），
  //   用户无需每次手填即可连续录制，后续可自己编辑
  const mainModIdx = Math.max(0, appState.state.currentMainModuleIndex);
  const mainModDefault = '模块' + (mainModIdx + 1);
  const mainModNameField = formField({
    label: '地图-场景主标题',
    required: true,
    placeholder: '例如：登录认证',
    id: 'mainModNameInput',
    value: currentMainMod ? (currentMainMod.mainModuleName || mainModDefault) : mainModDefault,
  });
  mainModuleBox.appendChild(mainModNameField.wrapper);

  const mainModDescField = formField({
    label: '地图-场景副标题',
    placeholder: '选填，例如：用户输入账号密码并登录',
    id: 'mainModDescInput',
    value: currentMainMod ? currentMainMod.mainModuleDesc : '',
  });
  mainModuleBox.appendChild(mainModDescField.wrapper);

  // ★ 新增模块按钮放在模块区域内
  const addMainModuleBtn = el('button', 'btn btn-secondary btn-sm btn-full');
  addMainModuleBtn.textContent = '＋  新增模块';
  addMainModuleBtn.style.marginTop = '6px';
  const mainModNameInput = mainModNameField.input;
  const mainModDescInput = mainModDescField.input;
  addMainModuleBtn.addEventListener('click', async () => {
    const mainModName = mainModNameInput ? mainModNameInput.value.trim() : '';
    const mainModDesc = mainModDescInput ? mainModDescInput.value.trim() : '';
    const modName = document.getElementById('modNameInput') ? document.getElementById('modNameInput').value.trim() : '';
    const intro = collectIntroduction();
    appState.clearFormOnNextRender = true;
    updateStatus('正在处理...', 'var(--accent-blue)');

    // ★ 应用内浏览器模式：先捕获 webview 页面数据
    let webviewData = null;
    if (appState.browserMode === 'in-app') {
      try { webviewData = await captureWebviewData(); } catch (err) {
        showToast('捕获页面失败: ' + err.message, 'error'); return; }
    }
    await sendAction('addMainModule', {
      mainModName, mainModDesc, modName, introduction: intro,
      pageId: appState.browserMode === 'in-app' ? 'webview' : undefined,
      ...(webviewData || {}),
    });
  });
  mainModuleBox.appendChild(addMainModuleBtn);

  contentEl.appendChild(mainModuleBox);

  // ── 当前主步骤 + introduction + 新增主步骤按钮 ──
  contentEl.appendChild(el('div', 'section-title', '当前主步骤'));
  const subModuleBox = el('div', 'section-box');

  // ★ 默认文案：主步骤标题为空时自动填充“步骤N”（N=当前主步骤序号，从1开始），支持连续录制
  const subModIdx = Math.max(0, appState.state.currentSubModuleIndex);
  const subModDefault = '步骤' + (subModIdx + 1);
  const modNameField = formField({
    label: '地图-主任务步骤',
    required: true,
    placeholder: '例如：输入账号密码',
    id: 'modNameInput',
    value: currentSubMod ? (currentSubMod.mainStepTitle || subModDefault) : subModDefault,
  });
  subModuleBox.appendChild(modNameField.wrapper);

  // ★ introduction 配置（可展开/收起）
  const introToggleRow = el('div', 'intro-toggle-row');
  const introToggleBtn = el('button', 'btn btn-link btn-sm');
  const hasIntro = currentSubMod && currentSubMod.introduction;
  introToggleBtn.textContent = hasIntro ? '▼ 收起介绍' : '▶ 添加介绍 (introduction)';
  introToggleBtn.id = 'introToggleBtn';
  subModuleBox.appendChild(introToggleRow);
  introToggleRow.appendChild(introToggleBtn);

  const introBox = el('div', 'intro-box');
  introBox.id = 'introBox';
  introBox.style.display = hasIntro ? 'block' : 'none';

  const introQuestionField = formField({
    label: '右下角场景故事主标',
    placeholder: '例如：本方案要解决的核心问题',
    id: 'introQuestionInput',
    value: hasIntro ? (currentSubMod.introduction.question || '') : '',
  });
  introBox.appendChild(introQuestionField.wrapper);

  const introAnswerField = formField({
    label: '右下角场景故事副标',
    placeholder: '例如：方案带来的业务价值',
    id: 'introAnswerInput',
    value: hasIntro ? (currentSubMod.introduction.answer || '') : '',
  });
  introBox.appendChild(introAnswerField.wrapper);

  subModuleBox.appendChild(introBox);

  const introQuestionInput = introQuestionField.input;
  const introAnswerInput = introAnswerField.input;

  introToggleBtn.addEventListener('click', () => {
    const isVisible = introBox.style.display !== 'none';
    introBox.style.display = isVisible ? 'none' : 'block';
    introToggleBtn.textContent = isVisible ? '▶ 添加介绍 (introduction)' : '▼ 收起介绍';
  });

  // ★ 新增主步骤按钮放在主步骤区域内
  const addSubModuleBtn = el('button', 'btn btn-secondary btn-sm btn-full');
  addSubModuleBtn.textContent = '＋  新增主步骤';
  addSubModuleBtn.style.marginTop = '6px';
  const modNameInput = modNameField.input;
  addSubModuleBtn.addEventListener('click', async () => {
    const modName = modNameInput ? modNameInput.value.trim() : '';
    const mainModName = mainModNameInput ? mainModNameInput.value.trim() : '';
    const mainModDesc = mainModDescInput ? mainModDescInput.value.trim() : '';
    const intro = collectIntroduction();
    appState.clearFormOnNextRender = true;
    updateStatus('正在处理...', 'var(--accent-blue)');

    // ★ 应用内浏览器模式：先捕获 webview 页面数据
    let webviewData = null;
    if (appState.browserMode === 'in-app') {
      try { webviewData = await captureWebviewData(); } catch (err) {
        showToast('捕获页面失败: ' + err.message, 'error'); return; }
    }
    await sendAction('addSubModule', {
      modName, mainModName, mainModDesc, introduction: intro,
      pageId: appState.browserMode === 'in-app' ? 'webview' : undefined,
      ...(webviewData || {}),
    });
  });
  subModuleBox.appendChild(addSubModuleBtn);

  contentEl.appendChild(subModuleBox);

  // ── 元素标记 ──
  contentEl.appendChild(el('div', 'section-title', '元素标记'));
  const markBox = el('div', 'section-box');

  // 选择模式提示
  const selectionHint = el('div', 'selection-active-hint');
  selectionHint.id = 'selectionHint';
  selectionHint.textContent = '🎯 请在浏览器中点击要标记的元素 | Esc退出';
  selectionHint.style.display = appState.isSelectingMode ? '' : 'none';
  markBox.appendChild(selectionHint);

  // 标记操作行：选择按钮 + 主标题输入 + 标记按钮
  const markRow = el('div', 'mark-action-row');
  markRow.id = 'markActionRow';

  const markBtn = el('button', appState.isSelectingMode ? 'btn btn-danger btn-sm' : 'btn btn-primary btn-sm');
  markBtn.textContent = appState.isSelectingMode ? '✕ 取消选择' : '⊕ 选择元素';
  markBtn.id = 'markBtn';
  markBtn.addEventListener('click', () => toggleSelectionMode());
  markRow.appendChild(markBtn);

  // ★ 默认文案：未选中元素时自动填充“标记N”（N=当前步骤已标记数+1），减少每步输入
  const markDefault = '标记' + ((appState.state.markedElements?.length || 0) + 1);
  const mainTitleField = formField({
    label: '',
    placeholder: '主标题 (mainTitle)',
    id: 'markMainTitleInput',
    value: appState.selectedElementData ? (appState.selectedElementData.text || markDefault) : markDefault,
    style: 'margin-bottom: 0; flex: 1;',
  });
  mainTitleField.wrapper.style.flex = '1';
  mainTitleField.wrapper.style.marginBottom = '0';
  markRow.appendChild(mainTitleField.wrapper);

  const completeMarkBtn = el('button', 'btn btn-success btn-sm');
  completeMarkBtn.textContent = '✓ 标记';
  completeMarkBtn.id = 'completeMarkBtn';
  completeMarkBtn.disabled = !appState.hasSelectedElement;
  completeMarkBtn.addEventListener('click', () => doCompleteMark());
  markRow.appendChild(completeMarkBtn);

  markBox.appendChild(markRow);

  const mainTitleInput = mainTitleField.input;

  // 副标题
  const subTitleField = formField({
    label: '气泡指引副标题',
    placeholder: '选填，例如：点击登录按钮',
    id: 'markSubTitleInput',
  });
  markBox.appendChild(subTitleField.wrapper);

  // ★ position 下拉选择 — 与下一步按钮开关并排
  const positionRow = el('div', 'form-field-row');

  // ★ 自定义下拉（antd 风格），id 兼容原 markPositionSelect
  const positionWrapper = el('div', 'form-field');
  const positionLabel = el('label', 'field-label', '位置 (position)');
  positionWrapper.appendChild(positionLabel);
  const positionSelectDropdown = createSelectDropdown({
    id: 'markPositionSelect',
    options: [
      { value: 'right',  label: 'right',  icon: '➡️' },
      { value: 'bottom', label: 'bottom', icon: '⬇️' },
      { value: 'left',   label: 'left',   icon: '⬅️' },
      { value: 'top',    label: 'top',    icon: '⬆️' },
    ],
    // ★ 从 appState 读取上次选择，跨步骤/重渲染保持不变（期间用户可改，改动即生效）
    value: appState.markPosition || 'right',
    onChange: (v) => { appState.markPosition = v; },
  });
  positionWrapper.appendChild(positionSelectDropdown.wrapper);
  positionRow.appendChild(positionWrapper);

  // ★ showNextStep 开关 — 纯开关，不带 input 框
  const showNextWrapper = el('div', 'form-field');
  const showNextLabel = el('label', 'field-label', '下一步按钮 (showNextStep)');
  showNextWrapper.appendChild(showNextLabel);
  const showNextControl = el('div', 'switch-control');
  const showNextText = el('span', 'switch-text', (appState.markShowNext !== false) ? '显示' : '隐藏');
  const showNextToggle = el('label', 'switch');
  const showNextCheckbox = el('input');
  showNextCheckbox.type = 'checkbox';
  showNextCheckbox.id = 'markShowNextStepInput';
  // ★ 从 appState 读取上次选择（默认显示），跨重渲染保持不变
  showNextCheckbox.checked = appState.markShowNext !== false;
  const showNextSlider = el('span', 'slider');
  showNextToggle.appendChild(showNextCheckbox);
  showNextToggle.appendChild(showNextSlider);
  showNextControl.appendChild(showNextText);
  showNextControl.appendChild(showNextToggle);
  showNextWrapper.appendChild(showNextControl);
  positionRow.appendChild(showNextWrapper);

  markBox.appendChild(positionRow);

  // ★ 监听 showNextStep 开关，更新文字并持久化到 appState（跨步骤/重渲染保留最新值）
  showNextCheckbox.addEventListener('change', () => {
    appState.markShowNext = showNextCheckbox.checked;
    showNextText.textContent = showNextCheckbox.checked ? '显示' : '隐藏';
  });

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
  stepInfo.textContent = appState.state.currentStepId ? '当前步骤: ' + appState.state.currentStepId : '';
  stepBox.appendChild(stepInfo);

  const stepShortcutHint = el('div', 'shortcut-hint');
  stepShortcutHint.textContent = '快捷键: Alt+S 下一步 | Alt+Q 结束保存';
  stepBox.appendChild(stepShortcutHint);

  const btnRow = el('div', 'btn-row');

  const nextStepBtn = el('button', 'btn btn-primary btn-sm');
  nextStepBtn.textContent = '下一步';
  nextStepBtn.id = 'nextStepBtn';
  nextStepBtn.disabled = !(appState.state.markedElements.length > 0 || appState.hasSelectedElement);
  nextStepBtn.className = nextStepBtn.disabled ? 'btn btn-primary btn-sm btn-disabled' : 'btn btn-primary btn-sm';
  nextStepBtn.addEventListener('click', async () => {
    if (nextStepBtn.disabled) return;
    if (appState.hasSelectedElement && mainTitleInput) {
      const mainTitle = mainTitleInput.value.trim();
      if (!mainTitle) {
        showToast('请先输入主标题再进行下一步', 'error');
        return;
      }
      doCompleteMark();
    }
    nextStepBtn.disabled = true;
    nextStepBtn.textContent = '处理中...';
    updateStatus('正在捕获页面...', 'var(--accent-blue)');

    // ★ 当前模块名/描述、当前主步骤标题，随下一步一并提交，避免重渲染后模块内容变空
    const mainModName = mainModNameInput ? mainModNameInput.value.trim() : '';
    const mainModDesc = mainModDescInput ? mainModDescInput.value.trim() : '';
    const modName = modNameInput ? modNameInput.value.trim() : '';

    // ★ 应用内浏览器模式：从 webview 捕获页面数据
    if (appState.browserMode === 'in-app') {
      try {
        const webviewData = await captureWebviewData();
        if (webviewData) {
          webviewData.mainModName = mainModName;
          webviewData.mainModDesc = mainModDesc;
          webviewData.modName = modName;
          await sendAction('nextStepWebview', webviewData);
        } else {
          showToast('捕获页面失败：webview 未就绪', 'error');
        }
      } catch (err) {
        showToast('捕获页面失败: ' + err.message, 'error');
      }
    } else {
      await sendAction('nextStep', { mainModName, mainModDesc, modName });
    }
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

  // ★ 录制记录已移至右栏（renderRightSteps）
}

/** ★ 收集 introduction 数据 */
export function collectIntroduction() {
  const introBox = document.getElementById('introBox');
  if (!introBox || introBox.style.display === 'none') return null;

  const questionInput = document.getElementById('introQuestionInput');
  const answerInput = document.getElementById('introAnswerInput');
  const question = questionInput ? questionInput.value.trim() : '';
  const answer = answerInput ? answerInput.value.trim() : '';

  if (!question && !answer) return null;
  return { question, answer };
}

export function renderMarkList(container) {
  container = container || document.getElementById('markList');
  if (!container) return;
  container.innerHTML = '';
  const marks = appState.state.markedElements || [];
  if (marks.length === 0) return;
  marks.forEach((markData, idx) => {
    const item = el('div', 'mark-item');
    const text = el('span', 'mark-text', markData.mainTitle + (markData.showNextStep === false ? ' (无下一步)' : ''));
    item.appendChild(text);
    const deleteBtn = el('button', 'mark-delete-btn', '\u00d7');
    deleteBtn.addEventListener('click', () => {
      // ★ webview 模式下先移除 webview 中的元素 ID
      if (appState.browserMode === 'in-app' && markData.elementId) {
        removeWebviewElementId(markData.elementId);
      }
      sendAction('deleteMark', {
        markIndex: idx,
        pageId: appState.browserMode === 'in-app' ? 'webview' : undefined,
      });
    });
    item.appendChild(deleteBtn);
    container.appendChild(item);
  });
}

export function renderModuleList(container) {
  container = container || document.getElementById('moduleListEl');
  if (!container) return;
  container.innerHTML = '';
  if (!appState.state.mainModules || appState.state.mainModules.length === 0) {
    container.appendChild(el('div', 'empty-state', '暂无模块'));
    return;
  }
  appState.state.mainModules.forEach((mainMod, mainIdx) => {
    const isCurrentMain = mainIdx === appState.state.currentMainModuleIndex;
    const totalSteps = mainMod.subModules.reduce((sum, sm) => sum + (sm.steps ? sm.steps.length : 0), 0);
    const header = el('div', 'module-header' + (isCurrentMain ? ' active' : ''));
    const arrow = el('span', 'module-arrow', '\u25b8');
    const name = el('span', 'module-name', (mainMod.mainModuleName || '未命名模块') + ' (' + totalSteps + '步)');
    header.appendChild(arrow);
    header.appendChild(name);
    const subList = el('div', 'sub-module-list');
    mainMod.subModules.forEach((subMod, subIdx) => {
      const isCurrentSub = isCurrentMain && subIdx === appState.state.currentSubModuleIndex;
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

// ===== ★ 录制模式：右栏步骤树 =====
export function renderRightSteps() {
  const c = document.getElementById('rightContent');
  if (!c) return;
  c.innerHTML = '';
  c.appendChild(el('div', 'section-title', '录制记录'));
  const list = el('div', 'module-list');
  renderModuleList(list);
  c.appendChild(list);
}
