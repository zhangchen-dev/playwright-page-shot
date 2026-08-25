/**
 * 用户反馈：状态栏 / Toast / 确认对话框 / 环境配置对话框
 */
import { statusEl, el, labelEl } from './dom.js';

/** 更新底部状态栏 */
export function updateStatus(text, color) {
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.style.color = color || 'var(--text-secondary)';
  }
}

/** Toast 通知 */
export function showToast(message, type, duration) {
  type = type || 'info';
  duration = duration || 3200;
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const t = el('div', 'toast ' + type, message);
  container.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(20px)';
    setTimeout(() => t.remove(), 200);
  }, duration);
}

/** 确认对话框 */
export function showConfirmDialog(title, desc, onConfirm, options) {
  options = options || {};
  const confirmText = options.confirmText || '确认';
  const cancelText = options.cancelText || '取消';
  const onCancel = options.onCancel;
  const overlay = el('div', 'dialog-overlay');
  const dialog = el('div', 'dialog');
  dialog.appendChild(el('div', 'dialog-title', title));
  dialog.appendChild(el('div', 'dialog-desc', desc));
  const btnRow = el('div', 'dialog-btn-row');
  const cancelBtn = el('button', 'dialog-cancel-btn', cancelText);
  cancelBtn.addEventListener('click', () => { overlay.remove(); if (onCancel) onCancel(); });
  const confirmBtn = el('button', 'dialog-confirm-btn', confirmText);
  confirmBtn.addEventListener('click', () => { overlay.remove(); onConfirm(); });
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(confirmBtn);
  dialog.appendChild(btnRow);
  overlay.appendChild(dialog);
  // ★ 防御：防止叠加 — 先清理已有的 dialog overlay
  document.querySelectorAll('.dialog-overlay').forEach((o) => o.remove());
  document.body.appendChild(overlay);
}

/** ★ 多按钮对话框 — 支持自定义按钮列表（用于重录"覆盖/插入"选项） */
export function showDialog({ title, desc, buttons, width }) {
  const overlay = el('div', 'dialog-overlay');
  const dialog = el('div', 'dialog');
  if (width) dialog.style.width = width;
  dialog.appendChild(el('div', 'dialog-title', title));
  if (desc) {
    // 支持 \n 换行
    const descEl = el('div', 'dialog-desc');
    if (typeof desc === 'string') {
      descEl.style.whiteSpace = 'pre-wrap';
      descEl.textContent = desc;
    } else {
      descEl.appendChild(desc);
    }
    dialog.appendChild(descEl);
  }

  const btnRow = el('div', 'dialog-btn-row');
  // ★ 多个按钮时使用列布局（垂直排列）
  if (buttons.length > 2) {
    btnRow.style.flexDirection = 'column';
    btnRow.style.gap = '8px';
  }
  buttons.forEach((btn) => {
    const b = el('button', btn.className || 'dialog-confirm-btn', btn.text);
    b.addEventListener('click', () => {
      overlay.remove();
      if (btn.onClick) btn.onClick();
    });
    if (btn.style) b.style.cssText = btn.style;
    btnRow.appendChild(b);
  });
  dialog.appendChild(btnRow);
  overlay.appendChild(dialog);
  // ★ 防御：防止叠加 — 先清理已有的 dialog overlay
  document.querySelectorAll('.dialog-overlay').forEach((o) => o.remove());
  document.body.appendChild(overlay);
  return overlay;
}

/** ★ 环境配置对话框（dev / prd 二选一）
 *  - dev/prd：CSS/资源在「部署态」使用带域名的绝对地址（与 HTML 自身地址一致），
 *    在「应用内预览（file://）」时由注入的运行时脚本自动回退为相对地址，
 *    因此测试/生产两种环境都能在应用内正常预览（与 nextStep 导航脚本的 file→相对/否则→全域名 逻辑一致）。
 */
