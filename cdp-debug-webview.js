/**
 * 调试脚本：检查 webview 元素实际行为
 */
const { chromium } = require('playwright');
const CDP_URL = 'http://127.0.0.1:9222';

(async () => {
  console.log('=== 调试 webview 元素行为 ===\n');

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

  await panelPage.waitForLoadState('domcontentloaded').catch(() => {});
  await panelPage.waitForTimeout(1500);

  // 详细检查 webview
  const detail = await panelPage.evaluate(() => {
    const wv = document.getElementById('previewWebview');
    if (!wv) return { error: 'no webview' };
    return {
      tagName: wv.tagName,
      // DOM 属性
      domAttrs: {
        id: wv.id,
        partition: wv.getAttribute('partition'),
        webpreferences: wv.getAttribute('webpreferences'),
      },
      // webview 内部属性
      internalAttrs: {
        src: wv.src,
        URL: wv.getURL ? wv.getURL() : 'no getURL',
        // webview tag 的 webPreferences 是 webContents 层面的
        partition: wv.partition,
      },
      // webview tag 是否有 webContents
      hasWebContents: !!wv.getWebContents,
      // 检查 setAttribute 是否能更新 webpreferences
      canSetAttr: (() => {
        try {
          wv.setAttribute('webpreferences', 'allowpopups;javascript=yes');
          return wv.getAttribute('webpreferences');
        } catch (e) {
          return 'error: ' + e.message;
        }
      })(),
    };
  });
  console.log('webview 详细信息:');
  console.log(JSON.stringify(detail, null, 2));

  // 检查 webview-controls.js 是否真的加载了
  const modulesCheck = await panelPage.evaluate(async () => {
    try {
      // 检查模块是否已经初始化
      const wv = document.getElementById('previewWebview');
      // 触发一个 test new-window 事件手动（如果监听器存在，console.log 会执行）
      let listenerWorks = false;
      const testListener = (e) => {
        listenerWorks = true;
        console.log('[Debug] new-window 监听器触发了！URL:', e.url);
        e.preventDefault();
      };
      wv.addEventListener('new-window', testListener);
      // 派发一个 fake 事件
      const fakeEvent = new Event('new-window');
      fakeEvent.url = 'https://test.example.com';
      fakeEvent.preventDefault = () => {};
      wv.dispatchEvent(fakeEvent);
      wv.removeEventListener('new-window', testListener);
      return { listenerWorks, message: listenerWorks ? 'new-window listener 存在' : 'new-window listener 未注册' };
    } catch (e) {
      return { error: e.message };
    }
  });
  console.log('模块检查:', modulesCheck);

  await browser.close();
  console.log('\n=== 完成 ===');
})();
