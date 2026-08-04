# 登录状态持久化 + 密码快捷登录方案

## 问题

1. 每次启动应用录制都到登录页面，需重新登录
2. 登录失效后重新登录，登录信息未更新
3. 用户希望记录账号密码，可选择快捷登录，不要每次重新输入

## 方案概述

三部分：
1. **持久化浏览器配置文件** — `launchPersistentContext` 保存 cookies/session/IndexedDB 等
2. **密码管理器** — 检测登录表单、捕获账号密码、加密存储
3. **快捷登录 UI** — 面板显示已保存账号，一键填充登录

---

## Part 1: 持久化浏览器配置文件

### `src/browser-manager.js` — 核心重构

**构造函数**：新增 `userDataDir` 参数

**`launch(initialUrl)` 方法**：
```javascript
// 替换:
this.browser = await chromium.launch({ headless: false, executablePath });
this.context = await this.browser.newContext({ viewport, javaScriptEnabled, ignoreHTTPSErrors });

// 为:
this.context = await chromium.launchPersistentContext(this.userDataDir, {
  headless: false,
  executablePath,
  viewport: { width: 1280, height: 900 },
  javaScriptEnabled: true,
  ignoreHTTPSErrors: true,
});
```

- `this.browser.on('disconnected')` → `this.context.on('close')`，回调中设 `this.context = null`
- 初始页面：`const page = this.context.pages()[0] || await this.context.newPage()`
- 移除所有 `this.browser` 引用

**`isLaunched()`**：`return this.context !== null`（原 `this.browser !== null`）

**`close()`**：移除 `this.browser.close()`，仅保留 `this.context.close()`

### `main/main.js` — 传入 userDataDir

```javascript
function getBrowserUserDataDir() {
  const dir = path.join(app.getPath('userData'), 'browser-profile');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
```
传入 `BrowserManager` 构造函数。

---

## Part 2: 密码存储模块

### 新建 `src/credential-store.js`

使用 Electron `safeStorage` 加密密码（OS 级加密：Windows DPAPI / macOS Keychain）。

**数据结构**：
```json
{
  "version": 1,
  "credentials": {
    "example.com": [
      { "username": "user1", "password": "<base64_encrypted>", "lastUsed": "2026-08-04T10:00:00Z" }
    ]
  }
}
```

**API**：
```javascript
class CredentialStore {
  constructor(filePath)            // 加载已有数据
  getCredentials(domain)           // → [{username, password, lastUsed}]
  saveCredential(domain, username, password)  // 新增或更新
  deleteCredential(domain, username)
  hasCredentials(domain)           // → boolean
}
```

**加密**：
```javascript
const { safeStorage } = require('electron');
// 加密: safeStorage.encryptString(password).toString('base64')
// 解密: safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
```

存储路径：`app.getPath('userData')/credentials.json`

---

## Part 3: 登录表单检测 & 凭证捕获注入脚本

### 新建 `src/inject/credential-helper.js`

注入到每个页面，职责：
1. **检测登录表单** — 找到 `<input type="password">` 及关联的用户名输入框
2. **通知应用** — 通过 `__recOnLoginFormDetected(domain)` 回调
3. **捕获凭证** — 监听表单 submit / Enter 键，通过 `__recOnLoginSubmit({domain, username, password})` 回调
4. **填充凭证** — 暴露 `window.__recCredHelper.fillCredentials(username, password)` 供主进程调用

**核心逻辑**：