export function showEnvConfigDialog(defaultSceneCode) {
  return new Promise((resolve) => {
    const ENV_URLS = {
      dev: 'https://xft-service-marketing.paas.cmbchina.cn/resource/file/demonstration/',
      prd: 'https://xft-service-marketing.paas.cmbchina.cn/resource/file/demonstration/',
    };

    const overlay = el('div', 'dialog-overlay');
    const dialog = el('div', 'dialog');
    dialog.style.width = '380px';

    dialog.appendChild(el('div', 'dialog-title', '资源配置'));

    // 提示：测试/生产均可在应用内预览
    const hint = el('div', 'dialog-desc', '请选择部署环境。测试/生产环境在部署时使用带域名的绝对地址；在应用内预览时会自动回退为相对地址，因此两种环境都能正常预览：');
    hint.style.fontSize = '11px';
    hint.style.color = 'var(--text-muted)';
    hint.style.marginBottom = '12px';
    dialog.appendChild(hint);

    // 环境选择（dev / prd）
    dialog.appendChild(labelEl('选择环境', true));
    const envGroup = el('div', 'env-radio-group');

    const envs = [
      { value: 'dev', label: '🔧 测试环境 (dev)' },
      { value: 'prd', label: '🚀 生产环境 (prd)' },
    ];

    let selectedEnv = 'dev';

    envs.forEach((env) => {
      const radioLabel = el('label', 'env-radio-item');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'envSelect';
      radio.value = env.value;
      radio.checked = env.value === 'dev';
      radio.addEventListener('change', () => {
        selectedEnv = env.value;
      });
      radioLabel.appendChild(radio);
      radioLabel.appendChild(el('span', '', env.label));
      envGroup.appendChild(radioLabel);
    });
    dialog.appendChild(envGroup);

    // ★ 场景码（系统自动生成，无需用户填写，仅展示）
    dialog.appendChild(labelEl('场景码（自动生成）', false));
    const codeDisplay = el('div', 'env-scene-code-display', defaultSceneCode || 'sen_code_******');
    codeDisplay.style.fontFamily = "'Courier New', monospace";
    codeDisplay.style.padding = '6px 10px';
    codeDisplay.style.background = 'var(--bg-secondary, #f3f4f6)';
    codeDisplay.style.borderRadius = '6px';
    codeDisplay.style.fontSize = '13px';
    codeDisplay.style.color = 'var(--text-secondary)';
    codeDisplay.style.letterSpacing = '0.5px';
    dialog.appendChild(codeDisplay);

    // 按钮
    const btnRow = el('div', 'dialog-btn-row');

    // ★ 关键修复：统一的关闭/取消函数（多次调用安全）
    //   - 防止 overlay 被外部强制移除后 Promise 永久挂起
    //   - 标记已关闭后忽略重复调用
    let _closed = false;
    function closeWith(reason, payload) {
      if (_closed) return;
      _closed = true;
      if (overlay && overlay.parentNode) overlay.remove();
      // 清理 Esc 监听
      document.removeEventListener('keydown', onKeyDown);
      // 标记 dialog 已关闭（供外部参考）
      overlay.dataset.closed = '1';
      resolve(payload);
    }

    // ★ 关键修复：Esc 键关闭对话框
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeWith('cancel', null);
      }
    }
    document.addEventListener('keydown', onKeyDown);

    // ★ 关键修复：点击遮罩（非 dialog 内容区）关闭对话框
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeWith('overlay-click', null);
      }
    });

    // ★ 关键修复：增加"取消"按钮，避免用户被卡死
    const cancelBtn = el('button', 'dialog-cancel-btn', '取消');
    cancelBtn.addEventListener('click', () => {
      closeWith('cancel-btn', null);
    });
    btnRow.appendChild(cancelBtn);

    const confirmBtn = el('button', 'dialog-confirm-btn blue', '确认');
    confirmBtn.addEventListener('click', () => {
      const sceneCode = (defaultSceneCode || '').trim();
      if (!sceneCode) {
        showToast('场景码未生成，请重试', 'error', 3000);
        return;
      }
      closeWith('confirm', {
        environment: selectedEnv,
        sceneCode: sceneCode,
        envBaseUrl: ENV_URLS[selectedEnv],
      });
    });
    btnRow.appendChild(confirmBtn);
    dialog.appendChild(btnRow);

    overlay.appendChild(dialog);
    // ★ 防御：防止叠加 — 先清理已有的 dialog overlay
    document.querySelectorAll('.dialog-overlay').forEach((o) => o.remove());
    document.body.appendChild(overlay);
    setTimeout(() => { if (confirmBtn) confirmBtn.focus(); }, 50);
  });
}

