/**
 * 录制状态机 - 核心业务逻辑
 * 所有录制状态集中在后端，通过回调通知状态变更
 */
const { HtmlCapture } = require('./html-capture');
const { Exporter } = require('./export');

class Recorder {
  constructor({ outputDir, onStateChange, onCaptureProgress }) {
    this.outputDir = outputDir;
    this.onStateChange = onStateChange;
    this.onCaptureProgress = onCaptureProgress;
    this.browserManager = null;

    // ===== 录制状态 (单一数据源) =====
    this.phase = 'config'; // 'config' | 'recording'
    this.sceneConfig = { sceneTitle: '', sceneSubTitle: '', sceneName: '' };
    this.mainModules = [];
    this.currentMainModuleIndex = -1;
    this.currentSubModuleIndex = -1;
    this.stepCount = 0;
    this.elementIdCounter = 0;
    this.currentStepId = null;
    this.nextStepId = null;
    this.resourceBaseUrl = '';
    this.lastExportDir = ''; // ★ 记录上次导出目录（用于预览）
    this.pageMarks = new Map();
    // ★ 移动端录制标记：开启移动端模式录制的场景，导出时 selector.isMobileGuide = true
    this.isMobileMode = false;
    // ★ 场景码 + 环境配置
    this.sceneCode = '';        // 场景码（场景名称+随机码）
    this.environment = 'local'; // 环境选择: 'local' | 'dev' | 'prd'
    this.envBaseUrl = '';       // 环境对应的远端基地址

    // ★ 重录模式状态 — 用于"重录该步骤"功能
    this.reRecord = {
      active: false,          // 是否处于重录模式
      dirPath: '',            // 场景目录路径
      mainModuleIndex: -1,    // 目标主模块索引
      subModuleIndex: -1,     // 目标主步骤索引
      targetStepIndex: -1,    // 目标步骤在 subMod.steps 中的索引
      targetStepId: '',       // 目标步骤的 stepId
      targetStepUrl: '',      // 目标步骤的 URL（用于重录时定位）
      targetModuleTitle: '',  // 目标主模块标题（用于 UI 显示）
      targetSubStepTitle: '', // 目标主步骤标题
      targetStepTitle: '',    // 目标步骤的 mainTitle
      baselineStepCount: 0,   // 加载时的步数（用于判断新录了多少步）
    };
  }

  setBrowserManager(bm) {
    this.browserManager = bm;
  }

  /**
   * 通知状态变更
   */
  _notifyStateChange() {
    if (this.onStateChange) {
      this.onStateChange(this.getState());
    }
  }

  /**
   * 通知捕获进度
   */
  _notifyCaptureProgress(message) {
    if (this.onCaptureProgress) {
      this.onCaptureProgress({ message });
    }
  }

  /**
   * 获取当前完整状态（深拷贝）
   */
  getState() {
    return {
      phase: this.phase,
      sceneConfig: { ...this.sceneConfig },
      mainModules: JSON.parse(JSON.stringify(this.mainModules)),
      currentMainModuleIndex: this.currentMainModuleIndex,
      currentSubModuleIndex: this.currentSubModuleIndex,
      currentStepId: this.currentStepId,
      nextStepId: this.nextStepId,
      isRecording: this.phase === 'recording',
      stepCount: this.stepCount,
      elementIdCounter: this.elementIdCounter,
      resourceBaseUrl: this.resourceBaseUrl,
      sceneCode: this.sceneCode, // ★ 场景码
      markedElements: this._getAllMarks(),
      activePageUrl: this._getActivePageUrl(),
      // ★ 重录模式信息（用于 UI 提示）
      reRecord: this.reRecord.active ? {
        active: true,
        mainModuleIndex: this.reRecord.mainModuleIndex,
        subModuleIndex: this.reRecord.subModuleIndex,
        targetStepIndex: this.reRecord.targetStepIndex,
        targetStepId: this.reRecord.targetStepId,
        targetStepUrl: this.reRecord.targetStepUrl,
        targetModuleTitle: this.reRecord.targetModuleTitle,
        targetSubStepTitle: this.reRecord.targetSubStepTitle,
        targetStepTitle: this.reRecord.targetStepTitle,
        baselineStepCount: this.reRecord.baselineStepCount,
        // ★ 新增步数（用于提示"录制了 N 步"）
        newStepCount: Math.max(0, this._countTotalSteps() - this.reRecord.baselineStepCount),
      } : null,
    };
  }

  /** 统计当前 mainModules 中所有步骤的总数 */
  _countTotalSteps() {
    let count = 0;
    for (const mainMod of this.mainModules) {
      for (const subMod of (mainMod.subModules || [])) {
        if (subMod.steps) count += subMod.steps.length;
      }
    }
    return count;
  }

  _getActivePageUrl() {
    if (!this.browserManager) return '';
    const active = this.browserManager.getActivePage();
    return active ? active.page.url() : '';
  }

  /**
   * 统一消息处理入口
   */
  handleAction(type, msg) {
    switch (type) {
      case 'startRecording': return this._startRecording(msg);
      case 'selectElement': return this._selectElement(msg);
      case 'cancelSelect': return this._cancelSelect(msg);
      case 'completeMark': return this._completeMark(msg);
      case 'deleteMark': return this._deleteMark(msg);
      case 'nextStep': return this._nextStep(msg);
      case 'nextStepWebview': return this._nextStepWebview(msg); // ★ webview 模式
      case 'addSubModule': return this._addSubModule(msg);
      case 'addMainModule': return this._addMainModule(msg);
      case 'endAndSave': return this._endAndSave(msg);
      case 'clearRecording': return this._clearRecording(msg);
      case 'continueRecording': return this._continueRecording(msg);
      case 'startReRecord': return this._startReRecord(msg);   // ★ 重录该步骤
      case 'cancelReRecord': return this._cancelReRecord(msg); // ★ 取消重录
      default: return null;
    }
  }

