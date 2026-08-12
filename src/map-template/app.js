/**
 * DemoDetail 静态页面业务逻辑
 * 使用 ES5 语法实现
 */

(function (global) {
  'use strict';

  // ==================== 应用状态 ====================
  var AppState = {
    currentStep: [-1, -1, -1],
    stepState: '0', // 0=未开始, 1=进行中, 2=停止, 3=已完成
    mapClose: false,
    sceneStoryShow: false,
    isLoading: false,
    stepFinished: false,
  };

  var STORAGE_KEY = 'xft-autouse-plugin-demo-config';

  /**
   * 从 sessionStorage 恢复状态
   */
  function restoreFromStorage() {
    try {
      var saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        var parsed = JSON.parse(saved);
        // 只恢复非 null 的值
        if (parsed.currentStep) AppState.currentStep = parsed.currentStep;
        if (parsed.stepState) AppState.stepState = parsed.stepState;
        if (typeof parsed.mapClose === 'boolean') AppState.mapClose = parsed.mapClose;
        if (typeof parsed.sceneStoryShow === 'boolean') AppState.sceneStoryShow = parsed.sceneStoryShow;
        if (typeof parsed.isLoading === 'boolean') AppState.isLoading = parsed.isLoading;
        if (typeof parsed.stepFinished === 'boolean') AppState.stepFinished = parsed.stepFinished;
        // allConf 不从 sessionStorage 恢复，因为数据量大且需要从 MockData 获取
      }
    } catch (e) {
      console.error('从 sessionStorage 恢复状态失败:', e);
    }
  }

  /**
   * 保存状态到 sessionStorage
   */
  function saveToStorage() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(AppState));
    } catch (e) {
      console.error('保存状态到 sessionStorage 失败:', e);
    }
  }

  /**
   * 设置状态并自动保存到 sessionStorage
   * @param {Object} updates - 要更新的状态对象
   */
  function setState(updates) {
    for (var key in updates) {
      if (updates.hasOwnProperty(key)) {
        AppState[key] = updates[key];
      }
    }
    saveToStorage();
  }

  // ==================== 工具函数 ====================

  // 转换为应用所需格式
  function transformData(data) {
    var extraInfo = {
      title: data.demonstrationTitle || '',
      subTitle: data.demonstrationSubTitle || '',
      headerBlock: data.demonstrationHeaderNavTitle || '',
    };
    var coordinateInfo = {};
    let subStepIdx = 1;

    var modelList = [];
    for (var i = 0; i < data.moduleList.length; i++) {
      var module = data.moduleList[i];
      var moduleInfo = {
        desc: module.moduleDesc || '',
        module_type: module.moduleType || '',
      };

      var stepList = [];
      for (var j = 0; j < module.stepList.length; j++) {
        var step = module.stepList[j];
        var introduction = step.introduction || {};

        var subStepList = [];
        for (var k = 0; k < step.subStepList.length; k++) {
          var subStep = step.subStepList[k];
          var url = `../${data.demonstrationCode}/step${subStepIdx++}.html`;
          subStepList.push({
            ...subStep,
            url: [url.replace('../', '/')],
            linkUrl: url,
            mainTitle: subStep.title,
            title: subStep.content,
            selector: {
              placeSelector: '[data-marked]',
              clickSelector: '[data-marked]',
            },
            allowClick: true,
          });
        }

        stepList.push({
          ...step,
          stepName: step.stepTitle,
          stepDesc: introduction.answer || '',
          stepQsTitle: introduction.question || '',
          stepQsDesc: introduction.answer || '',
          isMobileGuide: introduction.isMobileGuide || false,
          subStepList: subStepList,
        });
      }

      modelList.push({
        ...module,
        moduleName: module.moduleTitle,
        modelDesc: moduleInfo.desc || '',
        isEnterprise: moduleInfo.module_type === 'enterprise',
        open: i === 0,
        stepList: stepList,
      });
    }

    return {
      type: '3',
      sceneCode: data.demonstrationCode,
      sceneName: extraInfo.title || data.demonstrationCode,
      subSceneName: extraInfo.subTitle || '',
      topic: extraInfo.headerBlock || '',
      aiMode: coordinateInfo.aiMode || 1,
      showNextStep: coordinateInfo.showNextStep || false,
      welcomeSpeech: coordinateInfo.welcomeSpeech || '',
      currentStep: [-1, -1, -1],
      stepState: '0',
      mapClose: false,
      modelList: modelList,
      finishDialogConfig: {
        finishDialogImg: '',
        finishConfigBtnText: '返回演示中心',
        finishConfigLink: '/demo-center',
        finishConfigBackText: '重新演示',
      },
    };
  }

  /**
   * 获取元素
   */
  function $(selector) {
    return document.querySelector(selector);
  }

  /**
   * 获取所有元素
   */
  function $$(selector) {
    return document.querySelectorAll(selector);
  }

  /**
   * 绑定事件
   */
  function on(element, event, handler) {
    if (element && element.addEventListener) {
      element.addEventListener(event, handler, false);
    }
  }

  /**
   * 添加类名
   */
  function addClass(element, className) {
    if (element && element.classList) {
      element.classList.add(className);
    }
  }

  /**
   * 移除类名
   */
  function removeClass(element, className) {
    if (element && element.classList) {
      element.classList.remove(className);
    }
  }

  /**
   * 切换类名
   */
  function toggleClass(element, className) {
    if (element && element.classList) {
      element.classList.toggle(className);
    }
  }

  /**
   * 检查是否有类名
   */
  function hasClass(element, className) {
    if (element && element.classList) {
      return element.classList.contains(className);
    }
    return false;
  }

  /**
   * 深拷贝对象
   */
  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  // ==================== 渲染函数 ====================

  /**
   * 渲染模块卡片
   */
  function renderModuleCards() {
    var container = $('#cardContainer');
    if (!container || !AppState) {
      return;
    }

    var modelList = AppState.modelList;
    console.log('渲染模块卡片, 模块数量:', modelList.length);
    var html = '';

    for (var i = 0; i < modelList.length; i++) {
      var model = modelList[i];
      var isOpen = model.open ? 'cardOpen' : '';
      console.log('模块' + i + ':', model.moduleName, 'open=', model.open, 'steps=', model.stepList.length);
      var isEnterprise = model.isEnterprise ? 'enIcon' : '';

      html += '<div class="card ' + isOpen + '" data-model-index="' + i + '">';
      html += '<div class="cardTitle" onclick="DemoApp.toggleModule(' + i + ')">';
      html += '<span class="cardLeftIcon ' + isEnterprise + '"></span>';
      html += '<span class="cardTitleText" title="' + model.moduleName + '">' + model.moduleName + '</span>';
      html += '<span class="cardRightIcon">' + (model.open ? '▲' : '▼') + '</span>';
      html += '</div>';
      html += '<div class="cardDesc" onclick="DemoApp.toggleModule(' + i + ')">' + model.modelDesc + '</div>';

      // 步骤列表
      html += '<ul class="cardUl">';
      for (var j = 0; j < model.stepList.length; j++) {
        var step = model.stepList[j];
        var isCurrent = AppState.currentStep[0] === i && AppState.currentStep[1] === j;
        var isDone = AppState.currentStep[0] * 1000 + AppState.currentStep[1] > i * 1000 + j;
        var isDemoScene = AppState.type === '3';
        var firstSubStep = step.subStepList && step.subStepList[0];
        var allowClick = isDone && (isDemoScene || (firstSubStep && firstSubStep.allowClick));

        var liClass = '';
        if (isCurrent) liClass += ' active';
        if (isDone) liClass += ' over';
        // 所有步骤都可以点击
        liClass += ' allowClick';

        html +=
          '<li class="' + liClass + '" data-step-index="' + j + '" onclick="DemoApp.clickStep(' + i + ', ' + j + ')">';
        html += '<div class="stepNameContainer">';
        html += '<div class="stepIcon">' + (j + 1) + '</div>';
        html += '<div class="stepName" title="' + step.stepName + '">' + step.stepName + '</div>';
        html += '<span class="currentTag">进行中</span>';
        html += '</div>';
        html += '<div class="stepDesc">' + (step.stepDesc || '') + '</div>';
        html += '</li>';
      }
      html += '</ul>';
      html += '</div>';
    }

    container.innerHTML = html;
  }

  /**
   * 更新页面状态样式
   */
  function updatePageState() {
    var pageBody = $('#pageBody');
    if (!pageBody) return;

    // 清除所有状态类
    removeClass(pageBody, 'showMask');
    removeClass(pageBody, 'mapClose');
    removeClass(pageBody, 'loaddingBody');

    // 添加对应状态类
    if (AppState.stepState === '0') {
      addClass(pageBody, 'showMask');
    }
    if (AppState.mapClose) {
      addClass(pageBody, 'mapClose');
    }
    if (AppState.isLoading) {
      addClass(pageBody, 'loaddingBody');
    }
  }

  /**
   * 更新步骤状态
   */
  function updateStepState() {
    var modelList = AppState.modelList;

    for (var i = 0; i < modelList.length; i++) {
      for (var j = 0; j < modelList[i].stepList.length; j++) {
        var li = document.querySelector('.card[data-model-index="' + i + '"] li[data-step-index="' + j + '"]');
        if (li) {
          var isCurrent = AppState.currentStep[0] === i && AppState.currentStep[1] === j;
          var isDone = AppState.currentStep[0] * 1000 + AppState.currentStep[1] > i * 1000 + j;

          removeClass(li, 'active');
          removeClass(li, 'over');

          if (isCurrent) addClass(li, 'active');
          if (isDone) addClass(li, 'over');
        }
      }
    }
  }

  /**
   * 更新场景故事提示框
   */
  function updateSceneStory() {
    var container = $('#stepTipContainer');
    if (!container) return;

    if (AppState.sceneStoryShow && AppState.currentStep[0] >= 0 && AppState.currentStep[1] >= 0) {
      var stepConf = AppState.modelList[AppState.currentStep[0]].stepList[AppState.currentStep[1]];
      $('#tipsTextQs').innerText = stepConf.stepQsTitle || '';
      $('#tipsTextAs').innerText = stepConf.stepQsDesc || '';
      removeClass(container, 'stepTipHide');
    } else {
      addClass(container, 'stepTipHide');
    }
  }

  /**
   * 更新按钮显示状态
   */
  function updateButtons() {
    var startBtn = $('#startBtn');
    var btnContainer = $('#btnContainer');
    var globalTool = $('#globalTool');
    var floatBtn = $('#floatBtn');
    var mapToggleBtn = $('#mapToggleBtn');

    if (AppState.stepState === '0') {
      // 未开始
      startBtn.style.display = 'block';
      btnContainer.style.display = 'none';
      globalTool.style.display = 'none';
      floatBtn.style.display = 'none';
    } else if (AppState.stepState === '3') {
      // 已完成
      startBtn.style.display = 'none';
      btnContainer.style.display = 'none';
      globalTool.style.display = 'none';
      showFinishDialog();
    } else {
      // 进行中
      startBtn.style.display = 'none';
      btnContainer.style.display = 'flex';
      globalTool.style.display = 'flex';
      floatBtn.style.display = AppState.mapClose ? 'block' : 'none';
    }

    // 地图按钮状态
    if (mapToggleBtn) {
      if (AppState.mapClose) {
        mapToggleBtn.style.display = 'flex';
      } else {
        mapToggleBtn.style.display = 'none';
      }
    }
  }

  /**
   * 更新 iframe 地址
   */
  function updateIframeUrl(url) {
    var iframe = $('#demoIframe');
    if (iframe && url) {
      iframe.src = url;
    }
  }

  /**
   * 显示完成弹窗
   */
  function showFinishDialog() {
    var dialog = $('#finishDialog');
    if (dialog) {
      dialog.style.display = 'flex';
    }
  }

  /**
   * 隐藏完成弹窗
   */
  function hideFinishDialog() {
    var dialog = $('#finishDialog');
    if (dialog) {
      dialog.style.display = 'none';
    }
  }

  // ==================== 业务逻辑 ====================

  /**
   * 初始化应用
   */
  function init() {
    var config = transformData(global.MockData);

    Object.assign(AppState, config);

    // 尝试从 sessionStorage 恢复状态
    restoreFromStorage();

    // 如果没有恢复的状态，使用默认值
    if (!AppState.currentStep || AppState.currentStep[0] === -1) {
      AppState.currentStep = config.currentStep || [-1, -1, -1];
    }
    if (!AppState.stepState) {
      AppState.stepState = config.stepState || '0';
    }

    // 保存初始状态
    saveToStorage();

    // 更新标题
    $('#mapTitle').innerText = config.sceneName || '';
    $('#mapSubTitle').innerText = config.subSceneName || '';

    // 渲染模块卡片
    renderModuleCards();

    // 更新页面状态
    updatePageState();
    updateButtons();

    // 如果从 sessionStorage 恢复了正在进行中的状态，需要更新 iframe 地址
    if (AppState.stepState === '1' && AppState.currentStep[0] >= 0 && AppState.currentStep[1] >= 0) {
      var modelIdx = AppState.currentStep[0];
      var stepIdx = AppState.currentStep[1];
      var subStepIdx = AppState.currentStep[2] >= 0 ? AppState.currentStep[2] : 0;
      var model = AppState.modelList[modelIdx];
      if (model && model.stepList[stepIdx] && model.stepList[stepIdx].subStepList[subStepIdx]) {
        var url = model.stepList[stepIdx].subStepList[subStepIdx].linkUrl;
        if (url) {
          updateIframeUrl(url);
        }
      }
      // 展开当前模块
      model.open = true;
      updateSceneStory();
    } else if (AppState.modelList[0] && AppState.modelList[0].stepList[0]) {
      // 即使未开始演示，也预加载第一个子步骤的页面
      var firstSubStep = AppState.modelList[0].stepList[0].subStepList[0];
      if (firstSubStep && firstSubStep.linkUrl) {
        updateIframeUrl(firstSubStep.linkUrl);
      }
    }

    // 显示加载动画
    showLoading();
    setTimeout(hideLoading, 1000);

    // 注册 iframe 消息监听
    registerIframeMessageListener();
  }

  /**
   * 显示加载动画
   */
  function showLoading() {
    setState({ isLoading: true });
    updatePageState();
  }

  /**
   * 隐藏加载动画
   */
  function hideLoading() {
    setState({ isLoading: false });
    updatePageState();
  }

  /**
   * 开始演示
   */
  function startDemo() {
    setState({
      currentStep: [0, 0, 0],
      stepState: '1',
    });
    AppState.modelList[0].open = true;

    // 获取第一个步骤的 URL
    var firstUrl = AppState.modelList[0].stepList[0].subStepList[0].linkUrl || 'about:blank';

    showLoading();
    updateIframeUrl(firstUrl);

    renderModuleCards();
    updatePageState();
    updateButtons();
    updateSceneStory();

    setTimeout(hideLoading, 500);
  }

  /**
   * 切换模块展开/收起
   */
  function toggleModule(modelIndex) {
    if (!AppState) return;

    var model = AppState.modelList[modelIndex];
    if (model) {
      model.open = !model.open;
      renderModuleCards();
    }
  }

  /**
   * 跳转到指定步骤
   */
  function jumpStep(stepArr, options) {
    options = options || {};

    if (!AppState) return;

    var modelIdx = stepArr[0];
    var stepIdx = stepArr[1];
    var subStepIdx = stepArr[2];

    // 边界检查
    if (modelIdx < 0 || modelIdx >= AppState.modelList.length) {
      showFinishDialog();
      return;
    }

    var model = AppState.modelList[modelIdx];
    if (stepIdx < 0 || stepIdx >= model.stepList.length) {
      jumpStep([modelIdx + 1, 0, 0], options);
      return;
    }

    var step = model.stepList[stepIdx];
    if (subStepIdx < 0 || subStepIdx >= step.subStepList.length) {
      jumpStep([modelIdx, stepIdx + 1, 0], options);
      return;
    }

    // 更新当前步骤
    setState({
      currentStep: stepArr,
      stepState: '1',
    });

    // 展开当前模块
    model.open = true;

    // 获取 URL 并更新 iframe
    var subStep = step.subStepList[subStepIdx];
    if (subStep.linkUrl && options.refreshUrl !== false) {
      showLoading();
      updateIframeUrl(subStep.linkUrl);
      setTimeout(hideLoading, 500);
    }

    // 更新 UI
    renderModuleCards();
    updatePageState();
    updateStepState();
    updateSceneStory();
    updateButtons();
  }

  /**
   * 跳转到下一步
   */
  function jumpNextStep() {
    var nextStep = [AppState.currentStep[0], AppState.currentStep[1], AppState.currentStep[2] + 1];

    if (!AppState) return;

    var model = AppState.modelList[nextStep[0]];
    if (!model) {
      // 所有模块完成
      finishDemo();
      return;
    }

    var step = model.stepList[nextStep[1]];
    if (!step) {
      // 当前模块完成，进入下一个模块
      jumpNextModule();
      return;
    }

    if (nextStep[2] >= step.subStepList.length) {
      // 当前步骤完成，进入下一个步骤
      nextStep[1]++;
      nextStep[2] = 0;

      if (nextStep[1] >= model.stepList.length) {
        nextStep[0]++;
        nextStep[1] = 0;
      }
    }

    jumpStep(nextStep, { refreshUrl: true });
  }

  /**
   * 跳转到下一个模块
   */
  function jumpNextModule() {
    var nextModule = AppState.currentStep[0] + 1;

    if (nextModule >= AppState.modelList.length) {
      finishDemo();
      return;
    }

    jumpStep([nextModule, 0, 0], { refreshUrl: true });
  }

  /**
   * 完成演示
   */
  function finishDemo() {
    setState({
      stepState: '3',
      stepFinished: true,
    });
    updatePageState();
    updateButtons();
    showFinishDialog();
  }

  /**
   * 收起地图
   */
  function closeMap() {
    setState({ mapClose: true });
    updatePageState();
    updateButtons();
  }

  /**
   * 打开地图
   */
  function openMap() {
    setState({ mapClose: false });
    updatePageState();
    updateButtons();
  }

  /**
   * 切换地图
   */
  function toggleMap() {
    setState({ mapClose: !AppState.mapClose });
    updatePageState();
    updateButtons();
  }

  /**
   * 显示场景故事
   */
  function showSceneStory() {
    if (AppState.stepState === '0') return;
    setState({ sceneStoryShow: true });
    updateSceneStory();
  }

  /**
   * 隐藏场景故事
   */
  function hideSceneStory() {
    setState({ sceneStoryShow: false });
    updateSceneStory();
  }

  /**
   * 显示指引
   */
  function showGuide() {
    if (AppState.stepState === '0') return;
    console.log('显示指引气泡');
  }

  /**
   * 点击下一步
   */
  function clickNextStep() {
    jumpNextStep();
  }

  /**
   * 退出演示
   */
  function exitDemoGuide() {
    if (confirm('确定要退出演示吗？')) {
      // 重置状态
      setState({
        stepState: '0',
        currentStep: [-1, -1, -1],
        stepFinished: false,
      });

      // 刷新页面或跳转
      window.location.reload();
    }
  }

  /**
   * 返回列表
   */
  function returnToList() {
    alert('返回演示中心首页');
    // 实际项目中应跳转到列表页
  }

  /**
   * 重新演示
   */
  function restartDemo() {
    hideFinishDialog();
    setState({
      stepState: '0',
      currentStep: [-1, -1, -1],
      stepFinished: false,
      sceneStoryShow: false,
    });

    // 重置所有模块
    for (var i = 0; i < AppState.modelList.length; i++) {
      AppState.modelList[i].open = i === 0;
    }

    updateIframeUrl('about:blank');
    renderModuleCards();
    updatePageState();
    updateButtons();
  }

  // ==================== iframe 消息监听 ====================

  /**
   * 验证消息来源是否可信
   * @param {string} origin - 消息来源域名
   * @returns {boolean}
   */
  function isTrustedOrigin(origin) {
    // if (!origin) return false;
    // // 允许来自招商银行相关域名的消息
    // var trustedDomains = ["cmbchina", "cmburl"];
    // return trustedDomains.some(function (domain) {
    //   return origin.indexOf(domain) >= 0;
    // });
    return true;
  }

  /**
   * 设置 loading 状态（带超时保护）
   */
  function setLoadingWithTimeout(isLoading) {
    setState({ isLoading: isLoading });
    if (isLoading) {
      // 超过 3s 自动关闭 loading
      setTimeout(function () {
        if (AppState.isLoading) {
          setState({ isLoading: false });
          updatePageState();
        }
      }, 3000);
    }
  }

  /**
   * 处理 iframe 消息
   * @param {MessageEvent} e
   */
  function handleIframeMessage(e) {
    // 验证消息来源是否可信
    if (!isTrustedOrigin(e.origin)) {
      return; // 忽略不可信来源的消息
    }

    var msgObj = null;
    var msgStr = e.data;

    // 解析消息 json 字符串
    if (msgStr && typeof msgStr === 'string') {
      try {
        msgObj = JSON.parse(msgStr);
      } catch (error) {
        console.log('解析 iframe 消息失败:', error);
      }
    }

    if (!msgObj || msgObj.type !== 'iframe-autouse-message') {
      return;
    }

    console.log('收到 iframe 消息:', msgObj.key, msgObj.value);

    switch (msgObj.key) {
      case 'close':
        // 关闭气泡（暂停演示）
        setState({ stepState: '2' });
        updatePageState();
        break;

      case 'next':
        // 进入下一个步骤
        jumpNextStep(false);
        break;

      case 'next-by-click':
        // 点击"下一步"按钮进入下一步（需要刷新 URL）
        jumpNextStep(true);
        break;

      case 'finish':
        // 完成演示
        finishDemo();
        break;

      case 'pop-display':
        // 气泡状态更新
        // 静态版本暂不处理气泡显示状态
        break;

      case 'place-dom-show':
        // 步骤节点状态更新
        // 静态版本暂不处理
        break;

      case 'steptrigger-close':
        // 关闭步骤触发
        // 静态版本暂不处理
        break;

      case 'xft-autouseplugin-loaded':
        // 插件加载完成，关闭 loading
        setLoadingWithTimeout(false);
        updatePageState();
        break;

      case 'start-out-dom':
        // 外部触发开始地址指引
        startDemo();
        break;

      default:
        console.log('未知的 iframe 消息类型:', msgObj.key);
        break;
    }
  }

  /**
   * 注册 iframe 消息监听
   */
  function registerIframeMessageListener() {
    window.addEventListener('message', handleIframeMessage);
  }

  /**
   * 注销 iframe 消息监听
   */
  function unregisterIframeMessageListener() {
    window.removeEventListener('message', handleIframeMessage);
  }

  /**
   * 切换工具栏显示
   */
  function toggleToolDisplay() {
    var tool = $('#globalTool');
    if (tool) {
      if (tool.style.display === 'none') {
        tool.style.display = 'flex';
      } else {
        tool.style.display = 'none';
      }
    }
  }

  /**
   * 点击步骤跳转
   * @param {number} modelIndex - 模块索引
   * @param {number} stepIndex - 步骤索引
   */
  function clickStep(modelIndex, stepIndex) {
    if (!AppState || AppState.stepState === '0') {
      return; // 未开始演示时不允许点击
    }

    // 跳转到指定步骤的第一个子步骤
    jumpStep([modelIndex, stepIndex, 0], { refreshUrl: true });
  }

  // ==================== 暴露 API ====================
  var DemoApp = {
    init: init,
    startDemo: startDemo,
    toggleModule: toggleModule,
    jumpStep: jumpStep,
    jumpNextStep: jumpNextStep,
    closeMap: closeMap,
    openMap: openMap,
    toggleMap: toggleMap,
    showSceneStory: showSceneStory,
    hideSceneStory: hideSceneStory,
    showGuide: showGuide,
    clickNextStep: clickNextStep,
    exitDemoGuide: exitDemoGuide,
    returnToList: returnToList,
    restartDemo: restartDemo,
    toggleToolDisplay: toggleToolDisplay,
    clickStep: clickStep,
  };

  // 暴露到全局
  global.DemoApp = DemoApp;

  // DOM 加载完成后初始化
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 1);
  } else {
    document.addEventListener('DOMContentLoaded', init, false);
  }
})(typeof window !== 'undefined' ? window : this);
