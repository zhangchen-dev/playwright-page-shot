/**
 * 本地测试服务器 — 提供包含 4 种「新窗口/新Tab」触发模式的测试页
 * 用于验证 Electron <webview> 的弹窗拦截行为
 */
const http = require('http');

const PORT = 8899;

const PAGE = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>NewTab Test</title>
<style>
body{font-family:system-ui,sans-serif;padding:24px;background:#f7f8fa;color:#222}
button,a.btn{display:block;margin:10px 0;padding:12px 18px;font-size:15px;border:1px solid #d0d4da;
  border-radius:6px;background:#fff;cursor:pointer;text-decoration:none;color:#1a5fd0;width:420px}
#log{margin-top:20px;padding:12px;background:#fff;border:1px solid #d0d4da;border-radius:6px;
  white-space:pre-wrap;font-family:Consolas,monospace;font-size:12px;min-height:80px}
h2{font-size:16px;margin:0 0 12px}
</style></head><body>
<h2>Electron webview 新Tab 行为测试</h2>

<button id="btnA">A. window.open(url, '_blank')  — 直接带 URL</button>
<a class="btn" id="btnB" href="/target?p=B" target="_blank">B. &lt;a target="_blank"&gt; 链接点击</a>
<button id="btnC">C. window.open('', '_blank') 然后赋值 location  — 延迟 URL（最常见）</button>
<form id="formD" action="/target" method="GET" target="_blank" style="margin:0">
  <input type="hidden" name="p" value="D">
  <button type="submit">D. &lt;form target="_blank"&gt; 提交</button>
</form>
<button id="btnE">E. window.open(url) 无 target</button>

<div id="log">等待操作...</div>
<script>
var logEl = document.getElementById('log');
function log(s){ logEl.textContent += '\\n' + s; console.log('[testpage] ' + s); }
window.__results = {};

document.getElementById('btnA').onclick = function(){
  var w = window.open('/target?p=A', '_blank');
  window.__results.A = { returned: w === null ? 'null' : typeof w };
  log('A: window.open 返回 = ' + (w === null ? 'null (被拦截!)' : typeof w));
};

document.getElementById('btnC').onclick = function(){
  var w = window.open('', '_blank');
  window.__results.C = { returned: w === null ? 'null' : typeof w };
  if (!w) { log('C: window.open 返回 null → 后续 w.location 会抛异常 (按钮表现为"无反应")'); return; }
  try { w.location.href = '/target?p=C'; log('C: 已对返回句柄赋值 location'); }
  catch(e){ log('C: 赋值异常 ' + e.message); }
};

document.getElementById('btnE').onclick = function(){
  var w = window.open('/target?p=E');
  window.__results.E = { returned: w === null ? 'null' : typeof w };
  log('E: window.open 返回 = ' + (w === null ? 'null (被拦截!)' : typeof w));
};

document.getElementById('btnB').addEventListener('click', function(){ log('B: 链接已点击'); });
document.getElementById('formD').addEventListener('submit', function(){ log('D: 表单已提交'); });
log('测试页就绪 @ ' + location.href);
</script></body></html>`;

const TARGET = (p) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TARGET-${p}</title></head>
<body style="font-family:system-ui;padding:40px;background:#e8f5e9">
<h1 style="color:#2e7d32">✅ 新页面已打开 (模式 ${p})</h1>
<p>URL: <code>${'/target?p=' + p}</code></p></body></html>`;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost:' + PORT);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (u.pathname === '/target') {
    res.end(TARGET(u.searchParams.get('p') || '?'));
  } else {
    res.end(PAGE);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('[testpage] http://127.0.0.1:' + PORT + '/');
});
