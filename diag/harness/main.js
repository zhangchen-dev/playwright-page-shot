const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const mode = (process.argv.find((a) => a.startsWith('--mode=')) || '--mode=app').split('=')[1];
const HELP = 'https://xft2-web-home-uat.cmburl.cn/helpapp/#/help-main';
const DIR = __dirname;
const OUT = path.join(DIR, 'result-' + mode + '.json');

let popup = null;
let wvWc = null;
const events = [];
const L = (...a) => {
  const s = '[HARNESS] ' + a.map(String).join(' ');
  events.push(s);
  console.log(s);
};

function buildHost() {
  const attr = mode === 'no-allowpopups' ? '' : 'webpreferences="allowpopups"';
  const html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0">' +
    '<webview id="wv" src="guest.html" style="width:1000px;height:700px" partition="persist:webview" ' +
    attr +
    '></webview>' +
    '</body></html>';
  fs.writeFileSync(path.join(DIR, 'host.html'), html);
  return 'file://' + path.join(DIR, 'host.html');
}

function finish() {
  const result = {
    mode: mode,
    popupFired: popup,
    finalWebviewUrl: wvWc ? wvWc.getURL() : null,
    log: events,
  };
  try {
    fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  } catch (e) {}
  L('WROTE RESULT -> ' + OUT);
  if (win) win.destroy();
  app.quit();
}

let win;
app.whenReady().then(() => {
  const hostUrl = buildHost();
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  win.loadURL(hostUrl);

  win.webContents.on('did-attach-webview', (e, wc) => {
    wvWc = wc;
    L('did-attach-webview id=' + wc.id + ' mode=' + mode);
    wc.setWindowOpenHandler((details) => {
      const url = details.url;
      popup = { url: url, time: Date.now() };
      L('>>> setWindowOpenHandler FIRED url=' + url);
      if (!/^https?:\/\//i.test(url)) return { action: 'deny' };
      setTimeout(() => {
        if (!wc.isDestroyed()) {
          wc.loadURL(url)
            .then(() => L('>>> loadURL OK -> ' + url))
            .catch((err) => L('>>> loadURL FAILED: ' + err.message));
        }
      }, 0);
      return { action: 'deny' };
    });
    wc.on('did-finish-load', () => {
      L('guest did-finish-load url=' + wc.getURL());
      setTimeout(runClick, 1500);
    });
    wc.on('did-fail-load', (e, code, desc) => L('guest did-fail-load code=' + code + ' desc=' + desc));
  });

  win.on('closed', () => {});
});

async function runClick() {
  if (!wvWc) {
    L('no wvWc');
    return finish();
  }
  L('--- clicking target=_blank anchor (帮助中心) inside webview ---');
  const r = await wvWc
    .executeJavaScript(
      `(function(){
        var a=document.getElementById('lnk');
        if(!a) return JSON.stringify({error:'no lnk'});
        a.click();
        return JSON.stringify({clickedHref:a.getAttribute('href')});
      })()`
    )
    .catch((e) => 'EVAL_ERR:' + e.message);
  L('anchor-click result: ' + r);
  setTimeout(finish, 2500);
}