  _startRecording(msg) {
    const { sceneTitle, sceneSubTitle, sceneName } = msg;
    // ★ 场景名称 == 场景主标题：前端不再单独传 sceneName，缺失时以 sceneTitle 兜底
    const resolvedSceneName = sceneName || sceneTitle;
    if (!sceneTitle || !resolvedSceneName) {
      return { stateChanged: false, response: { type: 'error', message: '解决方案主标题为必填项' } };
    }
    this.sceneConfig = { sceneTitle, sceneSubTitle: sceneSubTitle || '', sceneName: resolvedSceneName };
    // ★ 场景码由系统直接生成：sen_code_ + 6 位随机（仅数字+字母，与 _genRandomSuffix 同规则）
    //   仅生成一次、全程保持不变，无需用户填写
    this.sceneCode = 'sen_code_' + this._genRandomSuffix(6);
    this.mainModules = [{
      mainModuleName: '',
      mainModuleDesc: '',
      subModules: [{ mainStepTitle: '', steps: [], introduction: null }],
    }];
    this.currentMainModuleIndex = 0;
    this.currentSubModuleIndex = 0;
    this.stepCount = 0;
    this.elementIdCounter = 0;
    this.currentStepId = this._generateStepId();
    this.nextStepId = this._generateStepId();
    this.phase = 'recording';
    this.resourceBaseUrl = '';
    this.pageMarks.clear();
    console.log(`[Recorder] 开始录制: ${sceneTitle} (${resolvedSceneName})`);
    this._notifyStateChange();
    return { stateChanged: true };
  }

  _selectElement(msg) {
    return { stateChanged: true };
  }

  _cancelSelect(msg) {
    return { stateChanged: true };
  }

  _completeMark(msg) {
    const { pageId, mainTitle, subTitle, elementId, isInIframe, iframeSrc, showNextStep, position } = msg;
    if (!mainTitle) {
      return { stateChanged: false, response: { type: 'error', message: '请输入主标题' } };
    }
    // 使用当前活跃页面作为 pageId（如果面板未传的话）
    const activePageId = pageId || this._getActivePageId();
    if (!this.pageMarks.has(activePageId)) {
      this.pageMarks.set(activePageId, []);
    }
    const marks = this.pageMarks.get(activePageId);
    marks.push({
      mainTitle,
      subTitle: subTitle || '',
      stepId: this.currentStepId,
      isInIframe: !!isInIframe,
      iframeSrc: iframeSrc || '',
      elementId: elementId || '',
      showNextStep: showNextStep !== false, // 默认 true
      position: position || 'right',
    });
    console.log(`[Recorder] 标记完成: ${mainTitle} (elementId=${elementId})`);
    this._notifyStateChange();
    return { stateChanged: true };
  }

  _deleteMark(msg) {
    const { pageId, markIndex } = msg;
    const activePageId = pageId || this._getActivePageId();
    const marks = this.pageMarks.get(activePageId);
    if (marks && markIndex >= 0 && markIndex < marks.length) {
      const removed = marks.splice(markIndex, 1)[0];
      // 移除 DOM 上的标记 ID（webview 模式由面板处理，此处仅处理 Playwright 页面）
      if (removed && removed.elementId && this.browserManager && activePageId !== 'webview') {
        this.browserManager.removeElementId(removed.elementId).catch(() => {});
      }
      console.log(`[Recorder] 标记已删除: index=${markIndex}`);
      this._notifyStateChange();
      return { stateChanged: true };
    }
    return { stateChanged: false };
  }

  async _nextStep(msg) {
    const { pageId } = msg;
    const activePageId = pageId || this._getActivePageId();
    this._saveCurrentModuleMeta(msg);
    if (!this.browserManager) {
      return { stateChanged: false, response: { type: 'error', message: '浏览器管理器未初始化' } };
    }

    const pageInfo = this.browserManager.getPageById(activePageId) || this.browserManager.getActivePage();
    if (!pageInfo) {
      return { stateChanged: false, response: { type: 'error', message: '找不到对应页面' } };
    }

    const marks = this.pageMarks.get(activePageId) || [];

    try {
      this._notifyCaptureProgress('正在捕获页面...');

      const capture = new HtmlCapture(pageInfo.page || pageInfo.page);
      const snapshot = await capture.captureStep({
        stepId: this.currentStepId,
        nextStepId: this.nextStepId,
        marks,
        isEndRecording: false,
      });

      const subMod = this._getCurrentSubModule();
      if (subMod) {
        subMod.steps.push(snapshot);
      }

      this.currentStepId = this.nextStepId;
      this.nextStepId = this._generateStepId();
      this.pageMarks.set(activePageId, []);

      console.log(`[Recorder] 步骤已捕获: ${this.currentStepId}`);
      this._notifyStateChange();
      return { stateChanged: true };
    } catch (err) {
      console.error('[Recorder] 捕获步骤失败:', err);
      return { stateChanged: false, response: { type: 'error', message: '捕获失败: ' + err.message } };
    }
  }

