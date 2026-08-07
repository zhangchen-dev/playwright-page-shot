/**
 * 调试脚本：在 webview 内部注入 + 点击 target="_blank" 链接
 * 在单次 executeJavaScript 中完成所有操作
 */
const { chromium } = require('playwright');
const CDP_URL = 'http://127.0.0.1:9222';

(async () => {
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (err) {
    console.error('无法连接 CDP 端口');
    process.exit(1);
  }

  const contexts = browser.contexts();
  let panelPage = null;
  for (const ctx of contexts) {
    for (const page of ctx.pages()) {
      if (page.url().includes('panel.html')) {
        panelPage = page;
        break;
      }
    }
    if (panelPage) break;
  }
  console.log('Panel URL:', panelPage.url());

  const logs = [];
  panelPage.on('console', (msg) => {
    const text = '[' + msg.type() + '] ' + msg.text();
    logs.push(text);
  });

  await panelPage.waitForLoadState('domcontentloaded').catch(() => {});
  await panelPage.waitForTimeout(2000);

  // 切到 recording 视图
  await panelPage.click('.menu-item[data-view="recording"]');
  await panelPage.waitForTimeout(500);

  // 导航到 example.com
  const urlInput = await panelPage.$('#urlInput');
  await urlInput.fill('https://example.com');
  await urlInput.press('Enter');
  await panelPage.waitForTimeout(8000);

  const state0 = await panelPage.evaluate(() => ({
    browserLaunched: window.appState?.browserLaunched,
    webviewURL: document.getElementById('previewWebview')?.getURL(),
  }));
  console.log('导航后状态:', state0);

  // ★ 在单次 executeJavaScript 中完成注入+点击
  console.log('\n=== 单次执行注入+点击 ===');
  const result = await panelPage.evaluate(async () => {
    const wv = document.getElementById('previewWebview');
    if (!wv) return { error: 'no webview' };

    try {
      const out = await wv.executeJavaScript(`
        (function() {
          try {
            // 检查当前页面
            const url = window.location.href;
            console.log('[Test] 当前页面:', url);

            // 注入测试链接
            const a = document.createElement('a');
            a.href = 'https://example.org';
            a.target = '_blank';
            a.textContent = 'TEST NEW TAB';
            a.id = '__test_newtab';
            a.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:yellow;color:black;padding:20px;';
            document.body.appendChild(a);

            // 立即点击
            const evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
            a.dispatchEvent(evt);
            console.log('[Test] 已派发 click 事件');

            return { ok: true, currentURL: window.location.href };
          } catch (err) {
            return { error: err.message };
          }
        })();
      `);
      return { out };
    } catch (err) {
      return { error: err.message };
    }
  });
  console.log('执行结果:', JSON.stringify(result, null, 2));

  // 等待
  await panelPage.waitForTimeout(5000);

  const state1 = await panelPage.evaluate(() => ({
    webviewURL: document.getElementById('previewWebview')?.getURL(),
  }));
  console.log('导航后 webview URL:', state1.webviewURL);

  // 检查日志
  console.log('\n=== 关键日志 ===');
  logs.filter((l) => l.includes('Test') || l.includes('new-window') || l.includes('panel'))
    .forEach((l) => console.log('  ' + l));

  // 截图
  await panelPage.screenshot({ path: 'd:/code_prj/playwright-page-shot/cdp-newtab-test.png' });
  console.log('截图: cdp-newtab-test.png');

  await browser.close();
  console.log('\n=== 完成 ===');
})();
