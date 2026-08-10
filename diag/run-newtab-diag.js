/**
 * 新Tab 行为诊断 — 通过 CDP 连接运行中的 Electron，驱动 webview 执行 4 种新窗口模式
 * 前置：应用已用 --remote-debugging-port=9222 启动，且 diag/newtab-testpage.js 已运行
 */
const http = require('http');
const WebSocket = require('ws');

const TEST_URL = 'http://127.0.0.1:8899/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method) {
        (this.handlers.get(m.method) || []).forEach((h) => h(m.params));
      }
    });
  }
  ready() { return new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); }); }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(method, h) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(h);
  }
  async evaluate(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('EVAL: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

async function findPanel() {
  for (let i = 0; i < 30; i++) {
    const ts = await getTargets().catch(() => []);
    const p = ts.find((t) => t.url.includes('panel.html') && t.type === 'page');
    if (p) return p;
    await sleep(1000);
  }
  return null;
}

async function main() {
  console.log('=== [1] 连接 panel ===');
  const pt = await findPanel();
  if (!pt) { console.error('❌ 未找到 panel 目标'); process.exit(1); }
  const panel = new Cdp(pt.webSocketDebuggerUrl);
  await panel.ready();
  await panel.send('Runtime.enable');
  console.log('✅ panel 已连接');

  console.log('\n=== [2] 读取 webview 元素属性（关键证据）===');
  const attrs = await panel.evaluate(`
    (function(){
      var w = document.getElementById('previewWebview');
      if (!w) return JSON.stringify({error:'webview 不存在'});
      var a = {};
      for (var i=0;i<w.attributes.length;i++) a[w.attributes[i].name] = w.attributes[i].value;
      return JSON.stringify({
        attributes: a,
        hasAllowpopupsAttr: w.hasAttribute('allowpopups'),
        webpreferencesAttr: w.getAttribute('webpreferences')
      }, null, 2);
    })()
  `);
  console.log(attrs);

  console.log('\n=== [3] 让 webview 可见并导航到测试页 ===');
  await panel.evaluate(`
    (function(){
      var rec = document.querySelector('[data-view="recording"]');
      if (rec) rec.click();
    })()
  `);
  await sleep(1000);
  const navRes = await panel.evaluate(`
    (function(){
      var w = document.getElementById('previewWebview');
      var host = w.closest('.preview-webview-host') || w.parentElement;
      // 强制容器可见，确保 guest 附着
      var el = w;
      while (el && el !== document.body) {
        el.style.display = el.style.display === 'none' ? '' : el.style.display;
        el.style.visibility = 'visible';
        el = el.parentElement;
      }
      w.src = ${JSON.stringify(TEST_URL)};
      return JSON.stringify({ src: w.getAttribute('src'), offsetW: w.offsetWidth, offsetH: w.offsetHeight });
    })()
  `);
  console.log('导航请求:', navRes);

  console.log('\n=== [4] 等待 webview target ===');
  let wt = null;
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    const ts = await getTargets().catch(() => []);
    wt = ts.find((t) => (t.type === 'webview' || t.type === 'page') && t.url.startsWith(TEST_URL));
    if (wt) break;
  }
  if (!wt) {
    console.error('❌ webview target 未出现');
    const all = await getTargets();
    console.log('现有 targets:', all.map((t) => t.type + ' | ' + t.url).join('\n  '));
    process.exit(1);
  }
  console.log('✅ webview target:', wt.url);

  const wv = new Cdp(wt.webSocketDebuggerUrl);
  await wv.ready();
  await wv.send('Runtime.enable');
  const logs = [];
  wv.on('Runtime.consoleAPICalled', (p) => {
    logs.push('[' + p.type + '] ' + p.args.map((a) => a.value ?? a.description ?? '').join(' '));
  });
  await sleep(1500);

  const before = await wv.evaluate('location.href');
  console.log('\n=== [5] 逐个测试新窗口模式 ===');
  console.log('起始 URL:', before);

  const results = {};

  // A: window.open(url,'_blank')
  results.A = await wv.evaluate(`
    (function(){ var w = window.open('/target?p=A','_blank');
      return JSON.stringify({ returned: w===null?'null':typeof w }); })()
  `);
  await sleep(1200);
  results.A_urlAfter = await wv.evaluate('location.href');

  // C: 延迟 URL（最常见的真实场景）
  results.C = await wv.evaluate(`
    (function(){ var w = window.open('','_blank');
      if(!w) return JSON.stringify({ returned:'null', note:'后续赋值会抛异常→按钮无反应' });
      try { w.location.href='/target?p=C'; return JSON.stringify({returned:'object', assigned:true}); }
      catch(e){ return JSON.stringify({returned:'object', error:e.message}); } })()
  `);
  await sleep(1200);
  results.C_urlAfter = await wv.evaluate('location.href');

  // B: target=_blank 链接点击（真实用户手势）
  await wv.send('Runtime.evaluate', { expression: "document.getElementById('btnB').click()", userGesture: true });
  await sleep(1500);
  results.B_urlAfter = await wv.evaluate('location.href').catch(() => 'N/A');

  // D: form target=_blank
  await wv.send('Runtime.evaluate', { expression: "document.getElementById('formD').querySelector('button').click()", userGesture: true }).catch(() => {});
  await sleep(1500);
  results.D_urlAfter = await wv.evaluate('location.href').catch(() => 'N/A');

  console.log(JSON.stringify(results, null, 2));

  console.log('\n=== [6] webview 控制台日志 ===');
  logs.slice(-25).forEach((l) => console.log('  ' + l));

  console.log('\n=== [7] 最终 targets 列表（是否产生新页面）===');
  const fin = await getTargets();
  fin.forEach((t) => console.log('  ' + t.type + ' | ' + t.title + ' | ' + t.url));

  wv.close(); panel.close();
  process.exit(0);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
