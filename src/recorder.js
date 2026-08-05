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
    // ★ 场景码 + 环境配置
    this.sceneCode = '';        // 场景码（场景名称+随机码）
    this.environment = 'local'; // 环境选择: 'local' | 'dev' | 'prd'
    this.envBaseUrl = '';       // 环境对应的远端基地址
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
    };
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
      default: return null;
    }
  }

  _startRecording(msg) {
    const { sceneTitle, sceneSubTitle, sceneName, sceneCode } = msg;
    if (!sceneTitle || !sceneName) {
      return { stateChanged: false, response: { type: 'error', message: '场景主标题和名称为必填项' } };
    }
    this.sceneConfig = { sceneTitle, sceneSubTitle: sceneSubTitle || '', sceneName };
    this.sceneCode = sceneCode || sceneName; // ★ 场景码
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
    console.log(`[Recorder] 开始录制: ${sceneTitle} (${sceneName})`);
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
    const { url, html, cssContents, isEndRecording: forceEnd } = msg;
    const activePageId = 'webview';
    const marks = this.pageMarks.get(activePageId) || [];

    try {
      this._notifyCaptureProgress('正在捕获页面（应用内浏览器）...');

      const capture = new HtmlCapture(null); // 不需要 page 对象
      const snapshot = await capture.processFromCapturedData({
        url,
        html,
        cssContents,
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
            environment, sceneCode, envBaseUrl } = msg;
    const activePageId = pageId || this._getActivePageId();

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
    this.sceneCode = sceneCode || this.sceneCode;
    this.envBaseUrl = envBaseUrl || '';

    try {
      this._fixStepNavigationLinks();

      // ★ 注入 originName（仅远端环境）
      if (this.environment !== 'local' && this.envBaseUrl) {
        const originName = this.envBaseUrl + this.sceneCode + '/';
        this._injectOriginName(originName);
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
      this.pageMarks.clear();

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

    console.log('[Recorder] 录制已清空');
    this._notifyStateChange();
    return { stateChanged: true };
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

  _generateStepId() {
    this.stepCount++;
    const now = new Date();
    const timestamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '_',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
      '_',
      Math.random().toString(36).substring(2, 8),
    ].join('');
    return 'step' + this.stepCount + '_' + timestamp;
  }

  _getAllMarks() {
    const all = [];
    for (const [, marks] of this.pageMarks) {
      all.push(...marks);
    }
    return all;
  }

  _fixStepNavigationLinks() {
    const allStepsOrdered = [];
    for (const mainMod of this.mainModules) {
      for (const subMod of mainMod.subModules) {
        if (subMod.steps) allStepsOrdered.push(...subMod.steps);
      }
    }

    for (let i = 0; i < allStepsOrdered.length; i++) {
      const snapshot = allStepsOrdered[i];
      const correctNextStepId = i < allStepsOrdered.length - 1 ? allStepsOrdered[i + 1].stepId : null;
      if (snapshot.nextStepId === correctNextStepId) continue;

      const oldNextStepId = snapshot.nextStepId;
      snapshot.nextStepId = correctNextStepId;

      if (oldNextStepId) {
        const oldNavVar = 'var nextStep = "' + oldNextStepId + '";';
        if (correctNextStepId) {
          const newNavVar = 'var nextStep = "' + correctNextStepId + '";';
          snapshot.htmlContent = snapshot.htmlContent.split(oldNavVar).join(newNavVar);
        } else {
          snapshot.htmlContent = snapshot.htmlContent.replace(
            /<script>\s*\(function\(\)\s*\{[\s\S]*?var nextStep = "[^"]*";[\s\S]*?\}\)\(\);\s*<\/script>/,
            ''
          );
        }
      } else if (correctNextStepId && snapshot.elementIds && snapshot.elementIds.length > 0) {
        const elementIdsJson = JSON.stringify(snapshot.elementIds);
        // ★ 使用协议检测版本的导航脚本（与 html-capture.js _buildNavScript 一致）
        const navScript =
          '<script>(function() {\n' +
          '  var elementIds = ' + elementIdsJson + ';\n' +
          '  var nextStep = "' + correctNextStepId + '";\n' +
          '  var originName = null;\n' +
          '  function handleClick() {\n' +
          '    var baseUrl = (window.location.protocol === "file:" || !originName) ? "./" : originName;\n' +
          '    window.location.href = baseUrl + nextStep + ".html";\n' +
          '  }\n' +
          '  elementIds.forEach(function(id) {\n' +
          '    var el = document.getElementById(id);\n' +
          '    if (!el) return;\n' +
          '    el.addEventListener("click", handleClick);\n' +
          '    el.style.cursor = "pointer";\n' +
          '  });\n' +
          '})();</script>';
        if (snapshot.htmlContent.includes('</body>')) {
          snapshot.htmlContent = snapshot.htmlContent.replace('</body>', navScript + '\n</body>');
        } else {
          snapshot.htmlContent += navScript;
        }
      }
    }
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

  _applyResourceBaseUrl(baseUrl) {
    if (!baseUrl) return;
    for (const mainMod of this.mainModules) {
      for (const subMod of mainMod.subModules) {
        if (!subMod.steps) continue;
        for (const snapshot of subMod.steps) {
          const cssFilePattern = './' + snapshot.cssFile;
          if (snapshot.htmlContent.includes(cssFilePattern)) {
            snapshot.htmlContent = snapshot.htmlContent.split(cssFilePattern).join(baseUrl + '/' + snapshot.cssFile);
          }
          if (snapshot.nextStepId) {
            const navPattern = '"./" + nextStep + ".html"';
            const navReplacement = '"' + baseUrl + '/" + nextStep + ".html"';
            if (snapshot.htmlContent.includes(navPattern)) {
              snapshot.htmlContent = snapshot.htmlContent.split(navPattern).join(navReplacement);
            }
          }
          if (snapshot.iframeFiles) {
            for (const iframe of snapshot.iframeFiles) {
              const iframeSrcPattern = './' + iframe.filename;
              if (snapshot.htmlContent.includes(iframeSrcPattern)) {
                snapshot.htmlContent = snapshot.htmlContent.split(iframeSrcPattern).join(baseUrl + '/' + iframe.filename);
              }
            }
          }
        }
      }
    }
  }
}

module.exports = { Recorder };
