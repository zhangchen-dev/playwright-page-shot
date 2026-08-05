/**
 * 元素选择辅助脚本 - 注入到 Playwright 浏览器页面
 * 
 * 职责：
 * - DOM 层面的交互（高亮、选择、iframe 处理）
 * - 页面可见性变化时通知后端（焦点追踪）
 * - 不处理业务逻辑，业务逻辑由 Electron 面板处理
 *
 * 通过 window.__recHelper 暴露接口供主进程调用
 * 通过 window.__recOnElementSelected / __recOnSelectionCancelled / __recOnPageFocus 回调通知主进程
 */
(function() {
  if (window.__recHelper) return; // 防止重复注入

  let isSelecting = false;

  // ===== 高亮遮罩层 =====
  const overlay = document.createElement('div');
  overlay.id = '__rec_highlight_overlay';
  overlay.style.cssText = [
    'position:fixed', 'pointer-events:none', 'z-index:2147483646',
    'border:2px solid #165dff', 'background:rgba(22,93,255,0.08)',
    'border-radius:2px', 'display:none', 'box-sizing:border-box',
    'transition:all 0.05s ease',
  ].join(';');
  document.body.appendChild(overlay);

  // ===== 选择提示标签 =====
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

  // ===== 事件拦截（选择模式） =====
  const eventsToBlock = [
    'click', 'mousedown', 'mouseup',
    'mouseover', 'mouseout', 'mouseleave',
    'pointerdown', 'pointerup', 'pointermove',
  ];

  function onEvent(e) {
    if (!isSelecting) return;

    // 不拦截辅助元素本身
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

      // 生成元素 ID 并设置到 DOM 上
      const elementId = '__rec_el_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
      e.target.id = elementId;

      // 通过回调通知主进程（try/finally 确保即使回调异常也能退出选择模式）
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
        // ★ 无论回调是否异常，都必须退出选择模式，否则页面无法恢复交互
        disableSelectionMode();
      }
    }
  }

  eventsToBlock.forEach(function(eventType) {
    document.addEventListener(eventType, onEvent, true);
  });

  // ===== Esc 退出选择模式 =====
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

  // ===== ★ 页面可见性追踪 — 用户切换 tab 时通知后端 =====
  document.addEventListener('visibilitychange', function() {
    if (typeof window.__recOnPageFocus === 'function') {
      window.__recOnPageFocus({
        url: window.location.href,
        visible: document.visibilityState === 'visible',
      });
    }
  });

  // ===== 暴露给主进程的接口 =====
  window.__recHelper = {
    /** 启用选择模式 */
    enableSelectionMode: function() {
      isSelecting = true;
      document.body.style.cursor = 'crosshair';
    },

    /** 禁用选择模式 */
    disableSelectionMode: function() {
      isSelecting = false;
      overlay.style.display = 'none';
      tooltip.style.display = 'none';
      document.body.style.cursor = '';
    },

    /** 移除元素 ID */
    removeElementId: function(elementId) {
      var el = document.getElementById(elementId);
      if (el) el.removeAttribute('id');
    },

    /** 查询当前是否在选择模式 */
    isSelecting: function() {
      return isSelecting;
    },
  };
})();
