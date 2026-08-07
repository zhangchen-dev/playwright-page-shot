/**
 * CDP 快速检查：场景管理视图下有什么 dialog
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

  await panelPage.waitForTimeout(1000);

  // 清理 overlay 然后切到管理
  await panelPage.evaluate(() => {
    document.querySelectorAll('.dialog-overlay').forEach((o) => o.remove());
  });
  await panelPage.click('.menu-item[data-view="management"]');
  await panelPage.waitForTimeout(1500);

  const detail = await panelPage.evaluate(() => {
    const overlays = Array.from(document.querySelectorAll('.dialog-overlay'));
    return {
      overlayCount: overlays.length,
      overlays: overlays.map((o) => ({
        title: o.querySelector('.dialog-title')?.textContent,
        desc: o.querySelector('.dialog-desc')?.textContent?.slice(0, 200),
        buttons: Array.from(o.querySelectorAll('button')).map((b) => b.textContent),
      })),
      state: {
        currentView: window.appState?.currentView,
        phase: window.appState?.state?.phase,
        sceneCode: window.appState?.state?.sceneCode,
        mainModulesCount: window.appState?.state?.mainModules?.length || 0,
      },
    };
  });
  console.log(JSON.stringify(detail, null, 2));

  await browser.close();
})();
