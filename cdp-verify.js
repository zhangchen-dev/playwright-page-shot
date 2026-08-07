/**
 * CDP 验证脚本（使用 Playwright connectOverCDP）
 * 验证：
 * 1. 菜单改名（场景管理） + 新增（定制演示）
 * 2. 菜单切换保护（录制未完成确认）
 * 3. 浏览器保护（未开浏览器时禁止开始录制）
 * 4. 重录功能
 */
const { chromium } = require('playwright');

(async () => {
  console.log('=== CDP 验证脚本（connectOverCDP）===\n');

  let browser;
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  } catch (err) {
    console.error('无法连接到 CDP:', err.message);
    process.exit(1);
  }

  console.log('已连接到 Electron CDP');

  // 找到主面板渲染进程
  const contexts = browser.contexts();
  let panelPage = null;
  for (const ctx of contexts) {
    for (const page of ctx.pages()) {
      if (page.url().includes('panel.html') || page.url().includes('index.html') || page.url().includes('renderer')) {
        panelPage = page;
        break;
      }
    }
    if (panelPage) break;
  }

  if (!panelPage) {
    // 拿第一个 page
    for (const ctx of contexts) {
      const pages = ctx.pages();
      if (pages.length > 0) {
        panelPage = pages[0];
        break;
      }
    }
  }

  if (!panelPage) {
    console.error('找不到任何 page');
    process.exit(1);
  }

  console.log('Panel page URL:', panelPage.url());

  // 收集 console 错误
  const consoleErrors = [];
  panelPage.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  // 等待页面就绪
  await panelPage.waitForLoadState('domcontentloaded').catch(() => {});
  await panelPage.waitForTimeout(1000);

  // ===== 检查 1：菜单名称 =====
  console.log('\n=== 检查 1: 菜单名称 ===');
  const menuData = await panelPage.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.menu-item')).map((m) => ({
      view: m.dataset.view,
      text: m.querySelector('.menu-text')?.textContent?.trim(),
    }));
    return {
      items,
      middleTitle: document.getElementById('middleTitle')?.textContent,
    };
  });
  console.log('菜单项:', menuData.items);
  console.log('中间列标题:', menuData.middleTitle);

  const hasSceneManagement = menuData.items.some((m) => m.view === 'management' && m.text === '场景管理');
  const hasCustomDemo = menuData.items.some((m) => m.view === 'demo' && m.text === '定制演示');
  const hasRecording = menuData.items.some((m) => m.view === 'recording' && m.text === '页面录制');
  const hasSettings = menuData.items.some((m) => m.view === 'settings' && m.text === '设置');

  console.log(hasSceneManagement ? '✓ 场景管理菜单存在' : '✗ 场景管理菜单不存在');
  console.log(hasCustomDemo ? '✓ 定制演示菜单存在' : '✗ 定制演示菜单不存在');
  console.log(hasRecording ? '✓ 页面录制菜单存在' : '✗ 页面录制菜单不存在');
  console.log(hasSettings ? '✓ 设置菜单存在' : '✗ 设置菜单不存在');

  // 截图：菜单
  await panelPage.screenshot({ path: 'd:/code_prj/playwright-page-shot/cdp-1-menus.png', fullPage: false });
  console.log('截图: cdp-1-menus.png');

  // ===== 检查 2：切换到"定制演示"菜单 =====
  console.log('\n=== 检查 2: 切换到定制演示菜单 ===');
  await panelPage.click('.menu-item[data-view="demo"]');
  await panelPage.waitForTimeout(500);

  const demoData = await panelPage.evaluate(() => ({
    currentView: window.appState?.currentView,
    middleTitle: document.getElementById('middleTitle')?.textContent,
    contentText: document.getElementById('content')?.textContent?.trim().slice(0, 100),
    hasDemoCard: !!document.querySelector('.demo-empty-card'),
  }));
  console.log('定制演示视图:', demoData);
  console.log(demoData.currentView === 'demo' ? '✓ currentView = demo' : '✗ currentView 错误');
  console.log(demoData.middleTitle === '定制演示' ? '✓ 中间列标题 = 定制演示' : '✗ 中间列标题错误');
  console.log(demoData.hasDemoCard ? '✓ 演示卡片渲染成功' : '✗ 演示卡片未渲染');

  await panelPage.screenshot({ path: 'd:/code_prj/playwright-page-shot/cdp-2-demo.png' });
  console.log('截图: cdp-2-demo.png');

  // ===== 检查 3：切换到"场景管理"菜单 =====
  console.log('\n=== 检查 3: 切换到场景管理菜单 ===');
  await panelPage.click('.menu-item[data-view="management"]');
  await panelPage.waitForTimeout(1500);

  const mgmtData = await panelPage.evaluate(() => ({
    currentView: window.appState?.currentView,
    middleTitle: document.getElementById('middleTitle')?.textContent,
    contentSnippet: document.getElementById('content')?.textContent?.trim().slice(0, 100),
  }));
  console.log('场景管理视图:', mgmtData);
  console.log(mgmtData.currentView === 'management' ? '✓ currentView = management' : '✗ currentView 错误');
  console.log(mgmtData.middleTitle === '场景管理' ? '✓ 中间列标题 = 场景管理' : '✗ 中间列标题错误');

  await panelPage.screenshot({ path: 'd:/code_prj/playwright-page-shot/cdp-3-management.png' });
  console.log('截图: cdp-3-management.png');

  // ===== 检查 4：浏览器保护（切到录制视图） =====
  console.log('\n=== 检查 4: 浏览器保护 ===');
  await panelPage.click('.menu-item[data-view="recording"]');
  await panelPage.waitForTimeout(800);

  const bpData = await panelPage.evaluate(() => ({
    currentView: window.appState?.currentView,
    browserLaunched: window.appState?.browserLaunched,
    browserMode: window.appState?.browserMode,
    startBtnExists: !!document.getElementById('startRecordingBtn'),
    startBtnDisabled: document.getElementById('startRecordingBtn')?.disabled,
    startBtnTitle: document.getElementById('startRecordingBtn')?.title,
  }));
  console.log('录制视图状态:', bpData);

  if (bpData.startBtnExists) {
    if (!bpData.browserLaunched) {
      console.log(bpData.startBtnDisabled ? '✓ 浏览器未打开时"开始录制"按钮已禁用' : '✗ 按钮未禁用');
      if (bpData.startBtnTitle) console.log('✓ 按钮 title:', bpData.startBtnTitle);
      else console.log('✗ 按钮 title 为空');
    } else {
      console.log('⚠ 浏览器已打开，跳过保护检查');
    }
  } else {
    console.log('⚠ 录制视图未显示 start 按钮（可能不在 config 阶段）');
  }

  await panelPage.screenshot({ path: 'd:/code_prj/playwright-page-shot/cdp-4-recording-no-browser.png' });
  console.log('截图: cdp-4-recording-no-browser.png');

  // ===== 检查 5：录制未完成确认（如果有正在录制的场景） =====
  console.log('\n=== 检查 5: 录制未完成确认 ===');
  const recState = await panelPage.evaluate(() => ({
    phase: window.appState?.state?.phase,
    isRecording: window.appState?.state?.isRecording,
    reRecordActive: window.appState?.state?.reRecord?.active,
  }));
  console.log('录制状态:', recState);

  // ===== 检查 6：关键状态 =====
  console.log('\n=== 检查 6: 关键状态对象 ===');
  const stateData = await panelPage.evaluate(() => {
    const totalSteps = (window.appState?.state?.mainModules || []).reduce(
      (acc, m) => acc + (m.subModules || []).reduce((a, s) => a + (s.steps?.length || 0), 0),
      0
    );
    return {
      appStateExists: typeof window.appState !== 'undefined',
      stateKeys: window.appState ? Object.keys(window.appState).slice(0, 20) : [],
      browserLaunched: window.appState?.browserLaunched,
      browserMode: window.appState?.browserMode,
      currentView: window.appState?.currentView,
      phase: window.appState?.state?.phase,
      reRecord: window.appState?.state?.reRecord,
      totalSteps,
    };
  });
  console.log('AppState:', JSON.stringify(stateData, null, 2));

  // ===== 检查 7：控制台错误 =====
  console.log('\n=== 检查 7: 控制台错误 ===');
  if (consoleErrors.length > 0) {
    console.log(`✗ 发现 ${consoleErrors.length} 条错误:`);
    consoleErrors.slice(0, 10).forEach((e) => console.log('  -', e.slice(0, 200)));
  } else {
    console.log('✓ 无控制台错误');
  }

  // ===== 检查 8：检查 IPC handlers 和关键方法 =====
  console.log('\n=== 检查 8: 关键方法可访问 ===');
  const methodCheck = await panelPage.evaluate(() => {
    const checks = {
      requestSwitchView: typeof window.requestSwitchView,
      isRecordingUnsaved: typeof window.isRecordingUnsaved,
      openPreview: typeof window.openPreview,
      startReRecord: typeof window.startReRecord,
      confirmAndSaveReRecord: typeof window.confirmAndSaveReRecord,
    };
    return checks;
  });
  console.log('关键方法:', methodCheck);

  await browser.close();
  console.log('\n=== 验证完成 ===');
})().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