  /**
   * ★ 应用内 webview 模式的步骤捕获
   * 使用渲染进程预捕获的 HTML/CSS 数据，不需要 Playwright page 对象
   */
  async _nextStepWebview(msg) {
    const { url, html, cssContents, iframes, baseURI, isEndRecording: forceEnd } = msg;
    const activePageId = 'webview';
    this._saveCurrentModuleMeta(msg);
    const marks = this.pageMarks.get(activePageId) || [];

    try {
      this._notifyCaptureProgress('正在捕获页面（应用内浏览器）...');

      const capture = new HtmlCapture(null); // 不需要 page 对象
      const snapshot = await capture.processFromCapturedData({
        url,
        html,
        cssContents,
        iframes,
        baseUrl: baseURI,
        stepId: this.currentStepId,
        nextStepId: this.nextStepId,
        marks,
        isEndRecording: !!forceEnd,
      });

      const subMod = this._getCurrentSubModule();
      if (subMod) {
        subMod.steps.push(snapshot);
      }

      this.currentStepId = this.nextStepId;
      this.nextStepId = this._generateStepId();
      this.pageMarks.set(activePageId, []);

      console.log(`[Recorder] webview 步骤已捕获: ${this.currentStepId}`);
      this._notifyStateChange();
      return { stateChanged: true };
    } catch (err) {
      console.error('[Recorder] webview 捕获步骤失败:', err);
      return { stateChanged: false, response: { type: 'error', message: '捕获失败: ' + err.message } };
    }
  }

  async _addSubModule(msg) {
    const { pageId, modName, introduction } = msg;
    const activePageId = pageId || this._getActivePageId();
    // ★ 先把当前模块名/描述、当前主步骤标题落库，避免重渲染后模块内容变空
    this._saveCurrentModuleMeta(msg);

    const marks = this.pageMarks.get(activePageId) || [];
    if (marks.length > 0) {
      // ★ webview 模式使用 _nextStepWebview（不需要 Playwright page）
      const result = (activePageId === 'webview')
        ? await this._nextStepWebview(msg)
        : await this._nextStep(msg);
      if (!result.stateChanged) return result;
    }

    const subMod = this._getCurrentSubModule();
    if (subMod && subMod.steps.length > 0) {
      subMod.steps[subMod.steps.length - 1].isEndRecording = true;
      subMod.steps[subMod.steps.length - 1].nextStepId = null;
    }
    if (subMod && modName) {
      subMod.mainStepTitle = modName;
    }
    // 保存 introduction 到当前主步骤
    if (subMod && introduction !== undefined) {
      subMod.introduction = introduction;
    }

    const mainMod = this._getCurrentMainModule();
    if (!mainMod) return { stateChanged: false };

    this.currentSubModuleIndex = mainMod.subModules.length;
    mainMod.subModules.push({ mainStepTitle: '', steps: [], introduction: null });
    this.pageMarks.set(activePageId, []);

    this.currentStepId = this._generateStepId();
    this.nextStepId = this._generateStepId();

    console.log(`[Recorder] 新增主步骤: index=${this.currentSubModuleIndex}`);
    this._notifyStateChange();
    return { stateChanged: true, response: { type: 'formCleared' } };
  }

  async _addMainModule(msg) {
    const { pageId, mainModName, mainModDesc, modName, introduction } = msg;
    const activePageId = pageId || this._getActivePageId();

    const marks = this.pageMarks.get(activePageId) || [];
    if (marks.length > 0) {
      // ★ webview 模式使用 _nextStepWebview（不需要 Playwright page）
      const result = (activePageId === 'webview')
        ? await this._nextStepWebview(msg)
        : await this._nextStep(msg);
      if (!result.stateChanged) return result;
    }

    const subMod = this._getCurrentSubModule();
    if (subMod && subMod.steps.length > 0) {
      subMod.steps[subMod.steps.length - 1].isEndRecording = true;
      subMod.steps[subMod.steps.length - 1].nextStepId = null;
      if (modName) subMod.mainStepTitle = modName;
    }
    if (subMod && introduction !== undefined) {
      subMod.introduction = introduction;
    }

    const mainMod = this._getCurrentMainModule();
    if (mainMod) {
      mainMod.mainModuleName = mainModName || mainMod.mainModuleName;
      mainMod.mainModuleDesc = mainModDesc || mainMod.mainModuleDesc;
    }

    this.currentMainModuleIndex = this.mainModules.length;
    this.currentSubModuleIndex = 0;
    this.mainModules.push({
      mainModuleName: '',
      mainModuleDesc: '',
      subModules: [{ mainStepTitle: '', steps: [], introduction: null }],
    });
    this.pageMarks.set(activePageId, []);

    this.currentStepId = this._generateStepId();
    this.nextStepId = this._generateStepId();

    console.log(`[Recorder] 新增模块: index=${this.currentMainModuleIndex}`);
    this._notifyStateChange();
    return { stateChanged: true, response: { type: 'formCleared' } };
  }