/**
 * ★ 错误弹窗（modal）— 内部浏览器加载失败等需要明确告知用户的场景
 *  - 仅「知道了」按钮，点击 / Esc / 点遮罩均可关闭
 *  - 标题默认红色强调，便于在普通对话框中一眼区分
 * @param {string} title 标题（默认「发生错误」）
 * @param {string} message 主要错误信息（如 ERR_NAME_NOT_RESOLVED）
 * @param {object} [options] { code, url, confirmText, onClose }
 */
export function showErrorModal(title, message, options) {
  options = options || {};
  const overlay = el('div', 'dialog-overlay');
  const dialog = el('div', 'dialog dialog-error');

  const titleEl = el('div', 'dialog-title', title || '发生错误');
  titleEl.style.color = 'var(--accent-red, #e54545)';
  dialog.appendChild(titleEl);

  const descEl = el('div', 'dialog-desc');
  descEl.style.whiteSpace = 'pre-wrap';
  let text = message || '';
  if (options.code !== undefined && options.code !== null && options.code !== '') {
    text += '\n错误码: ' + String(options.code);
  }
  descEl.textContent = text;
  dialog.appendChild(descEl);

  if (options.url) {
    const urlEl = el('div', 'dialog-desc');
    urlEl.style.fontSize = '11px';
    urlEl.style.color = 'var(--text-muted, #999)';
    urlEl.style.wordBreak = 'break-all';
    urlEl.style.marginTop = '6px';
    urlEl.textContent = '地址: ' + options.url;
    dialog.appendChild(urlEl);
  }

  const btnRow = el('div', 'dialog-btn-row');
  const okBtn = el('button', 'dialog-confirm-btn', options.confirmText || '知道了');
  okBtn.addEventListener('click', () => { overlay.remove(); if (options.onClose) options.onClose(); });
  btnRow.appendChild(okBtn);
  dialog.appendChild(btnRow);

  overlay.appendChild(dialog);
  // ★ 防御：防止叠加 — 先清理已有的 dialog overlay
  document.querySelectorAll('.dialog-overlay').forEach((o) => o.remove());
  document.body.appendChild(overlay);
  setTimeout(() => { if (okBtn) okBtn.focus(); }, 50);
  return overlay;
}

/**
 * ★ 内部浏览器加载失败 → 弹错误 modal
 *  - 仅当【主框架】加载失败（event.isMainFrame === true）才提示；
 *    子资源（iframe / 图片 / xhr）失败 isMainFrame=false，不弹，避免刷屏
 *  - 同一地址 1.5s 内只弹一次（去重，防止导航重试连续触发多个弹窗）
 *  - 供 webview-controls.js（主 webview）与 tabs.js（弹窗 webview）的
 *    did-fail-load / did-fail-provisional-load 事件调用
 * @param {object} e webview 的 did-fail-load / did-fail-provisional-load 事件对象
 */
let _lastWebviewFail = { url: '', t: 0 };
export function notifyWebviewLoadFail(e) {
  if (!e) return;
  if (e.isMainFrame === false) return; // 子资源 / iframe 失败，忽略
  const url = e.validatedURL || '';
  const now = Date.now();
  if (_lastWebviewFail.url === url && now - _lastWebviewFail.t < 1500) return; // 去重
  _lastWebviewFail = { url, t: now };
  showErrorModal('页面加载失败', e.errorDescription || '页面无法加载', {
    code: e.errorCode,
    url: url,
  });
}
