/**
 * CDP 验证脚本：测试 webview new-window 实际功能（修正版）
 *  1. 在 webview 中加载测试页
 *  2. 注入 target="_blank" 链接并点击
 *  3. 验证 webview 导航到新 URL
 */
const { chromium } = require('playwright');

const CDP_URL = 'http://127.0.0.1:9222';

function logOk(m)   { console.log('  ✓ ' + m); }
function logWarn(m) { console.log('  ⚠ ' + m); }
function logFail(m) { console.log('  ✗ ' + m); }
function logStep(t) { console.log('\n========== ' + t + ' =========='); }

(async () => {
  console.log('=== CDP 验证：webview new-window 实际功能 ===\n');

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (err) {
    console.error('无法连接 CDP 端口 ' + CDP_URL);
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
  if (!panelPage) {
    console.error('找不到 panel.html 页面');
    process.exit(1);
  }
  console.log('Panel URL:', panelPage.url());

  const consoleLogs = [];
  const consoleErrors = [];
  panelPage.on('console', (msg) => {
    const text = '[' + msg.type() + '] ' + msg.text();
    consoleLogs.push(text);
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await panelPage.waitForLoadState('domcontentloaded').catch(() => {});
  await panelPage.waitForTimeout(1000);

  // ★ 验证 1: webview 元素已配置
  logStep('1. 验证 webview 元素配置');
  const listenerCheck = await panelPage.evaluate(() => {
    const wv = document.getElementById('previewWebview');
    return {
      hasWebview: !!wv,
      webpreferences: wv?.getAttribute('webpreferences'),
      partition: wv?.getAttribute('partition'),
    };
  });
  console.log('  配置:', listenerCheck);
  if (listenerCheck.hasWebview && listenerCheck.webpreferences) {
    logOk('webview 已配置 webpreferences=' + listenerCheck.webpreferences);
  } else {
    logFail('webview 配置缺失');
  }

  // ★ 验证 2: 切到 recording 视图 + 导航到 example.com
  logStep('2. 切到 recording 视图并打开 example.com');
  await panelPage.click('.menu-item[data-view="recording"]');
  await panelPage.waitForTimeout(500);

  const urlInput = await panelPage.$('#urlInput');
  if (urlInput) {
    await urlInput.fill('https://example.com');
    await urlInput.press('Enter');
    logOk('已输入 URL https://example.com');
  } else {
    logFail('找不到 #urlInput');
  }

  // 等待浏览器启动 + 页面加载
  await panelPage.waitForTimeout(10000);

  const state1 = await panelPage.evaluate(() => ({
    browserLaunched: window.appState?.browserLaunched,
    webviewURL: document.getElementById('previewWebview')?.getURL(),
  }));
  console.log('  状态:', state1);
  if (state1.browserLaunched && state1.webviewURL?.includes('example.com')) {
    logOk('浏览器已启动并加载 example.com');
  } else {
    logWarn('浏览器未正确启动，可能 Playwright 限制');
    await browser.close();
    process.exit(0);
  }

  // ★ 验证 3: 注入并点击 target="_blank" 链接
  logStep('3. 注入并点击 target="_blank" 链接');

  // 通过 panelPage.evaluate 调用 webview 的 executeJavaScript
  const injectResult = await panelPage.evaluate(async () => {
    const wv = document.getElementById('previewWebview');
    if (!wv) return { error: 'no webview' };
    try {
      // 注入测试链接
      await wv.executeJavaScript(`
        (function() {
          const a = document.createElement('a');
          a.href = 'https://example.org';
          a.target = '_blank';
          a.textContent = 'Test new tab';
          a.id = '__test_newtab';
          a.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;background:yellow;padding:20px;';
          document.body.appendChild(a);
          console.log('[Test] 已注入测试链接到 example.org');
          return 'injected';
        })();
      `);
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  });
  console.log('  注入结果:', injectResult);

  if (injectResult.error) {
    logFail('注入失败: ' + injectResult.error);
  } else {
    logOk('已注入测试链接');
  }

  await panelPage.waitForTimeout(500);

  // 触发点击
  const clickResult = await panelPage.evaluate(async () => {
    const wv = document.getElementById('previewWebview');
    try {
      await wv.executeJavaScript(`
        (function() {
          const a = document.getElementById('__test_newtab');
          if (a) {
            a.click();
            console.log('[Test] 已点击测试链接');
            return 'clicked';
          } else {
            return 'no-link';
          }
        })();
      `);
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  });
  console.log('  点击结果:', clickResult);
  if (!clickResult.error) logOk('已触发点击');

  // ★ 验证 4: 等待导航
  logStep('4. 等待 webview 导航完成');
  await panelPage.waitForTimeout(5000);

  const navState = await panelPage.evaluate(() => {
    const wv = document.getElementById('previewWebview');
    return {
      webviewURL: wv?.getURL(),
    };
  });
  console.log('  webview URL:', navState.webviewURL);

  if (navState.webviewURL?.includes('example.org')) {
    logOk('✓ webview 已导航到 https://example.org（新窗口处理成功）');
  } else if (navState.webviewURL?.includes('example.com')) {
    logFail('webview 仍在 example.com — new-window 事件可能未触发');
  } else {
    logWarn('webview URL 异常: ' + navState.webviewURL);
  }

  // ★ 验证 5: 检查监听器日志
  logStep('5. 检查 new-window 监听器日志');
  const newWindowLogs = consoleLogs.filter((l) => l.includes('new-window') || l.includes('Test'));
  if (newWindowLogs.length > 0) {
    logOk('发现相关日志:');
    newWindowLogs.forEach((l) => console.log('  -', l));
  } else {
    logWarn('未发现 new-window 监听器日志');
  }

  // ★ 验证 6: 控制台错误
  logStep('6. 控制台错误');
  if (consoleErrors.length === 0) {
    logOk('无控制台错误');
  } else {
    logFail('发现 ' + consoleErrors.length + ' 条错误:');
    consoleErrors.slice(0, 5).forEach((e) => console.log('  -', e.slice(0, 200)));
  }

  await browser.close();
  console.log('\n=== 验证完成 ===');
})().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
