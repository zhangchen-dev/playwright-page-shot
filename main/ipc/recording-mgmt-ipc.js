/**
 * IPC - 已录制列表 + 删除/下载/上传/同步到生产
 * 从原 ipc-handler.js 拆分
 */
const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

function registerRecordingMgmtIpc({ recorder, panelWindowGetter }) {
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
      const { transformConfig } = require('../../src/config-transformer');

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

  // ===== ★ 同步录制场景到生产环境 =====
  ipcMain.handle('sync-to-prd', async (event, dirPath) => {
    try {
      const recordingsRoot = path.resolve(recorder.outputDir);
      const resolved = path.resolve(dirPath);
      // 安全校验
      if (!resolved.startsWith(recordingsRoot + path.sep)) {
        return { success: false, error: '非法路径' };
      }

      const ENV_URLS = {
        dev: 'https://xft-service-marketing.paas.cmbchina.cn/resource/file/demonstration/',
        prd: 'https://xft-service-marketing.paas.cmbchina.cn/resource/file/demonstration/',
      };

      const originalName = path.basename(resolved);
      const newName = originalName + '_prd_copy';
      const destDir = path.join(recordingsRoot, newName);

      // 如果目标已存在，先删除
      if (fs.existsSync(destDir)) {
        await fs.promises.rm(destDir, { recursive: true, force: true });
      }

      // 拷贝整个目录
      await fs.promises.mkdir(destDir, { recursive: true });
      await fs.promises.cp(resolved, destDir, { recursive: true });

      // 读取 demo_config.json 获取场景码
      const configPath = path.join(destDir, 'demo_config.json');
      let sceneCode = originalName;
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (Array.isArray(config) && config.length > 0) {
          sceneCode = config[0].demonstrationCode || originalName;
        }
      }

      const oldOrigin = ENV_URLS.dev + sceneCode + '/';
      const newOrigin = ENV_URLS.prd + newName + '/';

      // 更新 HTML 文件中的 originName
      const files = fs.readdirSync(destDir);
      for (const file of files) {
        if (file.endsWith('.html')) {
          const filePath = path.join(destDir, file);
          let content = fs.readFileSync(filePath, 'utf-8');
          // 替换 originName 值
          content = content.replace(
            /var originName = "[^"]*";/,
            'var originName = "' + newOrigin + '";'
          );
          fs.writeFileSync(filePath, content, 'utf-8');
        }
      }

      // 更新 demo_config.json 中的 URL
      if (fs.existsSync(configPath)) {
        let configContent = fs.readFileSync(configPath, 'utf-8');
        // 替换所有旧 URL 为新 URL
        configContent = configContent.split(oldOrigin).join(newOrigin);
        // 替换场景码
        configContent = configContent.split('"demonstrationCode": "' + sceneCode + '"')
          .join('"demonstrationCode": "' + newName + '"');
        configContent = configContent.split('"outlineCode": "' + sceneCode + '"')
          .join('"outlineCode": "' + newName + '"');
        configContent = configContent.split('"demonstrationCaseCode": "' + sceneCode + '"')
          .join('"demonstrationCaseCode": "' + newName + '"');
        configContent = configContent.split('"guideCode": "' + sceneCode + '"')
          .join('"guideCode": "' + newName + '"');
        fs.writeFileSync(configPath, configContent, 'utf-8');
      }

      console.log('[IPC] sync-to-prd 完成: %s -> %s', originalName, newName);
      return { success: true, newDirPath: destDir, newName: newName };
    } catch (err) {
      console.error('[IPC] sync-to-prd 失败:', err);
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerRecordingMgmtIpc };
