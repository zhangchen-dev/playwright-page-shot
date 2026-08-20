/**
 * 凭证 UI：快捷登录区域 / 保存密码对话框 / 已保存账号管理
 */
import { appState } from '../../common/state.js';
import { api } from '../../common/api.js';
import { contentEl, el } from '../../common/dom.js';
import { updateStatus, showConfirmDialog } from '../../common/feedback.js';
import { fillWebviewCredentials } from '../internal/webview-recording.js';
import { rerenderPanel } from '../../app.js';

// ===== ★ 快捷登录区域（录制阶段） =====
export function renderQuickLoginSection() {
  contentEl.appendChild(el('div', 'section-title', '快捷登录'));
  const loginBox = el('div', 'section-box quick-login-section');

  // 域名提示
  const domainInfo = el('div', 'quick-login-domain', '检测到登录页: ' + appState.loginFormDomain);
  loginBox.appendChild(domainInfo);

  if (appState.savedCredentials.length === 0) {
    // 无已保存凭证 — 提示用户手动登录后自动保存
    const hint = el('div', 'empty-state', '暂无已保存账号\n请手动登录，登录后将自动提示保存密码');
    hint.style.whiteSpace = 'pre-wrap';
    hint.style.padding = '12px';
    loginBox.appendChild(hint);
  } else {
    // 显示已保存的账号列表
    appState.savedCredentials.forEach((cred) => {
      const item = el('div', 'quick-login-item');
      const icon = el('span', 'quick-login-icon', '👤');
      const info = el('div', 'quick-login-info');
      info.appendChild(el('div', 'quick-login-username', cred.username));
      if (cred.lastUsed) {
        const date = new Date(cred.lastUsed);
        const dateStr = date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' +
          date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        info.appendChild(el('div', 'quick-login-lastused', '上次使用: ' + dateStr));
      }
      const fillBtn = el('button', 'quick-login-fill-btn', '填充登录');
      fillBtn.addEventListener('click', async () => {
        fillBtn.disabled = true;
        fillBtn.textContent = '填充中...';
        // 获取完整凭证（含密码）
        const fullCred = await api.getCredential({ domain: appState.loginFormDomain, username: cred.username });
        if (fullCred) {
          // ★ 应用内浏览器：通过 executeJavaScript 直接填充 webview
          const success = await fillWebviewCredentials(fullCred.username, fullCred.password);
          if (success) {
            updateStatus('已填充账号: ' + cred.username + '，请在页面中点击登录按钮', 'var(--accent-green)');
          } else {
            updateStatus('填充失败，请检查页面是否仍为登录页', 'var(--accent-red)');
          }
        }
        fillBtn.disabled = false;
        fillBtn.textContent = '填充登录';
      });
      item.appendChild(icon);
      item.appendChild(info);
      item.appendChild(fillBtn);
      loginBox.appendChild(item);
    });
  }

  contentEl.appendChild(loginBox);
}

