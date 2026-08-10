/**
 * CDP 诊断脚本 — 诊断 webview 中 window.open 拦截问题
 *
 * 步骤：
 * 1. 连接 panel 目标
 * 2. 在 panel 中执行 JS 打开应用内浏览器并导航到测试站点
 * 3. 等待 webview 目标出现
 * 4. 连接 webview 目标
 * 5. 检查拦截脚本注入状态
 * 6. 模拟 window.open 调用，观察行为
 */
const http = require('http');
const WebSocket = require('ws');

const TEST_URL = 'https://xft2-web-home-uat.cmburl.cn/offdoc/#/cntapp/official-homePage';

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class CdpClient {
  constructor(wsUrl, label) {
    this.ws = new WebSocket(wsUrl);
    this.label = label;
    this.msgId = 1;
    this.pending = new Map();
    this.eventHandlers = new Map();
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method && this.eventHandlers.has(msg.method)) {
        this.eventHandlers.get(msg.method)(msg.params);
      }
    });
  }

  async ready() {
    return new Promise((resolve) => this.ws.on('open', resolve));
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    this.eventHandlers.set(method, handler);
  }

  async evaluate(expression, returnByValue = true) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error('Eval error: ' + JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  console.log('=== 1. 获取 targets ===');
  let targets = await getTargets();
  const panelTarget = targets.find(t => t.url.includes('panel.html'));
  if (!panelTarget) {
    console.error('未找到 panel 目标');
    process.exit(1);
  }
  console.log('Panel target:', panelTarget.url);

  const panel = new CdpClient(panelTarget.webSocketDebuggerUrl, 'panel');
  await panel.ready();
  await panel.send('Runtime.enable');

  console.log('\n=== 2. 检查 panel 中的 URL 输入和导航机制 ===');
  const uiInfo = await panel.evaluate(`
    (function() {
      var inputs = document.querySelectorAll('input');
      var urlInputs = [];
      inputs.forEach(function(inp) {
        urlInputs.push({
          id: inp.id,
          type: inp.type,
          placeholder: inp.placeholder,
          className: inp.className.substring(0, 60),
          value: inp.value
        });
      });
      var buttons = document.querySelectorAll('button');
      var btnInfo = [];
      buttons.forEach(function(b) {
        btnInfo.push({
          id: b.id,
          text: (b.textContent || '').trim().substring(0, 30),
          className: b.className.substring(0, 60)
        });
      });
      var browserModeSwitch = document.getElementById('browserModeSwitch');
      var webview = document.getElementById('previewWebview');
      return JSON.stringify({
        urlInputs: urlInputs.slice(0, 10),
        buttons: btnInfo.slice(0, 15),
        browserMode: browserModeSwitch ? browserModeSwitch.checked : 'not found',
        webviewExists: !!webview,
        webviewSrc: webview ? webview.src : '',
        currentView: (typeof appState !== 'undefined' && appState.currentView) || 'unknown'
      });
    })()
  `);
  console.log('UI info:', uiInfo);

  console.log('\n=== 3. 切换到应用内浏览器模式并导航到测试站点 ===');
  // 确保在录制视图
  await panel.evaluate(`
    (function() {
      var recMenu = document.querySelector('[data-view="recording"]');
      if (recMenu) recMenu.click();
    })()
  `);
  await sleep(800);

  // ★ 切换到应用内浏览器模式 — 点击 switch-option[data-mode="in-app"]
  const switchResult = await panel.evaluate(`
    (function() {
      // 方法1: 点击 in-app switch-option
      var inAppOption = document.querySelector('.switch-option[data-mode="in-app"]');
      if (inAppOption) {
        inAppOption.click();
        return JSON.stringify({ method: 'switch-option click', success: true });
      }
      // 方法2: 直接设置 checkbox
      var sw = document.getElementById('browserModeSwitch');
      if (sw && !sw.checked) {
        sw.checked = true;
        sw.dispatchEvent(new Event('change', { bubbles: true }));
        return JSON.stringify({ method: 'checkbox change', success: true });
      }
      return JSON.stringify({ method: 'already in-app or not found', checked: sw ? sw.checked : null });
    })()
  `);
  console.log('Switch result:', switchResult);
  await sleep(500);

  // 验证模式已切换
  const modeCheck = await panel.evaluate(`
    (function() {
      var sw = document.getElementById('browserModeSwitch');
      return JSON.stringify({ checked: sw ? sw.checked : null });
    })()
  `);
  console.log('Mode after switch:', modeCheck);

  // ★ 在 URL 输入框中输入测试 URL 并点击导航按钮
  const navResult = await panel.evaluate(`
    (function() {
      var urlInput = document.getElementById('urlInput');
      if (!urlInput) return JSON.stringify({ error: 'URL input not found' });

      // 设置 URL（使用 native setter 确保值更新）
      var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(urlInput, ${JSON.stringify(TEST_URL)});
      urlInput.dispatchEvent(new Event('input', { bubbles: true }));
      urlInput.dispatchEvent(new Event('change', { bubbles: true }));

      // ★ 点击导航按钮（而不是按 Enter）
      var navBtn = document.getElementById('navigateBtn');
      if (navBtn) {
        navBtn.click();
        return JSON.stringify({ inputId: urlInput.id, inputValue: urlInput.value, navBtnClicked: true });
      }

      // 回退：触发 Enter
      var enterEvent = new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
      });
      urlInput.dispatchEvent(enterEvent);
      return JSON.stringify({ inputId: urlInput.id, inputValue: urlInput.value, navBtnClicked: false, enterDispatched: true });
    })()
  `);
  console.log('Navigation result:', navResult);

  console.log('\n=== 4. 等待 webview 目标出现 ===');
  let webviewTarget = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    targets = await getTargets();
    webviewTarget = targets.find(t => !t.url.includes('panel.html') && t.type === 'page');
    if (webviewTarget) {
      console.log('Webview target found:', webviewTarget.url);
      break;
    }
    if (i % 5 === 4) console.log('  等待中... (' + (i + 1) + 's)');
  }

  if (!webviewTarget) {
    console.error('未找到 webview 目标，请确保应用内浏览器已打开');
    // 尝试通过 panel 的 webview 元素直接设置 src
    console.log('\n尝试直接通过 webview 元素设置 src...');
    const setResult = await panel.evaluate(`
      (function() {
        var webview = document.getElementById('previewWebview');
        if (!webview) return JSON.stringify({ error: 'webview not found' });
        webview.src = ${JSON.stringify(TEST_URL)};
        return JSON.stringify({ src: webview.src });
      })()
    `);
    console.log('Set src result:', setResult);

    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      targets = await getTargets();
      webviewTarget = targets.find(t => !t.url.includes('panel.html') && t.type === 'page');
      if (webviewTarget) {
        console.log('Webview target found:', webviewTarget.url);
        break;
      }
    }
  }

  if (!webviewTarget) {
    console.error('仍然未找到 webview 目标');
    panel.close();
    process.exit(1);
  }

  console.log('\n=== 5. 连接 webview 目标并诊断拦截状态 ===');
  // 等待页面加载
  await sleep(3000);

  const wv = new CdpClient(webviewTarget.webSocketDebuggerUrl, 'webview');
  await wv.ready();
  await wv.send('Runtime.enable');

  // 启用控制台监听
  await wv.send('Log.enable');
  const consoleLogs = [];
  wv.on('Runtime.consoleAPICalled', (params) => {
    const text = params.args.map(a => a.value || a.description || '').join(' ');
    consoleLogs.push('[' + params.type + '] ' + text);
  });

  const interceptStatus = await wv.evaluate(`
    JSON.stringify({
      intercepted: window.__recNewTabIntercepted,
      hasRecSendToHost: typeof window.__recSendToHost,
      openFunc: window.open.toString().substring(0, 200),
      url: window.location.href,
      title: document.title,
      hasJQuery: typeof window.jQuery
    })
  `);
  console.log('\n拦截状态:', interceptStatus);

  console.log('\n=== 6. 模拟 window.open 调用 ===');
  const openTestResult = await wv.evaluate(`
    (function() {
      var results = [];
      var testUrl = 'https://www.baidu.com';

      // 测试 1: 直接调用 window.open
      try {
        var beforeUrl = window.location.href;
        var retVal = window.open(testUrl, '_blank');
        var afterUrl = window.location.href;
        results.push({
          test: 'window.open(baidu, _blank)',
          retVal: retVal,
          urlChanged: beforeUrl !== afterUrl,
          beforeUrl: beforeUrl,
          afterUrl: afterUrl
        });
      } catch(e) {
        results.push({ test: 'window.open(baidu, _blank)', error: e.message });
      }

      return JSON.stringify(results);
    })()
  `);
  console.log('window.open 测试结果:', openTestResult);

  // 等待可能的导航
  await sleep(2000);

  // 检查当前 URL
  const currentUrl = await wv.evaluate('window.location.href');
  console.log('\n2秒后当前 URL:', currentUrl);

  console.log('\n=== 7. 查找页面中的按钮和 window.open 使用 ===');
  const buttonInfo = await wv.evaluate(`
    (function() {
      var elements = document.querySelectorAll('a, button, [onclick], [role="button"], .ant-btn, .btn');
      var results = [];
      elements.forEach(function(el) {
        var text = (el.textContent || '').trim();
        if (text.length > 0 && text.length < 50) {
          results.push({
            tag: el.tagName,
            text: text.substring(0, 40),
            href: el.href || '',
            target: el.target || '',
            onclick: el.getAttribute('onclick') ? el.getAttribute('onclick').substring(0, 120) : '',
            className: el.className ? el.className.substring(0, 60) : ''
          });
        }
      });
      return JSON.stringify(results.slice(0, 30));
    })()
  `);
  console.log('页面按钮/链接:');
  JSON.parse(buttonInfo).forEach((b, i) => {
    console.log('  ' + i + ':', b.tag, '|', b.text, '| href:', b.href, '| target:', b.target, '| onclick:', b.onclick);
  });

  // 搜索脚本中的 window.open
  const scriptSearch = await wv.evaluate(`
    (function() {
      var scripts = document.querySelectorAll('script');
      var matches = [];
      scripts.forEach(function(s) {
        var text = s.textContent || '';
        if (text.indexOf('window.open') >= 0) {
          var idx = text.indexOf('window.open');
          matches.push(text.substring(Math.max(0, idx - 80), idx + 200));
        }
      });
      return JSON.stringify({ count: matches.length, samples: matches.slice(0, 3) });
    })()
  `);
  console.log('\n脚本中 window.open 使用:', scriptSearch);

  console.log('\n=== 8. 控制台日志 ===');
  console.log(consoleLogs.length + ' 条日志');
  consoleLogs.slice(-20).forEach(l => console.log('  ' + l));

  wv.close();
  panel.close();
  process.exit(0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
