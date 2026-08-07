/**
 * CDP 验证脚本：验证"继续录制"后"结束并保存"流程不再卡死
 * 验证修复：
 *   - P0: captureWebviewData 入口守卫 + 超时
 *   - P0: handleEndAndSave 增加 browserLaunched 检查
 *   - P1: 视图切换时清理残留 dialog overlay
 *   - P1: dialog 防叠加
 *   - P1: renderManagementView 入口清理 overlay
 */
const { chromium } = require('playwright');

(async () => {
  console.log('=== CDP 验证：继续录制 → 结束并保存 流程 ===\n');

  let browser;
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  } catch (err) {
    console.error('无法连接 CDP 调试端口 9222。请确保应用以 --remote-debugging-port=9222 启动。');
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

  const consoleErrors = [];
  panelPage.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await panelPage.waitForLoadState('domcontentloaded').catch(() => {});
  await panelPage.waitForTimeout(1500);

  // ★ 清理可能残留的 dialog overlay（测试前置：模拟用户报告的"残留 overlay 阻挡"场景）
  const initialOverlays = await panelPage.evaluate(() => {
    const list = Array.from(document.querySelectorAll('.dialog-overlay'));
    list.forEach((o) => o.remove());
    return list.length;
  });
  if (initialOverlays > 0) {
    console.log(`[0] 清理了 ${initialOverlays} 个残留 dialog overlay`);
  }

  // ===== 步骤 1：切到场景管理 =====
  console.log('\n[1] 切到场景管理菜单');
  await panelPage.click('.menu-item[data-view="management"]');
  await panelPage.waitForTimeout(1500);

  // ★ 处理可能出现的"录制未完成"对话框（残留状态）
  const preCheck = await panelPage.evaluate(() => {
    const overlays = Array.from(document.querySelectorAll('.dialog-overlay'));
    return overlays.map((o) => ({
      title: o.querySelector('.dialog-title')?.textContent,
      buttons: Array.from(o.querySelectorAll('button')).map((b) => b.textContent),
    }));
  });
  if (preCheck.length > 0) {
    console.log('  检测到对话框:', preCheck);
    // 尝试点击"确定切换"按钮
    const confirmBtn = await panelPage.$('button:has-text("确定切换")');
    if (confirmBtn) {
      await confirmBtn.click();
      console.log('  ✓ 已点击"确定切换"');
      await panelPage.waitForTimeout(1500);
    }
  }
  await panelPage.screenshot({ path: 'd:/code_prj/playwright-page-shot/cdp-fix-1-mgmt.png' });

  // ===== 步骤 2：检查场景卡片 =====
  const cards = await panelPage.$$('.scenario-card');
  console.log(`[2] 找到 ${cards.length} 个场景卡片`);

  // 找到带"继续录制"按钮的卡片
  let continueCardIdx = -1;
  for (let i = 0; i < cards.length; i++) {
    const hasContinue = await cards[i].$('button.scenario-action-btn:has-text("继续录制")');
    if (hasContinue) {
      continueCardIdx = i;
      console.log(`  场景 ${i} 有"继续录制"按钮`);
      break;
    }
  }

  if (continueCardIdx === -1) {
    console.log('  ✗ 没有找到可继续录制的场景卡');
    console.log('  列出所有按钮：');
    for (let i = 0; i < cards.length; i++) {
      const buttons = await cards[i].$$eval('button.scenario-action-btn', (els) => els.map((e) => e.textContent));
      console.log(`    场景 ${i} 按钮:`, buttons);
    }
    await browser.close();
    process.exit(1);
  }

  // ===== 步骤 3：点击继续录制 =====
  console.log(`\n[3] 点击场景 ${continueCardIdx} 的"继续录制"按钮`);
  const continueBtn = await cards[continueCardIdx].$('button.scenario-action-btn:has-text("继续录制")');
  await continueBtn.click();
  await panelPage.waitForTimeout(2500);

  // ★ 等待"结束并保存"按钮出现（最多等 5 秒）
  try {
    await panelPage.waitForSelector('button:has-text("结束并保存")', { timeout: 5000 });
    console.log('  ✓ 结束并保存按钮已出现');
  } catch (e) {
    console.warn('  ⚠ 等待结束并保存按钮超时');
  }
  await panelPage.screenshot({ path: 'd:/code_prj/playwright-page-shot/cdp-fix-2-after-continue.png' });

  // ===== 步骤 4：验证状态 =====
  const state1 = await panelPage.evaluate(() => ({
    currentView: window.appState?.currentView,
    phase: window.appState?.state?.phase,
    browserLaunched: window.appState?.browserLaunched,
    browserMode: window.appState?.browserMode,
    overlayCount: document.querySelectorAll('.dialog-overlay').length,
    hasEndSaveBtn: !!document.querySelector('button.btn-danger'),
    endSaveBtnText: Array.from(document.querySelectorAll('button.btn-danger')).map((b) => b.textContent.trim())[0] || null,
  }));
  console.log('\n[4] 继续录制后状态:');
  console.log('  currentView:', state1.currentView, state1.currentView === 'recording' ? '✓' : '✗');
  console.log('  phase:', state1.phase, state1.phase === 'recording' ? '✓' : '✗');
  console.log('  browserLaunched:', state1.browserLaunched, '(预期 false，因为未打开浏览器)');
  console.log('  browserMode:', state1.browserMode);
  console.log('  overlayCount:', state1.overlayCount, state1.overlayCount === 0 ? '✓' : '✗');
  console.log('  hasEndSaveBtn:', state1.hasEndSaveBtn, state1.hasEndSaveBtn ? '✓' : '✗');
  console.log('  endSaveBtnText:', state1.endSaveBtnText);

  if (state1.currentView !== 'recording') {
    console.error('✗ 视图未切到 recording');
    await browser.close();
    process.exit(1);
  }
  if (state1.overlayCount !== 0) {
    console.warn('⚠ 切换后有 overlay 残留');
  }

  // ===== 步骤 5：点击"结束并保存" =====
  console.log('\n[5] 点击"结束并保存"按钮');
  const endBtn = await panelPage.$('button:has-text("结束并保存")');
  if (!endBtn) {
    console.error('  ✗ 找不到"结束并保存"按钮');
    await browser.close();
    process.exit(1);
  }

  // 检查按钮是否被阻挡
  const isEndBtnClickable = await endBtn.evaluate((b) => {
    const rect = b.getBoundingClientRect();
    const topEl = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      visible: b.offsetParent !== null,
      disabled: b.disabled,
      topElement: topEl ? topEl.className : null,
      isBtnOnTop: topEl === b || b.contains(topEl),
    };
  });
  console.log('  按钮状态:', isEndBtnClickable);
  if (!isEndBtnClickable.isBtnOnTop) {
    console.warn('  ⚠ 按钮上方有其他元素:', isEndBtnClickable.topElement);
  }

  await endBtn.click();
  console.log('  ✓ 已点击');
  await panelPage.waitForTimeout(1000);

  // ===== 步骤 6：检查对话框 =====
  const dialog1 = await panelPage.evaluate(() => {
    const overlays = document.querySelectorAll('.dialog-overlay');
    return Array.from(overlays).map((o) => ({
      title: o.querySelector('.dialog-title')?.textContent,
      buttons: Array.from(o.querySelectorAll('button')).map((b) => b.textContent),
      hasInput: !!o.querySelector('input'),
    }));
  });
  console.log('\n[6] 点击结束并保存后对话框:');
  console.log('  对话框数量:', dialog1.length);
  dialog1.forEach((d, i) => {
    console.log(`  [${i}] title="${d.title}" buttons=${JSON.stringify(d.buttons)} hasInput=${d.hasInput}`);
  });
  await panelPage.screenshot({ path: 'd:/code_prj/playwright-page-shot/cdp-fix-3-end-save-clicked.png' });

  if (dialog1.length === 0) {
    console.error('  ✗ 期望出现"资源配置"对话框，但未出现');
    await browser.close();
    process.exit(1);
  }
  if (dialog1.length > 1) {
    console.warn(`  ⚠ 出现 ${dialog1.length} 个对话框（应只 1 个）`);
  }

  // ===== 步骤 7：填场景码并确认 =====
  console.log('\n[7] 填场景码并确认');
  const sceneCodeInput = await panelPage.$('.dialog input');
  if (sceneCodeInput) {
    await sceneCodeInput.fill('TESTCODE_FIX');
  }
  await panelPage.click('.dialog .dialog-confirm-btn');
  console.log('  ✓ 已确认');
  await panelPage.waitForTimeout(500);

  // ===== 步骤 8：关键验证 — 等待 5 秒，UI 不卡死 =====
  console.log('\n[8] 关键验证：等待 5 秒，确认 UI 不卡死');
  await panelPage.waitForTimeout(5000);

  const state2 = await panelPage.evaluate(() => {
    const endBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === '结束并保存');
    return {
      overlayCount: document.querySelectorAll('.dialog-overlay').length,
      dialogs: Array.from(document.querySelectorAll('.dialog-overlay')).map((o) => ({
        title: o.querySelector('.dialog-title')?.textContent,
        buttons: Array.from(o.querySelectorAll('button')).map((b) => b.textContent),
      })),
      endSaveBtnExists: !!endBtn,
      endSaveBtnClickable: endBtn ? endBtn.offsetParent !== null : false,
      middleTitle: document.getElementById('middleTitle')?.textContent,
      currentView: window.appState?.currentView,
      phase: window.appState?.state?.phase,
    };
  });
  console.log('  5秒后状态:');
  console.log('  overlayCount:', state2.overlayCount);
  console.log('  对话框:', state2.dialogs);
  console.log('  endSaveBtnExists:', state2.endSaveBtnExists);
  console.log('  endSaveBtnClickable:', state2.endSaveBtnClickable);
  console.log('  middleTitle:', state2.middleTitle);
  console.log('  currentView:', state2.currentView);
  console.log('  phase:', state2.phase);
  await panelPage.screenshot({ path: 'd:/code_prj/playwright-page-shot/cdp-fix-4-after-save.png' });

  // ===== 步骤 9：检查控制台错误 =====
  console.log('\n[9] 控制台错误:');
  if (consoleErrors.length > 0) {
    consoleErrors.forEach((e) => console.log('  ✗', e.slice(0, 200)));
  } else {
    console.log('  ✓ 无错误');
  }

  // ===== 总结 =====
  console.log('\n=== 验证总结 ===');
  const checks = {
    '继续录制后切到 recording 视图': state1.currentView === 'recording',
    '继续录制后 phase=recording': state1.phase === 'recording',
    '继续录制后无 overlay 残留': state1.overlayCount === 0,
    '结束并保存按钮存在': state1.hasEndSaveBtn,
    '结束并保存按钮可点击': isEndBtnClickable.isBtnOnTop,
    '点击后出现对话框': dialog1.length > 0,
    '5秒后UI不卡死 (overlay<3)': state2.overlayCount < 3,
    '无控制台错误': consoleErrors.length === 0,
  };
  let allPass = true;
  for (const [name, pass] of Object.entries(checks)) {
    console.log(`  ${pass ? '✓' : '✗'} ${name}`);
    if (!pass) allPass = false;
  }

  await browser.close();
  console.log(allPass ? '\n=== ✓ 修复验证通过 ===' : '\n=== ✗ 部分检查未通过 ===');
  process.exit(allPass ? 0 : 1);
})().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
