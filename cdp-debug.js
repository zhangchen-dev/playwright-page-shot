/**
 * CDP 深度诊断：检查 continueRecording 后的实际状态
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
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
  if (!panelPage) { console.log('找不到 panel'); process.exit(1); }

  await panelPage.waitForTimeout(1000);

  // 切到场景管理
  await panelPage.click('.menu-item[data-view="management"]');
  await panelPage.waitForTimeout(2000);

  // 点击继续录制
  await panelPage.click('button.scenario-action-btn:has-text("继续录制")');
  await panelPage.waitForTimeout(3000);

  // 详细检查 DOM
  const detail = await panelPage.evaluate(() => {
    const content = document.getElementById('content');
    return {
      // 检查 section titles
      sectionTitles: Array.from(content?.querySelectorAll('.section-title') || []).map((s) => s.textContent),
      // 检查按钮
      allButtons: Array.from(content?.querySelectorAll('button') || []).map((b) => b.textContent.trim()).slice(0, 30),
      // 检查输入框 ID
      inputIds: Array.from(content?.querySelectorAll('input') || []).map((i) => i.id),
      // content 的 innerHTML 前 500 字符
      contentSnippet: content?.innerHTML?.slice(0, 1500),
      // URL 栏是否显示
      urlBarVisible: document.getElementById('urlBar')?.style.display !== 'none',
      // 中间列标题
      middleTitle: document.getElementById('middleTitle')?.textContent,
      // 当前高亮的菜单
      activeMenu: document.querySelector('.menu-item.active')?.dataset?.view,
    };
  });
  console.log('sectionTitles:', detail.sectionTitles);
  console.log('所有按钮:', detail.allButtons);
  console.log('inputIds:', detail.inputIds);
  console.log('urlBarVisible:', detail.urlBarVisible);
  console.log('middleTitle:', detail.middleTitle);
  console.log('activeMenu:', detail.activeMenu);
  console.log('\ncontent HTML 前 1500 字符:');
  console.log(detail.contentSnippet);

  // 看看现在能否点"结束并保存"
  const endBtn = await panelPage.$('button:has-text("结束并保存")');
  console.log('\n"结束并保存"按钮存在:', !!endBtn);

  await panelPage.screenshot({ path: 'd:/code_prj/playwright-page-shot/cdp-debug.png' });

  await browser.close();
})().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
