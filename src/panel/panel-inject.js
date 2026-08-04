/**
 * 面板注入脚本 - 运行在浏览器上下文中
 * 移植自 google-single-page content.js，改造为 WebSocket 通信
 *
 * 此文件会被 BrowserManager 读取并注入到页面中，
 * __WS_URL__ 和 __PAGE_ID__ 占位符会在注入时被替换
 */
(function injectPanel() {
  // 防止重复注入
  if (document.getElementById('__rec_panel')) return;

  const WS_URL = '__WS_URL__';
  const PAGE_ID = '__PAGE_ID__';

  // ===== WebSocket 连接 =====
  let ws = null;
  let reconnectTimer = null;

  function connectWs() {
    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      console.warn('[Panel] WebSocket 连接失败:', e);
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectWs, 2000);
      return;
    }

    ws.onopen = () => {
      console.log('[Panel] WebSocket 已连接');
      sendMsg('register', { pageId: PAGE_ID });
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch (e) {
        console.warn('[Panel] 消息解析失败:', e);
      }
    };

    ws.onclose = () => {
      console.log('[Panel] WebSocket 已断开，2秒后重连');
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connectWs, 2000);
    };

    ws.onerror = (err) => {
      console.warn('[Panel] WebSocket 错误');
    };
  }

  // ===== 发送消息到后端 =====
  function sendMsg(type, data) {
    data = data || {};
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: type, pageId: PAGE_ID, ...data }));
    }
  }

  // ===== 本地状态 (从服务端同步) =====
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
  };

  // ===== 本地 UI 状态 =====
  let isExpanded = false;
  let isSelecting = false;
  let hasSelectedElement = false;
  let selectedElement = null;
  let selectedElementId = null;
  let escKeyHandler = null;

  // UI 引用
  let uiRefs = {
    markBtn: null,
    mainTitleInput: null,
    subTitleInput: null,
    completeMarkBtn: null,
    markListContainer: null,
    stepInfo: null,
    nextStepBtn: null,
    addSubModuleBtn: null,
    addMainModuleBtn: null,
    endSaveBtn: null,
    clearBtn: null,
    moduleListContainer: null,
    modNameInput: null,
    mainModNameInput: null,
    mainModSubtitleInput: null,
    shortcutHint: null,
    stepShortcutHint: null,
  };
  let statusEl = null;

  // ===== 服务端消息处理 =====
  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'stateSync':
        state = msg.state;
        rerenderPanel();
        break;
      case 'captureProgress':
        if (statusEl) {
          statusEl.textContent = msg.message || '处理中...';
          statusEl.style.color = '#165dff';
        }
        break;
      case 'saveComplete':
        if (statusEl) {
          statusEl.textContent = '录制已结束！所有文件已保存到 ' + (msg.outputDir || '');
          statusEl.style.color = '#00b42b';
        }
        setTimeout(() => {
          const panel = document.getElementById('__rec_panel');
          if (panel) panel.remove();
        }, 2000);
        break;
      case 'error':
        if (statusEl) {
          statusEl.textContent = '错误: ' + (msg.message || '未知错误');
          statusEl.style.color = '#f53f3f';
        }
        break;
    }
  }

  function rerenderPanel() {
    if (state.phase === 'config') {
      renderConfigPhase();
    } else if (state.phase === 'recording') {
      renderRecordingPhase();
    }
  }

  // ===== 样式定义 =====
  const styles = {
    sectionTitle:
      'font-size:11px;font-weight:600;color:rgba(255,255,255,0.95);text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px;',
    sectionBg:
      'background:rgba(0,0,0,0.35);border-radius:12px;padding:12px;margin-bottom:12px;border:1px solid rgba(255,255,255,0.08);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);',
    label: 'font-size:12px;color:rgba(255,255,255,0.95);margin-bottom:4px;display:block;',
    requiredStar: 'color:#f53f3f;margin-left:2px;',
    input: [
      'width:100%', 'padding:9px 12px', 'margin-bottom:10px',
      'border:1px solid rgba(255,255,255,0.15)', 'border-radius:8px', 'font-size:13px',
      'box-sizing:border-box', 'outline:none', 'transition:all 0.15s',
      'background:rgba(0,0,0,0.3)', 'color:#ffffff',
    ].join(';'),
    primaryBtn: [
      'width:100%', 'padding:10px 16px', 'border:none', 'border-radius:8px',
      'background:#165dff', 'color:#ffffff', 'font-size:13px', 'font-weight:600',
      'cursor:pointer', 'transition:all 0.15s',
    ].join(';'),
    primaryBtnDisabled: [
      'width:100%', 'padding:10px 16px', 'border:none', 'border-radius:8px',
      'background:rgba(255,255,255,0.15)', 'color:rgba(255,255,255,0.72)', 'font-size:13px', 'font-weight:500',
      'cursor:not-allowed',
    ].join(';'),
    secondaryBtn: [
      'width:100%', 'padding:8px 16px', 'border:1px solid rgba(22,93,255,0.6)',
      'border-radius:8px', 'background:rgba(22,93,255,0.15)', 'color:#7db0ff', 'font-size:13px',
      'cursor:pointer', 'transition:all 0.15s',
    ].join(';'),
    dangerBtn: [
      'width:100%', 'padding:8px 16px', 'border:1px solid rgba(245,63,63,0.6)',
      'border-radius:8px', 'background:rgba(245,63,63,0.15)', 'color:#ff7e7e', 'font-size:13px',
      'cursor:pointer', 'transition:all 0.15s',
    ].join(';'),
    warningBtn: [
      'width:100%', 'padding:8px 16px', 'border:1px solid rgba(255,125,0,0.6)',
      'border-radius:8px', 'background:rgba(255,125,0,0.15)', 'color:#ffbb6e', 'font-size:13px',
      'cursor:pointer', 'transition:all 0.15s',
    ].join(';'),
    moduleListBg:
      'background:rgba(0,0,0,0.35);border-radius:12px;padding:10px;margin-bottom:10px;border:1px solid rgba(255,255,255,0.08);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);',
    statusText: 'font-size:11px;color:rgba(255,255,255,0.88);margin-top:10px;min-height:16px;line-height:1.5;',
  };

  const compactStyles = {
    secondaryBtn: [
      'width:100%', 'box-sizing:border-box', 'padding:8px 12px', 'border:1px solid rgba(22,93,255,0.6)',
      'border-radius:8px', 'background:rgba(22,93,255,0.15)', 'color:#7db0ff', 'font-size:12px',
      'cursor:pointer', 'white-space:nowrap', 'transition:all 0.15s',
    ].join(';'),
    dangerBtn: [
      'width:100%', 'box-sizing:border-box', 'padding:8px 12px', 'border:1px solid rgba(245,63,63,0.6)',
      'border-radius:8px', 'background:rgba(245,63,63,0.15)', 'color:#ff7e7e', 'font-size:12px',
      'cursor:pointer', 'white-space:nowrap', 'transition:all 0.15s',
    ].join(';'),
    warningBtn: [
      'width:100%', 'box-sizing:border-box', 'padding:8px 12px', 'border:1px solid rgba(255,125,0,0.6)',
      'border-radius:8px', 'background:rgba(255,125,0,0.15)', 'color:#ffbb6e', 'font-size:12px',
      'cursor:pointer', 'white-space:nowrap', 'transition:all 0.15s',
    ].join(';'),
    primaryBtn: [
      'width:100%', 'box-sizing:border-box', 'padding:8px 12px', 'border:none', 'border-radius:8px',
      'background:#165dff', 'color:#ffffff', 'font-size:12px', 'font-weight:600',
      'cursor:pointer', 'white-space:nowrap', 'transition:all 0.15s',
    ].join(';'),
    primaryBtnDisabled: [
      'width:100%', 'box-sizing:border-box', 'padding:8px 12px', 'border:none', 'border-radius:8px',
      'background:rgba(255,255,255,0.15)', 'color:rgba(255,255,255,0.72)', 'font-size:12px', 'font-weight:500',
      'cursor:not-allowed', 'white-space:nowrap',
    ].join(';'),
    input: [
      'flex:1', 'padding:8px 10px',
      'border:1px solid rgba(255,255,255,0.15)', 'border-radius:8px', 'font-size:12px',
      'box-sizing:border-box', 'outline:none', 'transition:all 0.15s',
      'background:rgba(0,0,0,0.3)', 'color:#ffffff', 'margin-bottom:0',
    ].join(';'),
  };

  function markBtnStyle(styleName) {
    if (isExpanded) return styles[styleName];
    return compactStyles[styleName] || styles[styleName];
  }

  function addInputFocusEffect(input) {
    input.addEventListener('focus', () => {
      input.style.borderColor = '#165dff';
      input.style.boxShadow = '0 0 0 3px rgba(22,93,255,0.3)';
    });
    input.addEventListener('blur', () => {
      input.style.borderColor = 'rgba(255,255,255,0.15)';
      input.style.boxShadow = 'none';
    });
  }

  // ===== 创建面板 =====
  const panel = document.createElement('div');
  panel.id = '__rec_panel';
  panel.style.cssText = [
    'position:fixed', 'top:80px', 'right:24px', 'z-index:2147483647',
    'width:340px', 'border-radius:16px',
    'border:1px solid rgba(255,255,255,0.1)',
    'box-shadow:0 8px 32px rgba(0,0,0,0.4),0 0 1px rgba(0,0,0,0.1)',
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif",
    'padding:0', 'color:#ffffff', 'pointer-events:auto',
    'overflow:hidden',
    'background:rgba(10,15,30,0.88)',
  ].join(';');

  panel.addEventListener('click', (e) => e.stopPropagation());
  panel.addEventListener('mousedown', (e) => e.stopPropagation());

  document.body.appendChild(panel);

  // 选择模式高亮遮罩层
  const highlightOverlay = document.createElement('div');
  highlightOverlay.id = '__rec_highlight_overlay';
  highlightOverlay.style.cssText = [
    'position:fixed', 'pointer-events:none', 'z-index:2147483646',
    'border:2px solid #165dff', 'background:rgba(22,93,255,0.08)',
    'border-radius:2px', 'display:none', 'box-sizing:border-box',
  ].join(';');
  document.body.appendChild(highlightOverlay);

  // ===== 面板标题栏 =====
  const titleBar = document.createElement('div');
  titleBar.style.cssText = [
    'display:flex', 'justify-content:space-between', 'align-items:center',
    'padding:14px 20px', 'cursor:move', 'user-select:none',
    'border-bottom:1px solid rgba(255,255,255,0.08)',
    'position:relative', 'z-index:1',
  ].join(';');

  const panelTitle = document.createElement('span');
  panelTitle.textContent = '场景录制助手';
  panelTitle.style.cssText = 'font-size:14px;font-weight:600;color:#7db0ff;text-shadow:0 1px 4px rgba(0,0,0,0.3);';

  const expandBtn = document.createElement('button');
  expandBtn.textContent = '⤢';
  expandBtn.style.cssText = [
    'background:rgba(255,255,255,0.08)', 'border:1px solid rgba(255,255,255,0.15)', 'color:rgba(255,255,255,0.95)',
    'padding:4px 10px', 'border-radius:8px', 'cursor:pointer', 'font-size:12px',
    'transition:all 0.15s',
  ].join(';');
  expandBtn.onmouseenter = () => {
    expandBtn.style.borderColor = '#165dff';
    expandBtn.style.color = '#6aa1ff';
  };
  expandBtn.onmouseleave = () => {
    expandBtn.style.borderColor = 'rgba(255,255,255,0.15)';
    expandBtn.style.color = 'rgba(255,255,255,0.7)';
  };
  expandBtn.onclick = (e) => {
    e.stopPropagation();
    toggleExpand();
  };
  expandBtn.onmousedown = (e) => e.stopPropagation();

  titleBar.appendChild(panelTitle);
  titleBar.appendChild(expandBtn);
  panel.appendChild(titleBar);

  // 内容包裹器
  const contentWrapper = document.createElement('div');
  contentWrapper.style.cssText = 'display:flex;max-height:calc(90vh - 48px);overflow:hidden;position:relative;z-index:1;';
  panel.appendChild(contentWrapper);

  // ===== 展开/收起逻辑 =====
  function toggleExpand() {
    isExpanded = !isExpanded;
    expandBtn.textContent = isExpanded ? '⤡' : '⤢';
    panel.style.width = isExpanded ? '720px' : '340px';
    applyExpandState();
  }

  function applyExpandState() {
    const expandElements = panel.querySelectorAll('[data-expand-only]');
    expandElements.forEach((el) => {
      el.style.display = isExpanded ? '' : 'none';
    });

    if (state.phase === 'recording') {
      updateNextStepBtn();
      if (uiRefs.addSubModuleBtn) {
        uiRefs.addSubModuleBtn.style.cssText = (isExpanded ? styles.secondaryBtn : compactStyles.secondaryBtn) + ';width:auto;padding:8px 14px;';
      }
      if (uiRefs.addMainModuleBtn) {
        uiRefs.addMainModuleBtn.style.cssText = (isExpanded ? styles.secondaryBtn : compactStyles.secondaryBtn) + ';width:auto;padding:8px 14px;';
      }
      if (uiRefs.endSaveBtn) {
        uiRefs.endSaveBtn.style.cssText = (isExpanded ? styles.dangerBtn : compactStyles.dangerBtn) + ';width:auto;padding:8px 14px;white-space:nowrap;';
      }
      if (uiRefs.clearBtn) {
        uiRefs.clearBtn.style.cssText = (isExpanded ? styles.warningBtn : compactStyles.warningBtn) + ';width:auto;padding:8px 14px;white-space:nowrap;';
      }
    }
  }

  // ===== 拖拽 =====
  function makeDraggable(panelEl, handle) {
    let isDown = false;
    let offsetX = 0;
    let offsetY = 0;
    handle.style.cursor = 'move';
    handle.style.userSelect = 'none';
    handle.onmousedown = (e) => {
      isDown = true;
      offsetX = e.clientX - panelEl.offsetLeft;
      offsetY = e.clientY - panelEl.offsetTop;
    };
    document.onmousemove = (e) => {
      if (!isDown) return;
      panelEl.style.left = e.clientX - offsetX + 'px';
      panelEl.style.top = e.clientY - offsetY + 'px';
      panelEl.style.right = 'auto';
    };
    document.onmouseup = () => {
      isDown = false;
    };
  }
  makeDraggable(panel, titleBar);

  // ===== 选择模式 =====
  function enableSelectionMode() {
    isSelecting = true;
    if (uiRefs.markBtn) {
      uiRefs.markBtn.textContent = '取消选择';
      uiRefs.markBtn.style.cssText = markBtnStyle('dangerBtn') + ';width:auto;';
    }
    if (uiRefs.shortcutHint) {
      uiRefs.shortcutHint.textContent = 'Esc';
    }
    if (statusEl) {
      statusEl.textContent = '请在页面上点击选择要标记的元素，按 Esc 退出';
      statusEl.style.color = '#f53f3f';
    }
    document.body.style.cursor = 'crosshair';

    escKeyHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        resetSelectionState();
        if (statusEl) statusEl.textContent = '';
      }
    };
    document.addEventListener('keydown', escKeyHandler, true);
  }

  function disableSelectionMode() {
    isSelecting = false;
    highlightOverlay.style.display = 'none';

    if (uiRefs.markBtn) {
      uiRefs.markBtn.textContent = '选择元素';
      uiRefs.markBtn.style.cssText = markBtnStyle('secondaryBtn') + ';width:auto;';
    }
    if (uiRefs.shortcutHint) {
      uiRefs.shortcutHint.textContent = 'Alt+A';
    }
    document.body.style.cursor = '';

    if (escKeyHandler) {
      document.removeEventListener('keydown', escKeyHandler, true);
      escKeyHandler = null;
    }
  }

  function resetSelectionState() {
    isSelecting = false;
    highlightOverlay.style.display = 'none';
    hasSelectedElement = false;
    selectedElement = null;
    selectedElementId = null;

    if (uiRefs.markBtn) {
      uiRefs.markBtn.textContent = '选择元素';
      uiRefs.markBtn.style.cssText = markBtnStyle('secondaryBtn') + ';width:auto;';
    }
    if (uiRefs.shortcutHint) {
      uiRefs.shortcutHint.textContent = 'Alt+A';
    }
    document.body.style.cursor = '';

    if (escKeyHandler) {
      document.removeEventListener('keydown', escKeyHandler, true);
      escKeyHandler = null;
    }
  }

  function onElementSelected() {
    if (statusEl) {
      statusEl.textContent = '已选择元素，请输入主标题后完成标记';
      statusEl.style.color = '#00b42b';
    }
    if (uiRefs.completeMarkBtn) {
      uiRefs.completeMarkBtn.style.cssText = markBtnStyle('primaryBtn') + ';width:auto;';
      uiRefs.completeMarkBtn.disabled = false;
    }
    if (uiRefs.mainTitleInput) {
      uiRefs.mainTitleInput.focus();
    }
    updateNextStepBtn();
  }

  function completeMark() {
    if (!uiRefs.mainTitleInput) return;
    const mainTitle = uiRefs.mainTitleInput.value.trim();
    if (!mainTitle) {
      if (statusEl) {
        statusEl.textContent = '请输入主标题';
        statusEl.style.color = '#f53f3f';
      }
      return;
    }
    const subTitle = uiRefs.subTitleInput ? uiRefs.subTitleInput.value.trim() : '';

    if (selectedElement && selectedElementId) {
      sendMsg('completeMark', {
        mainTitle: mainTitle,
        subTitle: subTitle,
        elementId: selectedElementId,
        isInIframe: false,
      });
    }

    selectedElement = null;
    selectedElementId = null;
    if (uiRefs.mainTitleInput) uiRefs.mainTitleInput.value = '';
    if (uiRefs.subTitleInput) uiRefs.subTitleInput.value = '';
    if (uiRefs.completeMarkBtn) {
      uiRefs.completeMarkBtn.style.cssText = markBtnStyle('primaryBtnDisabled') + ';width:auto;';
      uiRefs.completeMarkBtn.disabled = true;
    }
    hasSelectedElement = false;

    if (statusEl) {
      statusEl.textContent = '标记成功！';
      statusEl.style.color = '#00b42b';
    }
  }

  function updateNextStepBtn() {
    const btn = uiRefs.nextStepBtn;
    if (!btn) return;
    if ((state.markedElements.length > 0 || hasSelectedElement) && state.isRecording) {
      btn.style.cssText = (isExpanded ? styles.primaryBtn : compactStyles.primaryBtn) + ';width:auto;padding:8px 14px;';
      btn.disabled = false;
    } else {
      btn.style.cssText = (isExpanded ? styles.primaryBtnDisabled : compactStyles.primaryBtnDisabled) + ';width:auto;padding:8px 14px;';
      btn.disabled = true;
    }
  }

  // ===== 事件拦截 (选择模式) =====
  const eventsToBlock = [
    'click', 'mousedown', 'mouseup',
    'mouseover', 'mouseout', 'mouseleave',
    'pointerdown', 'pointerup', 'pointermove',
  ];

  eventsToBlock.forEach((eventType) => {
    document.addEventListener(eventType, function (e) {
      if (!isSelecting) return;
      if (e.target === panel || panel.contains(e.target)) {
        if (eventType === 'mouseover' || eventType === 'mousemove' || eventType === 'pointermove') {
          highlightOverlay.style.display = 'none';
        }
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      if (eventType === 'mouseover' || eventType === 'mousemove' || eventType === 'pointermove') {
        const rect = e.target.getBoundingClientRect();
        highlightOverlay.style.display = 'block';
        highlightOverlay.style.top = rect.top + 'px';
        highlightOverlay.style.left = rect.left + 'px';
        highlightOverlay.style.width = rect.width + 'px';
        highlightOverlay.style.height = rect.height + 'px';
      }

      if (eventType === 'mouseout' || eventType === 'mouseleave') {
        highlightOverlay.style.display = 'none';
      }

      if (eventType === 'click') {
        if (hasSelectedElement) return;
        highlightOverlay.style.display = 'none';

        // 生成元素 ID 并设置到 DOM 上
        const elementId = '__rec_el_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
        e.target.id = elementId;
        selectedElement = e.target;
        selectedElementId = elementId;
        hasSelectedElement = true;

        disableSelectionMode();
        onElementSelected();
      }
    }, true);
  });

  // ===== 键盘快捷键 =====
  document.addEventListener('keydown', function (e) {
    if (!e.altKey) return;

    if (e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      e.stopPropagation();
      if (!isSelecting && state.phase === 'recording' && state.isRecording) {
        hasSelectedElement = false;
        selectedElement = null;
        selectedElementId = null;
        enableSelectionMode();
      }
    } else if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      e.stopPropagation();
      if (state.phase === 'recording' && state.isRecording && uiRefs.nextStepBtn && !uiRefs.nextStepBtn.disabled) {
        uiRefs.nextStepBtn.click();
      }
    } else if (e.key === 'q' || e.key === 'Q') {
      e.preventDefault();
      e.stopPropagation();
      if (state.phase === 'recording' && state.isRecording && uiRefs.endSaveBtn) {
        uiRefs.endSaveBtn.click();
      }
    }
  }, true);

  // ===== 确认对话框 =====
  function showConfirmDialog(title, desc, onConfirm) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:999999;display:flex;align-items:center;justify-content:center;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:rgba(20,25,40,0.95);border-radius:12px;padding:24px;width:340px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,0.4);font-family:system-ui,sans-serif;border:1px solid rgba(255,255,255,0.1);backdrop-filter:blur(12px);';

    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:15px;font-weight:600;color:#ffffff;margin-bottom:12px;';
    titleEl.textContent = title;
    dialog.appendChild(titleEl);

    const descEl = document.createElement('div');
    descEl.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.88);margin-bottom:16px;line-height:1.6;';
    descEl.textContent = desc;
    dialog.appendChild(descEl);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '取消';
    cancelBtn.style.cssText = 'padding:8px 16px;border:1px solid rgba(255,255,255,0.15);border-radius:8px;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.95);font-size:13px;cursor:pointer;';
    cancelBtn.onclick = () => overlay.remove();

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = '确认';
    confirmBtn.style.cssText = 'padding:8px 16px;border:none;border-radius:8px;background:#f53f3f;color:#ffffff;font-size:13px;font-weight:600;cursor:pointer;';
    confirmBtn.onclick = () => {
      overlay.remove();
      onConfirm();
    };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(confirmBtn);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  // ===== 资源地址配置对话框 =====
  function showBaseUrlDialog() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:999999;display:flex;align-items:center;justify-content:center;';

      const dialog = document.createElement('div');
      dialog.style.cssText = 'background:rgba(20,25,40,0.95);border-radius:12px;padding:24px;width:400px;max-width:90vw;box-shadow:0 8px 32px rgba(0,0,0,0.4);font-family:system-ui,sans-serif;border:1px solid rgba(255,255,255,0.1);backdrop-filter:blur(12px);';

      const title = document.createElement('div');
      title.style.cssText = 'font-size:15px;font-weight:600;color:#ffffff;margin-bottom:12px;';
      title.textContent = '资源配置（选填）';
      dialog.appendChild(title);

      const desc = document.createElement('div');
      desc.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.88);margin-bottom:16px;line-height:1.6;';
      desc.textContent = '输入基础地址后，导出 HTML 中的 CSS 引用、点击跳转链接、iframe 地址将拼接为完整路径。留空则使用相对路径。';
      dialog.appendChild(desc);

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = '例如：https://example.com/path';
      input.style.cssText = 'width:100%;padding:10px 12px;border:1px solid rgba(255,255,255,0.15);border-radius:8px;font-size:13px;box-sizing:border-box;outline:none;margin-bottom:8px;color:#ffffff;background:rgba(0,0,0,0.3);';
      dialog.appendChild(input);

      const example = document.createElement('div');
      example.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.72);margin-bottom:16px;line-height:1.5;';
      example.innerHTML = "示例：输入 <span style='color:#7db0ff'>https://xxx.com/a/b</span><br>CSS → https://xxx.com/a/b/step1.css<br>跳转 → https://xxx.com/a/b/step2.html";
      dialog.appendChild(example);

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;';

      const skipBtn = document.createElement('button');
      skipBtn.textContent = '跳过（使用相对路径）';
      skipBtn.style.cssText = 'padding:8px 16px;border:1px solid rgba(255,255,255,0.15);border-radius:8px;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.95);font-size:13px;cursor:pointer;';
      skipBtn.onclick = () => { overlay.remove(); resolve(''); };

      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = '确认';
      confirmBtn.style.cssText = 'padding:8px 16px;border:none;border-radius:8px;background:#165dff;color:#ffffff;font-size:13px;font-weight:600;cursor:pointer;';
      confirmBtn.onclick = () => {
        let val = input.value.trim();
        if (val.endsWith('/')) val = val.slice(0, -1);
        overlay.remove();
        resolve(val);
      };

      btnRow.appendChild(skipBtn);
      btnRow.appendChild(confirmBtn);
      dialog.appendChild(btnRow);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      setTimeout(() => input.focus(), 50);
    });
  }

  // ===== 渲染：配置阶段 =====
  function renderConfigPhase() {
    contentWrapper.innerHTML = '';
    const leftCol = document.createElement('div');
    leftCol.style.cssText = 'flex:1;padding:16px 20px;';

    const sectionDiv = document.createElement('div');
    sectionDiv.style.cssText = styles.sectionTitle;
    sectionDiv.textContent = '场景配置';
    leftCol.appendChild(sectionDiv);

    const configBox = document.createElement('div');
    configBox.style.cssText = styles.sectionBg;

    // 场景主标题
    const titleLabel = document.createElement('label');
    titleLabel.style.cssText = styles.label;
    titleLabel.innerHTML = "场景主标题<span style='" + styles.requiredStar + "'>*</span>";
    configBox.appendChild(titleLabel);

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.placeholder = '请输入场景主标题';
    titleInput.style.cssText = styles.input;
    titleInput.value = state.sceneConfig.sceneTitle;
    addInputFocusEffect(titleInput);
    configBox.appendChild(titleInput);

    // 场景副标题（展开时显示）
    const subtitleLabel = document.createElement('label');
    subtitleLabel.style.cssText = styles.label;
    subtitleLabel.setAttribute('data-expand-only', '');
    subtitleLabel.textContent = '场景副标题';
    configBox.appendChild(subtitleLabel);

    const subtitleInput = document.createElement('input');
    subtitleInput.type = 'text';
    subtitleInput.placeholder = '请输入场景副标题（选填）';
    subtitleInput.style.cssText = styles.input;
    subtitleInput.value = state.sceneConfig.sceneSubTitle;
    subtitleInput.setAttribute('data-expand-only', '');
    addInputFocusEffect(subtitleInput);
    configBox.appendChild(subtitleInput);

    // 场景名称
    const nameLabel = document.createElement('label');
    nameLabel.style.cssText = styles.label;
    nameLabel.innerHTML = "场景名称<span style='" + styles.requiredStar + "'>*</span>";
    configBox.appendChild(nameLabel);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = '请输入场景名称';
    nameInput.style.cssText = styles.input;
    nameInput.value = state.sceneConfig.sceneName;
    addInputFocusEffect(nameInput);
    configBox.appendChild(nameInput);

    leftCol.appendChild(configBox);

    // 开始录制按钮
    const startBtn = document.createElement('button');
    startBtn.textContent = '开始录制';

    function updateStartBtn() {
      const title = titleInput.value.trim();
      const name = nameInput.value.trim();
      if (title && name) {
        startBtn.style.cssText = styles.primaryBtn;
        startBtn.disabled = false;
      } else {
        startBtn.style.cssText = styles.primaryBtnDisabled;
        startBtn.disabled = true;
      }
    }

    titleInput.addEventListener('input', updateStartBtn);
    nameInput.addEventListener('input', updateStartBtn);
    updateStartBtn();

    startBtn.onclick = (e) => {
      e.stopPropagation();
      const title = titleInput.value.trim();
      const name = nameInput.value.trim();
      if (!title || !name) return;
      sendMsg('startRecording', {
        sceneTitle: title,
        sceneSubTitle: subtitleInput.value.trim(),
        sceneName: name,
      });
    };

    leftCol.appendChild(startBtn);

    statusEl = document.createElement('div');
    statusEl.style.cssText = styles.statusText;
    leftCol.appendChild(statusEl);

    contentWrapper.appendChild(leftCol);
    applyExpandState();
  }

  // ===== 渲染：录制阶段 =====
  function renderRecordingPhase() {
    contentWrapper.innerHTML = '';

    const currentMainMod = state.currentMainModuleIndex >= 0 && state.currentMainModuleIndex < state.mainModules.length
      ? state.mainModules[state.currentMainModuleIndex]
      : null;
    const currentSubMod = currentMainMod && state.currentSubModuleIndex >= 0 && state.currentSubModuleIndex < currentMainMod.subModules.length
      ? currentMainMod.subModules[state.currentSubModuleIndex]
      : null;

    // 左栏
    const leftCol = document.createElement('div');
    leftCol.style.cssText = 'flex:1;padding:16px 20px;overflow-y:auto;';

    // 右栏（展开时显示）
    const rightCol = document.createElement('div');
    rightCol.style.cssText = 'width:280px;border-left:1px solid rgba(255,255,255,0.08);padding:16px 20px;overflow-y:auto;';
    rightCol.setAttribute('data-expand-only', '');

    // ── 当前模块 ──
    const mainModuleSection = document.createElement('div');
    mainModuleSection.style.cssText = styles.sectionTitle;
    mainModuleSection.setAttribute('data-expand-only', '');
    mainModuleSection.textContent = '当前模块';
    leftCol.appendChild(mainModuleSection);

    const mainModuleBox = document.createElement('div');
    mainModuleBox.style.cssText = styles.sectionBg;

    const mainModNameLabel = document.createElement('label');
    mainModNameLabel.style.cssText = styles.label;
    mainModNameLabel.innerHTML = "模块主标题<span style='" + styles.requiredStar + "'>*</span>";
    mainModuleBox.appendChild(mainModNameLabel);

    const mainModNameInput = document.createElement('input');
    mainModNameInput.type = 'text';
    mainModNameInput.placeholder = '请输入模块主标题';
    mainModNameInput.style.cssText = styles.input;
    mainModNameInput.value = currentMainMod ? currentMainMod.mainModuleName : '';
    addInputFocusEffect(mainModNameInput);
    mainModuleBox.appendChild(mainModNameInput);
    uiRefs.mainModNameInput = mainModNameInput;

    const mainModSubtitleLabel = document.createElement('label');
    mainModSubtitleLabel.style.cssText = styles.label;
    mainModSubtitleLabel.setAttribute('data-expand-only', '');
    mainModSubtitleLabel.textContent = '模块描述';
    mainModuleBox.appendChild(mainModSubtitleLabel);

    const mainModSubtitleInput = document.createElement('input');
    mainModSubtitleInput.type = 'text';
    mainModSubtitleInput.placeholder = '请输入模块描述（选填）';
    mainModSubtitleInput.style.cssText = styles.input;
    mainModSubtitleInput.value = currentMainMod ? currentMainMod.mainModuleDesc : '';
    mainModSubtitleInput.setAttribute('data-expand-only', '');
    addInputFocusEffect(mainModSubtitleInput);
    mainModuleBox.appendChild(mainModSubtitleInput);
    uiRefs.mainModSubtitleInput = mainModSubtitleInput;

    leftCol.appendChild(mainModuleBox);

    // ── 当前主步骤 ──
    const subModuleSection = document.createElement('div');
    subModuleSection.style.cssText = styles.sectionTitle;
    subModuleSection.setAttribute('data-expand-only', '');
    subModuleSection.textContent = '当前主步骤';
    leftCol.appendChild(subModuleSection);

    const subModuleBox = document.createElement('div');
    subModuleBox.style.cssText = styles.sectionBg;

    const modNameLabel = document.createElement('label');
    modNameLabel.style.cssText = styles.label;
    modNameLabel.innerHTML = "主步骤标题<span style='" + styles.requiredStar + "'>*</span>";
    subModuleBox.appendChild(modNameLabel);

    const modNameInput = document.createElement('input');
    modNameInput.type = 'text';
    modNameInput.placeholder = '请输入主步骤标题';
    modNameInput.style.cssText = styles.input;
    modNameInput.value = currentSubMod ? currentSubMod.mainStepTitle : '';
    addInputFocusEffect(modNameInput);
    subModuleBox.appendChild(modNameInput);
    uiRefs.modNameInput = modNameInput;

    leftCol.appendChild(subModuleBox);

    // ── 元素标记 ──
    const markSection = document.createElement('div');
    markSection.style.cssText = styles.sectionTitle;
    markSection.setAttribute('data-expand-only', '');
    markSection.textContent = '元素标记';
    leftCol.appendChild(markSection);

    const markBox = document.createElement('div');
    markBox.style.cssText = styles.sectionBg;

    // 快捷键提示
    const shortcutHint = document.createElement('span');
    shortcutHint.textContent = 'Alt+A';
    shortcutHint.style.cssText = 'display:block;font-size:10px;color:rgba(255,255,255,0.82);margin-bottom:4px;';
    markBox.appendChild(shortcutHint);
    uiRefs.shortcutHint = shortcutHint;

    // 标记操作行
    const markRow = document.createElement('div');
    markRow.setAttribute('data-mark-row', '');
    markRow.style.cssText = 'display:flex;flex-direction:row;gap:4px;align-items:center;';

    // 选择元素按钮
    const markBtn = document.createElement('button');
    markBtn.textContent = '选择元素';
    markBtn.style.cssText = compactStyles.secondaryBtn + ';width:auto;';
    markBtn.onclick = (e) => {
      e.stopPropagation();
      if (isSelecting) {
        resetSelectionState();
        if (statusEl) statusEl.textContent = '';
      } else {
        hasSelectedElement = false;
        selectedElement = null;
        selectedElementId = null;
        enableSelectionMode();
      }
    };
    markRow.appendChild(markBtn);
    uiRefs.markBtn = markBtn;

    // 主标题输入框
    const mainTitleInput = document.createElement('input');
    mainTitleInput.type = 'text';
    mainTitleInput.placeholder = '主标题';
    mainTitleInput.style.cssText = compactStyles.input;
    addInputFocusEffect(mainTitleInput);
    markRow.appendChild(mainTitleInput);
    uiRefs.mainTitleInput = mainTitleInput;

    // 完成标记按钮
    const completeMarkBtn = document.createElement('button');
    completeMarkBtn.textContent = isExpanded ? '完成标记' : '标记';
    completeMarkBtn.style.cssText = compactStyles.primaryBtnDisabled + ';width:auto;';
    completeMarkBtn.disabled = true;
    completeMarkBtn.onclick = (e) => {
      e.stopPropagation();
      completeMark();
    };
    markRow.appendChild(completeMarkBtn);
    uiRefs.completeMarkBtn = completeMarkBtn;

    markBox.appendChild(markRow);

    // 副标题（展开时显示）
    const subTitleLabel = document.createElement('label');
    subTitleLabel.style.cssText = styles.label;
    subTitleLabel.setAttribute('data-expand-only', '');
    subTitleLabel.textContent = '标记副标题';
    markBox.appendChild(subTitleLabel);

    const subTitleInput = document.createElement('input');
    subTitleInput.type = 'text';
    subTitleInput.placeholder = '请输入标记副标题（选填）';
    subTitleInput.style.cssText = styles.input;
    subTitleInput.setAttribute('data-expand-only', '');
    addInputFocusEffect(subTitleInput);
    markBox.appendChild(subTitleInput);
    uiRefs.subTitleInput = subTitleInput;

    // 标记列表（展开时显示）
    const markListContainer = document.createElement('div');
    markListContainer.style.cssText = 'margin-top:8px;margin-bottom:4px;';
    markListContainer.setAttribute('data-expand-only', '');
    markBox.appendChild(markListContainer);
    uiRefs.markListContainer = markListContainer;

    leftCol.appendChild(markBox);

    // ── 操作 ──
    const stepSection = document.createElement('div');
    stepSection.style.cssText = styles.sectionTitle;
    stepSection.setAttribute('data-expand-only', '');
    stepSection.textContent = '操作';
    leftCol.appendChild(stepSection);

    const stepBox = document.createElement('div');
    stepBox.style.cssText = styles.sectionBg;

    // 步骤信息
    const stepInfo = document.createElement('div');
    stepInfo.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.82);margin-bottom:10px;';
    stepInfo.textContent = state.currentStepId ? '当前步骤: ' + state.currentStepId : '';
    stepInfo.setAttribute('data-expand-only', '');
    stepBox.appendChild(stepInfo);
    uiRefs.stepInfo = stepInfo;

    // 快捷键提示
    const stepShortcutHint = document.createElement('span');
    stepShortcutHint.textContent = 'Alt+S 下一步 | Alt+Q 结束保存';
    stepShortcutHint.style.cssText = 'display:block;font-size:10px;color:rgba(255,255,255,0.82);margin-bottom:4px;';
    stepBox.appendChild(stepShortcutHint);
    uiRefs.stepShortcutHint = stepShortcutHint;

    // 按钮行1
    const btnRow1 = document.createElement('div');
    btnRow1.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px;';

    // 下一步按钮
    const nextStepBtn = document.createElement('button');
    nextStepBtn.textContent = '下一步';
    nextStepBtn.style.cssText = (isExpanded ? styles.primaryBtnDisabled : compactStyles.primaryBtnDisabled) + ';width:auto;padding:8px 14px;';
    nextStepBtn.disabled = true;
    nextStepBtn.onclick = async (e) => {
      e.stopPropagation();
      if (nextStepBtn.disabled || !state.isRecording) return;

      // 如果已选择元素但未完成标记，自动完成
      if (hasSelectedElement && uiRefs.mainTitleInput) {
        const mainTitle = uiRefs.mainTitleInput.value.trim();
        if (!mainTitle) {
          if (statusEl) {
            statusEl.textContent = '请先输入主标题再进行下一步';
            statusEl.style.color = '#f53f3f';
          }
          return;
        }
        completeMark();
      }

      nextStepBtn.disabled = true;
      nextStepBtn.textContent = '处理中...';
      nextStepBtn.style.cssText = (isExpanded ? styles.primaryBtnDisabled : compactStyles.primaryBtnDisabled) + ';width:auto;padding:8px 14px;';
      if (statusEl) {
        statusEl.textContent = '正在捕获页面...';
        statusEl.style.color = '#165dff';
      }

      sendMsg('nextStep');
    };
    btnRow1.appendChild(nextStepBtn);
    uiRefs.nextStepBtn = nextStepBtn;

    // 新增主步骤按钮
    const addSubModuleBtn = document.createElement('button');
    addSubModuleBtn.textContent = '新增主步骤';
    addSubModuleBtn.style.cssText = (isExpanded ? styles.secondaryBtn : compactStyles.secondaryBtn) + ';width:auto;padding:8px 14px;';
    addSubModuleBtn.onclick = (e) => {
      e.stopPropagation();
      const modName = uiRefs.modNameInput ? uiRefs.modNameInput.value.trim() : '';
      sendMsg('addSubModule', { modName });
    };
    btnRow1.appendChild(addSubModuleBtn);
    uiRefs.addSubModuleBtn = addSubModuleBtn;

    // 新增模块按钮
    const addMainModuleBtn = document.createElement('button');
    addMainModuleBtn.textContent = '新增模块';
    addMainModuleBtn.style.cssText = (isExpanded ? styles.secondaryBtn : compactStyles.secondaryBtn) + ';width:auto;padding:8px 14px;';
    addMainModuleBtn.onclick = (e) => {
      e.stopPropagation();
      const mainModName = uiRefs.mainModNameInput ? uiRefs.mainModNameInput.value.trim() : '';
      const mainModDesc = uiRefs.mainModSubtitleInput ? uiRefs.mainModSubtitleInput.value.trim() : '';
      sendMsg('addMainModule', { mainModName, mainModDesc });
    };
    btnRow1.appendChild(addMainModuleBtn);
    uiRefs.addMainModuleBtn = addMainModuleBtn;

    stepBox.appendChild(btnRow1);

    // 按钮行2
    const btnRow2 = document.createElement('div');
    btnRow2.style.cssText = 'display:flex;gap:6px;align-items:center;';

    // 结束并保存按钮
    const endSaveBtn = document.createElement('button');
    endSaveBtn.textContent = '结束并保存';
    endSaveBtn.style.cssText = (isExpanded ? styles.dangerBtn : compactStyles.dangerBtn) + ';width:auto;padding:8px 14px;white-space:nowrap;';
    endSaveBtn.onclick = async (e) => {
      e.stopPropagation();

      // 如果已选择元素但未完成标记，校验
      if (hasSelectedElement && uiRefs.mainTitleInput) {
        const mainTitle = uiRefs.mainTitleInput.value.trim();
        if (!mainTitle) {
          if (statusEl) {
            statusEl.textContent = '请先输入主标题再结束保存';
            statusEl.style.color = '#f53f3f';
          }
          return;
        }
        completeMark();
      }

      // 弹出资源地址配置对话框
      const baseUrl = await showBaseUrlDialog();

      const modName = uiRefs.modNameInput ? uiRefs.modNameInput.value.trim() : '';
      const mainModName = uiRefs.mainModNameInput ? uiRefs.mainModNameInput.value.trim() : '';
      const mainModDesc = uiRefs.mainModSubtitleInput ? uiRefs.mainModSubtitleInput.value.trim() : '';

      endSaveBtn.disabled = true;
      endSaveBtn.textContent = '处理中...';
      if (statusEl) {
        statusEl.textContent = '正在处理和保存...';
        statusEl.style.color = '#165dff';
      }

      sendMsg('endAndSave', { modName, mainModName, mainModDesc, resourceBaseUrl: baseUrl });
    };
    btnRow2.appendChild(endSaveBtn);
    uiRefs.endSaveBtn = endSaveBtn;

    // 清空录制按钮
    const clearBtn = document.createElement('button');
    clearBtn.textContent = '清空录制';
    clearBtn.style.cssText = (isExpanded ? styles.warningBtn : compactStyles.warningBtn) + ';width:auto;padding:8px 14px;white-space:nowrap;';
    clearBtn.onclick = (e) => {
      e.stopPropagation();
      showConfirmDialog(
        '确认清空录制',
        '清空后将丢失本次所有录制数据，且无法恢复。确定要清空吗？',
        () => {
          sendMsg('clearRecording');
        }
      );
    };
    btnRow2.appendChild(clearBtn);
    uiRefs.clearBtn = clearBtn;

    stepBox.appendChild(btnRow2);
    leftCol.appendChild(stepBox);

    // 状态文本
    statusEl = document.createElement('div');
    statusEl.style.cssText = styles.statusText;
    statusEl.setAttribute('data-expand-only', '');
    leftCol.appendChild(statusEl);

    // ── 右栏：录制记录 ──
    const rightTitle = document.createElement('div');
    rightTitle.style.cssText = styles.sectionTitle + 'margin-top:0;';
    rightTitle.textContent = '录制记录';
    rightCol.appendChild(rightTitle);

    const moduleListContainer = document.createElement('div');
    moduleListContainer.style.cssText = styles.moduleListBg;
    rightCol.appendChild(moduleListContainer);
    uiRefs.moduleListContainer = moduleListContainer;

    contentWrapper.appendChild(leftCol);
    contentWrapper.appendChild(rightCol);

    // 渲染标记列表
    renderMarkList();
    renderModuleList();
    updateNextStepBtn();
    applyExpandState();
  }

  // ===== 渲染标记列表 =====
  function renderMarkList() {
    const container = uiRefs.markListContainer;
    if (!container) return;
    container.innerHTML = '';

    (state.markedElements || []).forEach((markData, idx) => {
      const markItem = document.createElement('div');
      markItem.style.cssText = [
        'display:flex', 'align-items:center', 'justify-content:space-between',
        'padding:8px 12px', 'margin-bottom:4px', 'background:rgba(255,255,255,0.06)',
        'border-radius:8px', 'border:1px solid rgba(255,255,255,0.08)', 'font-size:12px',
        'color:#ffffff', 'transition:all 0.15s',
      ].join(';');

      const markText = document.createElement('span');
      markText.textContent = markData.mainTitle;
      markText.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:8px;';
      markItem.appendChild(markText);

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '\u00d7';
      deleteBtn.style.cssText = [
        'width:20px', 'height:20px', 'border:none', 'border-radius:50%',
        'background:#f53f3f', 'color:#ffffff', 'font-size:14px', 'line-height:1',
        'cursor:pointer', 'flex-shrink:0', 'transition:all 0.15s',
      ].join(';');
      deleteBtn.onclick = (de) => {
        de.stopPropagation();
        // 清理 DOM 上的标记 ID
        const el = document.getElementById(markData.elementId);
        if (el) el.removeAttribute('id');
        sendMsg('deleteMark', { markIndex: idx });
      };
      markItem.appendChild(deleteBtn);
      container.appendChild(markItem);
    });
  }

  // ===== 渲染模块列表 =====
  function renderModuleList() {
    const container = uiRefs.moduleListContainer;
    if (!container) return;
    container.innerHTML = '';

    if (!state.mainModules || state.mainModules.length === 0) {
      container.textContent = '暂无模块';
      container.style.cssText = styles.moduleListBg + 'color:rgba(255,255,255,0.72);font-size:12px;text-align:center;';
      return;
    }
    container.style.cssText = styles.moduleListBg;

    state.mainModules.forEach((mainMod, mainIdx) => {
      const isCurrentMain = mainIdx === state.currentMainModuleIndex;

      const mainHeader = document.createElement('div');
      mainHeader.style.cssText = [
        'padding:8px 10px', 'cursor:pointer', 'border-radius:8px',
        'color:#ffffff', 'font-size:12px', 'display:flex', 'align-items:center', 'gap:6px',
        'transition:all 0.15s', 'font-weight:600',
      ].join(';');
      if (isCurrentMain) mainHeader.style.background = 'rgba(22,93,255,0.15)';

      const mainArrow = document.createElement('span');
      mainArrow.style.cssText = 'color:rgba(255,255,255,0.72);font-size:10px;width:12px;text-align:center;flex-shrink:0;';
      mainArrow.textContent = '\u25b8';

      const mainName = document.createElement('span');
      const totalSteps = mainMod.subModules.reduce((sum, sm) => sum + (sm.steps ? sm.steps.length : 0), 0);
      mainName.textContent = (mainMod.mainModuleName || '未命名模块') + ' (' + totalSteps + '步)';
      if (isCurrentMain) mainName.style.color = '#6aa1ff';

      mainHeader.appendChild(mainArrow);
      mainHeader.appendChild(mainName);

      const subList = document.createElement('div');
      subList.style.cssText = 'display:none;margin-left:16px;border-left:2px solid rgba(255,255,255,0.1);padding-left:12px;margin-top:4px;';

      mainMod.subModules.forEach((subMod, subIdx) => {
        const isCurrentSub = isCurrentMain && subIdx === state.currentSubModuleIndex;
        const stepCnt = subMod.steps ? subMod.steps.length : 0;

        const subHeader = document.createElement('div');
        subHeader.style.cssText = [
          'padding:6px 8px', 'cursor:pointer', 'border-radius:6px',
          'color:#ffffff', 'font-size:11px', 'display:flex', 'align-items:center', 'gap:4px',
          'transition:all 0.15s',
        ].join(';');
        if (isCurrentSub) subHeader.style.background = 'rgba(22,93,255,0.15)';

        const subArrow = document.createElement('span');
        subArrow.style.cssText = 'color:rgba(255,255,255,0.72);font-size:9px;width:10px;text-align:center;flex-shrink:0;';
        subArrow.textContent = '\u25b8';

        const subName = document.createElement('span');
        subName.textContent = (subMod.mainStepTitle || '未命名主步骤') + ' (' + stepCnt + '步)';
        if (isCurrentSub) {
          subName.style.fontWeight = '600';
          subName.style.color = '#6aa1ff';
        }

        subHeader.appendChild(subArrow);
        subHeader.appendChild(subName);

        // 步骤列表
        const stepList = document.createElement('div');
        stepList.style.cssText = 'display:none;margin-left:12px;border-left:2px solid rgba(255,255,255,0.06);padding-left:10px;margin-top:2px;';

        if (subMod.steps && subMod.steps.length > 0) {
          subMod.steps.forEach((step, sIdx) => {
            const stepItem = document.createElement('div');
            stepItem.style.cssText = 'padding:3px 6px;font-size:10px;color:rgba(255,255,255,0.82);border-radius:4px;';
            const marksText = step.marks && step.marks.length > 0
              ? step.marks.map((m) => m.mainTitle).join(', ')
              : '无标记';
            stepItem.textContent = (sIdx + 1) + '. ' + marksText;
            stepList.appendChild(stepItem);
          });
        }

        subHeader.onclick = (e) => {
          e.stopPropagation();
          const isOpen = stepList.style.display !== 'none';
          stepList.style.display = isOpen ? 'none' : 'block';
          subArrow.textContent = isOpen ? '\u25b8' : '\u25be';
        };

        subList.appendChild(subHeader);
        subList.appendChild(stepList);
      });

      mainHeader.onclick = () => {
        const isOpen = subList.style.display !== 'none';
        subList.style.display = isOpen ? 'none' : 'block';
        mainArrow.textContent = isOpen ? '\u25b8' : '\u25be';
      };

      container.appendChild(mainHeader);
      container.appendChild(subList);
    });
  }

  // ===== 初始化 =====
  connectWs();
})();
