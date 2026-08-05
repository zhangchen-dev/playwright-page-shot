/**
 * 浏览器管理器 - 管理 Playwright 浏览器实例、多标签页追踪和元素选择桥接
 * 
 * 核心能力：
 * - 跨标签页追踪：通过 Playwright 事件 + 页面可见性追踪"用户当前正在看的页面"
 * - 跨域录制：所有标签页共享同一个 BrowserContext，exposeFunction 在 context 级别注册
 * - 元素选择桥接：选择模式操作当前焦点页面，新 tab 自动注入辅助脚本
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

class BrowserManager {
  constructor({ recorder, onStateChange, onElementSelected, onSelectionCancelled, panelWindowGetter, userDataDir, onLoginFormDetected, onLoginSubmit, onBrowserClosed }) {
    this.recorder = recorder;
    this.onStateChange = onStateChange;
    this.onElementSelected = onElementSelected;
    this.onSelectionCancelled = onSelectionCancelled;
    this.panelWindowGetter = panelWindowGetter;
    this.userDataDir = userDataDir; // ★ 持久化浏览器配置文件目录
    this.onLoginFormDetected = onLoginFormDetected; // ★ 登录表单检测回调
    this.onLoginSubmit = onLoginSubmit; // ★ 登录提交捕获回调
    this.onBrowserClosed = onBrowserClosed; // ★ 浏览器关闭回调
    this.browser = null; // ★ launchPersistentContext 模式下不再使用 browser 对象
    this.context = null;
    this.pages = new Map(); // pageId -> { page, url }
    this._pageIdMap = new Map(); // page (object) -> pageId
    this._exposeFunctionsRegistered = false; // context 级别的 exposeFunction 只注册一次
    this._activePageId = null; // 当前用户焦点所在的页面 ID
  }

  /**
   * 启动浏览器 — ★ 使用 launchPersistentContext 持久化登录状态
   * cookies / session / IndexedDB / localStorage 均保存在 userDataDir 中
   */
  async launch(initialUrl) {
    let executablePath;
    // 打包后使用内置 Chromium
    try {
      const { app } = require('electron');
      if (app && app.isPackaged) {
        const browserDir = path.join(process.resourcesPath, 'playwright-browser', 'chromium-1234');
        const platform = process.platform;
        if (platform === 'win32') {
          executablePath = path.join(browserDir, 'chrome-win64', 'chrome.exe');
        } else if (platform === 'darwin') {
          executablePath = path.join(browserDir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
        } else {
          executablePath = path.join(browserDir, 'chrome-linux', 'chrome');
        }
        if (!fs.existsSync(executablePath)) {
          console.warn('[BrowserManager] 内置 Chromium 不存在:', executablePath, '，使用 Playwright 默认路径');
          executablePath = undefined;
        } else {
          console.log('[BrowserManager] 使用内置 Chromium:', executablePath);
        }
      }
    } catch (e) {
      // 非 Electron 环境，使用默认
    }

    // ★ 确保 userDataDir 存在
    if (this.userDataDir) {
      try {
        fs.mkdirSync(this.userDataDir, { recursive: true });
      } catch (e) {
        console.warn('[BrowserManager] 创建 userDataDir 失败:', e.message);
      }
    }

    // ★ 使用 launchPersistentContext 替代 launch + newContext
    // 持久化浏览器配置文件，保存 cookies/session/登录状态
    const launchOptions = {
      headless: false,
      executablePath,
      viewport: { width: 1280, height: 900 },
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
    };

    if (this.userDataDir) {
      console.log('[BrowserManager] 使用持久化配置目录:', this.userDataDir);
      this.context = await chromium.launchPersistentContext(this.userDataDir, launchOptions);
    } else {
      // 回退：无 userDataDir 时使用普通 launch + newContext（不持久化）
      console.warn('[BrowserManager] 未提供 userDataDir，使用非持久化模式');
      this.browser = await chromium.launch({ headless: false, executablePath });
      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 900 },
        javaScriptEnabled: true,
        ignoreHTTPSErrors: true,
      });
    }

    // 监听新标签页（用户通过链接打开的新标签页、window.open 等）
    this.context.on('page', (page) => {
      if (this._pageIdMap.has(page)) return;
      this._onNewPage(page);
    });

    // ★ 监听 context 关闭（替代 browser.disconnected）
    this.context.on('close', () => {
      console.log('[BrowserManager] 浏览器已关闭');
      this.pages.clear();
      this._pageIdMap.clear();
      this._activePageId = null;
      this.context = null;
      this.browser = null;
      this._exposeFunctionsRegistered = false; // ★ 重置以便下次启动重新注册
      if (this.onBrowserClosed) this.onBrowserClosed(); // ★ 通知面板浏览器已关闭
    });

    // 如果是持久化模式，browser 为 null；否则使用已创建的 browser 监听断开
    if (this.browser) {
      this.browser.on('disconnected', () => {
        console.log('[BrowserManager] 浏览器已断开');
        this.pages.clear();
        this._pageIdMap.clear();
        this._activePageId = null;
        this._exposeFunctionsRegistered = false; // ★ 重置
      });
    }

    // ★ 获取初始页面：持久化模式下 context 可能已有页面（恢复的 session）
    const page = this.context.pages()[0] || await this.context.newPage();

    // ★ 在 context 创建后、第一个页面上注册 exposeFunction
    // context.exposeFunction 对所有页面（含未来新 tab）自动生效
    await this._exposeFunctions();

    await this._registerPage(page);

    if (initialUrl) {
      console.log(`[BrowserManager] 导航到: ${initialUrl}`);
      try {
        await page.goto(initialUrl, { waitUntil: 'networkidle', timeout: 30000 });
      } catch (err) {
        try {
          await page.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (err2) {
          console.warn('[BrowserManager] 导航失败:', err2.message);
        }
      }
    }
  }

  /**
   * 注册新页面 — 注入辅助脚本、设置事件监听、追踪焦点
   */
  async _registerPage(page) {
    const pageId = this._generatePageId();
    this.pages.set(pageId, { page, url: page.url() });
    this._pageIdMap.set(page, pageId);

    // 设为焦点页面
    this._activePageId = pageId;

    // 注入元素选择辅助脚本
    await this._injectElementHelper(page);

    // ★ 注入凭证辅助脚本（登录表单检测 + 凭证捕获 + 填充）
    await this._injectCredentialHelper(page);

    // ★ 追踪焦点：页面获得焦点时更新 _activePageId
    page.on('load', async () => {
      if (this.pages.has(pageId)) {
        this.pages.get(pageId).url = page.url();
      }
      // 页面加载后重新注入辅助脚本
      await this._injectElementHelper(page);
      await this._injectCredentialHelper(page);
      this._notifyStateChange();
    });

    // ★ 追踪焦点：通过 frame navigated 事件检测用户切换
    page.on('framenavigated', () => {
      if (this.pages.has(pageId)) {
        this.pages.get(pageId).url = page.url();
      }
      this._activePageId = pageId;
      this._notifyStateChange();
    });

    // ★ 注入可见性追踪脚本：当用户切换 tab 时通知后端
    try {
      await page.evaluate(() => {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            // 通过 exposeFunction 通知后端当前页面获得焦点
            if (typeof window.__recOnPageFocus === 'function') {
              window.__recOnPageFocus({ url: window.location.href });
            }
          }
        });
      });
    } catch (e) {
      // about:blank 等页面可能无法执行，忽略
    }

    // 页面关闭
    page.on('close', () => {
      this.pages.delete(pageId);
      this._pageIdMap.delete(page);
      // 如果关闭的是焦点页面，切换到其他页面
      if (this._activePageId === pageId) {
        const remaining = Array.from(this.pages.keys());
        this._activePageId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      }
      this._notifyStateChange();
    });

    console.log(`[BrowserManager] 页面已注册: ${pageId} (${page.url()})`);
  }

  /**
   * 处理新标签页（用户点击链接打开的新 tab）
   */
  async _onNewPage(page) {
    await this._registerPage(page);
    this._notifyStateChange();
    console.log(`[BrowserManager] 新标签页已注册，当前共 ${this.pages.size} 个页面`);
  }

  /**
   * 注入元素选择辅助脚本
   */
  async _injectElementHelper(page) {
    try {
      const helperScriptPath = path.join(__dirname, 'inject', 'element-helper.js');
      const helperScript = fs.readFileSync(helperScriptPath, 'utf-8');
      await page.addScriptTag({ content: helperScript });
    } catch (err) {
      // about:blank 等页面无法注入，忽略
    }
  }

  /**
   * ★ 注入凭证辅助脚本（登录表单检测 + 凭证捕获 + 填充）
   */
  async _injectCredentialHelper(page) {
    try {
      const credScriptPath = path.join(__dirname, 'inject', 'credential-helper.js');
      const credScript = fs.readFileSync(credScriptPath, 'utf-8');
      await page.addScriptTag({ content: credScript });
    } catch (err) {
      // about:blank 等页面无法注入，忽略
    }
  }

  /**
   * 注册 Playwright exposeFunction 桥接
   * ★ 使用 context.exposeFunction() 而非 page.exposeFunction()
   * context 级别的 exposeFunction 会自动在所有页面（含未来新 tab）的 window 上生效
   */
  async _exposeFunctions() {
    if (this._exposeFunctionsRegistered) {
      return;
    }
    this._exposeFunctionsRegistered = true;

    try {
      // 元素被选中回调 - 选中后自动退出选择模式
      await this.context.exposeFunction('__recOnElementSelected', (data) => {
        data.pageId = this._activePageId || this._getActivePageId();

        // 主动确保浏览器端退出选择模式（双保险）
        this.disableSelectionMode().catch(() => {});

        if (this.onElementSelected) {
          this.onElementSelected(data);
        }
      });

      // 选择被取消回调
      await this.context.exposeFunction('__recOnSelectionCancelled', () => {
        this.disableSelectionMode().catch(() => {});

        if (this.onSelectionCancelled) {
          this.onSelectionCancelled();
        }
      });

      // ★ 页面焦点回调 — 用户切换 tab 时更新焦点页面
      await this.context.exposeFunction('__recOnPageFocus', (data) => {
        // 找到触发焦点的页面
        for (const [pid, info] of this.pages) {
          if (info.page && !info.page.isClosed()) {
            try {
              const pageUrl = info.page.url();
              // 通过 URL 匹配
              if (pageUrl === data.url || data.url.endsWith(pageUrl.replace(/^https?:\/\/[^/]+/, ''))) {
                this._activePageId = pid;
                console.log(`[BrowserManager] 焦点切换到: ${pid} (${data.url})`);
                this._notifyStateChange();
                break;
              }
            } catch (e) {
              // ignore
            }
          }
        }
      });

      console.log('[BrowserManager] context.exposeFunction 已注册（自动对所有页面生效）');

      // ★ 登录表单检测回调 — 页面中出现 password input 时触发
      await this.context.exposeFunction('__recOnLoginFormDetected', (data) => {
        console.log('[BrowserManager] 检测到登录表单:', data.domain);
        if (this.onLoginFormDetected) {
          this.onLoginFormDetected(data);
        }
      });

      // ★ 登录提交捕获回调 — 用户提交登录表单时触发
      await this.context.exposeFunction('__recOnLoginSubmit', (data) => {
        console.log('[BrowserManager] 捕获到登录提交:', data.domain, '/', data.username);
        if (this.onLoginSubmit) {
          this.onLoginSubmit(data);
        }
      });
    } catch (err) {
      console.warn('[BrowserManager] exposeFunction 注册失败:', err.message);
    }
  }

  /**
   * ★ 启用元素选择模式 — 在当前焦点页面激活
   */
  async enableSelectionMode() {
    const active = this.getActivePage();
    if (active && active.page) {
      try {
        await active.page.evaluate(() => {
          if (window.__recHelper) {
            window.__recHelper.enableSelectionMode();
          }
        });
        console.log(`[BrowserManager] 选择模式已启用: ${active.pageId}`);
      } catch (err) {
        console.warn('[BrowserManager] 启用选择模式失败:', err.message);
      }
    }
  }

  /**
   * ★ 禁用元素选择模式 — 在所有页面中禁用（确保不残留）
   */
  async disableSelectionMode() {
    for (const [pageId, info] of this.pages) {
      try {
        if (info.page && !info.page.isClosed()) {
          await info.page.evaluate(() => {
            if (window.__recHelper) {
              window.__recHelper.disableSelectionMode();
            }
          });
        }
      } catch (err) {
        // 跨域页面可能无法 evaluate，忽略
      }
    }
  }

  /**
   * 移除元素 ID（删除标记时使用）
   */
  async removeElementId(elementId) {
    for (const [, info] of this.pages) {
      try {
        await info.page.evaluate((id) => {
          if (window.__recHelper && window.__recHelper.removeElementId) {
            window.__recHelper.removeElementId(id);
          }
        }, elementId);
      } catch (e) {
        // ignore
      }
    }
  }

  // ===== 页面焦点管理 =====

  /**
   * ★ 手动设置焦点页面（面板切换 tab 时使用）
   */
  setActivePageId(pageId) {
    if (this.pages.has(pageId)) {
      this._activePageId = pageId;
      console.log(`[BrowserManager] 焦点手动切换到: ${pageId}`);
      this._notifyStateChange();
    }
  }

  /**
   * ★ 在应用内 Playwright 浏览器中打开本地 HTML 文件（用于预览已录制内容）
   * - 若浏览器未启动则先启动浏览器
   * - 在现有 context 中新建标签页打开文件，不影响当前录制页面
   */
  async openLocalHtmlFile(filePath) {
    const { pathToFileURL } = require('url');
    const fileUrl = pathToFileURL(filePath).href;

    if (!this.isLaunched()) {
      console.log('[BrowserManager] 浏览器未启动，先启动再打开预览:', fileUrl);
      await this.launch(fileUrl);
      return { success: true, justLaunched: true };
    }

    // 在现有 context 中新建标签页
    const page = await this.context.newPage();
    if (!this._pageIdMap.has(page)) {
      await this._registerPage(page);
    }

    try {
      await page.goto(fileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      console.log('[BrowserManager] 已在应用内打开预览:', fileUrl);
    } catch (err) {
      console.warn('[BrowserManager] 打开本地文件失败:', err.message);
    }

    try {
      await page.bringToFront();
    } catch (e) {
      // ignore
    }

    return { success: true };
  }

  /**
   * ★ 填充凭证到当前焦点页面的登录表单
   * 用于"快捷登录"功能：用户选择已保存账号后自动填充
   * @param {string} username
   * @param {string} password
   * @returns {boolean} 是否填充成功
   */
  async fillCredentials(username, password) {
    const active = this.getActivePage();
    if (active && active.page) {
      try {
        const result = await active.page.evaluate(({ u, p }) => {
          if (window.__recCredHelper) return window.__recCredHelper.fillCredentials(u, p);
          return false;
        }, { u: username, p: password });
        console.log('[BrowserManager] 凭证填充结果:', result);
        return result;
      } catch (err) {
        console.warn('[BrowserManager] 填充凭证失败:', err.message);
        return false;
      }
    }
    return false;
  }

  // ===== 辅助方法 =====

  _notifyStateChange() {
    if (this.onStateChange && this.recorder) {
      this.onStateChange(this.recorder.getState());
    }
  }

  _generatePageId() {
    return 'page_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
  }

  _getActivePageId() {
    if (this._activePageId && this.pages.has(this._activePageId)) {
      return this._activePageId;
    }
    // 回退：返回第一个未关闭的页面
    for (const [pageId, info] of this.pages) {
      if (!info.page.isClosed()) return pageId;
    }
    return 'unknown';
  }

  getPageById(pageId) {
    return this.pages.get(pageId) || null;
  }

  getAllPages() {
    return Array.from(this.pages.entries()).map(([id, info]) => ({
      pageId: id,
      url: info.page.url(),
      page: info.page,
    }));
  }

  /**
   * ★ 获取当前焦点页面（用户正在看的页面）
   */
  getActivePage() {
    // 优先返回追踪到的焦点页面
    if (this._activePageId) {
      const info = this.pages.get(this._activePageId);
      if (info && !info.page.isClosed()) {
        return { pageId: this._activePageId, ...info };
      }
    }
    // 回退：返回最后一个未关闭的页面
    for (const [pageId, info] of this.pages) {
      if (!info.page.isClosed()) return { pageId, ...info };
    }
    return null;
  }

  /**
   * 检查浏览器是否已启动
   * ★ 持久化模式下 browser 为 null，以 context 为准
   */
  isLaunched() {
    return this.context !== null;
  }

  async close() {
    try {
      if (this.context) await this.context.close().catch(() => {});
      // ★ 持久化模式下 browser 为 null，无需关闭
      if (this.browser) await this.browser.close().catch(() => {});
    } finally {
      this.browser = null;
      this.context = null;
      this.pages.clear();
      this._pageIdMap.clear();
      this._activePageId = null;
      this._exposeFunctionsRegistered = false; // ★ 重置以便下次启动重新注册
    }
  }

  /** ★ 获取 Playwright 上下文的所有 cookies（用于同步到 webview） */
  async getCookies() {
    if (!this.context) return [];
    try {
      return await this.context.cookies();
    } catch (e) {
      console.warn('[BrowserManager] 获取 cookies 失败:', e.message);
      return [];
    }
  }

  /** ★ 设置 Playwright 上下文的 cookies（用于从 webview 同步） */
  async setCookies(cookies) {
    if (!this.context || !cookies || cookies.length === 0) return;
    try {
      await this.context.addCookies(cookies);
    } catch (e) {
      console.warn('[BrowserManager] 设置 cookies 失败:', e.message);
    }
  }
}

module.exports = { BrowserManager };
