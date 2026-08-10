/**
 * CDP 测试脚本 — 用 http 模块连接 CDP（不依赖 ws）
 */
const http = require('http');

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

// 通过 CDP HTTP API 执行 JS（使用 /json/protocol 不行，需要 WebSocket）
// 改用更简单的方式：直接通过 Electron 主页面的 CDP 来操作

async function main() {
  let targets = await getTargets();
  console.log('Targets:');
  targets.forEach(t => console.log('  ', t.type, '|', t.title, '|', t.url));

  const panelTarget = targets.find(t => t.url.includes('panel.html'));
  if (!panelTarget) {
    console.error('No panel target found');
    process.exit(1);
  }

  console.log('\nPanel target wsUrl:', panelTarget.webSocketDebuggerUrl);

  // 检查 webview targets
  const webviewTargets = targets.filter(t => !t.url.includes('panel.html') && t.type === 'page');
  console.log('Webview targets:', webviewTargets.length);
  webviewTargets.forEach(t => console.log('  ', t.url));

  // 如果没有 webview target，尝试通过主页面设置 webview src
  if (webviewTargets.length === 0) {
    console.log('\nNo webview target. Please open the in-app browser in the app first.');
    console.log('You need to:');
    console.log('1. In the app, make sure "应用内" browser mode is selected');
    console.log('2. Enter a URL and press Enter to navigate');
    console.log('3. Wait for the page to load');
    console.log('\nWaiting 60 seconds for you to open the browser...');
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      targets = await getTargets();
      const wvTargets = targets.filter(t => !t.url.includes('panel.html') && t.type === 'page');
      if (wvTargets.length > 0) {
        console.log('\nWebview target detected:', wvTargets[0].url);
        break;
      }
    }
  }

  // 再次获取 targets
  targets = await getTargets();
  const webviewTarget = targets.find(t => !t.url.includes('panel.html') && t.type === 'page');

  if (!webviewTarget) {
    console.error('Still no webview target. Please ensure the in-app browser is open.');
    process.exit(1);
  }

  console.log('\nWebview target:', webviewTarget.url);
  console.log('Webview wsUrl:', webviewTarget.webSocketDebuggerUrl);

  // 使用 WebSocket（Electron 自带 ws 模块）
  let WebSocket;
  try {
    WebSocket = require('ws');
  } catch (e) {
    console.log('ws module not found, using electron\'s built-in...');
    // 尝试从 electron 的 node_modules 中找
    try {
      WebSocket = require('electron/node_modules/ws');
    } catch (e2) {
      console.error('Cannot find ws module. Install it: npm install ws');
      process.exit(1);
    }
  }

  const ws = new WebSocket(webviewTarget.webSocketDebuggerUrl);
  let msgId = 1;

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = msgId++;
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.id === id) {
        ws.off('message', handler);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });

  await new Promise((resolve) => ws.on('open', resolve));
  await send('Runtime.enable');

  // 检查拦截状态
  const interceptResult = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      intercepted: window.__recNewTabIntercepted,
      hasRecSendToHost: typeof window.__recSendToHost,
      openFunc: window.open.toString().substring(0, 150),
      url: window.location.href,
      title: document.title
    })`,
    returnByValue: true
  });
  console.log('\nIntercept status:', interceptResult.result.value);

  // 查找按钮
  const buttonsResult = await send('Runtime.evaluate', {
    expression: `
      JSON.stringify(Array.from(document.querySelectorAll('a, button, [onclick], [role="button"], .ant-btn')).slice(0, 30).map(el => ({
        tag: el.tagName,
        text: (el.textContent || '').trim().substring(0, 50),
        href: el.href || '',
        target: el.target || '',
        onclick: el.getAttribute('onclick') ? el.getAttribute('onclick').substring(0, 100) : '',
        class: el.className ? el.className.substring(0, 80) : ''
      })))
    `,
    returnByValue: true
  });

  console.log('\nButtons/links on page:');
  const buttons = JSON.parse(buttonsResult.result.value);
  buttons.forEach((b, i) => {
    console.log('  ' + i + ':', b.tag, '|', b.text, '| href:', b.href, '| target:', b.target, '| onclick:', b.onclick);
  });

  // 尝试查找 window.open 调用
  const openCallsResult = await send('Runtime.evaluate', {
    expression: `
      // 搜索页面所有 script 标签中的 window.open 调用
      var scripts = document.querySelectorAll('script');
      var results = [];
      scripts.forEach(function(s) {
        var text = s.textContent || '';
        if (text.indexOf('window.open') >= 0 || text.indexOf('openWindow') >= 0 || text.indexOf('openTab') >= 0) {
          var idx = text.indexOf('window.open');
          if (idx < 0) idx = text.indexOf('openWindow');
          if (idx < 0) idx = text.indexOf('openTab');
          if (idx >= 0) {
            results.push(text.substring(Math.max(0, idx - 50), idx + 200));
          }
        }
      });
      // 也检查外部脚本
      var externalScripts = Array.from(scripts).filter(s => s.src).map(s => s.src);
      JSON.stringify({ inlineMatches: results.length, matches: results.slice(0, 5), externalScripts: externalScripts.slice(0, 10) })
    `,
    returnByValue: true
  });
  console.log('\nWindow.open in scripts:', openCallsResult.result.value);

  ws.close();
  process.exit(0);
}

main().catch(console.error);