  async _endAndSave(msg) {
    const { pageId, modName, mainModName, mainModDesc, resourceBaseUrl, introduction,
            environment, sceneCode, envBaseUrl, reRecordSaveMode, isMobile } = msg;
    const activePageId = pageId || this._getActivePageId();
    // ★ 记录移动端录制标记（供导出 selector.isMobileGuide 使用）
    this.isMobileMode = !!isMobile;

    // ★ 如果是重录模式且没有新录制的步骤，先尝试将残留的标记清掉（不报错）
    if (this.reRecord.active && this.getNewStepCount() === 0) {
      console.log('[Recorder] 重录模式下没有新步骤，取消重录');
      this._resetReRecord();
    }

    const mainMod = this._getCurrentMainModule();
    if (mainMod) {
      mainMod.mainModuleName = mainModName || mainMod.mainModuleName;
      mainMod.mainModuleDesc = mainModDesc !== undefined ? mainModDesc : mainMod.mainModuleDesc;
    }

    // 保存 introduction 到当前主步骤
    const subMod = this._getCurrentSubModule();
    if (subMod && introduction !== undefined) {
      subMod.introduction = introduction;
    }

    const marks = this.pageMarks.get(activePageId) || [];
    if (this.phase === 'recording' && marks.length > 0) {
      // ★ webview 模式使用 _nextStepWebview（不需要 Playwright page）
      const captureResult = (activePageId === 'webview')
        ? await this._nextStepWebview(msg)
        : await this._nextStep(msg);
      if (!captureResult.stateChanged) return captureResult;
    }

    if (subMod && subMod.steps.length > 0) {
      subMod.steps[subMod.steps.length - 1].isEndRecording = true;
      subMod.steps[subMod.steps.length - 1].nextStepId = null;
      if (modName) subMod.mainStepTitle = modName;
    }

    this.resourceBaseUrl = resourceBaseUrl || '';
    // ★ 环境配置
    this.environment = environment || 'local';
    // ★ 场景码已在开始录制时生成（含 4 位随机后缀），保存时保持不变，避免覆盖已带后缀的值
    this.sceneCode = this.sceneCode || sceneCode;
    this.envBaseUrl = envBaseUrl || '';

    try {
      // ★ 重录模式：根据用户选择的保存模式调整 mainModules
      if (this.reRecord.active && reRecordSaveMode) {
        this._applyReRecordSaveMode(reRecordSaveMode);
        this._resetReRecord();
      }

      this._fixStepNavigationLinks();

      // ★ 注入 originName（仅远端环境）
      if (this.environment !== 'local' && this.envBaseUrl) {
        const originName = this.envBaseUrl + this.sceneCode + '/';
        this._injectOriginName(originName);
        // ★ 同源：把 CSS <link> 改为「运行时判定」加载（file:// 相对 / 否则全域名，与 nextStep 导航一致）
        this._applyRuntimeResourceUrls(originName);
      }

      const exporter = new Exporter({ outputDir: this.outputDir });
      const result = await exporter.exportRecording(this);

      // 重置状态
      this.phase = 'config';
      this.sceneConfig = { sceneTitle: '', sceneSubTitle: '', sceneName: '' };
      this.mainModules = [];
      this.currentMainModuleIndex = -1;
      this.currentSubModuleIndex = -1;
      this.stepCount = 0;
      this.elementIdCounter = 0;
      this.currentStepId = null;
      this.nextStepId = null;
      this.resourceBaseUrl = '';
      this.sceneCode = ''; // ★ 重置场景码
      this.environment = 'local'; // ★ 重置环境
      this.envBaseUrl = ''; // ★ 重置远端地址
      this.isMobileMode = false; // ★ 重置移动端标记
      this.pageMarks.clear();
      this._resetReRecord();

      console.log(`[Recorder] 录制已结束，文件已保存到: ${result.outputDir}`);
      this.lastExportDir = result.outputDir;
      this._notifyStateChange();
      return {
        stateChanged: true,
        response: { type: 'saveComplete', fileCount: result.fileCount, outputDir: result.outputDir },
      };
    } catch (err) {
      console.error('[Recorder] 导出失败:', err);
      return { stateChanged: false, response: { type: 'error', message: '导出失败: ' + err.message } };
    }
  }

  /**
   * ★ 重录保存模式应用 — 根据用户选择的模式调整 mainModules
   * @param {string} mode - 'replace' (覆盖) | 'insert' (插入) | 'replace-single' (一步替换)
   */
  _applyReRecordSaveMode(mode) {
    if (!this.reRecord.active) return;
    const { mainModuleIndex, subModuleIndex, targetStepIndex } = this.reRecord;
    if (mainModuleIndex < 0 || mainModuleIndex >= this.mainModules.length) return;
    const mainMod = this.mainModules[mainModuleIndex];
    if (!mainMod) return;
    if (subModuleIndex < 0 || subModuleIndex >= mainMod.subModules.length) return;
    const subMod = mainMod.subModules[subModuleIndex];
    if (!subMod || !subMod.steps) return;
    if (targetStepIndex < 0 || targetStepIndex >= subMod.steps.length) return;

    const newCount = this.getNewStepCount();
    if (newCount <= 0) return;

    // ★ 当前 subMod 的旧步数 = 总步数 - 新增步数
    //    新步骤只追加到当前 subMod，其他 subMod 步数不变
    const oldStepsInThisSubMod = (subMod.steps || []).length - newCount;

    // 旧步数（基线时的步数）和新步数（用户新增的步数）
    const oldSteps = subMod.steps.slice(0, oldStepsInThisSubMod);
    const newSteps = subMod.steps.slice(oldStepsInThisSubMod);

    if (mode === 'replace') {
      // 覆盖模式：移除 targetStepIndex 及之后的所有旧步骤，用新步骤替代
      const keptOldSteps = oldSteps.slice(0, targetStepIndex);
      subMod.steps = [...keptOldSteps, ...newSteps];
    } else if (mode === 'insert') {
      // 插入模式：在 targetStepIndex 之后插入新步骤，原步骤全部保留
      const before = oldSteps.slice(0, targetStepIndex + 1);
      const after = oldSteps.slice(targetStepIndex + 1);
      subMod.steps = [...before, ...newSteps, ...after];
    } else {
      // ★ 单步替换（replace-single）：仅替换目标步骤，保留目标之后的步骤
      //    之前错误地与 replace 模式相同（删除目标后所有步骤），现已修正
      const before = oldSteps.slice(0, targetStepIndex);
      const after = oldSteps.slice(targetStepIndex + 1);
      subMod.steps = [...before, ...newSteps, ...after];
    }

    // 重新编号所有步骤（全局 step1, step2, ...）并修复 nextStepId
    this._renumberAllSteps();
    console.log(`[Recorder] 重录保存模式: ${mode} → 总步数 ${this.stepCount}`);
  }

