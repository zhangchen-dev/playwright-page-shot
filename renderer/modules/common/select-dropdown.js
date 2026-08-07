/**
 * 自定义下拉选择组件 - antd 风格
 * - 点击 trigger 展开下拉面板
 * - 点击外部或 Esc 关闭
 * - 选中项高亮 + 右侧 ✓ 标记
 * - 支持图标显示
 * - 键盘导航 (↑↓ Enter Esc)
 */
import { el } from './dom.js';

let _openDropdown = null;
let _clickOutsideHandler = null;
let _escHandler = null;

/**
 * 创建自定义下拉选择
 * @param {object} opts
 * @param {string} opts.id - trigger 元素 id（用于提交时取值）
 * @param {Array<{value: string, label: string, icon?: string}>} opts.options - 选项列表
 * @param {string} [opts.value] - 初始选中值
 * @param {string} [opts.placeholder] - 占位文字
 * @param {string} [opts.className] - trigger 额外的 class
 * @param {function} [opts.onChange] - 选项变化回调
 * @returns {{ wrapper: HTMLDivElement, trigger: HTMLDivElement, hiddenInput: HTMLInputElement }}
 */
export function createSelectDropdown(opts) {
  // ★ 清理上次同 id 残留的 dropdown（防止重新渲染时累积）
  if (opts.id) {
    const oldWrapper = document.getElementById(opts.id + 'Wrapper');
    if (oldWrapper) oldWrapper.remove();
    document.querySelectorAll(`.antd-select-dropdown[data-owner="${opts.id}"]`).forEach(d => d.remove());
  }

  const wrapper = el('div', 'antd-select-wrapper');
  if (opts.id) wrapper.id = opts.id + 'Wrapper';

  // ★ 触发按钮（显示当前选中项）
  const trigger = el('div', 'antd-select-trigger');
  if (opts.className) trigger.classList.add(opts.className);

  const triggerContent = el('span', 'antd-select-content');
  const triggerArrow = el('span', 'antd-select-arrow');
  triggerArrow.innerHTML = antdArrowSvg();
  trigger.appendChild(triggerContent);
  trigger.appendChild(triggerArrow);

  // ★ 隐藏 input 用于表单提交或与现有 getElementById 逻辑兼容
  const hiddenInput = el('input', 'antd-select-hidden');
  hiddenInput.type = 'hidden';
  if (opts.id) hiddenInput.id = opts.id;

  // ★ 弹出层（默认隐藏）
  const dropdown = el('div', 'antd-select-dropdown');
  dropdown.style.display = 'none';
  if (opts.id) dropdown.dataset.owner = opts.id;

  const optionList = el('div', 'antd-select-option-list');
  dropdown.appendChild(optionList);

  // 状态
  let currentValue = opts.value || (opts.options[0] && opts.options[0].value) || '';
  hiddenInput.value = currentValue;

  // 渲染选项
  function renderOptions() {
    optionList.innerHTML = '';
    opts.options.forEach((opt) => {
      const optEl = el('div', 'antd-select-option');
      if (opt.value === currentValue) optEl.classList.add('antd-select-option-selected');
      if (opt.icon) {
        const icon = el('span', 'antd-select-option-icon', opt.icon);
        optEl.appendChild(icon);
      }
      const label = el('span', 'antd-select-option-label', opt.label);
      optEl.appendChild(label);
      const check = el('span', 'antd-select-option-check', '✓');
      optEl.appendChild(check);

      optEl.addEventListener('click', (e) => {
        e.stopPropagation();
        selectOption(opt.value);
      });
      optionList.appendChild(optEl);
    });
  }

  // 选中选项
  function selectOption(value) {
    const opt = opts.options.find((o) => o.value === value);
    if (!opt) return;
    currentValue = value;
    hiddenInput.value = value;
    // 更新 trigger 显示
    triggerContent.innerHTML = '';
    if (opt.icon) {
      const icon = el('span', 'antd-select-trigger-icon', opt.icon);
      triggerContent.appendChild(icon);
    }
    const label = el('span', 'antd-select-trigger-label', opt.label);
    triggerContent.appendChild(label);
    trigger.classList.add('antd-select-has-value');
    // 更新选项高亮
    renderOptions();
    // 关闭下拉
    closeDropdown();
    // 回调
    if (opts.onChange) opts.onChange(value, opt);
  }

  // 渲染 trigger 初始值
  function renderTrigger() {
    const opt = opts.options.find((o) => o.value === currentValue);
    if (opt) {
      triggerContent.innerHTML = '';
      if (opt.icon) {
        const icon = el('span', 'antd-select-trigger-icon', opt.icon);
        triggerContent.appendChild(icon);
      }
      const label = el('span', 'antd-select-trigger-label', opt.label);
      triggerContent.appendChild(label);
      trigger.classList.add('antd-select-has-value');
    } else {
      triggerContent.textContent = opts.placeholder || '请选择';
      trigger.classList.add('antd-select-placeholder');
    }
  }

  // 打开下拉
  function openDropdown() {
    if (_openDropdown && _openDropdown !== closeDropdown) {
      _openDropdown();
    }
    _openDropdown = closeDropdown;

    trigger.classList.add('antd-select-open');
    dropdown.style.display = '';

    // ★ 定位：相对于 trigger 的下方
    const rect = trigger.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.minWidth = rect.width + 'px';
    dropdown.style.zIndex = '999999';

    // ★ 滚动到选中项
    setTimeout(() => {
      const selected = optionList.querySelector('.antd-select-option-selected');
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' });
      }
    }, 0);

    // 绑定全局事件
    _clickOutsideHandler = (e) => {
      if (!wrapper.contains(e.target) && !dropdown.contains(e.target)) {
        closeDropdown();
      }
    };
    _escHandler = (e) => {
      if (e.key === 'Escape') closeDropdown();
    };
    setTimeout(() => {
      document.addEventListener('mousedown', _clickOutsideHandler);
      document.addEventListener('keydown', _escHandler);
    }, 0);
  }

  // 关闭下拉
  function closeDropdown() {
    trigger.classList.remove('antd-select-open');
    dropdown.style.display = 'none';
    if (_clickOutsideHandler) {
      document.removeEventListener('mousedown', _clickOutsideHandler);
      _clickOutsideHandler = null;
    }
    if (_escHandler) {
      document.removeEventListener('keydown', _escHandler);
      _escHandler = null;
    }
    if (_openDropdown === closeDropdown) {
      _openDropdown = null;
    }
  }

  // trigger 点击切换
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (trigger.classList.contains('antd-select-open')) {
      closeDropdown();
    } else {
      openDropdown();
    }
  });

  // 组装
  wrapper.appendChild(trigger);
  wrapper.appendChild(hiddenInput);
  // dropdown 放在 body 下，避免被 section-box overflow 裁剪
  document.body.appendChild(dropdown);

  // 初始渲染
  renderTrigger();
  renderOptions();

  return { wrapper, trigger, hiddenInput, dropdown, setValue: selectOption, getValue: () => currentValue };
}

/** antd 风格的下拉箭头 SVG（内联避免 CSP） */
function antdArrowSvg() {
  return '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;">' +
    '<path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
    '</svg>';
}
