/**
 * 验证 antd 风格下拉 + showNextStep 开关 - 修正版
 */
const { chromium } = require('playwright');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const contexts = browser.contexts();
    const pages = contexts.length > 0 ? await contexts[0].pages() : [];
    if (pages.length === 0) {
      console.log('❌ 未找到渲染页面');
      await browser.close();
      return;
    }
    const page = pages[0];
    console.log('✅ 找到页面:', await page.title());

    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // 1. 切换到录制视图
    await page.click('.menu-item[data-view="recording"]');
    await page.waitForTimeout(1500);

    // 检查是否在配置阶段
    const inConfig = await page.$('#sceneTitleInput');
    if (!inConfig) {
      console.log('⚠️ 录制视图无配置阶段输入框，可能已在录制中');
      // 检查是否在录制中
      const inRecording = await page.$('.mark-action-row, .mark-list, .form-field-row');
      if (!inRecording) {
        console.log('❌ 录制视图无任何内容');
        await browser.close();
        return;
      }
      console.log('✅ 在录制中阶段（继续录制）');
    } else {
      // 2. 填充配置 + 开始录制
      await page.fill('#sceneTitleInput', '测试场景');
      await page.fill('#sceneNameInput', 'test-scene');
      await page.fill('#sceneCodeInput', 'TS');
      await page.waitForTimeout(300);
      await page.click('#startRecordingBtn');
      await page.waitForTimeout(2000);
      console.log('✅ 进入录制阶段');
    }

    // 3. 滚动到元素标记 section
    await page.evaluate(() => {
      const titles = document.querySelectorAll('.section-title');
      for (const t of titles) {
        if (t.textContent.includes('元素标记')) {
          t.scrollIntoView({ behavior: 'instant', block: 'start' });
          return;
        }
      }
    });
    await page.waitForTimeout(500);

    // 4. 截图：位置下拉关闭状态
    await page.screenshot({ path: 'd:\\code_prj\\playwright-page-shot\\select-closed.png' });
    console.log('📸 已截图：下拉关闭状态');

    // 5. 点击下拉 trigger 打开
    const trigger = await page.$('.antd-select-trigger');
    if (trigger) {
      await trigger.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: 'd:\\code_prj\\playwright-page-shot\\select-opened.png' });
      console.log('📸 已截图：下拉打开状态');

      // 检查 dropdown
      const dropdownInfo = await page.evaluate(() => {
        const dropdown = document.querySelector('.antd-select-dropdown');
        const options = document.querySelectorAll('.antd-select-option');
        const selected = document.querySelectorAll('.antd-select-option-selected');
        const positionInput = document.getElementById('markPositionSelect');
        return {
          dropdownExists: !!dropdown,
          dropdownDisplay: dropdown?.style.display || '',
          optionCount: options.length,
          optionTexts: Array.from(options).map(o => o.textContent?.trim()),
          selectedCount: selected.length,
          selectedText: selected[0]?.textContent?.trim() || '',
          hiddenValue: positionInput?.value || '',
        };
      });
      console.log('\n📊 下拉信息:');
      console.log(JSON.stringify(dropdownInfo, null, 2));

      // 6. 点击 bottom
      const options = await page.$$('.antd-select-option');
      for (const opt of options) {
        const text = await opt.textContent();
        if (text.includes('bottom')) {
          await opt.hover();
          await page.waitForTimeout(300);
          await page.screenshot({ path: 'd:\\code_prj\\playwright-page-shot\\select-hover.png' });
          console.log('📸 已截图：悬停 bottom');

          await opt.click();
          await page.waitForTimeout(400);
          break;
        }
      }

      // 7. 验证选中后的值
      const afterSelect = await page.evaluate(() => {
        const trigger = document.querySelector('.antd-select-trigger');
        const triggerLabel = trigger?.querySelector('.antd-select-trigger-label')?.textContent || '';
        const triggerIcon = trigger?.querySelector('.antd-select-trigger-icon')?.textContent || '';
        const positionInput = document.getElementById('markPositionSelect');
        const dropdown = document.querySelector('.antd-select-dropdown');
        return {
          triggerLabel,
          triggerIcon,
          hiddenValue: positionInput?.value || '',
          dropdownDisplay: dropdown?.style.display || '',
        };
      });
      console.log('\n📊 选中 bottom 后:');
      console.log(JSON.stringify(afterSelect, null, 2));
      await page.screenshot({ path: 'd:\\code_prj\\playwright-page-shot\\after-select.png' });
      console.log('📸 已截图：选中 bottom 后');
    } else {
      console.log('❌ 未找到 antd-select-trigger');
    }

    // 8. 测试 showNextStep 开关
    const showNextInfo = await page.evaluate(() => {
      const checkbox = document.getElementById('markShowNextStepInput');
      const switchText = document.querySelector('.switch-text');
      const switchControl = document.querySelector('.switch-control');
      return {
        checkboxExists: !!checkbox,
        checkboxChecked: checkbox?.checked || false,
        switchText: switchText?.textContent || '',
        switchControlExists: !!switchControl,
        wrapperHasInput: switchControl?.querySelectorAll('input')?.length || 0,
      };
    });
    console.log('\n📊 showNextStep 开关:');
    console.log(JSON.stringify(showNextInfo, null, 2));

    const checkbox = await page.$('#markShowNextStepInput');
    if (checkbox) {
      await checkbox.click();
      await page.waitForTimeout(300);
      const afterToggle = await page.evaluate(() => {
        const checkbox = document.getElementById('markShowNextStepInput');
        const switchText = document.querySelector('.switch-text');
        return {
          checkboxChecked: checkbox?.checked || false,
          switchText: switchText?.textContent || '',
        };
      });
      console.log('  切换后:', JSON.stringify(afterToggle));
      await page.screenshot({ path: 'd:\\code_prj\\playwright-page-shot\\switch-toggle.png' });
      console.log('📸 已截图：开关切换后');
    }

    if (consoleErrors.length > 0) {
      console.log('\n❌ Console 错误:');
      consoleErrors.forEach(e => console.log('  -', e));
    } else {
      console.log('\n✅ 无 Console 错误');
    }

    await browser.close();
  } catch (err) {
    console.error('❌ 失败:', err.message);
  }
})();