  /**
   * ★ 全局重新编号所有步骤的 stepId 和文件引用（重录路径）
   * 现统一委托给 _sequentialRenumber，确保命名无缺口、导航链跨模块连续、且无陈旧脚本残留
   */
  _renumberAllSteps() {
    this._sequentialRenumber();
  }

  _clearRecording(msg) {
    this.phase = 'config';
    this.sceneConfig = { sceneTitle: '', sceneSubTitle: '', sceneName: '' };
    this.mainModules = [];
    this.currentMainModuleIndex = -1;
    this.currentSubModuleIndex = -1;
    this.stepCount = 0;
    this.elementIdCounter = 0;
    this.currentStepId = null;
    this.nextStepId = null;
    this.resourceBaseUrl = '';
    this.sceneCode = '';
    this.environment = 'local';
    this.envBaseUrl = '';
    this.pageMarks.clear();
    this._resetReRecord();

    console.log('[Recorder] 录制已清空');
    this._notifyStateChange();
    return { stateChanged: true };
  }

  /**
   * ★ 继续录制 — 从已保存的 recording_data.json 恢复录制状态
   */
  _continueRecording(msg) {
    const data = msg.data;
    if (!data || !data.mainModules) {
      return { stateChanged: false, response: { type: 'error', message: '录制数据无效' } };
    }
    this.sceneConfig = data.sceneConfig || { sceneTitle: '', sceneSubTitle: '', sceneName: '' };
    // ★ 关键修复：sceneCode 必须有兜底值，否则"结束并保存"对话框会卡死
    //   - 优先使用 data.sceneCode
    //   - 兜底使用 sceneConfig.sceneName（从目录名可推导）
    //   - 最后兜底使用时间戳生成 REC_xxxxxx
    this.sceneCode = data.sceneCode
      || (this.sceneConfig && this.sceneConfig.sceneName)
      || ('REC_' + Date.now().toString(36).toUpperCase().slice(-6));
    this.mainModules = data.mainModules;
    this.currentMainModuleIndex = data.currentMainModuleIndex ?? -1;
    this.currentSubModuleIndex = data.currentSubModuleIndex ?? -1;
    this.stepCount = data.stepCount || 0;
    this.elementIdCounter = 0;
    this.environment = data.environment || 'local';
    this.envBaseUrl = data.envBaseUrl || '';
    this.resourceBaseUrl = '';
    this.phase = 'recording';
    this.currentStepId = this._generateStepId();
    this.nextStepId = this._generateStepId();
    this.pageMarks.clear();

    console.log(`[Recorder] 继续录制: ${this.sceneConfig.sceneTitle} (${this.sceneCode}), 已有 ${this.stepCount} 步`);
    this._notifyStateChange();
    return { stateChanged: true };
  }

