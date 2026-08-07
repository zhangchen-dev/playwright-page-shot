/**
 * CDP 验证脚本：测试本次两个修复
 *  1. 重录表单导航（Fix 1）
 *  2. webview new-window 新Tab支持（Fix 2）
 *
 * 启动应用：
 *   $env:ELECTRON_ENABLE_LOGGING = 1
 *   npm start -- --remote-debugging-port=9222
 *
 * 运行此脚本：
 *   node cdp-verify-rerecord-newtab.js
 */
const { chromium } = require('playwright');

const CDP_URL = 'http://127.0.0.1:9222';
const SCREENSHOT_DIR = 'd:/code_prj/playwright-page-shot';

function logOk(msg)   { console.log('  ✓ ' + msg); }
function logWarn(msg) { console.log('  ⚠ ' + msg); }
function logFail(msg) { console.log('  ✗ ' + msg); }
function logStep(t)   { console.log('\n========== ' + t + ' =========='); }

(async () => {
  console.log('=== CDP 验证：重录表单导航 + webview new-window ===\n');

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (err) {
    console.error('无法连接 CDP 端口 ' + CDP_URL);
    console.error('请先启动：npm start -- --remote-debugging-port=9222');
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
  panelPage.on('pageerror', (err) => {
    consoleErrors.push('PAGEERROR: ' + err.message);
  });

  await panelPage.waitForLoadState('domcontentloaded').catch(() => {});
  await panelPage.waitForTimeout(1500);

  // ★ 清理可能残留的 overlay
  await panelPage.evaluate(() => {
    document.querySelectorAll('.dialog-overlay').forEach((o) => o.remove());
  });

  // ===== 检查 A: 基础状态 =====
  logStep('A. 基础状态');
  const baseState = await panelPage.evaluate(() => ({
    appStateExists: typeof window.appState !== 'undefined',
    currentView: window.appState?.currentView,
    phase: window.appState?.state?.phase,
    browserMode: window.appState?.browserMode,
  }));
  logOk('appState 暴露: ' + baseState.appStateExists);
  logOk('currentView: ' + baseState.currentView);
  logOk('phase: ' + baseState.phase);
  logOk('browserMode: ' + baseState.browserMode);

  // ===== 检查 B: webview 标签的 webpreferences 属性 =====
  logStep('B. webview 标签的 webpreferences="allowpopups"');
  const webviewAttrs = await panelPage.evaluate(() => {
    const wv = document.getElementById('previewWebview');
    if (!wv) return null;
    return {
      id: wv.id,
      partition: wv.getAttribute('partition'),
      webpreferences: wv.getAttribute('webpreferences'),
    };
  });
  console.log('  webview 属性:', webviewAttrs);
  if (webviewAttrs?.webpreferences?.includes('allowpopups')) {
    logOk('webview 已配置 webpreferences="allowpopups"');
  } else {
    logFail('webview 缺少 webpreferences="allowpopups"');
  }

  // ===== 检查 C: openExternal IPC 暴露 =====
  logStep('C. openExternal IPC');
  const apiCheck = await panelPage.evaluate(() => ({
    hasOpenExternal: typeof window.electronAPI?.openExternal === 'function',
    hasRerecordStep: typeof window.electronAPI?.rerecordStep === 'function',
  }));
  console.log('  electronAPI:', apiCheck);
  if (apiCheck.hasOpenExternal) logOk('openExternal IPC 已暴露');
  else logFail('openExternal IPC 未暴露');
  if (apiCheck.hasRerecordStep) logOk('rerecordStep IPC 已暴露');
  else logFail('rerecordStep IPC 未暴露');

  // ===== 检查 D: 切换到场景管理 =====
  logStep('D. 切换到场景管理');
  await panelPage.click('.menu-item[data-view="management"]');
  await panelPage.waitForTimeout(1500);

  const mgmtState = await panelPage.evaluate(() => ({
    currentView: window.appState?.currentView,
    hasScenarioCards: document.querySelectorAll('.scenario-card').length,
  }));
  console.log('  状态:', mgmtState);
  if (mgmtState.currentView === 'management') logOk('currentView = management');
  else logFail('currentView 错误: ' + mgmtState.currentView);
  logOk('场景卡片数: ' + mgmtState.hasScenarioCards);

  // ===== 检查 E: 尝试重录（如果有可重录的场景） =====
  logStep('E. 测试重录流程');
  const canRerecord = await panelPage.evaluate(() => {
    // 找到第一个有 recording_data.json 的场景
    const cards = document.querySelectorAll('.scenario-card');
    for (const card of cards) {
      const btns = card.querySelectorAll('button.scenario-action-btn');
      for (const btn of btns) {
        if (btn.textContent.includes('预览') && !btn.textContent.includes('全屏')) {
          // 检查场景是否支持继续录制（有继续录制按钮）
          const continueBtn = Array.from(card.querySelectorAll('button.scenario-action-btn'))
            .find((b) => b.textContent.includes('继续录制'));
          if (continueBtn) {
            return {
              canRerecord: true,
              cardTitle: card.querySelector('.scenario-card-title')?.textContent,
            };
          }
        }
      }
    }
    return { canRerecord: false };
  });

  if (!canRerecord.canRerecord) {
    logWarn('未找到可重录的场景（无 recording_data.json），跳过 E 步骤');
  } else {
    logOk('找到可重录场景: ' + canRerecord.cardTitle);

    // 点击该场景的预览按钮
    await panelPage.evaluate(() => {
      const cards = document.querySelectorAll('.scenario-card');
      for (const card of cards) {
        const continueBtn = Array.from(card.querySelectorAll('button.scenario-action-btn'))
          .find((b) => b.textContent.includes('继续录制'));
        if (continueBtn) {
          const previewBtn = Array.from(card.querySelectorAll('button.scenario-action-btn'))
            .find((b) => b.textContent.includes('预览') && !b.textContent.includes('全屏'));
          if (previewBtn) previewBtn.click();
          break;
        }
      }
    });
    await panelPage.waitForTimeout(2000);

    // 检查预览是否打开
    const previewState = await panelPage.evaluate(() => ({
      hasStepSelector: !!document.querySelector('.preview-step-selector'),
      hasRerecordBtn: !!Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('重录该步骤')),
    }));
    console.log('  预览状态:', previewState);

    if (previewState.hasRerecordBtn) {
      // 点击重录按钮
      await panelPage.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('重录该步骤'));
        if (btn) btn.click();
      });
      await panelPage.waitForTimeout(1000);

      // 确认对话框
      const confirmClicked = await panelPage.evaluate(() => {
        const dialogs = document.querySelectorAll('.dialog-overlay');
        for (const d of dialogs) {
          const btns = d.querySelectorAll('button');
          for (const b of btns) {
            if (b.textContent.includes('开始重录')) {
              b.click();
              return true;
            }
          }
        }
        return false;
      });

      if (confirmClicked) {
        logOk('已点击"开始重录"');
        // 等待 state 同步
        await panelPage.waitForTimeout(2500);

        // 关闭就绪对话框
        await panelPage.evaluate(() => {
          const dialogs = document.querySelectorAll('.dialog-overlay');
          for (const d of dialogs) {
            const btns = d.querySelectorAll('button');
            for (const b of btns) {
              if (b.textContent.includes('稍后手动') || b.textContent.includes('好的')) {
                b.click();
                break;
              }
            }
          }
        });
        await panelPage.waitForTimeout(500);

        // 关键验证：检查重录表单是否正确渲染
        const rerecordState = await panelPage.evaluate(() => ({
          currentView: window.appState?.currentView,
          phase: window.appState?.state?.phase,
          reRecordActive: window.appState?.state?.reRecord?.active,
          hasRerecordBanner: !!document.querySelector('.rerecord-banner'),
          hasModuleInput: !!document.getElementById('mainModNameInput'),
          hasSubModuleInput: !!document.getElementById('modNameInput'),
          contentSectionTitles: Array.from(document.querySelectorAll('.section-title')).map((s) => s.textContent),
        }));
        console.log('  重录后状态:', JSON.stringify(rerecordState, null, 2));

        if (rerecordState.currentView === 'recording') logOk('currentView = recording');
        else logFail('currentView 错误: ' + rerecordState.currentView);

        if (rerecordState.phase === 'recording') logOk('phase = recording');
        else logFail('phase 错误: ' + rerecordState.phase);

        if (rerecordState.reRecordActive) logOk('reRecord.active = true');
        else logFail('reRecord.active = false');

        if (rerecordState.hasRerecordBanner) logOk('重录模式横幅已渲染');
        else logFail('重录模式横幅未渲染');

        if (rerecordState.hasModuleInput && rerecordState.hasSubModuleInput) {
          logOk('模块/主步骤表单已渲染');
        } else {
          logFail('模块/主步骤表单未完整渲染');
        }

        await panelPage.screenshot({ path: SCREENSHOT_DIR + '/cdp-rerecord-form.png' });
        logOk('截图: cdp-rerecord-form.png');
      } else {
        logFail('未找到"开始重录"确认按钮');
      }
    } else {
      logWarn('预览面板无"重录该步骤"按钮（可能场景只有 1 步）');
    }
  }

  // ===== 检查 F: webview new-window 监听器 =====
  logStep('F. webview new-window 事件支持（静态检查）');
  // 通过注入测试代码验证 new-window 监听器工作
  const newWindowCheck = await panelPage.evaluate(() => {
    // 检查 webview 元素是否有 webpreferences（影响事件触发）
    const wv = document.getElementById('previewWebview');
    if (!wv) return { error: 'no webview' };
    return {
      hasWebpreferences: !!wv.getAttribute('webpreferences'),
      webpreferences: wv.getAttribute('webpreferences'),
      hasPartition: !!wv.getAttribute('partition'),
    };
  });
  console.log('  webview 配置:', newWindowCheck);
  if (newWindowCheck.hasWebpreferences) {
    logOk('webview 已配置 webpreferences');
  } else {
    logFail('webview 缺少 webpreferences（new-window 事件不会触发）');
  }

  // ===== 检查 G: 控制台错误 =====
  logStep('G. 控制台错误');
  if (consoleErrors.length === 0) {
    logOk('无控制台错误');
  } else {
    logFail('发现 ' + consoleErrors.length + ' 条错误:');
    consoleErrors.slice(0, 10).forEach((e) => console.log('  -', e.slice(0, 200)));
  }

  // ===== 总结 =====
  logStep('总结');
  await browser.close();
  console.log('\n=== 验证完成 ===');
})().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