```javascript
(function() {
  if (window.__recCredHelper) return;

  // 检测登录表单
  function detectLoginForm() {
    const passwordInputs = document.querySelectorAll('input[type="password"]');
    if (passwordInputs.length === 0) return null;
    const passwordInput = passwordInputs[0];
    // 向前查找用户名输入框
    const allInputs = Array.from(document.querySelectorAll('input'));
    const pwdIdx = allInputs.indexOf(passwordInput);
    let usernameInput = null;
    for (let i = pwdIdx - 1; i >= 0; i--) {
      const t = allInputs[i].type;
      if (t === 'text' || t === 'email' || t === 'tel') { usernameInput = allInputs[i]; break; }
    }
    return { passwordInput, usernameInput };
  }

  // 通知应用检测到登录表单
  function notifyLoginDetected() {
    const form = detectLoginForm();
    if (form && typeof window.__recOnLoginFormDetected === 'function') {
      window.__recOnLoginFormDetected({ domain: window.location.hostname });
    }
  }

  // 捕获登录提交
  function captureLogin() {
    const form = detectLoginForm();
    if (!form) return;
    const username = form.usernameInput ? form.usernameInput.value : '';
    const password = form.passwordInput.value;
    if (password && typeof window.__recOnLoginSubmit === 'function') {
      window.__recOnLoginSubmit({ domain: window.location.hostname, username, password });
    }
  }

  // 填充凭证（兼容 React/Vue 的原生 setter）
  function setNativeValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(el, 'value').set;
    const proto = Object.getPrototypeOf(el);
    const protoSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    if (protoSetter && setter !== protoSetter) protoSetter.call(el, value);
    else setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // 监听表单提交
  function setupListeners() {
    const form = detectLoginForm();
    if (!form) return;
    const formEl = form.passwordInput.closest('form');
    if (formEl) formEl.addEventListener('submit', captureLogin);
    form.passwordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') captureLogin(); });
  }

  // SPA 支持：URL 变化时重新检测
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) { lastUrl = location.href; setTimeout(notifyLoginDetected, 500); }
  });

  // 页面加载后检测
  if (document.readyState === 'complete') { notifyLoginDetected(); setupListeners(); }
  else window.addEventListener('load', () => { notifyLoginDetected(); setupListeners(); });

  observer.observe(document.body, { childList: true, subtree: true });

  window.__recCredHelper = {
    fillCredentials(username, password) {
      const form = detectLoginForm();
      if (!form) return false;
      if (form.usernameInput) setNativeValue(form.usernameInput, username);
      setNativeValue(form.passwordInput, password);
      return true;
    },
  };
})();
```

---

## Part 4: BrowserManager 集成

### `src/browser-manager.js` — 新增

**构造函数**：新增 `onLoginFormDetected`, `onLoginSubmit` 回调

**`_exposeFunctions()` 新增两个注册**：
```javascript
await this.context.exposeFunction('__recOnLoginFormDetected', (data) => {
  if (this.onLoginFormDetected) this.onLoginFormDetected(data);
});
await this.context.exposeFunction('__recOnLoginSubmit', (data) => {
  if (this.onLoginSubmit) this.onLoginSubmit(data);
});
```

**`_registerPage()` 新增注入**：在 `_injectElementHelper(page)` 之后调用 `_injectCredentialHelper(page)`

**新增方法**：
```javascript
async _injectCredentialHelper(page) {
  try {
    const scriptPath = path.join(__dirname, 'inject', 'credential-helper.js');
    const script = fs.readFileSync(scriptPath, 'utf-8');
    await page.addScriptTag({ content: script });
  } catch (err) { /* ignore */ }
}

async fillCredentials(username, password) {
  const active = this.getActivePage();
  if (active && active.page) {
    return await active.page.evaluate(({u, p}) => {
      if (window.__recCredHelper) return window.__recCredHelper.fillCredentials(u, p);
      return false;
    }, { u: username, p: password });
  }
  return false;
}
```

---

## Part 5: IPC + Preload

### `main/main.js` — 初始化 CredentialStore

```javascript
const { CredentialStore } = require('../src/credential-store');
const credStore = new CredentialStore(path.join(app.getPath('userData'), 'credentials.json'));
```

传入 `setupIpc({ recorder, browserManager, panelWindowGetter, credStore })`

### `main/ipc-handler.js` — 新增 IPC

```javascript
// 获取当前域名已保存的凭证
ipcMain.handle('get-credentials', (e, domain) => {
  return credStore.getCredentials(domain);  // 返回 [{username, lastUsed}]（不含密码明文）
});

// 填充凭证到当前页面
ipcMain.handle('fill-credentials', async (e, { username, password }) => {
  return await browserManager.fillCredentials(username, password);
});

// 保存凭证
ipcMain.handle('save-credential', (e, { domain, username, password }) => {
  credStore.saveCredential(domain, username, password);
  return { success: true };
});

// 删除凭证
ipcMain.handle('delete-credential', (e, { domain, username }) => {
  credStore.deleteCredential(domain, username);
  return { success: true };
});
```