  /**
   * ★ 重录该步骤 — 加载已存在的场景并将光标定位到目标步骤
   * 后续用户录制的步骤会追加到目标步骤之后
   */
  _startReRecord(msg) {
    const { data, dirPath, mainModuleIndex, subModuleIndex, stepIndex } = msg;
    if (!data || !data.mainModules) {
      return { stateChanged: false, response: { type: 'error', message: '录制数据无效' } };
    }
    if (mainModuleIndex < 0 || mainModuleIndex >= data.mainModules.length) {
      return { stateChanged: false, response: { type: 'error', message: '主模块索引无效' } };
    }
    const mainMod = data.mainModules[mainModuleIndex];
    if (!mainMod) {
      return { stateChanged: false, response: { type: 'error', message: '主模块不存在' } };
    }
    if (subModuleIndex < 0 || subModuleIndex >= mainMod.subModules.length) {
      return { stateChanged: false, response: { type: 'error', message: '主步骤索引无效' } };
    }
    const subMod = mainMod.subModules[subModuleIndex];
    if (!subMod || !subMod.steps || stepIndex < 0 || stepIndex >= subMod.steps.length) {
      return { stateChanged: false, response: { type: 'error', message: '目标步骤不存在' } };
    }
    const targetSnapshot = subMod.steps[stepIndex];

    // 1. 恢复完整场景状态
    this.sceneConfig = data.sceneConfig || { sceneTitle: '', sceneSubTitle: '', sceneName: '' };
    // ★ 关键修复：sceneCode 必须有兜底值，否则"结束并保存"对话框会卡死
    this.sceneCode = data.sceneCode
      || (this.sceneConfig && this.sceneConfig.sceneName)
      || ('REC_' + Date.now().toString(36).toUpperCase().slice(-6));
    this.mainModules = JSON.parse(JSON.stringify(data.mainModules));
    this.environment = data.environment || 'local';
    this.envBaseUrl = data.envBaseUrl || '';
    this.resourceBaseUrl = '';
    this.stepCount = data.stepCount || 0;
    this.elementIdCounter = 0;

    // 2. 将光标定位到目标主步骤（用户可以继续在子步骤后追加）
    this.currentMainModuleIndex = mainModuleIndex;
    this.currentSubModuleIndex = subModuleIndex;
    this.pageMarks.clear();

    // 3. ★ 设置重录模式状态
    this.reRecord.active = true;
    this.reRecord.dirPath = dirPath || '';
    this.reRecord.mainModuleIndex = mainModuleIndex;
    this.reRecord.subModuleIndex = subModuleIndex;
    this.reRecord.targetStepIndex = stepIndex;
    this.reRecord.targetStepId = targetSnapshot.stepId;
    this.reRecord.targetStepUrl = this._extractStepUrl(targetSnapshot) || '';
    this.reRecord.targetModuleTitle = mainMod.mainModuleName || '';
    this.reRecord.targetSubStepTitle = subMod.mainStepTitle || '';
    this.reRecord.targetStepTitle = this._extractStepTitle(targetSnapshot) || '';
    this.reRecord.baselineStepCount = this._countTotalSteps();

    // 4. 准备下一步的 stepId
    this.phase = 'recording';
    this.currentStepId = this._generateStepId();
    this.nextStepId = this._generateStepId();

    console.log(
      `[Recorder] 重录模式: 场景="${this.sceneConfig.sceneTitle}", ` +
      `目标 [${mainModuleIndex}.${subModuleIndex}.${stepIndex}] (${targetSnapshot.stepId}), URL=${this.reRecord.targetStepUrl}`
    );
    this._notifyStateChange();
    return {
      stateChanged: true,
      response: {
        type: 'reRecordStarted',
        targetStepUrl: this.reRecord.targetStepUrl,
        targetStepId: this.reRecord.targetStepId,
        targetModuleTitle: this.reRecord.targetModuleTitle,
        targetSubStepTitle: this.reRecord.targetSubStepTitle,
        targetStepTitle: this.reRecord.targetStepTitle,
        newStepCount: 0,
      },
    };
  }

  /**
   * ★ 取消重录模式 — 重新加载原始数据并恢复配置阶段
   */
  _cancelReRecord(msg) {
    if (!this.reRecord.active) {
      return { stateChanged: false };
    }
    // 重置到 config 阶段
    this.phase = 'config';
    this.sceneConfig = { sceneTitle: '', sceneSubTitle: '', sceneName: '' };
    this.mainModules = [];
    this.currentMainModuleIndex = -1;
    this.currentSubModuleIndex = -1;
    this.stepCount = 0;
    this.elementIdCounter = 0;
    this.currentStepId = null;
    this.nextStepId = null;
    this.sceneCode = '';
    this.environment = 'local';
    this.envBaseUrl = '';
    this.pageMarks.clear();
    this._resetReRecord();
    this._notifyStateChange();
    return { stateChanged: true, response: { type: 'reRecordCancelled' } };
  }

  /** 重置重录模式状态 */
  _resetReRecord() {
    this.reRecord.active = false;
    this.reRecord.dirPath = '';
    this.reRecord.mainModuleIndex = -1;
    this.reRecord.subModuleIndex = -1;
    this.reRecord.targetStepIndex = -1;
    this.reRecord.targetStepId = '';
    this.reRecord.targetStepUrl = '';
    this.reRecord.targetModuleTitle = '';
    this.reRecord.targetSubStepTitle = '';
    this.reRecord.targetStepTitle = '';
    this.reRecord.baselineStepCount = 0;
  }

  /**
   * 从快照中提取 URL（优先使用 url 字段；webview 模式使用 htmlContent 顶部 URL）
   */
  _extractStepUrl(snapshot) {
    if (!snapshot) return '';
    if (snapshot.url) return snapshot.url;
    return '';
  }

  /**
   * 从快照中提取主标题
   */
  _extractStepTitle(snapshot) {
    if (!snapshot) return '';
    if (Array.isArray(snapshot.marks) && snapshot.marks.length > 0) {
      return snapshot.marks[0].mainTitle || snapshot.marks[0].subTitle || '';
    }
    return '';
  }

  /**
   * ★ 统计重录模式下新录制的步数
   */
  getNewStepCount() {
    if (!this.reRecord.active) return 0;
    return Math.max(0, this._countTotalSteps() - this.reRecord.baselineStepCount);
  }

  // ===== 辅助方法 =====

  _getActivePageId() {
    if (!this.browserManager) return 'unknown';
    const active = this.browserManager.getActivePage();
    return active ? active.pageId : 'unknown';
  }

  _getCurrentMainModule() {
    if (this.currentMainModuleIndex >= 0 && this.currentMainModuleIndex < this.mainModules.length) {
      return this.mainModules[this.currentMainModuleIndex];
    }
    return null;
  }

  _getCurrentSubModule() {
    const mainMod = this._getCurrentMainModule();
    if (mainMod && this.currentSubModuleIndex >= 0 && this.currentSubModuleIndex < mainMod.subModules.length) {
      return mainMod.subModules[this.currentSubModuleIndex];
    }
    return null;
  }

