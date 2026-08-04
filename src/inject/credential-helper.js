/**
 * 凭证辅助脚本 - 注入到 Playwright 浏览器页面
 *
 * 职责：
 * 1. 检测登录表单（找到 password input 及关联的 username input）
 * 2. 通过 __recOnLoginFormDetected 通知应用检测到登录表单
 * 3. 捕获用户提交的账号密码，通过 __recOnLoginSubmit 回调
 * 4. 暴露 __recCredHelper.fillCredentials(username, password) 供主进程调用填充
 *
 * 通过 window.__recCredHelper 暴露接口
 * 通过 window.__recOnLoginFormDetected / __recOnLoginSubmit 回调通知主进程
 */
(function() {
  if (window.__recCredHelper) return; // 防止重复注入

  var lastDetectedDomain = '';
  var listenersAttached = false;

  // ===== 检测登录表单 =====
  function detectLoginForm() {
    var passwordInputs = document.querySelectorAll('input[type="password"]');
    if (passwordInputs.length === 0) return null;

    var passwordInput = passwordInputs[0];

    // 向前查找用户名输入框
    var allInputs = Array.from(document.querySelectorAll('input'));
    var pwdIdx = allInputs.indexOf(passwordInput);
    var usernameInput = null;

    for (var i = pwdIdx - 1; i >= 0; i--) {
      var t = allInputs[i].type;
      if (t === 'text' || t === 'email' || t === 'tel' || t === '') {
        usernameInput = allInputs[i];
        break;
      }
    }

    // 如果没有找到独立的用户名框，检查所有 input 中 type 不为 password 且不为 hidden/submit/button 的
    if (!usernameInput) {
      for (var j = 0; j < allInputs.length; j++) {
        var ti = allInputs[j].type;
        if (ti !== 'password' && ti !== 'hidden' && ti !== 'submit' && ti !== 'button' && ti !== 'checkbox' && ti !== 'radio') {
          usernameInput = allInputs[j];
          break;
        }
      }
    }

    return { passwordInput: passwordInput, usernameInput: usernameInput };
  }

  // ===== 通知应用检测到登录表单 =====
  function notifyLoginDetected() {
    var form = detectLoginForm();
    if (!form) return;

    var domain = window.location.hostname;
    if (domain === lastDetectedDomain) return; // 同一域名不重复通知
    lastDetectedDomain = domain;

    if (typeof window.__recOnLoginFormDetected === 'function') {
      window.__recOnLoginFormDetected({ domain: domain, url: window.location.href });
    }
  }

  // ===== 捕获登录提交 =====
  function captureLogin() {
    var form = detectLoginForm();
    if (!form) return;

    var username = form.usernameInput ? form.usernameInput.value : '';
    var password = form.passwordInput.value;

    if (password && typeof window.__recOnLoginSubmit === 'function') {
      window.__recOnLoginSubmit({
        domain: window.location.hostname,
        username: username,
        password: password,
      });
    }
  }

  // ===== 兼容 React/Vue 的原生 value setter =====
  function setNativeValue(el, value) {
    var descriptor = Object.getOwnPropertyDescriptor(el, 'value');
    var proto = Object.getPrototypeOf(el);
    var protoDescriptor = Object.getOwnPropertyDescriptor(proto, 'value');

    if (protoDescriptor && protoDescriptor.set && descriptor && descriptor.set !== protoDescriptor.set) {
      protoDescriptor.set.call(el, value);
    } else if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ===== 设置表单提交监听 =====
  function setupListeners() {
    if (listenersAttached) return;
    var form = detectLoginForm();
    if (!form) return;

    var formEl = form.passwordInput.closest('form');
    if (formEl) {
      formEl.addEventListener('submit', function(e) {
        captureLogin();
      });
    }

    // 监听 Enter 键提交（有些登录没有 form 标签，靠 JS 拦截 Enter）
    form.passwordInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        captureLogin();
      }
    });

    if (form.usernameInput) {
      form.usernameInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
          captureLogin();
        }
      });
    }

    listenersAttached = true;
  }

  // ===== SPA 支持：URL 变化时重新检测 =====
  var lastUrl = location.href;

  function checkUrlChange() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastDetectedDomain = '';
      listenersAttached = false;
      setTimeout(function() {
        notifyLoginDetected();
        setupListeners();
      }, 500);
    }
  }

  // 使用 MutationObserver 监听 DOM 变化（SPA 路由切换）
  var observer = new MutationObserver(function() {
    checkUrlChange();
  });

  // ===== 页面加载后初始化 =====
  function init() {
    notifyLoginDetected();
    setupListeners();

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 300);
  } else {
    window.addEventListener('DOMContentLoaded', function() { setTimeout(init, 300); });
  }

  // ===== 暴露给主进程的接口 =====
  window.__recCredHelper = {
    /**
     * 填充凭证到当前页面的登录表单
     * @param {string} username
     * @param {string} password
     * @returns {boolean} 是否填充成功
     */
    fillCredentials: function(username, password) {
      var form = detectLoginForm();
      if (!form) return false;

      if (form.usernameInput && username) {
        setNativeValue(form.usernameInput, username);
      }
      if (form.passwordInput && password) {
        setNativeValue(form.passwordInput, password);
      }

      return true;
    },

    /**
     * 检查当前页面是否有登录表单
     * @returns {boolean}
     */
    hasLoginForm: function() {
      return detectLoginForm() !== null;
    },

    /**
     * 手动触发登录提交捕获
     */
    triggerCapture: function() {
      captureLogin();
    },
  };
})();
