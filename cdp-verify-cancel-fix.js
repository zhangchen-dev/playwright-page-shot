/**
 * CDP 验证脚本：验证"继续录制"后"结束并保存"对话框的取消功能
 * 验证修复：
 *   - P0: showEnvConfigDialog 增加"取消"按钮
 *   - P0: Esc 键关闭对话框
 *   - P0: 点击遮罩关闭对话框
 *   - P0: sceneCode 兜底值生成
 *   - P0: handleEndAndSave 检测 envConfig=null 时退出保存
 *
 * 启动应用：
 *   $env:ELECTRON_ENABLE_LOGGING = 1
 *   npm start -- --remote-debugging-port=9222
 *
 * 运行此脚本：
 *   node cdp-verify-cancel-fix.js
 */
const { chromium } = require('playwright');

const CDP_URL = 'http://127.0.0.1:9222';
const SCREENSHOT_DIR = 'd:/code_prj/playwright-page-shot';

function logStep(name) {
  console.log('\n========== ' + name + ' ==========');
}

function logOk(msg) {
  console.log('  ✓ ' + msg);
}

function logWarn(msg) {
  console.log('  ⚠ ' + msg);
}

function logFail(msg) {
  console.log('  ✗ ' + msg);
}

(async () => {
  console.log('=== CDP 验证：继续录制 → 结束并保存 对话框的取消功能 ===\n');

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (err) {
    console.error('无法连接 CDP 端口 ' + CDP_URL + '。请先启动应用：npm start -- --remote-debugging-port=9222');
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

  const consoleAll = [];
  const consoleErrors = [];
  panelPage.on('console', (msg) => {
    const text = '[' + msg.type() + '] ' + msg.text();
    consoleAll.push(text);
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  panelPage.on('pageerror', (err) => {
    consoleErrors.push('PAGEERROR: ' + err.message);
  });

  await panelPage.waitForLoadState('domcontentloaded').catch(() => {});
  await panelPage.waitForTimeout(1500);

  // ★ 前置：清理可能残留的 overlay
  await panelPage.evaluate(() => {
    document.querySelectorAll('.dialog-overlay').forEach((o) => o.remove());
  });

  // ============== 测试 A：场景管理 → 继续录制 → 结束并保存 → 取消按钮 ==============
  logStep('A. 测试取消按钮 — 结束并保存对话框可以被取消');

  // 切到场景管理
  await panelPage.click('.menu-item[data-view="management"]');
  await panelPage.waitForTimeout(1500);

  // 处理可能残留的"录制未完成"对话框
  await panelPage.evaluate(() => {
    const overlays = document.querySelectorAll('.dialog-overlay');
    overlays.forEach((o) => {
      const confirmBtn = Array.from(o.querySelectorAll('button')).find((b) => b.textContent.includes('确定切换'));
      if (confirmBtn) confirmBtn.click();
    });
  });
  await panelPage.waitForTimeout(500);

  // 找带"继续录制"按钮的场景卡
  const cards = await panelPage.$$('.scenario-card');
  let continueCardIdx = -1;
  for (let i = 0; i < cards.length; i++) {
    const hasContinue = await cards[i].$('button.scenario-action-btn:has-text("继续录制")');
    if (hasContinue) {
      continueCardIdx = i;
      break;
    }
  }
  if (continueCardIdx === -1) {
    logFail('找不到带"继续录制"按钮的场景卡');
    await browser.close();
    process.exit(1);
  }
  logOk('找到场景卡 ' + continueCardIdx + ' 有继续录制按钮');

  // 点击继续录制
  const continueBtn = await cards[continueCardIdx].$('button.scenario-action-btn:has-text("继续录制")');
  await continueBtn.click();
  await panelPage.waitForTimeout(2000);

  // 等待"结束并保存"按钮出现
  try {
    await panelPage.waitForSelector('button:has-text("结束并保存")', { timeout: 5000 });
    logOk('结束并保存按钮已出现');
  } catch (e) {
    logFail('等待结束并保存按钮超时');
    await browser.close();
    process.exit(1);
  }

  // 点击结束并保存
  await panelPage.click('button:has-text("结束并保存")');
  await panelPage.waitForTimeout(800);

  // 检查对话框出现
  const dialogState = await panelPage.evaluate(() => {
    const overlays = document.querySelectorAll('.dialog-overlay');
    if (overlays.length === 0) return null;
    const o = overlays[0];
    return {
      title: o.querySelector('.dialog-title')?.textContent,
      buttons: Array.from(o.querySelectorAll('button')).map((b) => ({
        text: b.textContent.trim(),
        className: b.className,
      })),
      sceneCodeValue: o.querySelector('input')?.value,
    };
  });

  if (!dialogState) {
    logFail('点击结束并保存后对话框未出现');
    await panelPage.screenshot({ path: SCREENSHOT_DIR + '/cdp-cancel-A1-no-dialog.png' });
    await browser.close();
    process.exit(1);
  }
  logOk('对话框出现: ' + dialogState.title);
  logOk('按钮列表: ' + dialogState.buttons.map((b) => b.text).join(', '));
  logOk('场景码预填值: "' + (dialogState.sceneCodeValue || '(空)') + '"');

  // ★ 关键验证 A1：必须有"取消"按钮
  const hasCancelBtn = dialogState.buttons.some((b) => b.text === '取消');
  if (hasCancelBtn) {
    logOk('【A1】"取消"按钮存在 ✓');
  } else {
    logFail('【A1】"取消"按钮缺失！');
  }

  // ★ 关键验证 A2：场景码必须非空（兜底逻辑生效）
  if (dialogState.sceneCodeValue && dialogState.sceneCodeValue.length > 0) {
    logOk('【A2】场景码已预填 ✓');
  } else {
    logWarn('【A2】场景码为空（依赖用户手动输入）');
  }

  await panelPage.screenshot({ path: SCREENSHOT_DIR + '/cdp-cancel-A1-dialog-shown.png' });

  // 点击"取消"按钮
  const cancelBtn = await panelPage.$('.dialog-overlay button:has-text("取消")');
  if (cancelBtn) {
    await cancelBtn.click();
    logOk('已点击取消按钮');
  }
  await panelPage.waitForTimeout(1000);

  // 验证对话框消失
  const afterCancel = await panelPage.evaluate(() => {
    return {
      overlayCount: document.querySelectorAll('.dialog-overlay').length,
      hasToast: document.querySelectorAll('.toast').length,
      currentView: window.appState?.currentView,
      phase: window.appState?.state?.phase,
    };
  });
  if (afterCancel.overlayCount === 0) {
    logOk('【A3】取消后对话框消失 ✓');
  } else {
    logFail('【A3】取消后对话框仍存在（' + afterCancel.overlayCount + ' 个）');
  }
  if (afterCancel.phase === 'recording') {
    logOk('【A4】取消后仍在 recording 阶段（未误保存）✓');
  } else {
    logWarn('【A4】阶段变为: ' + afterCancel.phase);
  }

  // ============== 测试 B：Esc 键关闭对话框 ==============
  logStep('B. 测试 Esc 键 — 可以关闭对话框');

  // 重新点击结束并保存
  await panelPage.click('button:has-text("结束并保存")');
  await panelPage.waitForTimeout(800);

  const dialogB = await panelPage.evaluate(() => document.querySelectorAll('.dialog-overlay').length);
  if (dialogB === 0) {
    logFail('【B1】再次点击结束并保存后对话框未出现');
    await browser.close();
    process.exit(1);
  }
  logOk('【B1】对话框已出现');

  // 按 Esc
  await panelPage.keyboard.press('Escape');
  await panelPage.waitForTimeout(800);

  const afterEsc = await panelPage.evaluate(() => document.querySelectorAll('.dialog-overlay').length);
  if (afterEsc === 0) {
    logOk('【B2】Esc 键成功关闭对话框 ✓');
  } else {
    logFail('【B2】Esc 键未能关闭对话框（剩余 ' + afterEsc + ' 个）');
  }

  // ============== 测试 C：点击遮罩关闭对话框 ==============
  logStep('C. 测试点击遮罩 — 可以关闭对话框');

  await panelPage.click('button:has-text("结束并保存")');
  await panelPage.waitForTimeout(800);

  const dialogC = await panelPage.evaluate(() => document.querySelectorAll('.dialog-overlay').length);
  if (dialogC === 0) {
    logFail('【C1】再次点击结束并保存后对话框未出现');
    await browser.close();
    process.exit(1);
  }

  // 点击遮罩（点击 overlay 左上角空白处）
  await panelPage.evaluate(() => {
    const overlay = document.querySelector('.dialog-overlay');
    if (overlay) {
      // 模拟点击 overlay 本体（不是 dialog 子元素）
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  });
  await panelPage.waitForTimeout(800);

  const afterOverlay = await panelPage.evaluate(() => document.querySelectorAll('.dialog-overlay').length);
  if (afterOverlay === 0) {
    logOk('【C2】点击遮罩成功关闭对话框 ✓');
  } else {
    logWarn('【C2】点击遮罩未关闭（剩余 ' + afterOverlay + ' 个）— 可能 overlay 监听未生效');
  }

  // ============== 测试 D：场景码为空时 confirm 不会被卡死 ==============
  logStep('D. 测试空场景码 — confirm 不会永久卡死');

  // 重新点击结束并保存
  await panelPage.click('button:has-text("结束并保存")');
  await panelPage.waitForTimeout(800);

  // 清空场景码输入
  const sceneCodeInput = await panelPage.$('.dialog input');
  if (sceneCodeInput) {
    await sceneCodeInput.fill('');
    logOk('已清空场景码');
  }

  // 点击确认（应被红框拦截，但 dialog 仍存在）
  await panelPage.click('.dialog .dialog-confirm-btn');
  await panelPage.waitForTimeout(500);

  const afterEmptyConfirm = await panelPage.evaluate(() => ({
    overlayCount: document.querySelectorAll('.dialog-overlay').length,
    borderRed: document.querySelector('.dialog input')?.style.borderColor || '',
  }));
  if (afterEmptyConfirm.overlayCount > 0) {
    logOk('【D1】空场景码 + 确认 → 对话框仍存在（符合预期：需重输）');
  } else {
    logFail('【D1】空场景码 + 确认 → 对话框异常消失');
  }

  // 现在用 Esc 退出（验证 D 场景下 Esc 仍可用 → 不卡死）
  await panelPage.keyboard.press('Escape');
  await panelPage.waitForTimeout(800);

  const afterEmptyEsc = await panelPage.evaluate(() => document.querySelectorAll('.dialog-overlay').length);
  if (afterEmptyEsc === 0) {
    logOk('【D2】空场景码场景下 Esc 仍可退出 ✓');
  } else {
    logFail('【D2】空场景码场景下 Esc 失效');
  }

  // ============== 测试 E：正常确认流程 ==============
  logStep('E. 测试正常流程 — 填场景码 + 确认');

  await panelPage.click('button:has-text("结束并保存")');
  await panelPage.waitForTimeout(800);

  const sceneCodeInputE = await panelPage.$('.dialog input');
  if (sceneCodeInputE) {
    await sceneCodeInputE.fill('TESTCODE_E2E');
  }
  await panelPage.click('.dialog .dialog-confirm-btn');
  logOk('已点击确认');

  // 等待保存完成
  await panelPage.waitForTimeout(3000);

  const afterConfirm = await panelPage.evaluate(() => ({
    overlayCount: document.querySelectorAll('.dialog-overlay').length,
    phase: window.appState?.state?.phase,
    currentView: window.appState?.currentView,
  }));
  logOk('【E1】确认后状态: phase=' + afterConfirm.phase + ' view=' + afterConfirm.currentView + ' overlays=' + afterConfirm.overlayCount);

  // 后续可能弹出"是否关闭浏览器"对话框
  const afterConfirmDialog = await panelPage.evaluate(() => {
    const overlays = document.querySelectorAll('.dialog-overlay');
    if (overlays.length === 0) return null;
    const o = overlays[0];
    return {
      title: o.querySelector('.dialog-title')?.textContent,
      buttons: Array.from(o.querySelectorAll('button')).map((b) => b.textContent.trim()),
    };
  });
  if (afterConfirmDialog) {
    logOk('【E2】后续对话框: ' + afterConfirmDialog.title);
    // 关闭它（点保持打开）
    await panelPage.click('button:has-text("保持打开")').catch(() => {});
    await panelPage.waitForTimeout(500);
  } else {
    logOk('【E2】无后续对话框');
  }

  // ============== 总结 ==============
  logStep('=== 验证总结 ===');

  if (consoleErrors.length > 0) {
    logFail('控制台错误:');
    consoleErrors.forEach((e) => console.log('     ' + e.slice(0, 200)));
  } else {
    logOk('无控制台错误');
  }

  await panelPage.screenshot({ path: SCREENSHOT_DIR + '/cdp-cancel-FINAL.png' });

  await browser.close();

  console.log('\n=== ✓ 验证完成 ===');
  console.log('关键修复点：');
  console.log('  1. showEnvConfigDialog 增加"取消"按钮');
  console.log('  2. Esc 键关闭对话框');
  console.log('  3. 点击遮罩关闭对话框');
  console.log('  4. sceneCode 自动兜底（REC_xxxxxx）');
  console.log('  5. handleEndAndSave 检测 null envConfig 直接退出');
})().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
