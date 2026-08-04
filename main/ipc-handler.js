/**
 * IPC 消息处理 - 面板↔录制器通信中转
 */
const { ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');

function setupIpc({ recorder, browserManager, panelWindowGetter, credStore }) {
  // ===== 录制操作（统一入口） =====
  ipcMain.handle('recorder-action', async (event, { type, ...msg }) => {
    try {
      const result = await recorder.handleAction(type, msg);
      return result?.response || null;
    } catch (err) {
      console.error('[IPC] recorder-action 失败:', err);
      return { type: 'error', message: err.message };
    }
  });

  // ===== 元素选择 =====
  ipcMain.handle('enable-selection-mode', async (event) => {
    try {
      await browserManager.enableSelectionMode();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('disable-selection-mode', async (event) => {
    try {
      await browserManager.disableSelectionMode();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ===== 页面操作 =====
  ipcMain.handle('get-active-page-url', async (event) => {
    const active = browserManager.getActivePage();
    return active ? active.url : null;
  });

  ipcMain.handle('navigate-to', async (event, url) => {
    try {
      if (!browserManager.isLaunched()) {
        await browserManager.launch(url);
        return { success: true, justLaunched: true };
      }

      const active = browserManager.getActivePage();
      if (active && active.page) {
        await active.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        return { success: true };
      }
      return { success: false, error: '没有活跃页面' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ★ 获取所有标签页（含焦点标识）
  ipcMain.handle('get-all-pages', async (event) => {
    const activePageId = browserManager._activePageId;
    return browserManager.getAllPages().map((p) => ({
      pageId: p.pageId,
      url: p.url,
      isActive: p.pageId === activePageId,
    }));
  });

  // ★ 手动切换焦点页面
  ipcMain.handle('set-active-page', async (event, pageId) => {
    browserManager.setActivePageId(pageId);
    return { success: true };
  });

  // ===== 保存目录选择 =====
  ipcMain.handle('select-save-directory', async (event) => {
    const win = panelWindowGetter();
    const result = await dialog.showOpenDialog(win, {
      title: '选择保存目录',
      properties: ['createDirectory', 'openDirectory'],
      defaultPath: recorder.outputDir,
    });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  // ===== 设置保存目录 =====
  ipcMain.handle('set-output-dir', async (event, dir) => {
    recorder.outputDir = dir;
    return { success: true };
  });

  // ===== 窗口控制 =====
  ipcMain.handle('minimize-to-tray', async (event) => {
    const win = panelWindowGetter();
    if (win) win.hide();
    return { success: true };
  });

  ipcMain.handle('set-always-on-top', async (event, flag) => {
    const win = panelWindowGetter();
    if (win) win.setAlwaysOnTop(flag);
    return { success: true };
  });

  // ===== 检查浏览器是否已启动 =====
  ipcMain.handle('is-browser-launched', async (event) => {
    return browserManager.isLaunched();
  });

  // ===== ★ 窗口尺寸控制（用于应用内预览模式） =====
  ipcMain.handle('resize-window', async (event, width) => {
    const win = panelWindowGetter();
    if (!win) return { success: false };

    // ★ 最大化时不强制改尺寸，由 flex 布局自适应
    if (win.isMaximized()) return { success: true, maximized: true };

    const { screen } = require('electron');
    const display = screen.getDisplayNearestPoint(win.getBounds());
    const screenWidth = display.workAreaSize.width;

    const [, currentHeight] = win.getSize();
    const [, currentY] = win.getPosition();
    const newX = Math.max(0, screenWidth - width - 10);

    win.setBounds({ x: newX, y: currentY, width, height: currentHeight });
    return { success: true };
  });

  // ===== ★ 获取上次导出的第一个 HTML 文件路径（用于应用内预览） =====
  ipcMain.handle('preview-export', async (event) => {
    try {
      const exportDir = recorder.lastExportDir;
      if (!exportDir || !fs.existsSync(exportDir)) {
        return { success: false, error: '没有可预览的导出文件，请先完成一次录制并保存' };
      }

      const files = fs.readdirSync(exportDir);
      const htmlFiles = files.filter((f) => f.endsWith('.html')).sort();
      if (htmlFiles.length === 0) {
        return { success: false, error: '导出目录中没有 HTML 文件' };
      }

      const firstHtml = path.join(exportDir, htmlFiles[0]);
      return { success: true, filePath: firstHtml };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ===== ★ 预览指定 HTML 文件（返回文件路径，由渲染进程 webview 加载） =====
  ipcMain.handle('preview-html-file', async (event, filePath) => {
    try {
      if (!filePath || !fs.existsSync(filePath)) {
        return { success: false, error: '文件不存在: ' + filePath };
      }
      return { success: true, filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ===== ★ 凭证管理 IPC =====

  // 获取当前域名已保存的凭证列表（不含密码明文，用于 UI 展示）
  ipcMain.handle('get-credentials', (event, domain) => {
    try {
      if (!credStore) return [];
      return credStore.getCredentials(domain);
    } catch (err) {
      console.error('[IPC] get-credentials 失败:', err);
      return [];
    }
  });

  // 获取指定域名 + 用户名的完整凭证（含解密密码，用于自动填充）
  ipcMain.handle('get-credential', (event, { domain, username }) => {
    try {
      if (!credStore) return null;
      return credStore.getCredential(domain, username);
    } catch (err) {
      console.error('[IPC] get-credential 失败:', err);
      return null;
    }
  });

  // 填充凭证到当前页面登录表单
  ipcMain.handle('fill-credentials', async (event, { username, password }) => {
    try {
      const result = await browserManager.fillCredentials(username, password);
      return { success: result };
    } catch (err) {
      console.error('[IPC] fill-credentials 失败:', err);
      return { success: false, error: err.message };
    }
  });

  // 保存凭证（新增或更新）
  ipcMain.handle('save-credential', (event, { domain, username, password }) => {
    try {
      if (!credStore) return { success: false, error: '凭证存储未初始化' };
      credStore.saveCredential(domain, username, password);
      return { success: true };
    } catch (err) {
      console.error('[IPC] save-credential 失败:', err);
      return { success: false, error: err.message };
    }
  });

  // 删除凭证
  ipcMain.handle('delete-credential', (event, { domain, username }) => {
    try {
      if (!credStore) return { success: false, error: '凭证存储未初始化' };
      credStore.deleteCredential(domain, username);
      return { success: true };
    } catch (err) {
      console.error('[IPC] delete-credential 失败:', err);
      return { success: false, error: err.message };
    }
  });

  // 获取所有域名的凭证（用于凭证管理 UI）
  ipcMain.handle('get-all-credentials', (event) => {
    try {
      if (!credStore) return [];
      return credStore.getAllDomains();
    } catch (err) {
      console.error('[IPC] get-all-credentials 失败:', err);
      return [];
    }
  });

  // ===== ★ 获取已录制的导出列表（扫描输出目录） =====
  ipcMain.handle('get-recorded-exports', async (event) => {
    try {
      const outputDir = recorder.outputDir;
      if (!outputDir || !fs.existsSync(outputDir)) {
        return { success: true, exports: [] };
      }

      const entries = fs.readdirSync(outputDir, { withFileTypes: true });
      const exportsList = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const exportDir = path.join(outputDir, entry.name);
        const configPath = path.join(exportDir, 'demo_config.json');
        if (!fs.existsSync(configPath)) continue;

        let sceneTitle = entry.name;
        let sceneSubTitle = '';
        const stepInfoMap = new Map();

        // 解析 demo_config.json 获取步骤信息
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          if (Array.isArray(config) && config.length > 0) {
            const extraInfo = JSON.parse(config[0].extraInfo || '{}');
            sceneTitle = extraInfo.headerBlock || entry.name;
            sceneSubTitle = extraInfo.subTitle || '';

            for (const module of (config[0].stepModuleConfigs || [])) {
              for (const detail of (module.outlineDetailResponses || [])) {
                for (const guide of (detail.guideComponentList || [])) {
                  const url = guide.url && guide.url[0];
                  if (!url) continue;
                  const filename = url.split('/').pop();
                  if (!stepInfoMap.has(filename)) {
                    stepInfoMap.set(filename, {
                      moduleTitle: module.moduleTitle || '',
                      stepTitle: detail.stepTitle || '',
                      mainTitle: guide.mainTitle || '',
                    });
                  } else {
                    const existing = stepInfoMap.get(filename);
                    existing.mainTitle += ', ' + (guide.mainTitle || '');
                  }
                }
              }
            }
          }
        } catch (e) {
          // config 解析失败，仅列出 HTML 文件
        }

        const htmlFiles = fs.readdirSync(exportDir)
          .filter((f) => f.endsWith('.html'))
          .sort()
          .map((f, idx) => {
            const info = stepInfoMap.get(f) || {};
            return {
              filename: f,
              filePath: path.join(exportDir, f),
              index: idx + 1,
              moduleTitle: info.moduleTitle || '',
              stepTitle: info.stepTitle || '',
              mainTitle: info.mainTitle || '',
            };
          });

        exportsList.push({
          dirName: entry.name,
          dirPath: exportDir,
          sceneTitle,
          sceneSubTitle,
          stepCount: htmlFiles.length,
          htmlFiles,
        });
      }

      // 按修改时间倒序排列（最新的在前）
      exportsList.sort((a, b) => {
        try {
          return fs.statSync(b.dirPath).mtimeMs - fs.statSync(a.dirPath).mtimeMs;
        } catch (e) {
          return 0;
        }
      });

      return { success: true, exports: exportsList };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ===== ★ 删除录制场景 =====
  ipcMain.handle('delete-recording', async (event, dirPath) => {
    try {
      const recordingsRoot = path.resolve(recorder.outputDir);
      const resolved = path.resolve(dirPath);
      // 安全校验：必须在 recordings 目录内
      if (!resolved.startsWith(recordingsRoot + path.sep)) {
        return { success: false, error: '非法路径' };
      }
      await fs.promises.rm(resolved, { recursive: true, force: true });
      return { success: true };
    } catch (err) {
      console.error('[IPC] delete-recording 失败:', err);
      return { success: false, error: err.message };
    }
  });

  // ===== ★ 下载录制场景（拷贝文件夹到用户选择的位置） =====
  ipcMain.handle('download-recording', async (event, dirPath) => {
    try {
      const win = panelWindowGetter();
      const result = await dialog.showOpenDialog(win, {
        title: '选择下载保存位置',
        properties: ['createDirectory', 'openDirectory'],
      });
      if (result.canceled) return { success: false, canceled: true };

      const destRoot = result.filePaths[0];
      const scenarioName = path.basename(dirPath);
      const dest = path.join(destRoot, scenarioName);

      await fs.promises.mkdir(dest, { recursive: true });
      await fs.promises.cp(dirPath, dest, { recursive: true });
      return { success: true, destination: dest };
    } catch (err) {
      console.error('[IPC] download-recording 失败:', err);
      return { success: false, error: err.message };
    }
  });

  // ===== ★ 上传录制场景（HTML/CSS + 转换后的 JSON 配置） =====
  ipcMain.handle('upload-recording', async (event, dirPath) => {
    try {
      const { transformConfig } = require('../src/config-transformer');

      // 1. 读取目录中所有 HTML 和 CSS 文件
      const files = fs.readdirSync(dirPath);
      const htmlCssFiles = files.filter((f) => f.endsWith('.html') || f.endsWith('.css'));

      // 2. 读取并转换 demo_config.json
      const configPath = path.join(dirPath, 'demo_config.json');
      let transformedConfig = null;
      if (fs.existsSync(configPath)) {
        const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        transformedConfig = transformConfig(rawConfig); // ★ 转换方法（目前原样返回）
      }

      // 3. TODO: 上传 HTML/CSS 文件到资源接口（接口地址待定）
      //    const UPLOAD_RESOURCE_API = ''; // 待配置
      //    await uploadFiles(htmlCssFiles, dirPath, UPLOAD_RESOURCE_API);

      // 4. TODO: 上传转换后的 JSON 配置到配置接口（接口地址待定）
      //    const UPLOAD_CONFIG_API = ''; // 待配置
      //    await uploadConfig(transformedConfig, UPLOAD_CONFIG_API);

      console.log('[IPC] upload-recording 占位完成: %d 个文件, 配置=%s',
        htmlCssFiles.length, transformedConfig ? '已转换' : '无');

      return {
        success: true,
        fileCount: htmlCssFiles.length,
        configUploaded: !!transformedConfig,
        message: '上传功能待接口配置（当前为占位实现）',
      };
    } catch (err) {
      console.error('[IPC] upload-recording 失败:', err);
      return { success: false, error: err.message };
    }
  });

  // ===== ★ 获取应用录制存储目录 =====
  ipcMain.handle('get-app-recordings-dir', async (event) => {
    return recorder.outputDir;
  });

  console.log('[IPC] 处理器已注册');
}

module.exports = { setupIpc };
