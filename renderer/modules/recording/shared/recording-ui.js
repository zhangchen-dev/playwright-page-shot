/**
 * 录制共用 UI：配置阶段 / 录制阶段 / introduction / 标记列表 / 模块列表 / 右栏步骤树
 */
import { appState } from '../../common/state.js';
import { api, sendAction } from '../../common/api.js';
import { contentEl, el, labelEl, shortenUrl } from '../../common/dom.js';
import { updateStatus, showToast, showConfirmDialog } from '../../common/feedback.js';
import { captureWebviewData, removeWebviewElementId } from '../internal/webview-recording.js';
import { doCompleteMark, handleEndAndSave, toggleSelectionMode } from './recording-actions.js';
import { renderQuickLoginSection } from './credentials-ui.js';

// ===== 渲染：配置阶段 =====
export function renderConfigPhase() {
  contentEl.innerHTML = '';

  contentEl.appendChild(el('div', 'section-title', '场景配置'));
  const configBox = el('div', 'section-box');

  configBox.appendChild(labelEl('场景主标题', true));
  const titleInput = el('input', 'input-field');
  titleInput.type = 'text';
  titleInput.placeholder = '请输入场景主标题';
  titleInput.value = appState.state.sceneConfig.sceneTitle;
  titleInput.id = 'sceneTitleInput';
  configBox.appendChild(titleInput);

  configBox.appendChild(labelEl('场景副标题', false));
  const subtitleInput = el('input', 'input-field');
  subtitleInput.type = 'text';
  subtitleInput.placeholder = '请输入场景副标题（选填）';
  subtitleInput.value = appState.state.sceneConfig.sceneSubTitle;
  subtitleInput.id = 'sceneSubTitleInput';
  configBox.appendChild(subtitleInput);

  configBox.appendChild(labelEl('场景名称', true));
  const nameInput = el('input', 'input-field');
  nameInput.type = 'text';
  nameInput.placeholder = '请输入场景名称（英文/拼音）';
  nameInput.value = appState.state.sceneConfig.sceneName;
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
}

// ===== 渲染：录制阶段 =====
export function renderRecordingPhase() {
  contentEl.innerHTML = '';

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
      modName, introduction: intro,
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
  selectionHint.textContent = '请在浏览器中点击要标记的元素 | Esc退出';
  selectionHint.style.display = appState.isSelectingMode ? '' : 'none';
  markBox.appendChild(selectionHint);

  const shortcutHint = el('div', 'shortcut-hint');
  shortcutHint.textContent = '快捷键: Alt+A 选择元素';
  markBox.appendChild(shortcutHint);

  // 标记操作行
  const markRow = el('div', 'btn-row');

  const markBtn = el('button', 'btn btn-secondary btn-sm');
  markBtn.textContent = appState.isSelectingMode ? '取消选择' : '选择元素';
  markBtn.className = appState.isSelectingMode ? 'btn btn-danger btn-sm' : 'btn btn-secondary btn-sm';
  markBtn.id = 'markBtn';
  markBtn.addEventListener('click', () => toggleSelectionMode());
  markRow.appendChild(markBtn);

  const mainTitleInput = el('input', 'input-field');
  mainTitleInput.type = 'text';
  mainTitleInput.placeholder = '主标题 (mainTitle)';
  mainTitleInput.style.marginBottom = '0';
  mainTitleInput.style.flex = '1';
  mainTitleInput.id = 'markMainTitleInput';
  if (appState.selectedElementData) mainTitleInput.value = appState.selectedElementData.text || '';
  markRow.appendChild(mainTitleInput);

  const completeMarkBtn = el('button', 'btn btn-primary btn-sm');
  completeMarkBtn.textContent = '标记';
  completeMarkBtn.id = 'completeMarkBtn';
  completeMarkBtn.disabled = !appState.hasSelectedElement;
  completeMarkBtn.className = appState.hasSelectedElement ? 'btn btn-primary btn-sm' : 'btn btn-primary btn-sm btn-disabled';
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

    // ★ 应用内浏览器模式：从 webview 捕获页面数据
    if (appState.browserMode === 'in-app') {
      try {
        const webviewData = await captureWebviewData();
        if (webviewData) {
          await sendAction('nextStepWebview', webviewData);
        } else {
          showToast('捕获页面失败：webview 未就绪', 'error');
        }
      } catch (err) {
        showToast('捕获页面失败: ' + err.message, 'error');
      }
    } else {
      await sendAction('nextStep');
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