// ===== ★ 保存密码对话框 =====
export function showSavePasswordDialog(domain, username, password) {
  if (!domain || !username || !password) return;

  // 检查是否已存在相同用户名的凭证
  const existing = appState.savedCredentials.find((c) => c.username === username);
  const isUpdate = !!existing;

  const overlay = el('div', 'dialog-overlay');
  const dialog = el('div', 'dialog');

  dialog.appendChild(el('div', 'dialog-title', isUpdate ? '🔄 更新密码？' : '🔑 保存密码？'));
  dialog.appendChild(el('div', 'dialog-desc',
    (isUpdate ? '检测到账号 "' + username + '" 的密码已变更。\n' : '检测到登录账号：\n') +
    '域名: ' + domain + '\n' +
    '账号: ' + username + '\n\n' +
    '是否保存以便下次快捷登录？'));

  const btnRow = el('div', 'dialog-btn-row');

  const neverBtn = el('button', 'dialog-cancel-btn', '永不保存');
  neverBtn.addEventListener('click', () => overlay.remove());

  const skipBtn = el('button', 'dialog-cancel-btn', '本次不保存');
  skipBtn.addEventListener('click', () => overlay.remove());

  const saveBtn = el('button', 'dialog-confirm-btn blue', isUpdate ? '更新' : '保存');
  saveBtn.addEventListener('click', async () => {
    overlay.remove();
    const result = await api.saveCredential({ domain, username, password });
    if (result && result.success) {
      updateStatus(isUpdate ? '密码已更新' : '密码已保存', 'var(--accent-green)');
      // 刷新已保存凭证列表
      appState.savedCredentials = await api.getCredentials(domain) || [];
      rerenderPanel();
    } else {
      updateStatus('保存失败: ' + (result ? result.error : ''), 'var(--accent-red)');
    }
  });

  btnRow.appendChild(neverBtn);
  btnRow.appendChild(skipBtn);
  btnRow.appendChild(saveBtn);
  dialog.appendChild(btnRow);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

// ===== ★ 已保存账号管理（配置阶段，可展开面板） =====
export function renderCredentialManagementSection() {
  const sectionBox = el('div', 'section-box recorded-exports-section');

  const header = el('div', 'recorded-exports-header');
  const arrow = el('span', 'module-arrow', appState.isCredentialsExpanded ? '\u25be' : '\u25b8');
  const title = el('span', 'module-name', '已保存账号');
  header.appendChild(arrow);
  header.appendChild(title);

  const content = el('div', 'recorded-exports-content');
  content.style.display = appState.isCredentialsExpanded ? 'block' : 'none';

  header.addEventListener('click', () => {
    appState.isCredentialsExpanded = !appState.isCredentialsExpanded;
    arrow.textContent = appState.isCredentialsExpanded ? '\u25be' : '\u25b8';
    content.style.display = appState.isCredentialsExpanded ? 'block' : 'none';
    if (appState.isCredentialsExpanded && content.children.length === 0) {
      loadAllCredentials(content);
    }
  });

  if (appState.isCredentialsExpanded) {
    loadAllCredentials(content);
  }

  sectionBox.appendChild(header);
  sectionBox.appendChild(content);
  contentEl.appendChild(sectionBox);
}

/** ★ 异步加载所有已保存的账号凭证 */
export async function loadAllCredentials(container) {
  container.innerHTML = '';
  container.appendChild(el('div', 'empty-state', '加载中...'));

  const domains = await api.getAllCredentials();
  container.innerHTML = '';

  if (!domains || domains.length === 0) {
    container.appendChild(el('div', 'empty-state', '暂无已保存的账号'));
    return;
  }

  domains.forEach((domainInfo) => {
    const domainHeader = el('div', 'cred-domain-header');
    domainHeader.appendChild(el('span', 'cred-domain-name', domainInfo.domain));
    domainHeader.appendChild(el('span', 'cred-domain-count', domainInfo.count + ' 个账号'));

    const credList = el('div', 'cred-list');
    domainInfo.credentials.forEach((cred) => {
      const item = el('div', 'cred-item');
      const info = el('div', 'cred-item-info');
      info.appendChild(el('div', 'cred-item-username', '👤 ' + cred.username));
      if (cred.lastUsed) {
        const date = new Date(cred.lastUsed);
        const dateStr = date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }) + ' ' +
          date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        info.appendChild(el('div', 'cred-item-lastused', '上次使用: ' + dateStr));
      }
      const deleteBtn = el('button', 'cred-delete-btn', '删除');
      deleteBtn.addEventListener('click', async () => {
        showConfirmDialog('删除账号', '确认删除 ' + domainInfo.domain + ' 下的账号 "' + cred.username + '" 吗？', async () => {
          await api.deleteCredential({ domain: domainInfo.domain, username: cred.username });
          updateStatus('已删除账号: ' + cred.username, 'var(--accent-green)');
          loadAllCredentials(container);
        });
      });
      item.appendChild(info);
      item.appendChild(deleteBtn);
      credList.appendChild(item);
    });

    container.appendChild(domainHeader);
    container.appendChild(credList);
  });
}