  /**
   * ★ 把当前模块名/描述、当前主步骤标题落库（避免「下一步/新增主步骤」等动作后表单被清空、重渲染时模块内容变空）。
   *   仅当传入非空字符串时才覆盖，避免把已保存的内容误清空。
   *   各动作（nextStep / nextStepWebview / addSubModule / addMainModule / endAndSave）调用前先执行一次。
   */
  _saveCurrentModuleMeta(msg) {
    if (!msg) return;
    const { mainModName, mainModDesc, modName } = msg;
    const mainMod = this._getCurrentMainModule();
    if (mainMod) {
      if (typeof mainModName === 'string' && mainModName) mainMod.mainModuleName = mainModName;
      if (typeof mainModDesc === 'string' && mainModDesc) mainMod.mainModuleDesc = mainModDesc;
    }
    const subMod = this._getCurrentSubModule();
    if (subMod && typeof modName === 'string' && modName) subMod.mainStepTitle = modName;
  }

  _generateStepId() {
    this.stepCount++;
    return 'step' + this.stepCount;
  }

  /**
   * ★ 生成 N 位随机后缀（仅数字 + 字母），用于拼接在场景码末尾
   *   字符集为 [a-zA-Z0-9]，避免与用户分隔符/特殊字符混淆
   */
  _genRandomSuffix(len) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let s = '';
    for (let i = 0; i < len; i++) {
      s += chars[Math.floor(Math.random() * chars.length)];
    }
    return s;
  }

  _getAllMarks() {
    const all = [];
    for (const [, marks] of this.pageMarks) {
      all.push(...marks);
    }
    return all;
  }

  /**
   * ★ 顺序重编号 + 修复导航脚本（统一入口）
   * 保存/导出前调用：按"扁平播放顺序"重新编号为无缺口的 step1..N，
   * 清空所有陈旧导航脚本，注入唯一一条 iframe 感知的正确跳转脚本。
   * 修复：
   *   ① 命名带缺口（step1/step2/step9/step12）—— 重录/新增主步骤模块导致 stepCount 不连续；
   *   ② 同页多条陈旧跳转指向不存在文件（step3/step10/step13）—— 旧逻辑只替换首条、且 nextStepId
   *      已正确时直接跳过整页，陈旧脚本永不清理；
   *   ③ 子模块边界断链 —— 旧逻辑在子模块末步置 nextStepId=null；
   *   ④ 点击元素在 iframe 内时挂不上 handler —— 旧注入版只用 document.getElementById。
   */
  _sequentialRenumber() {
    // 第一遍：扁平收集所有步骤（mainModules → subModules → steps 播放顺序）
    const allSteps = [];
    for (const mainMod of this.mainModules) {
      for (const subMod of (mainMod.subModules || [])) {
        if (subMod.steps) allSteps.push(...subMod.steps);
      }
    }
    if (allSteps.length === 0) return;

    // 第二遍：分配新 stepId，修复资源引用与 nextStepId
    for (let i = 0; i < allSteps.length; i++) {
      const snapshot = allSteps[i];
      const newId = 'step' + (i + 1);

      // 记录旧文件名（替换 htmlContent 内资源引用用）
      const oldCssFile = snapshot.cssFile;
      const oldIframeFilenames = Array.isArray(snapshot.iframeFiles)
        ? snapshot.iframeFiles.map((f) => f.filename)
        : [];

      // 更新字段
      snapshot.stepId = newId;
      snapshot.htmlFile = newId + '.html';
      snapshot.cssFile = newId + '.css';
      if (Array.isArray(snapshot.iframeFiles)) {
        let iframeIdx = 0;
        for (const iframe of snapshot.iframeFiles) {
          iframeIdx++;
          iframe.filename = newId + '_iframe_' + iframeIdx + '.html';
          if (iframe.cssFilename) iframe.cssFilename = newId + '_iframe_' + iframeIdx + '.css';
        }
      }

      // 修复 htmlContent 内的资源引用（仅替换本步骤自身引用的旧文件名）
      if (snapshot.htmlContent) {
        if (oldCssFile && oldCssFile !== snapshot.cssFile) {
          snapshot.htmlContent = snapshot.htmlContent.split('./' + oldCssFile).join('./' + snapshot.cssFile);
        }
        if (oldIframeFilenames.length > 0 && Array.isArray(snapshot.iframeFiles)) {
          for (let ii = 0; ii < oldIframeFilenames.length; ii++) {
            const oldFn = oldIframeFilenames[ii];
            const newFn = snapshot.iframeFiles[ii] ? snapshot.iframeFiles[ii].filename : null;
            if (oldFn && newFn && oldFn !== newFn) {
              snapshot.htmlContent = snapshot.htmlContent.split('./' + oldFn).join('./' + newFn);
            }
          }
        }
      }

      // nextStepId：按扁平序列的下一位置（跨子模块连续），末页为 null
      snapshot.nextStepId = (i < allSteps.length - 1) ? ('step' + (i + 2)) : null;
    }

    // 第三遍：清空所有陈旧导航脚本，并为非末页注入唯一一条 iframe 感知的正确脚本
    for (let i = 0; i < allSteps.length; i++) {
      const snapshot = allSteps[i];
      if (!snapshot.htmlContent) continue;
      // ★ 全局清除所有导航脚本（含陈旧的 step3/step10/step13 等重复脚本）
      const navScriptGlobalRegex = /<script>\s*\(function\(\)\s*\{[\s\S]*?var nextStep = "[^"]*";[\s\S]*?\}\)\(\);\s*<\/script>/g;
      snapshot.htmlContent = snapshot.htmlContent.replace(navScriptGlobalRegex, '');

      // 非末页且有录制元素 → 注入唯一一条规范导航脚本
      if (i < allSteps.length - 1 && Array.isArray(snapshot.elementIds) && snapshot.elementIds.length > 0) {
        const navScript = this._buildCanonicalNavScript(snapshot.elementIds, snapshot.nextStepId);
        if (snapshot.htmlContent.includes('</body>')) {
          snapshot.htmlContent = snapshot.htmlContent.replace('</body>', navScript + '\n</body>');
        } else {
          snapshot.htmlContent += navScript;
        }
      }
    }

    this.stepCount = allSteps.length;
    console.log(`[Recorder] 顺序重编号完成：共 ${allSteps.length} 步，命名 step1..step${allSteps.length}`);
  }

  /**
   * ★ 构建规范导航脚本（与 html-capture.js _buildNavScript 一致，含 iframe 感知查找）
   * 保留 var originName = null; 以便 _injectOriginName 在远端环境注入真实地址
   */
  _buildCanonicalNavScript(elementIds, nextStepId) {
    const elementIdsJson = JSON.stringify(elementIds || []);
    return `<script>(function() {
  var elementIds = ${elementIdsJson};
  var nextStep = "${nextStepId}";
  var originName = null;
  function handleClick() {
    var baseUrl = (window.location.protocol === 'file:' || !originName)
      ? './'
      : originName;
    window.location.href = baseUrl + nextStep + '.html';
  }
  // ★ 查找元素：先顶层 document，再遍历所有同域 iframe 的 document
  function findElementById(id) {
    var el = document.getElementById(id);
    if (el) return el;
    var iframes = document.querySelectorAll('iframe');
    for (var i = 0; i < iframes.length; i++) {
      try {
        var doc = iframes[i].contentDocument || (iframes[i].contentWindow && iframes[i].contentWindow.document);
        if (doc) {
          el = doc.getElementById(id);
          if (el) return el;
        }
      } catch(e) { /* 跨域 iframe 跳过 */ }
    }
    return null;
  }
  elementIds.forEach(function(id) {
    var el = findElementById(id);
    if (!el) return;
    el.addEventListener('click', handleClick);
    el.style.cursor = 'pointer';
  });
})();</script>`;
  }

  // ★ 兼容旧调用：统一走 _sequentialRenumber
  _fixStepNavigationLinks() {
    this._sequentialRenumber();
  }

  /**
   * ★ 注入 originName 到所有 HTML 步骤的导航脚本中
   * 将 var originName = null; 替换为 var originName = "远端地址";
   * 仅在远端环境（dev/prd）保存时调用
   */
  _injectOriginName(originName) {
    if (!originName) return;
    // 确保末尾有 /
    if (!originName.endsWith('/')) originName += '/';

    for (const mainMod of this.mainModules) {
      for (const subMod of mainMod.subModules) {
        if (!subMod.steps) continue;
        for (const snapshot of subMod.steps) {
          // 替换导航脚本中的 originName
          const oldVar = 'var originName = null;';
          const newVar = 'var originName = "' + originName + '";';
          if (snapshot.htmlContent.includes(oldVar)) {
            snapshot.htmlContent = snapshot.htmlContent.split(oldVar).join(newVar);
          }
        }
      }
    }
    console.log('[Recorder] originName 已注入:', originName);
  }

  /**
   * ★ 把 HTML 中「相对」的 CSS <link> 改为「运行时判定」加载（与 nextStep 导航脚本逻辑一致）：
   *    - file://（本地预览）→ 继续用相对 './stepX.css'
   *    - http/https（已部署）→ 改用 originName + stepX.css 的全域名地址
   * 因此同一个保存产物既能本地 file:// 预览，也能部署到远端正常使用，无需二次处理。
   * ★ 注意：iframe 的 src 保持相对（同目录，两种协议都解析正确），此处不改写，
   *   以免破坏 file:// 预览。仅处理主步骤的 CSS <link>。
   * 仅在远端环境（dev/prd）保存时、_fixStepNavigationLinks（重编号→cssFile 已定稿）之后调用。
   */
  _applyRuntimeResourceUrls(originName) {
    if (!originName) return; // 本地环境：保持相对 <link>，file:// 预览即用
    if (!originName.endsWith('/')) originName += '/';

    // 仅匹配由 html-capture 生成的相对 CSS 链接：<link rel="stylesheet" href="./stepX.css">
    const CSS_LINK_REGEX = /<link\s+rel="stylesheet"\s+href="\.\/([^"]+\.css)"\s*\/?>/gi;

    for (const mainMod of this.mainModules) {
      for (const subMod of mainMod.subModules) {
        if (!subMod.steps) continue;
        for (const snapshot of subMod.steps) {
          if (!snapshot.htmlContent) continue;
          const cssFile = snapshot.cssFile;
          if (!cssFile) continue;
          // 运行时判定脚本：解析结果用 document.write 同步注入 <link>，无样式闪烁
          const loaderScript =
            '<script>(function(){' +
            'var __R_ORIGIN__="' + originName + '";' +
            'var __R_CSS__="' + cssFile + '";' +
            'var __R_HREF__=(window.location.protocol===\'file:\'||!__R_ORIGIN__)?(\'./\'+__R_CSS__):(__R_ORIGIN__+__R_CSS__);' +
            'document.write(\'<link rel="stylesheet" href="\'+__R_HREF__+\'">\');' +
            '})();</' + 'script>';
          snapshot.htmlContent = snapshot.htmlContent.replace(CSS_LINK_REGEX, loaderScript);
        }
      }
    }
    console.log('[Recorder] CSS 链接已改为运行时判定（file:// 相对 / 否则全域名）:', originName);
  }
}

module.exports = { Recorder };
