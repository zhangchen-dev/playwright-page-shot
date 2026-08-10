/**
 * 诊断：Electron <webview> 三种 popup 配置下，target=_blank / window.open 的真实行为
 *
 *   mode=none      → <webview>                              （无任何 popup 属性）
 *   mode=webpref   → <webview webpreferences="allowpopups">  （项目当前写法）
 *   mode=attr      → <webview allowpopups>                   （Electron 官方写法）
 *
 * 观测点：
 *   1. guest webContents 的 setWindowOpenHandler 是否被调用
 *   2. 是否有额外 BrowserWindow 被创建（native 弹窗）
 *   3. window.open() 的返回值（null = 被 Chromium 拦截）
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-software-rasterizer');

const mode = (process.argv.find((a) => a.startsWith('--mode=')) || '--mode=attr').split('=')[1];
const DIR = __dirname;
const OUT = path.join(DIR, 'result-' + mode + '.json');

const handlerCalls = [];
const events = [];
let wvWc = null;
let win = null;

const L = (...a) => {
  const s = '[H:' + mode + '] ' + a.map(String).join(' ');
  events.push(s);
  console.log(s);
};

function attrFor(m) {
  if (m === 'none') return '';
  if (m === 'webpref') return 'webpreferences="allowpopups"';
  return 'allowpopups';
}

function buildHost() {
  const html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0">' +
    '<webview id="wv" src="guest.html" style="width:900px;height:600px" partition="persist:diagwv" ' +
    attrFor(mode) +
    '></webview></body></html>';
  const p = path.join(DIR, 'host-' + mode + '.html');
  fs.writeFileSync(p, html);
  return 'file://' + p.replace(/\\/g, '/');
}

function finish() {
  const extraWindows = BrowserWindow.getAllWindows().length - 1;
  const result = {
    mode,
    attr: attrFor(mode) || '(none)',
    windowOpenHandlerCalls: handlerCalls,
    handlerFired: handlerCalls.length > 0,
    extraBrowserWindows: extraWindows,
    finalGuestUrl: wvWc && !wvWc.isDestroyed() ? wvWc.getURL() : null,
    log: events,
  };
  try { fs.writeFileSync(OUT, JSON.stringify(result, null, 2)); } catch (e) {}
  L('RESULT -> handlerFired=' + result.handlerFired + ' extraWindows=' + extraWindows);
  try { if (win) win.destroy(); } catch (e) {}
  setTimeout(() => app.exit(0), 200);
}

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, webviewTag: true },
  });
  win.loadURL(buildHost());

  win.webContents.on('did-attach-webview', (e, wc) => {
    wvWc = wc;
    L('did-attach-webview id=' + wc.id);

    wc.setWindowOpenHandler((details) => {
      handlerCalls.push({ url: details.url, disposition: details.disposition });
      L('>>> setWindowOpenHandler FIRED url=' + details.url + ' disposition=' + details.disposition);
      return { action: 'deny' };
    });

    wc.on('console-message', (ev, lvl, msg) => {
      if (String(msg).indexOf('[guest]') === 0) L('guest-console: ' + msg);
    });

    wc.once('did-finish-load', () => {
      L('guest loaded url=' + wc.getURL());
      setTimeout(runSteps, 800);
    });
    wc.on('did-fail-load', (ev, code, desc) => L('guest did-fail-load ' + code + ' ' + desc));
  });

  setTimeout(() => { L('GLOBAL TIMEOUT'); finish(); }, 20000);
});

async function runSteps() {
  if (!wvWc) { L('no guest wc'); return finish(); }

  L('--- step1: click relative target=_blank ---');
  await wvWc.executeJavaScript("document.getElementById('lnk').click();1").catch((e) => L('err ' + e.message));
  await sleep(900);

  L('--- step2: click absolute target=_blank ---');
  await wvWc.executeJavaScript("document.getElementById('lnk2').click();1").catch((e) => L('err ' + e.message));
  await sleep(900);

  L('--- step3: window.open() ---');
  const r = await wvWc
    .executeJavaScript("(function(){var w=window.open('https://example.com/winopen','_blank');return w===null?'NULL':'OBJECT'})()")
    .catch((e) => 'ERR:' + e.message);
  L('window.open returned: ' + r);
  await sleep(900);

  finish();
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
