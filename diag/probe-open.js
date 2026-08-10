/**
 * 精确探针 — 每种新窗口模式独立测试（每次重新加载测试页），并打印 window.open 实际实现
 */
const http = require('http');
const WebSocket = require('ws');

const TEST_URL = 'http://127.0.0.1:8899/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json', (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

class Cdp {
  constructor(u) {
    this.ws = new WebSocket(u); this.id = 1; this.pending = new Map(); this.handlers = new Map();
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method) (this.handlers.get(m.method) || []).forEach((h) => h(m.params));
    });
  }
  ready() { return new Promise((r, j) => { this.ws.on('open', r); this.ws.on('error', j); }); }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.id++; this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(m, h) { if (!this.handlers.has(m)) this.handlers.set(m, []); this.handlers.get(m).push(h); }
  async ev(expr, gesture = true) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: gesture });
    if (r.exceptionDetails) return '__EXCEPTION__: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

async function findWebview() {
  for (let i = 0; i < 20; i++) {
    const ts = await getTargets().catch(() => []);
    const t = ts.find((x) => (x.type === 'webview' || x.type === 'page') && x.url.startsWith('http://127.0.0.1:8899'));
    if (t) return t;
    await sleep(800);
  }
  return null;
}

async function resetToTestPage(panel) {
  await panel.ev(`(function(){document.getElementById('previewWebview').src=${JSON.stringify(TEST_URL)};})()`);
  await sleep(2500);
}

async function main() {
  const ts = await getTargets();
  const pt = ts.find((t) => t.url.includes('panel.html'));
  const panel = new Cdp(pt.webSocketDebuggerUrl);
  await panel.ready(); await panel.send('Runtime.enable');

  await resetToTestPage(panel);
  let wt = await findWebview();
  if (!wt) { console.error('no webview'); process.exit(1); }

  const wv = new Cdp(wt.webSocketDebuggerUrl);
  await wv.ready(); await wv.send('Runtime.enable');
  const logs = [];
  wv.on('Runtime.consoleAPICalled', (p) => logs.push(p.args.map((a) => a.value ?? a.description ?? '').join(' ')));
  await sleep(1000);

  console.log('=== window.open 实际实现 ===');
  console.log(await wv.ev('window.open.toString()'));
  console.log('\n=== 是否为原生实现 ===');
  console.log(await wv.ev(`JSON.stringify({
    isNative: /\\[native code\\]/.test(window.open.toString()),
    marker: window.__recNewTabIntercepted,
    hasOpener: typeof window.opener
  })`));

  const cases = [
    { id: 'A', desc: "window.open(url,'_blank')", code: `(function(){var w=window.open('/target?p=A','_blank');return JSON.stringify({ret:w===null?'null':typeof w});})()` },
    { id: 'C', desc: "window.open('','_blank') + location 赋值（延迟URL）", code: `(function(){var w=window.open('','_blank');if(!w)return JSON.stringify({ret:'null',fatal:'后续 w.location 抛异常 → 按钮无反应'});try{w.location.href='/target?p=C';return JSON.stringify({ret:'object',assigned:true});}catch(e){return JSON.stringify({ret:'object',err:e.message});}})()` },
    { id: 'B', desc: '<a target="_blank"> 点击', code: `(function(){document.getElementById('btnB').click();return 'clicked';})()` },
    { id: 'D', desc: '<form target="_blank"> 提交', code: `(function(){document.getElementById('formD').querySelector('button').click();return 'submitted';})()` },
    { id: 'E', desc: 'window.open(url) 无 target', code: `(function(){var w=window.open('/target?p=E');return JSON.stringify({ret:w===null?'null':typeof w});})()` },
  ];

  console.log('\n=== 逐项独立测试（每次重置测试页）===\n');
  for (const c of cases) {
    await resetToTestPage(panel);
    const nwt = await findWebview();
    const conn = new Cdp(nwt.webSocketDebuggerUrl);
    await conn.ready(); await conn.send('Runtime.enable');
    const clogs = [];
    conn.on('Runtime.consoleAPICalled', (p) => clogs.push(p.args.map((a) => a.value ?? a.description ?? '').join(' ')));
    await sleep(800);

    const urlBefore = await conn.ev('location.href', false);
    const ret = await conn.ev(c.code);
    await sleep(2000);
    const urlAfter = await conn.ev('location.href', false);

    // 新增了几个 target?
    const allT = await getTargets();
    const pages = allT.filter((t) => (t.type === 'webview' || t.type === 'page') && t.url.includes('8899'));

    const navigated = urlBefore !== urlAfter;
    const verdict = navigated ? '⚠️  原地跳转（覆盖当前页，非新Tab）' : '❌ 完全无反应';

    console.log(`[${c.id}] ${c.desc}`);
    console.log(`     返回值: ${ret}`);
    console.log(`     URL: ${urlBefore}  →  ${urlAfter}`);
    console.log(`     8899 相关 target 数: ${pages.length}`);
    console.log(`     结论: ${verdict}`);
    if (clogs.length) console.log(`     日志: ${clogs.slice(0, 4).join(' | ')}`);
    console.log('');
    conn.close();
  }

  wv.close(); panel.close();
  process.exit(0);
}
main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
