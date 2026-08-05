/**
 * 设置视图：账号凭证管理
 */
import { api } from '../common/api.js';
import { el } from '../common/dom.js';
import { showToast, showConfirmDialog } from '../common/feedback.js';

// ===== ★ 设置视图：凭证管理 =====
export function renderSettingsView() {
  const c = document.getElementById('content');
  if (!c) return;
  c.innerHTML = '';
  c.appendChild(el('div', 'section-title', '账号管理'));
  c.appendChild(el('div', 'empty-state', '加载中...'));

  // 异步加载所有已保存的账号凭证
  loadAllCredentialsToContent();
}

/** 加载所有已保存凭证到 content 区 */
export async function loadAllCredentialsToContent() {
  const c = document.getElementById('content');
  if (!c) return;
  c.innerHTML = '';
  c.appendChild(el('div', 'section-title', '账号管理'));

  const domains = await api.getAllCredentials();

  if (!domains || domains.length === 0) {
    c.appendChild(el('div', 'empty-state', '暂无已保存的账号\n录制时登录系统后会自动提示保存'));
    return;
  }

  const listBox = el('div', 'section-box');

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
      deleteBtn.addEventListener('click', () => {
        showConfirmDialog('删除账号', '确认删除 ' + domainInfo.domain + ' 下的账号 "' + cred.username + '" 吗？', async () => {
          await api.deleteCredential({ domain: domainInfo.domain, username: cred.username });
          showToast('已删除账号: ' + cred.username, 'success');
          loadAllCredentialsToContent();
        });
      });
      item.appendChild(info);
      item.appendChild(deleteBtn);
      credList.appendChild(item);
    });

    listBox.appendChild(domainHeader);
    listBox.appendChild(credList);
  });

  c.appendChild(listBox);
}
