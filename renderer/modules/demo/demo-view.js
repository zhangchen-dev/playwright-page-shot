/**
 * 定制演示视图（占位，暂未实现）
 */
import { el } from '../common/dom.js';

export function renderDemoView() {
  const c = document.getElementById('content');
  if (!c) return;
  c.innerHTML = '';

  const card = el('div', 'demo-empty-card');
  card.style.padding = '40px 24px';
  card.style.textAlign = 'center';
  card.style.color = 'var(--text-secondary)';

  const icon = el('div', 'demo-empty-icon', '🎨');
  icon.style.fontSize = '48px';
  icon.style.marginBottom = '16px';

  const title = el('div', 'demo-empty-title', '定制演示');
  title.style.fontSize = '16px';
  title.style.fontWeight = '600';
  title.style.color = 'var(--text-primary)';
  title.style.marginBottom = '8px';

  const desc = el('div', 'demo-empty-desc', '该功能正在规划中，敬请期待。');
  desc.style.fontSize = '13px';
  desc.style.lineHeight = '1.6';

  card.appendChild(icon);
  card.appendChild(title);
  card.appendChild(desc);
  c.appendChild(card);
}
