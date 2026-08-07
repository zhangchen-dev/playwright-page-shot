/**
 * 检查页面初始内容
 */
const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const contexts = browser.contexts();
    const pages = contexts.length > 0 ? await contexts[0].pages() : [];
    const page = pages[0];

    const content = await page.evaluate(() => {
      return {
        bodyText: document.body?.textContent?.trim().substring(0, 200) || '',
        contentEl: document.getElementById('content')?.innerHTML?.substring(0, 500) || '',
        sectionBoxCount: document.querySelectorAll('.section-box').length,
        inputCount: document.querySelectorAll('input').length,
        inputIds: Array.from(document.querySelectorAll('input')).map(i => i.id || i.className),
      };
    });
    console.log(JSON.stringify(content, null, 2));

    await page.screenshot({ path: 'd:\\code_prj\\playwright-page-shot\\initial-state.png' });
    console.log('📸 初始截图已保存');

    await browser.close();
  } catch (err) {
    console.error('❌ 失败:', err.message);
  }
})();
