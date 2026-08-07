/**
 * CDP 调试：检查 recording 视图的 DOM
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

  // 详细收集错误和console输出
  const consoleAll = [];
  const consoleErrors = [];
  panelPage.on('console', (msg) => {
    const text = `[${msg.type()}] ${msg.text()}`;
    consoleAll.push(text);
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  panelPage.on('pageerror', (err) => {
    consoleErrors.push('PAGEERROR: ' + err.message);
  });

  // 切到管理
  await panelPage.evaluate(() => {
    document.querySelectorAll('.dialog-overlay').forEach((o) => o.remove());
  });
  await panelPage.click('.menu-item[data-view="management"]');
  await panelPage.waitForTimeout(1000);

  // 处理录制未完成对话框
  const overlay = await panelPage.$('button:has-text("确定切换")');
  if (overlay) {
    await overlay.click();
    await panelPage.waitForTimeout(1500);
  }

  // 点击继续录制
  const continueBtn = await panelPage.$('button.scenario-action-btn:has-text("继续录制")');
  if (!continueBtn) {
    console.log('找不到继续录制按钮');
    await browser.close();
    return;
  }
  await continueBtn.click();
  await panelPage.waitForTimeout(3000);

  // 详细检查 DOM
  const detail = await panelPage.evaluate(() => {
    const content = document.getElementById('content');
    return {
      middleTitle: document.getElementById('middleTitle')?.textContent,
      contentInnerLength: content?.innerHTML?.length || 0,
      contentPreview: content?.innerHTML?.slice(0, 500) || '',
      sectionTitles: Array.from(content?.querySelectorAll('.section-title') || []).map((s) => s.textContent),
      buttonCount: content?.querySelectorAll('button').length || 0,
      allButtons: Array.from(content?.querySelectorAll('button') || []).slice(0, 10).map((b) => b.textContent.trim().slice(0, 30)),
      allInputs: Array.from(content?.querySelectorAll('input') || []).map((i) => ({ id: i.id, type: i.type })),
      state: {
        currentView: window.appState?.currentView,
        phase: window.appState?.state?.phase,
        mainModulesCount: window.appState?.state?.mainModules?.length || 0,
        currentMainModuleIndex: window.appState?.state?.currentMainModuleIndex,
        currentSubModuleIndex: window.appState?.state?.currentSubModuleIndex,
        sceneCode: window.appState?.state?.sceneCode,
        mainModule0SubCount: window.appState?.state?.mainModules?.[0]?.subModules?.length || 0,
      },
    };
  });
  console.log(JSON.stringify(detail, null, 2));

  if (consoleErrors.length > 0) {
    console.log('\n=== 控制台错误 ===');
    consoleErrors.forEach((e) => console.log('  -', e.slice(0, 300)));
  } else {
    console.log('\n=== 无控制台错误 ===');
  }

  // 打印最近 30 条 console 输出
  console.log('\n=== 最近 console 输出 ===');
  consoleAll.slice(-30).forEach((m) => console.log('  ', m));

  await browser.close();
})();