### `main/preload.js` — 暴露 API

```javascript
getCredentials: (domain) => ipcRenderer.invoke('get-credentials', domain),
fillCredentials: (data) => ipcRenderer.invoke('fill-credentials', data),
saveCredential: (data) => ipcRenderer.invoke('save-credential', data),
deleteCredential: (data) => ipcRenderer.invoke('delete-credential', data),

// 事件监听
onLoginFormDetected: (cb) => ipcRenderer.on('loginFormDetected', (e, data) => cb(data)),
onLoginSubmit: (cb) => ipcRenderer.on('loginSubmit', (e, data) => cb(data)),
```

### `main/main.js` — 事件转发

```javascript
browserManager = new BrowserManager({
  // ... existing ...
  onLoginFormDetected: (data) => notifyPanel('loginFormDetected', data),
  onLoginSubmit: (data) => notifyPanel('loginSubmit', data),
});
```

---

## Part 6: 面板 UI

### `renderer/panel.js` — 新增

**状态变量**：
```javascript
let loginFormDomain = null;     // 当前检测到登录表单的域名
let savedCredentials = [];      // 当前域名的已保存凭证
```

**事件监听**：
```javascript
api.onLoginFormDetected((data) => {
  loginFormDomain = data.domain;
  // 加载该域名的已保存凭证
  api.getCredentials(data.domain).then((creds) => {
    savedCredentials = creds;
    rerenderPanel();
  });
});

api.onLoginSubmit((data) => {
  // 显示"保存密码?"对话框
  showSavePasswordDialog(data.domain, data.username, data.password);
});
```

**录制阶段渲染**：在标签页列表之后、模块配置之前，插入快捷登录区域：
```javascript
if (loginFormDomain && savedCredentials.length > 0) {
  // 渲染"快捷登录"区域
  // 每个已保存账号显示为一个按钮，点击后填充凭证
}
```

**保存密码对话框**：
```javascript
function showSavePasswordDialog(domain, username, password) {
  // 检查是否已存在相同用户名
  // 如果已存在 → "更新密码?" 对话框
  // 如果不存在 → "保存密码?" 对话框
  // 用户确认后调用 api.saveCredential({ domain, username, password })
}
```

**凭证管理**：在配置阶段的"已录制内容"下方，添加"已保存账号"管理区域，可查看和删除。

---

## Part 7: CSS

### `renderer/panel.css` — 新增

```css
/* 快捷登录区域 */
.quick-login-section { ... }
.quick-login-item { ... }
.quick-login-fill-btn { ... }

/* 保存密码对话框（复用现有 dialog 样式） */

/* 凭证管理 */
.credential-list { ... }
.credential-item { ... }
.credential-delete-btn { ... }
```

---

## 文件清单

| 文件 | 操作 | 改动 |
|------|------|------|
| `src/browser-manager.js` | 修改 | launchPersistentContext + exposeFunction + 注入 + fillCredentials |
| `src/credential-store.js` | 新建 | 加密存储模块 |
| `src/inject/credential-helper.js` | 新建 | 登录表单检测 + 凭证捕获 + 填充 |
| `main/main.js` | 修改 | userDataDir + CredentialStore + 事件转发 |
| `main/ipc-handler.js` | 修改 | 4 个凭证 IPC |
| `main/preload.js` | 修改 | 4 个 API + 2 个事件 |
| `renderer/panel.js` | 修改 | 快捷登录 UI + 保存对话框 + 凭证管理 |
| `renderer/panel.css` | 修改 | 新增样式 |

## 验证步骤

1. 启动应用，导航到需要登录的网站
2. 面板显示"快捷登录"区域（首次为空）
3. 手动登录，提交后弹出"保存密码?"对话框，点击保存
4. 关闭浏览器，重新启动应用
5. 导航到同一网站 → 应直接进入已登录状态（持久化 profile 生效）
6. 若登录失效，手动重新登录 → 弹出"更新密码?"对话框
7. 在另一台机器/清除 profile 后，导航到登录页 → 面板显示已保存账号 → 点击填充 → 一键登录
