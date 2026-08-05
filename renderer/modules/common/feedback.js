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
export function showConfirmDialog(title, desc, onConfirm) {
  const overlay = el('div', 'dialog-overlay');
  const dialog = el('div', 'dialog');
  dialog.appendChild(el('div', 'dialog-title', title));
  dialog.appendChild(el('div', 'dialog-desc', desc));
  const btnRow = el('div', 'dialog-btn-row');
  const cancelBtn = el('button', 'dialog-cancel-btn', '取消');
  cancelBtn.addEventListener('click', () => overlay.remove());
  const confirmBtn = el('button', 'dialog-confirm-btn', '确认');
  confirmBtn.addEventListener('click', () => { overlay.remove(); onConfirm(); });
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(confirmBtn);
  dialog.appendChild(btnRow);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

/** ★ 环境配置对话框（仅 dev/prd，本地预览为默认功能无需选择） */
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

    // 提示：本地预览为默认功能
    const hint = el('div', 'dialog-desc', '本地预览为默认功能，无需选择。请选择远端部署环境：');
    hint.style.fontSize = '11px';
    hint.style.color = 'var(--text-muted)';
    hint.style.marginBottom = '12px';
    dialog.appendChild(hint);

    // 环境选择（仅 dev / prd）
    dialog.appendChild(labelEl('选择环境', true));
    const envGroup = el('div', 'env-radio-group');

    const envs = [
      { value: 'dev', label: '🔧 开发环境 (dev)' },
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
        updateUrlPreview();
      });
      radioLabel.appendChild(radio);
      radioLabel.appendChild(el('span', '', env.label));
      envGroup.appendChild(radioLabel);
    });
    dialog.appendChild(envGroup);

    // 场景码输入
    dialog.appendChild(labelEl('场景码', true));
    const sceneCodeInput = el('input', 'dialog-input');
    sceneCodeInput.type = 'text';
    sceneCodeInput.value = defaultSceneCode || '';
    sceneCodeInput.placeholder = '请输入场景码';
    sceneCodeInput.style.fontFamily = "'Courier New', monospace";
    sceneCodeInput.addEventListener('input', updateUrlPreview);
    dialog.appendChild(sceneCodeInput);

    // URL 预览
    const previewLabel = el('div', 'field-label', 'URL 预览');
    previewLabel.style.marginTop = '12px';
    dialog.appendChild(previewLabel);
    const previewBox = el('div', 'env-url-preview');
    dialog.appendChild(previewBox);

    function updateUrlPreview() {
      const code = sceneCodeInput.value.trim() || '场景码';
      const base = ENV_URLS[selectedEnv];
      previewBox.textContent = '远端: ' + base + code + '/step1.html\n本地: ./step1.html (默认可用)';
      previewBox.style.whiteSpace = 'pre-wrap';
    }
    updateUrlPreview();

    // 按钮
    const btnRow = el('div', 'dialog-btn-row');
    const confirmBtn = el('button', 'dialog-confirm-btn blue', '确认');
    confirmBtn.addEventListener('click', () => {
      const sceneCode = sceneCodeInput.value.trim();
      if (!sceneCode) {
        sceneCodeInput.style.borderColor = 'var(--accent-red)';
        sceneCodeInput.focus();
        return;
      }
      overlay.remove();
      resolve({
        environment: selectedEnv,
        sceneCode: sceneCode,
        envBaseUrl: ENV_URLS[selectedEnv],
      });
    });
    btnRow.appendChild(confirmBtn);
    dialog.appendChild(btnRow);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    setTimeout(() => sceneCodeInput.focus(), 50);
  });
}
