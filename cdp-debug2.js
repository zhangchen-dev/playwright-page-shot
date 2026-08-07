/**
 * CDP 深度诊断：检查残留 dialog
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

  // 先检查所有 dialog overlay
  const overlays = await panelPage.evaluate(() => {
    const list = Array.from(document.querySelectorAll('.dialog-overlay'));
    return list.map((o) => {
      const d = o.querySelector('.dialog');
      return {
        title: d?.querySelector('.dialog-title')?.textContent,
        desc: d?.querySelector('.dialog-desc')?.textContent?.slice(0, 300),
        inputValues: Array.from(d?.querySelectorAll('input') || []).map((i) => i.value),
        buttons: Array.from(d?.querySelectorAll('button') || []).map((b) => b.textContent),
      };
    });
  });
  console.log('残留的 dialog overlays:', JSON.stringify(overlays, null, 2));

  // 关闭所有 dialog overlay（清理）
  if (overlays.length > 0) {
    console.log('\n清理 dialog overlays...');
    await panelPage.evaluate(() => {
      document.querySelectorAll('.dialog-overlay').forEach((o) => o.remove());
    });
  }

  // 现在重新测试继续录制
  console.log('\n[测试] 点击"继续录制"');
  await panelPage.click('.menu-item[data-view="management"]');
  await panelPage.waitForTimeout(1500);
  await panelPage.click('button.scenario-action-btn:has-text("继续录制")');
  await panelPage.waitForTimeout(2500);

  // 详细检查 DOM
  const detail = await panelPage.evaluate(() => {
    const content = document.getElementById('content');
    return {
      sectionTitles: Array.from(content?.querySelectorAll('.section-title') || []).map((s) => s.textContent),
      buttons: Array.from(content?.querySelectorAll('button') || []).map((b) => b.textContent.trim()),
      inputIds: Array.from(content?.querySelectorAll('input') || []).map((i) => i.id).filter((id) => id),
      middleTitle: document.getElementById('middleTitle')?.textContent,
      activeMenu: document.querySelector('.menu-item.active')?.dataset?.view,
      urlBarDisplay: document.getElementById('urlBar')?.style.display,
      overlays: Array.from(document.querySelectorAll('.dialog-overlay')).length,
    };
  });
  console.log('sectionTitles:', detail.sectionTitles);
  console.log('所有按钮:', detail.buttons);
  console.log('inputIds:', detail.inputIds);
  console.log('middleTitle:', detail.middleTitle);
  console.log('activeMenu:', detail.activeMenu);
  console.log('urlBarDisplay:', detail.urlBarDisplay);
  console.log('overlays:', detail.overlays);

  // 截图
  await panelPage.screenshot({ path: 'd:/code_prj/playwright-page-shot/cdp-clean-debug.png' });

  // 现在尝试点"结束并保存"
  console.log('\n[测试] 找"结束并保存"按钮');
  const endBtn = await panelPage.$('button:has-text("结束并保存")');
  if (endBtn) {
    console.log('  ✓ 找到按钮');
    await endBtn.click();
    console.log('  ✓ 已点击');
    await panelPage.waitForTimeout(2000);
    const newOverlays = await panelPage.evaluate(() => {
      return Array.from(document.querySelectorAll('.dialog-overlay')).map((o) => {
        const d = o.querySelector('.dialog');
        return {
          title: d?.querySelector('.dialog-title')?.textContent,
          buttons: Array.from(d?.querySelectorAll('button') || []).map((b) => b.textContent),
        };
      });
    });
    console.log('点击后 overlays:', newOverlays);
    await panelPage.screenshot({ path: 'd:/code_prj/playwright-page-shot/cdp-end-save-clicked.png' });
  } else {
    console.log('  ✗ 找不到按钮');
  }

  await browser.close();
})().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
