/**
 * Banner 轮播组件 — 录制视图未开浏览器 / 无预览时在右栏展示说明海报
 * - 2 张海报始终轮播
 * - 显示时从下方滑入；被预览/浏览器替换时向上滚动移除
 */

// ★ 海报图片列表
const BANNER_IMAGES = [
  'assets/banners/poster1.svg',
  'assets/banners/poster2.svg',
];

const ROTATE_INTERVAL = 5000; // 轮播间隔 5s
const HIDE_ANIM_MS = 500;     // 向上移除动画时长（与 CSS transition 对齐）

let _currentSlide = 0;
let _rotateTimer = null;
let _hideTimer = null;
let _rendered = false;

/** 恢复 webview 显示（banner 在上层移除时露出 webview） */
function restoreWebview() {
  // ★ 多 tab：整体显隐 #tabPages（覆盖所有 tab 的 webview），不再只管主 tab 的滚动容器
  const pages = document.getElementById('tabPages');
  if (pages) pages.style.display = '';
  const w = document.getElementById('webviewScrollWrapper');
  if (w) w.style.display = '';
  // tabBar 显隐交回 tabs.js 决定（单 tab 时应保持隐藏）
  import('./tabs.js').then((m) => m.refreshTabBar()).catch(() => {});
}

/** 渲染 Banner 轮播（仅构建一次 DOM） */
function renderBanner() {
  const container = document.getElementById('bannerContainer');
  if (!container || _rendered) return;
  _rendered = true;
  container.innerHTML = '';

  if (BANNER_IMAGES.length === 0) {
    const placeholder = document.createElement('div');
    placeholder.className = 'banner-placeholder';
    placeholder.innerHTML = [
      '<div class="banner-placeholder-icon">📋</div>',
      '<div class="banner-placeholder-text">说明海报区域</div>',
      '<div class="banner-placeholder-hint">后续可在 banner.js 中添加海报图片</div>',
    ].join('');
    container.appendChild(placeholder);
    return;
  }

  const slidesWrapper = document.createElement('div');
  slidesWrapper.className = 'banner-slides';

  BANNER_IMAGES.forEach((src, idx) => {
    const slide = document.createElement('div');
    slide.className = 'banner-slide' + (idx === 0 ? ' active' : '');
    const img = document.createElement('img');
    img.src = src;
    img.alt = '海报 ' + (idx + 1);
    img.draggable = false;
    slide.appendChild(img);
    slidesWrapper.appendChild(slide);
  });

  container.appendChild(slidesWrapper);

  // 导航圆点（多图时显示）
  if (BANNER_IMAGES.length > 1) {
    const dots = document.createElement('div');
    dots.className = 'banner-dots';
    BANNER_IMAGES.forEach((_, idx) => {
      const dot = document.createElement('span');
      dot.className = 'banner-dot' + (idx === 0 ? ' active' : '');
      dot.addEventListener('click', () => { goToSlide(idx); resetAutoRotate(); });
      dots.appendChild(dot);
    });
    container.appendChild(dots);
  }
}

/** 显示 Banner（从下方滑入），隐藏 webview/工具栏 */
export function showBanner() {
  // 取消未完成的隐藏动画
  if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }

  const banner = document.getElementById('bannerContainer');
  const webviewWrapper = document.getElementById('webviewScrollWrapper');
  const tabPages = document.getElementById('tabPages');
  const tabBar = document.getElementById('tabBar');
  const loading = document.getElementById('previewLoading');
  const toolbarActions = document.getElementById('rightToolbarActions');

  if (webviewWrapper) webviewWrapper.style.display = 'none';
  if (tabPages) tabPages.style.display = 'none'; // ★ 连同其它 tab 的 webview 一起隐藏
  if (tabBar) tabBar.style.display = 'none';
  if (loading) loading.style.display = 'none';
  if (toolbarActions) toolbarActions.style.display = 'none';

  if (banner) {
    banner.style.display = '';
    renderBanner();
    banner.classList.remove('hiding');
    void banner.offsetWidth; // ★ 先移除 hiding 再重排，确保从初始态(下方)滑入而非从上方滑下
    banner.classList.add('visible');
    startAutoRotate();
  }
}

/** 隐藏 Banner（向上滚动移除），恢复 webview 容器 */
export function hideBanner() {
  const banner = document.getElementById('bannerContainer');
  // 先恢复 webview 容器（banner 向上移除时逐步露出 webview）
  restoreWebview();
  if (!banner || banner.style.display === 'none' || !banner.classList.contains('visible')) {
    return;
  }
  banner.classList.remove('visible');
  banner.classList.add('hiding');
  stopAutoRotate();
  if (_hideTimer) clearTimeout(_hideTimer);
  _hideTimer = setTimeout(() => {
    banner.style.display = 'none';
    banner.classList.remove('hiding');
    _hideTimer = null;
  }, HIDE_ANIM_MS);
}

/** 切换到指定轮播项 */
function goToSlide(idx) {
  const slides = document.querySelectorAll('.banner-slide');
  const dots = document.querySelectorAll('.banner-dot');
  if (idx < 0 || idx >= slides.length) return;
  slides.forEach((s, i) => s.classList.toggle('active', i === idx));
  dots.forEach((d, i) => d.classList.toggle('active', i === idx));
  _currentSlide = idx;
}

/** 启动自动轮播（始终轮播） */
function startAutoRotate() {
  stopAutoRotate();
  if (BANNER_IMAGES.length <= 1) return;
  _rotateTimer = setInterval(() => {
    _currentSlide = (_currentSlide + 1) % BANNER_IMAGES.length;
    goToSlide(_currentSlide);
  }, ROTATE_INTERVAL);
}

/** 停止自动轮播 */
function stopAutoRotate() {
  if (_rotateTimer) {
    clearInterval(_rotateTimer);
    _rotateTimer = null;
  }
}

/** 用户手动切换后重置轮播计时 */
function resetAutoRotate() {
  startAutoRotate();
}
