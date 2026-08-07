/**
 * CDP 复现脚本：继续录制后点"结束并保存"
 */
const { chromium } = require('playwright');

(async () => {
  console.log('=== CDP 复现：继续录制后无法结束 ===\n');

  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');

  // 找主面板
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
    console.log('找不到 panel.html');
    process.exit(1);
  }

  console.log('Panel URL:', panelPage.url());

  const consoleErrors = [];
  panelPage.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await panelPage.waitForLoadState('domcontentloaded').catch(() => {});
  await panelPage.waitForTimeout(1500);

  // 1. 切到场景管理
  console.log('\n[1] 切到场景管理菜单');
  await panelPage.click('.menu-item[data-view="management"]');
  await panelPage.waitForTimeout(1500);

  await panelPage.screenshot({ path: 'd:/code_prj/playwright-page-shot/cdp-repro-1-mgmt.png' });

  // 2. 检查场景卡片
  const cards = await panelPage.$$('.scenario-card');
  console.log(`[2] 找到 ${cards.length} 个场景卡片`);

  // 3. 找到带"继续录制"按钮的卡片（说明 canContinue = true）
  let continueCardIdx = -1;
  for (let i = 0; i < cards.length; i++) {
    const hasContinue = await cards[i].$('button.scenario-action-btn:has-text("继续录制")');
    if (hasContinue) {
      continueCardIdx = i;
      console.log(`[3] 场景 ${i} 有"继续录制"按钮`);
      break;
    }
  }

  if (continueCardIdx === -1) {
    console.log('没有找到可继续录制的场景卡');
    // 列出所有按钮
    for (let i = 0; i < cards.length; i++) {
      const buttons = await cards[i].$$eval('button.scenario-action-btn', (els) => els.map((e) => e.textContent));
      console.log(`  场景 ${i} 按钮:`, buttons);
    }
    process.exit(1);
  }

  // 4. 点击继续录制
  console.log(`[4] 点击场景 ${continueCardIdx} 的"继续录制"按钮`);
  const continueBtn = await cards[continueCardIdx].$('button.scenario-action-btn:has-text("继续录制")');
  await continueBtn.click();
  await panelPage.waitForTimeout(2000);

  await panelPage.screenshot({ path: 'd:/code_prj/playwright-page-shot/cdp-repro-2-after-continue.png' });

  // 5. 检查当前视图和"结束并保存"按钮
  const state = await panelPage.evaluate(() => {
    // 尝试通过各种方式找到"结束并保存"按钮
    const allButtons = Array.from(document.querySelectorAll('button')).map((b) => ({
      text: b.textContent.trim(),
      id: b.id,
      disabled: b.disabled,
      visible: b.offsetParent !== null,
    }));
    return {
      currentView: window.appState?.currentView,
      phase: window.appState?.state?.phase,
      buttons: allButtons,
    };
  });
  console.log('[5] 继续录制后状态:');
  console.log('  currentView:', state.currentView);
  console.log('  phase:', state.phase);
  console.log('  所有按钮:');
  state.buttons.forEach((b) => {
    if (b.text.includes('结束') || b.text.includes('保存') || b.text.includes('录制')) {
      console.log(`    [${b.disabled ? '禁用' : '启用'}] id="${b.id}" text="${b.text}" visible=${b.visible}`);
    }
  });

  // 6. 直接点击"结束并保存"按钮
  console.log('\n[6] 点击"结束并保存"按钮');
  const endBtn = await panelPage.$('button:has-text("结束并保存")');
  if (!endBtn) {
    console.log('  ✗ 找不到"结束并保存"按钮');
  } else {
    const btnInfo = await endBtn.evaluate((b) => ({
      text: b.textContent,
      id: b.id,
      disabled: b.disabled,
      hasClickHandler: !!b.onclick,
    }));
    console.log('  按钮信息:', btnInfo);
    await endBtn.click();
    console.log('  ✓ 已点击');

    // 等待对话框或处理
    await panelPage.waitForTimeout(2000);

    // 7. 检查是否出现对话框
    const dialogInfo = await panelPage.evaluate(() => {
      const overlays = document.querySelectorAll('.dialog-overlay');
      const dialogs = Array.from(overlays).map((o) => {
        const d = o.querySelector('.dialog');
        return {
          title: d?.querySelector('.dialog-title')?.textContent,
          desc: d?.querySelector('.dialog-desc')?.textContent?.slice(0, 200),
          buttons: Array.from(d?.querySelectorAll('button') || []).map((b) => b.textContent),
        };
      });
      return {
        dialogCount: overlays.length,
        dialogs,
        urlInputValue: document.getElementById('urlInput')?.value,
      };
    });
    console.log('\n[7] 点击结束保存后的状态:');
    console.log('  对话框数量:', dialogInfo.dialogCount);
    dialogInfo.dialogs.forEach((d, i) => {
      console.log(`  对话框 ${i}: title="${d.title}" buttons=${JSON.stringify(d.buttons)}`);
      console.log(`    desc: ${d.desc}`);
    });

    await panelPage.screenshot({ path: 'd:/code_prj/playwright-page-shot/cdp-repro-3-end-save-clicked.png' });

    // 8. 关闭对话框（如果有）
    if (dialogInfo.dialogCount > 0) {
      console.log('\n[8] 检查对话框是否可以关闭');
      // 点击 confirm
      const confirmBtn = await panelPage.$('.dialog .dialog-confirm-btn');
      if (confirmBtn) {
        const confirmText = await confirmBtn.textContent();
        console.log(`  准备点击"${confirmText}"按钮`);
        // 不直接点，先看场景码输入框的值
        const sceneCodeVal = await panelPage.$eval('.dialog input', (el) => el.value).catch(() => null);
        console.log(`  场景码输入框值: "${sceneCodeVal}"`);
      }
    }
  }

  // 9. 控制台错误
  console.log('\n[9] 控制台错误:');
  if (consoleErrors.length > 0) {
    consoleErrors.forEach((e) => console.log('  -', e.slice(0, 200)));
  } else {
    console.log('  无错误');
  }

  await browser.close();
  console.log('\n=== 复现完成 ===');
})().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
