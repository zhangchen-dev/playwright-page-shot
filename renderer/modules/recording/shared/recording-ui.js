/**
 * 录制共用 UI：配置阶段 / 录制阶段（可编辑节点树）/ introduction / 标记列表 / 模块列表 / 右栏步骤树
 */
import { appState } from '../../common/state.js';
import { api, sendAction } from '../../common/api.js';
import { contentEl, el, labelEl, formField, shortenUrl, urlInput, showLoadingOverlay, hideLoadingOverlay } from '../../common/dom.js';
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

// ===== 渲染：录制阶段（可编辑节点树） =====
// 结构：模块（历史行 + 当前编辑表单节点）→ 主步骤（历史行 + 当前编辑表单节点）
//       → 子步骤（历史行 + 当前编辑表单节点）
// 每个层级的「当前」节点都是该层级的最后一个节点（可编辑）；历史节点只读、可展开查看子层。
// 底层数据逻辑（recorder.js / IPC）保持不变，仅改交互渲染。
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

  // ── 当前页面信息（应用内单页模式，无外部多标签页） ──
  const tabSection = el('div', 'tab-section');
  tabSection.id = 'tabSection';
  const info = el('div', 'page-info');
  info.innerHTML = '当前页面: <span class="page-info-url">' + (appState.state.activePageUrl || '空白页') + '</span>';
  tabSection.appendChild(info);
  contentEl.appendChild(tabSection);

  // ★ 快捷登录区域 — 检测到登录表单且有已保存凭证时显示
  if (appState.loginFormDomain) {
    renderQuickLoginSection();
  }

  // ===== 工具函数 =====
  const getVal = (id) => {
    const e = document.getElementById(id);
    return e ? e.value.trim() : '';
  };

  // ===== 新增模块 / 新增主步骤（按钮逻辑，数据不变） =====
  async function onAddMainModule() {
    const mainModName = getVal('mainModNameInput');
    const mainModDesc = getVal('mainModDescInput');
    const modName = getVal('modNameInput');
    const intro = collectIntroduction();
    appState.clearFormOnNextRender = true;
    updateStatus('正在处理...', 'var(--accent-blue)');
    let webviewData = null;
    if (appState.browserMode === 'in-app') {
      try { webviewData = await captureWebviewData(); } catch (err) {
        showToast('捕获页面失败: ' + err.message, 'error'); return; }
    }
    await sendAction('addMainModule', {
      mainModName, mainModDesc, modName, introduction: intro,
      pageId: 'webview',
      ...(webviewData || {}),
    });
  }

  async function onAddSubModule() {
    const modName = getVal('modNameInput');
    const mainModName = getVal('mainModNameInput');
    const mainModDesc = getVal('mainModDescInput');
    const intro = collectIntroduction();
    appState.clearFormOnNextRender = true;
    updateStatus('正在处理...', 'var(--accent-blue)');
    let webviewData = null;
    if (appState.browserMode === 'in-app') {
      try { webviewData = await captureWebviewData(); } catch (err) {
        showToast('捕获页面失败: ' + err.message, 'error'); return; }
    }
    await sendAction('addSubModule', {
      modName, mainModName, mainModDesc, introduction: intro,
      pageId: 'webview',
      ...(webviewData || {}),
    });
  }

  // ===== 折叠态记忆（仅作用于「当前」层级节点，避免重渲染后被收起） =====
  if (!appState.expandedNodes) appState.expandedNodes = {};
  function nodeExpanded(key, def) {
    if (Object.prototype.hasOwnProperty.call(appState.expandedNodes, key)) return appState.expandedNodes[key];
    return def;
  }
  // 让节点头部可点击折叠，并记住展开态（key 固定为层级语义，跨重渲染保持）
  function makeCollapsible(header, body, children, key, def) {
    header.classList.add('collapsible');
    const expanded = nodeExpanded(key, def);
    const arrow = el('span', 'tree-arrow', expanded ? '▾' : '▸');
    // 箭头插在「层级标签」之后（第二个子元素位置）
    if (header.children.length >= 2) header.insertBefore(arrow, header.children[1]);
    else header.appendChild(arrow);
    const apply = (open) => {
      body.style.display = open ? '' : 'none';
      if (children) children.style.display = open ? '' : 'none';
      arrow.textContent = open ? '▾' : '▸';
    };
    apply(expanded);
    header.addEventListener('click', () => {
      const nowOpen = body.style.display === 'none';
      apply(nowOpen);
      appState.expandedNodes[key] = nowOpen;
    });
  }

  // ===== 历史节点构建（只读、可展开） =====
  function buildHistoricalModule(mm, mi) {
    const node = el('div', 'tree-node tree-node-historical');
    const header = el('div', 'tree-node-header collapsible');
    const tag = el('span', 'tree-node-tag', '模块');
    const arrow = el('span', 'tree-arrow', '▸');
    const title = el('span', 'tree-node-title');
    title.textContent = (mm.mainModuleName || ('模块' + (mi + 1)));
    const meta = el('span', 'tree-node-meta');
    meta.textContent = (mm.subModules ? mm.subModules.length : 0) + ' 主步骤';
    header.appendChild(tag);
    header.appendChild(arrow);
    header.appendChild(title);
    header.appendChild(meta);

    const children = el('div', 'tree-children');
    children.style.display = 'none';
    (mm.subModules || []).forEach((sm, si) => children.appendChild(buildHistoricalMainStep(sm, si, mi)));

    header.addEventListener('click', () => {
      const open = children.style.display !== 'none';
      children.style.display = open ? 'none' : 'block';
      arrow.textContent = open ? '▸' : '▾';
    });

    node.appendChild(header);
    node.appendChild(children);
    return node;
  }

  function buildHistoricalMainStep(sm, si, mi) {
    const node = el('div', 'tree-node tree-node-historical');
    const header = el('div', 'tree-node-header collapsible');
    const tag = el('span', 'tree-node-tag', '主步骤');
    const arrow = el('span', 'tree-arrow', '▸');
    const title = el('span', 'tree-node-title');
    title.textContent = (sm.mainStepTitle || ('步骤' + (si + 1)));
    const meta = el('span', 'tree-node-meta');
    meta.textContent = (sm.steps ? sm.steps.length : 0) + ' 步';
    header.appendChild(tag);
    header.appendChild(arrow);
    header.appendChild(title);
    header.appendChild(meta);

    const children = el('div', 'tree-children');
    children.style.display = 'none';
    (sm.steps || []).forEach((st, sti) => children.appendChild(buildHistoricalSubStep(st, sti)));

    header.addEventListener('click', () => {
      const open = children.style.display !== 'none';
      children.style.display = open ? 'none' : 'block';
      arrow.textContent = open ? '▸' : '▾';
    });

    node.appendChild(header);
    node.appendChild(children);
    return node;
  }

  function buildHistoricalSubStep(st, sti) {
    const node = el('div', 'tree-node tree-node-historical tree-leaf');
    const header = el('div', 'tree-node-header');
    const tag = el('span', 'tree-node-tag', '子步骤');
    const title = el('span', 'tree-node-title');
    const label = (st.marks && st.marks.length > 0) ? st.marks[0].mainTitle : ('子步骤' + (sti + 1));
    title.textContent = label;
    header.appendChild(tag);
    header.appendChild(title);
    node.appendChild(header);
    return node;
  }

  // ===== 当前子步骤编辑表单（树最末节点） =====
  function buildCurrentSubStepForm() {
    const node = el('div', 'tree-node tree-node-current');
    const header = el('div', 'tree-node-header');
    const tag = el('span', 'tree-node-tag', '子步骤');
    const badge = el('span', 'tree-node-badge', '当前');
    const title = el('span', 'tree-node-title', '子步骤（选择元素并填写气泡指引）');
    header.appendChild(tag);
    header.appendChild(badge);
    header.appendChild(title);
    node.appendChild(header);

    const body = el('div', 'tree-node-body');

    // 选择模式提示
    const selectionHint = el('div', 'selection-active-hint');
    selectionHint.id = 'selectionHint';
    selectionHint.textContent = '🎯 请在浏览器中点击要标记的元素 | Esc退出';
    selectionHint.style.display = appState.isSelectingMode ? '' : 'none';
    body.appendChild(selectionHint);

    // 标记操作行：选择按钮 + 气泡指引标题
    const markRow = el('div', 'mark-action-row');
    markRow.id = 'markActionRow';
    const markBtn = el('button', appState.isSelectingMode ? 'btn btn-danger btn-sm' : 'btn btn-primary btn-sm');
    markBtn.textContent = appState.isSelectingMode ? '✕ 取消选择' : '⊕ 选择元素';
    markBtn.id = 'markBtn';
    markBtn.addEventListener('click', () => toggleSelectionMode());
    markRow.appendChild(markBtn);

    const mainTitleField = formField({
      label: '气泡指引标题',
      placeholder: '例如：点击登录按钮',
      id: 'markMainTitleInput',
      value: appState.selectedElementData ? (appState.selectedElementData.text || '') : '',
      style: 'margin-bottom: 0; flex: 1;',
    });
    mainTitleField.wrapper.style.flex = '1';
    mainTitleField.wrapper.style.marginBottom = '0';
    markRow.appendChild(mainTitleField.wrapper);
    body.appendChild(markRow);

    // 副标题
    const subTitleField = formField({
      label: '气泡指引副标题',
      placeholder: '选填，例如：点击登录按钮',
      id: 'markSubTitleInput',
    });
    body.appendChild(subTitleField.wrapper);

    // ★ position 下拉 + showNextStep 开关（并排）
    const positionRow = el('div', 'form-field-row');
    const positionWrapper = el('div', 'form-field');
    positionWrapper.appendChild(el('label', 'field-label', '位置 (position)'));
    const positionSelectDropdown = createSelectDropdown({
      id: 'markPositionSelect',
      options: [
        { value: 'right',  label: 'right',  icon: '➡️' },
        { value: 'bottom', label: 'bottom', icon: '⬇️' },
        { value: 'left',   label: 'left',   icon: '⬅️' },
        { value: 'top',    label: 'top',    icon: '⬆️' },
      ],
      value: appState.markPosition || 'right',
      onChange: (v) => { appState.markPosition = v; },
    });
    positionWrapper.appendChild(positionSelectDropdown.wrapper);
    positionRow.appendChild(positionWrapper);

    const showNextWrapper = el('div', 'form-field');
    showNextWrapper.appendChild(el('label', 'field-label', '下一步按钮 (showNextStep)'));
    const showNextControl = el('div', 'switch-control');
    const showNextText = el('span', 'switch-text', (appState.markShowNext !== false) ? '显示' : '隐藏');
    const showNextToggle = el('label', 'switch');
    const showNextCheckbox = el('input');
    showNextCheckbox.type = 'checkbox';
    showNextCheckbox.id = 'markShowNextStepInput';
    showNextCheckbox.checked = appState.markShowNext !== false;
    const showNextSlider = el('span', 'slider');
    showNextToggle.appendChild(showNextCheckbox);
    showNextToggle.appendChild(showNextSlider);
    showNextControl.appendChild(showNextText);
    showNextControl.appendChild(showNextToggle);
    showNextWrapper.appendChild(showNextControl);
    positionRow.appendChild(showNextWrapper);
    body.appendChild(positionRow);

    showNextCheckbox.addEventListener('change', () => {
      appState.markShowNext = showNextCheckbox.checked;
      showNextText.textContent = showNextCheckbox.checked ? '显示' : '隐藏';
    });

    // ── 操作按钮 ──
    const stepBox = el('div', 'step-box');
    const stepInfo = el('div', 'step-info');
    stepInfo.textContent = appState.state.currentStepId ? '当前步骤: ' + appState.state.currentStepId : '';
    stepBox.appendChild(stepInfo);

    const btnRow = el('div', 'btn-row');

    const nextStepBtn = el('button', 'btn btn-primary btn-sm');
    nextStepBtn.textContent = '下一步';
    nextStepBtn.id = 'nextStepBtn';
    nextStepBtn.disabled = !(appState.state.markedElements.length > 0 || appState.hasSelectedElement);
    nextStepBtn.className = nextStepBtn.disabled ? 'btn btn-primary btn-sm btn-disabled' : 'btn btn-primary btn-sm';
    nextStepBtn.addEventListener('click', async () => {
      if (nextStepBtn.disabled) return;
      nextStepBtn.disabled = true;
      nextStepBtn.textContent = '处理中...';
      updateStatus('正在捕获页面（录制中）...', 'var(--accent-blue)');
      showLoadingOverlay();

      const mainModName = getVal('mainModNameInput');
      const mainModDesc = getVal('mainModDescInput');
      const modName = getVal('modNameInput');

      // ★ 自动标记兜底：若「选择即标记」的异步链路（completeMark IPC）尚未把标记落库，
      //   在捕获前用 _pendingMark 重提交一次。顺序保证 completeMark 先于 nextStepWebview 到达后端，
      //   杜绝「选择后秒点下一步」导致本步 marks 为空、预览无指引的竞态。
      if (appState.state.markedElements.length === 0 && appState._pendingMark) {
        appState.selectedElementData = appState._pendingMark;
        const mt = document.getElementById('markMainTitleInput');
        if (mt && !mt.value) mt.value = appState._pendingMark.text || '';
        doCompleteMark();
      }

      if (appState.browserMode === 'in-app') {
        try {
          const webviewData = await captureWebviewData();
          if (webviewData) {
            webviewData.mainModName = mainModName;
            webviewData.mainModDesc = mainModDesc;
            webviewData.modName = modName;
            // ★ per-step 移动端标记：只记当前这一步的开关状态（checkbox DOM 真实状态 + appState 取 OR）。
            //   下一步若没开，recorder 那边存的就是 false——支持混合录制（部分步骤 mobile、部分 PC）。
            const _mobileSwitchCbNext = document.getElementById('mobileModeSwitch');
            webviewData.isMobile = !!(appState.isMobileMode || (_mobileSwitchCbNext && _mobileSwitchCbNext.checked));
            const res = await sendAction('nextStepWebview', webviewData);
            if (res && res.response && res.response.type === 'empty') {
              showToast('⚠️ 本步页面内容为空，未记录。请等待页面完全加载后重新点「下一步」', 'error', 6000);
              updateStatus('本步内容为空未记录 — 请等待页面加载后重试「下一步」', 'var(--accent-red)');
              // ★ 空步不清除 _pendingMark：用户重试时仍可兜底重提交该步标记
            } else {
              appState._pendingMark = null;
              updateStatus('✓ 已捕获当前步骤，可继续录制下一步', 'var(--accent-green)');
            }
          } else {
            showToast('捕获页面失败：webview 未就绪', 'error');
          }
        } catch (err) {
          showToast('捕获页面失败: ' + err.message, 'error');
        }
      }
      hideLoadingOverlay();
    });
    btnRow.appendChild(nextStepBtn);

    stepBox.appendChild(btnRow);
    body.appendChild(stepBox);

    node.appendChild(body);
    makeCollapsible(header, body, null, 'step-current', false);
    return node;
  }

  // ===== 当前主步骤编辑表单（树节点，内嵌子步骤树） =====
  function buildCurrentMainStepForm(sm, si, mi) {
    const node = el('div', 'tree-node tree-node-current');
    const header = el('div', 'tree-node-header');
    const tag = el('span', 'tree-node-tag', '主步骤');
    const badge = el('span', 'tree-node-badge', '当前');
    const title = el('span', 'tree-node-title', '主步骤：' + (sm.mainStepTitle || ('步骤' + (si + 1))));
    header.appendChild(tag);
    header.appendChild(badge);
    header.appendChild(title);
    node.appendChild(header);

    const body = el('div', 'tree-node-body');

    const subModIdx = si;
    const subModDefault = '步骤' + (subModIdx + 1);
    const modNameField = formField({
      label: '地图-主任务步骤',
      required: true,
      placeholder: '例如：输入账号密码',
      id: 'modNameInput',
      value: sm.mainStepTitle || subModDefault,
    });
    body.appendChild(modNameField.wrapper);

    // ★ introduction 配置（默认收起，点击展开）
    const introToggleRow = el('div', 'intro-toggle-row');
    const introToggleBtn = el('button', 'btn btn-link btn-sm');
    const hasIntro = sm.introduction;
    // ★ 默认收起：文案统一为「添加」状态，表单默认隐藏（修复按钮/表单状态不一致）
    introToggleBtn.textContent = '▶ 添加当前主流程故事';
    introToggleRow.appendChild(introToggleBtn);
    body.appendChild(introToggleRow);

    const introBox = el('div', 'intro-box');
    introBox.style.display = 'none';
    const introKey = mi + '_' + si;
    const introDraft = appState.savedInputValues['intro_' + introKey] || {};
    const introQuestionField = formField({
      label: '右下角场景故事主标',
      placeholder: '例如：本方案要解决的核心问题',
      id: 'introQuestionInput',
      value: hasIntro ? (sm.introduction.question || '') : (introDraft.question || ''),
    });
    introBox.appendChild(introQuestionField.wrapper);
    const introAnswerField = formField({
      label: '右下角场景故事副标',
      placeholder: '例如：方案带来的业务价值',
      id: 'introAnswerInput',
      value: hasIntro ? (sm.introduction.answer || '') : (introDraft.answer || ''),
    });
    introBox.appendChild(introAnswerField.wrapper);
    body.appendChild(introBox);

    const introQuestionInput = introQuestionField.input;
    const introAnswerInput = introAnswerField.input;
    function persistIntroDraft() {
      const q = introQuestionInput ? introQuestionInput.value.trim() : '';
      const a = introAnswerInput ? introAnswerInput.value.trim() : '';
      if (!q && !a) {
        delete appState.savedInputValues['intro_' + introKey];
      } else {
        appState.savedInputValues['intro_' + introKey] = { question: q, answer: a };
      }
    }
    if (introQuestionInput) introQuestionInput.addEventListener('input', persistIntroDraft);
    if (introAnswerInput) introAnswerInput.addEventListener('input', persistIntroDraft);
    introToggleBtn.addEventListener('click', () => {
      const isVisible = introBox.style.display !== 'none';
      introBox.style.display = isVisible ? 'none' : 'block';
      introToggleBtn.textContent = isVisible ? '▶ 添加当前主流程故事' : '▼ 收起当前主流程故事';
    });

    node.appendChild(body);

    // 子步骤树（内嵌到当前主步骤节点下）
    const children = el('div', 'tree-children');
    (sm.steps || []).forEach((st, sti) => children.appendChild(buildHistoricalSubStep(st, sti)));
    children.appendChild(buildCurrentSubStepForm());
    node.appendChild(children);
    makeCollapsible(header, body, children, 'sub-current', false);
    return node;
  }

  // ===== 当前模块编辑表单（树根节点，内嵌主步骤树） =====
  function buildCurrentModuleForm(mm, mi) {
    const node = el('div', 'tree-node tree-node-current');
    const header = el('div', 'tree-node-header');
    const tag = el('span', 'tree-node-tag', '模块');
    const badge = el('span', 'tree-node-badge', '当前');
    const title = el('span', 'tree-node-title', '模块：' + (mm.mainModuleName || ('模块' + (mi + 1))));
    header.appendChild(tag);
    header.appendChild(badge);
    header.appendChild(title);
    node.appendChild(header);

    const body = el('div', 'tree-node-body');
    const mainModIdx = mi;
    const mainModDefault = '模块' + (mainModIdx + 1);
    const mainModNameField = formField({
      label: '地图-场景主标题',
      required: true,
      placeholder: '例如：登录认证',
      id: 'mainModNameInput',
      value: mm.mainModuleName || mainModDefault,
    });
    body.appendChild(mainModNameField.wrapper);
    const mainModDescField = formField({
      label: '地图-场景副标题',
      placeholder: '选填，例如：用户输入账号密码并登录',
      id: 'mainModDescInput',
      value: mm.mainModuleDesc || '',
    });
    body.appendChild(mainModDescField.wrapper);
    node.appendChild(body);

    // 主步骤树（内嵌到当前模块节点下）
    const children = el('div', 'tree-children');
    const curSubIdx = appState.state.currentSubModuleIndex;
    (mm.subModules || []).forEach((sm, si) => {
      if (si < curSubIdx) children.appendChild(buildHistoricalMainStep(sm, si, mi));
      else children.appendChild(buildCurrentMainStepForm(sm, si, mi));
    });
    const addSubBtn = el('button', 'btn btn-secondary btn-sm');
    addSubBtn.textContent = '＋  新增主步骤';
    addSubBtn.style.margin = '2px 0 2px 14px';
    addSubBtn.addEventListener('click', onAddSubModule);
    children.appendChild(addSubBtn);
    node.appendChild(children);
    makeCollapsible(header, body, children, 'mod-current', true);
    return node;
  }

  // ===== 组装树 =====
  const modules = appState.state.mainModules || [];
  const curModIdx = appState.state.currentMainModuleIndex;

  const treeRoot = el('div', 'tree-root');
  modules.forEach((mm, mi) => {
    if (mi < curModIdx) {
      treeRoot.appendChild(buildHistoricalModule(mm, mi));
    } else {
      treeRoot.appendChild(buildCurrentModuleForm(mm, mi));
    }
  });

  const addModBtn = el('button', 'btn btn-secondary btn-sm');
  addModBtn.textContent = '＋  新增模块';
  addModBtn.style.marginTop = '2px';
  addModBtn.addEventListener('click', onAddMainModule);
  treeRoot.appendChild(addModBtn);

  contentEl.appendChild(treeRoot);

  // ★ 结束保存 / 清空录制：放在树最外层（不在子步骤模块内），位置变更、逻辑不变
  const treeActionBar = el('div', 'tree-action-bar');

  // ★ 快捷键提示统一放在操作栏顶部，一行展示
  const treeActionHint = el('div', 'tree-action-hint');
  const treeActionHintPill = el('span', 'shortcut-hint');
  treeActionHintPill.textContent = 'Alt+S 下一步 | Alt+Q 结束保存';
  treeActionHint.appendChild(treeActionHintPill);
  treeActionBar.appendChild(treeActionHint);

  const endSaveItem = el('div', 'tree-action-item');
  const endSaveBtn = el('button', 'btn btn-danger btn-sm');
  endSaveBtn.textContent = '结束并保存';
  endSaveBtn.id = 'endSaveBtn';
  endSaveBtn.addEventListener('click', () => handleEndAndSave());
  endSaveItem.appendChild(endSaveBtn);
  treeActionBar.appendChild(endSaveItem);

  const clearItem = el('div', 'tree-action-item');
  const clearBtn = el('button', 'btn btn-warning btn-sm');
  clearBtn.textContent = '清空录制';
  clearBtn.id = 'clearRecordingBtn';
  clearBtn.addEventListener('click', () => {
    showConfirmDialog('确认清空录制', '清空后将丢失本次所有录制数据，且无法恢复。确定要清空吗？', () => sendAction('clearRecording'));
  });
  clearItem.appendChild(clearBtn);
  treeActionBar.appendChild(clearItem);

  contentEl.appendChild(treeActionBar);

  // ★ 录制记录已移至右栏（renderRightSteps）
}

/** ★ 收集 introduction 数据（直接读输入框，不依赖折叠状态，避免重渲染后空白被判为空） */
export function collectIntroduction() {
  const questionInput = document.getElementById('introQuestionInput');
  const answerInput = document.getElementById('introAnswerInput');
  const question = questionInput ? questionInput.value.trim() : '';
  const answer = answerInput ? answerInput.value.trim() : '';

  if (!question && !answer) return null;
  // ★ isMobileGuide：当前是否处于移动端录制模式，随场景故事一并落库，供地图模板 selector.isMobileGuide 使用
  return { question, answer, isMobileGuide: !!appState.isMobileMode };
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
      if (markData.elementId) {
        removeWebviewElementId(markData.elementId);
      }
      sendAction('deleteMark', {
        markIndex: idx,
        pageId: 'webview',
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
