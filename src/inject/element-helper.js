/**
 * 元素选择辅助脚本 - 注入到 webview / Playwright 页面
 *
 * 职责：
 * - DOM 层面的交互（高亮、选择、★ iframe 内元素选择）
 * - 页面可见性变化时通知后端（焦点追踪）
 * - 不处理业务逻辑，业务逻辑由 Electron 面板处理
 *
 * 通过 window.__recHelper 暴露接口供主进程调用
 * 通过 window.__recOnElementSelected / __recOnSelectionCancelled / __recOnPageFocus 回调通知主进程
 *
 * ★ iframe 支持：
 *   - 同域 iframe：在 iframe document 上直接添加事件监听器，高亮 overlay 放在 iframe 内
 *   - 跨域 iframe：受同源策略限制，无法访问 contentDocument，自动跳过
 *   - iframe 内点击元素时，通过 window.parent.__recOnElementSelected 通知 host
 *     （该函数在顶层 window 定义，内部调用 __recSendToHost → ipcRenderer.sendToHost）
 */
(function() {
  if (window.__recHelper) return; // 防止重复注入

  let isSelecting = false;

  // ===== 顶层高亮遮罩层 =====
  const overlay = document.createElement('div');
  overlay.id = '__rec_highlight_overlay';
  overlay.style.cssText = [
    'position:fixed', 'pointer-events:none', 'z-index:2147483646',
    'border:2px solid #165dff', 'background:rgba(22,93,255,0.08)',
    'border-radius:2px', 'display:none', 'box-sizing:border-box',
    'transition:all 0.05s ease',
  ].join(';');
  document.body.appendChild(overlay);

  // ===== 顶层选择提示标签 =====
  const tooltip = document.createElement('div');
  tooltip.id = '__rec_selection_tooltip';
  tooltip.style.cssText = [
    'position:fixed', 'z-index:2147483647',
    'background:rgba(22,93,255,0.9)', 'color:#ffffff',
    'padding:4px 8px', 'border-radius:4px',
    'font-size:11px', 'font-family:system-ui,sans-serif',
    'pointer-events:none', 'display:none',
    'white-space:nowrap',
  ].join(';');
  tooltip.textContent = '点击选择此元素 | Esc 退出';
  document.body.appendChild(tooltip);

  // ===== 顶层事件拦截（选择模式） =====
  const eventsToBlock = [
    'click', 'mousedown', 'mouseup',
    'mouseover', 'mouseout', 'mouseleave',
    'pointerdown', 'pointerup', 'pointermove',
  ];

  function onEvent(e) {
    if (!isSelecting) return;
    if (e.target === overlay || e.target === tooltip) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (e.type === 'mouseover' || e.type === 'mousemove' || e.type === 'pointermove') {
      const rect = e.target.getBoundingClientRect();
      overlay.style.display = 'block';
      overlay.style.top = rect.top + 'px';
      overlay.style.left = rect.left + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';

      tooltip.style.display = 'block';
      tooltip.style.top = (rect.top - 28) + 'px';
      tooltip.style.left = rect.left + 'px';
    }

    if (e.type === 'mouseout' || e.type === 'mouseleave') {
      overlay.style.display = 'none';
      tooltip.style.display = 'none';
    }

    if (e.type === 'click') {
      overlay.style.display = 'none';
      tooltip.style.display = 'none';

      var baseId = 'stepElementId';
      var elementId = baseId;
      var counter = 1;
      while (document.getElementById(elementId)) {
        counter++;
        elementId = baseId + '_' + counter;
      }
      e.target.id = elementId;

      try {
        if (typeof window.__recOnElementSelected === 'function') {
          window.__recOnElementSelected({
            elementId: elementId,
            tagName: e.target.tagName,
            text: (e.target.textContent || '').substring(0, 50).trim(),
            className: e.target.className || '',
            isInIframe: false,
            iframeSrc: '',
          });
        }
      } catch (err) {
        console.error('[recHelper] __recOnElementSelected 回调异常:', err);
      } finally {
        disableSelectionMode();
      }
    }
  }

  eventsToBlock.forEach(function(eventType) {
    document.addEventListener(eventType, onEvent, true);
  });

  // ===== Esc 退出选择模式（顶层） =====
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && isSelecting) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      disableSelectionMode();
      if (typeof window.__recOnSelectionCancelled === 'function') {
        window.__recOnSelectionCancelled();
      }
    }
  }, true);

  // ===== 页面可见性追踪 =====
  document.addEventListener('visibilitychange', function() {
    if (typeof window.__recOnPageFocus === 'function') {
      window.__recOnPageFocus({
        url: window.location.href,
        visible: document.visibilityState === 'visible',
      });
    }
  });

  // ===== ★ iframe 内元素选择支持 =====
  //    在每个同域 iframe 的 document 上添加事件监听器
  //    高亮 overlay 放在 iframe 内（无需坐标转换）
  //    通过 window.parent.__recOnElementSelected 通知 host
  const _iframeState = []; // 保存每个 iframe 的状态 { iframe, overlay, tooltip, handler }

  function _bindIframe(iframe) {
    try {
      var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
      if (!doc || !doc.body) return;

      // 防止重复绑定
      if (iframe.__recBound) return;
      iframe.__recBound = true;

      // 在 iframe 内创建 overlay 和 tooltip
      var iOverlay = doc.createElement('div');
      iOverlay.style.cssText = [
        'position:fixed', 'pointer-events:none', 'z-index:2147483646',
        'border:2px solid #165dff', 'background:rgba(22,93,255,0.08)',
        'border-radius:2px', 'display:none', 'box-sizing:border-box',
        'transition:all 0.05s ease',
      ].join(';');
      doc.body.appendChild(iOverlay);

      var iTooltip = doc.createElement('div');
      iTooltip.style.cssText = [
        'position:fixed', 'z-index:2147483647',
        'background:rgba(22,93,255,0.9)', 'color:#ffffff',
        'padding:4px 8px', 'border-radius:4px',
        'font-size:11px', 'font-family:system-ui,sans-serif',
        'pointer-events:none', 'display:none', 'white-space:nowrap',
      ].join(';');
      iTooltip.textContent = '点击选择此元素 | Esc 退出';
      doc.body.appendChild(iTooltip);

      // 事件拦截处理器
      function onIframeEvent(e) {
        if (!isSelecting) return;
        if (e.target === iOverlay || e.target === iTooltip) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (e.type === 'mouseover' || e.type === 'mousemove' || e.type === 'pointermove') {
          var rect = e.target.getBoundingClientRect();
          iOverlay.style.display = 'block';
          iOverlay.style.top = rect.top + 'px';
          iOverlay.style.left = rect.left + 'px';
          iOverlay.style.width = rect.width + 'px';
          iOverlay.style.height = rect.height + 'px';

          iTooltip.style.display = 'block';
          iTooltip.style.top = (rect.top - 28) + 'px';
          iTooltip.style.left = rect.left + 'px';
        }

        if (e.type === 'mouseout' || e.type === 'mouseleave') {
          iOverlay.style.display = 'none';
          iTooltip.style.display = 'none';
        }

        if (e.type === 'click') {
          iOverlay.style.display = 'none';
          iTooltip.style.display = 'none';

          // 在 iframe document 中生成唯一元素 ID
          var baseId = 'stepElementId';
          var elementId = baseId;
          var counter = 1;
          while (doc.getElementById(elementId)) {
            counter++;
            elementId = baseId + '_' + counter;
          }
          e.target.id = elementId;

          // ★ 通过父窗口的回调通知 host
          //    window.parent.__recOnElementSelected 在顶层 window 定义，
          //    内部调用 window.__recSendToHost (contextBridge 暴露) → ipcRenderer.sendToHost
          try {
            if (window.parent && typeof window.parent.__recOnElementSelected === 'function') {
              window.parent.__recOnElementSelected({
                elementId: elementId,
                tagName: e.target.tagName,
                text: (e.target.textContent || '').substring(0, 50).trim(),
                className: e.target.className || '',
                isInIframe: true,
                iframeSrc: iframe.src || '',
              });
            } else {
              console.warn('[recHelper iframe] window.parent.__recOnElementSelected 不可用');
            }
          } catch (err) {
            console.error('[recHelper iframe] 回调异常:', err);
          }

          // ★ 禁用选择模式（通过顶层 __recHelper）
          try {
            if (window.parent && window.parent.__recHelper) {
              window.parent.__recHelper.disableSelectionMode();
            }
          } catch (err) {}
        }
      }

      // Esc 退出（iframe 内）
      function onIframeKeydown(e) {
        if (e.key === 'Escape' && isSelecting) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          try {
            if (window.parent && window.parent.__recHelper) {
              window.parent.__recHelper.disableSelectionMode();
            }
            if (window.parent && typeof window.parent.__recOnSelectionCancelled === 'function') {
              window.parent.__recOnSelectionCancelled();
            }
          } catch (err) {}
        }
      }

      eventsToBlock.forEach(function(et) {
        doc.addEventListener(et, onIframeEvent, true);
      });
      doc.addEventListener('keydown', onIframeKeydown, true);

      _iframeState.push({
        iframe: iframe,
        overlay: iOverlay,
        tooltip: iTooltip,
        handler: onIframeEvent,
        keydownHandler: onIframeKeydown,
      });

      console.log('[recHelper] iframe 已绑定选择模式:', iframe.src);
    } catch (e) {
      // 跨域 iframe 无法访问 contentDocument，忽略
      console.warn('[recHelper] 无法绑定 iframe（可能是跨域）:', iframe.src, e.message);
    }
  }

  function _bindAllIframes() {
    var iframes = document.querySelectorAll('iframe');
    iframes.forEach(_bindIframe);
    // ★ 监听 iframe 加载完成（可能在选择模式启用后才加载）
    iframes.forEach(function(iframe) {
      if (!iframe.__recLoadBound) {
        iframe.__recLoadBound = true;
        iframe.addEventListener('load', function() {
          if (isSelecting) _bindIframe(iframe);
        });
      }
    });
  }

  // ===== 暴露给主进程的接口 =====
  window.__recHelper = {
    /** 启用选择模式 */
    enableSelectionMode: function() {
      isSelecting = true;
      document.body.style.cursor = 'crosshair';
      // ★ 绑定所有同域 iframe
      _bindAllIframes();
    },

    /** 禁用选择模式 */
    disableSelectionMode: function() {
      isSelecting = false;
      overlay.style.display = 'none';
      tooltip.style.display = 'none';
      document.body.style.cursor = '';
      // 清理 iframe overlay
      _iframeState.forEach(function(s) {
        if (s.overlay) s.overlay.style.display = 'none';
        if (s.tooltip) s.tooltip.style.display = 'none';
      });
    },

    /** 移除元素 ID（顶层 + 所有同域 iframe） */
    removeElementId: function(elementId) {
      var el = document.getElementById(elementId);
      if (el) el.removeAttribute('id');
      // 也检查所有同域 iframe
      document.querySelectorAll('iframe').forEach(function(iframe) {
        try {
          var doc = iframe.contentDocument;
          if (doc) {
            var iframeEl = doc.getElementById(elementId);
            if (iframeEl) iframeEl.removeAttribute('id');
          }
        } catch (e) {}
      });
    },

    /** 查询当前是否在选择模式 */
    isSelecting: function() {
      return isSelecting;
    },
  };
})();
