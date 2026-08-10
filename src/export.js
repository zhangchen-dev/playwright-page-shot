/**
 * 文件导出器 - 将录制数据导出为静态 HTML/CSS 文件 + demo_config.json
 * 严格匹配 demo_config.json 格式
 */
const fs = require('fs-extra');
const path = require('path');

class Exporter {
  constructor({ outputDir }) {
    this.outputDir = outputDir;
  }

  /**
   * ★ 健壮的目录准备 — 删除旧目录 + 重新创建（带重试）
   *    Windows 上 fs.mkdir({recursive:true}) 对刚删除的目录可能返回 EPERM（文件系统延迟），
   *    需要重试。同时避免 emptyDir+ensureDir 组合在某些 Electron 环境下的竞态问题。
   */
  async _prepareExportDir(exportDir) {
    // 1. 如果目录已存在，删除整个目录（比 emptyDir 更彻底）
    if (fs.existsSync(exportDir)) {
      try {
        await fs.remove(exportDir);
      } catch (err) {
        console.warn('[Exporter] 删除旧目录失败（继续尝试创建）:', err.message);
      }
    }

    // 2. 创建目录（带重试，应对 Windows 文件系统延迟）
    const maxRetries = 3;
    let lastErr;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await fs.mkdir(exportDir, { recursive: true });
        console.log('[Exporter] 目录已创建:', exportDir);
        return; // 成功
      } catch (err) {
        lastErr = err;
        // EEXIST 表示目录已存在，这是正常的（可能 remove 失败但目录还在）
        if (err.code === 'EEXIST') {
          console.log('[Exporter] 目录已存在，直接使用:', exportDir);
          return;
        }
        // EPERM/EBUSY 可能是 Windows 文件系统延迟，重试
        if (err.code === 'EPERM' || err.code === 'EBUSY') {
          console.warn(`[Exporter] 创建目录失败 (尝试 ${attempt + 1}/${maxRetries}): ${err.code} ${err.message}`);
          await new Promise((r) => setTimeout(r, 300));
          continue;
        }
        // 其他错误直接抛出
        throw err;
      }
    }
    // 重试全部失败，最后检查目录是否已存在（Windows 有时对已存在目录返回 EPERM 而非 EEXIST）
    if (fs.existsSync(exportDir) && fs.statSync(exportDir).isDirectory()) {
      console.log('[Exporter] 重试失败但目录已存在，直接使用:', exportDir);
      return;
    }
    throw lastErr;
  }

  /**
   * 导出完整录制数据
   */
  async exportRecording(recorder) {
    const { mainModules, sceneConfig, resourceBaseUrl, sceneCode } = recorder;

    // ★ 导出目录名优先使用 sceneCode
    const dirName = sceneCode || sceneConfig.sceneName || 'recording';
    const exportDir = path.join(this.outputDir, dirName);

    // ★ 健壮的目录准备：先删除整个目录再重新创建（避免 emptyDir+ensureDir 在 Windows 上的 EPERM 竞态）
    //    Windows 上 fs.mkdir({recursive:true}) 对刚操作的目录可能返回 EPERM，需要重试
    await this._prepareExportDir(exportDir);

    // 收集所有快照
    const allSnapshots = [];
    for (const mainMod of mainModules) {
      for (const subMod of mainMod.subModules) {
        if (subMod.steps) {
          allSnapshots.push(...subMod.steps);
        }
      }
    }

    if (allSnapshots.length === 0) {
      throw new Error('没有可保存的步骤数据');
    }

    // 写入所有步骤文件
    let fileCount = 0;
    for (const snapshot of allSnapshots) {
      // HTML 文件
      await fs.writeFile(path.join(exportDir, snapshot.htmlFile), snapshot.htmlContent, 'utf-8');
      fileCount++;

      // CSS 文件
      await fs.writeFile(path.join(exportDir, snapshot.cssFile), snapshot.cssContent, 'utf-8');
      fileCount++;

      // iframe 文件
      if (snapshot.iframeFiles) {
        for (const iframe of snapshot.iframeFiles) {
          await fs.writeFile(path.join(exportDir, iframe.filename), iframe.content, 'utf-8');
          fileCount++;

          if (iframe.cssContent && iframe.cssContent.trim()) {
            await fs.writeFile(path.join(exportDir, iframe.cssFilename), iframe.cssContent, 'utf-8');
            fileCount++;
          }
        }
      }
    }

    // 写入配置文件（严格匹配 demo_config.json 格式）
    const config = this._buildConfig(recorder);
    await fs.writeFile(path.join(exportDir, 'demo_config.json'), JSON.stringify(config, null, 4), 'utf-8');
    fileCount++;

    // ★ 写入完整录制数据（用于"继续录制"功能）
    const recordingData = {
      sceneConfig: recorder.sceneConfig,
      sceneCode: recorder.sceneCode,
      mainModules: recorder.mainModules,
      currentMainModuleIndex: recorder.currentMainModuleIndex,
      currentSubModuleIndex: recorder.currentSubModuleIndex,
      stepCount: recorder.stepCount,
      environment: recorder.environment,
      envBaseUrl: recorder.envBaseUrl,
    };
    await fs.writeFile(path.join(exportDir, 'recording_data.json'), JSON.stringify(recordingData), 'utf-8');
    fileCount++;

    console.log(`[Exporter] 导出完成: ${fileCount} 个文件保存到 ${exportDir}`);
    return { outputDir: exportDir, fileCount };
  }

  /**
   * 构建配置 JSON — 严格匹配 demo_config.json 格式
   */
  _buildConfig(recorder) {
    const { sceneConfig, mainModules, resourceBaseUrl, environment, envBaseUrl, sceneCode } = recorder;
    // ★ 使用 sceneCode 作为 code（替代 sceneName）
    const code = sceneCode || sceneConfig.sceneName || 'demonstrationCaseCode';
    // ★ S3 网关固定地址（url 数组第二元素）
    const s3Gateway = 'https://s3gw.paas.cmbchina.cn';

    // 构建顶层对象
    const topObject = {
      demonstrationCode: code,
      outlineCode: code,
      demonstrationCaseCode: code,
      extraInfo: JSON.stringify({
        title: '',
        subTitle: sceneConfig.sceneSubTitle || '',
        headerBlock: sceneConfig.sceneTitle || '',
      }),
      outlineOrder: 1,
      coordinateInfo: JSON.stringify({
        showNextStep: true,
        isThirdDomain: true,
      }),
      stepModuleConfigs: [],
    };

    // 遍历模块
    for (const mainMod of mainModules) {
      const moduleConfig = {
        outlineCode: code,
        moduleTitle: mainMod.mainModuleName || '',
        moduleInfo: JSON.stringify({
          desc: mainMod.mainModuleDesc || '',
          module_type: 'enterprise',
        }),
        outlineDetailResponses: [],
      };

      // 遍历主步骤
      for (const subMod of mainMod.subModules) {
        if (!subMod.steps || subMod.steps.length === 0) continue;

        const detailResponse = {
          stepTitle: subMod.mainStepTitle || '',
          stepOrder: moduleConfig.outlineDetailResponses.length + 1,
          introduction: subMod.introduction
            ? JSON.stringify({
                question: subMod.introduction.question || '',
                answer: subMod.introduction.answer || '',
              })
            : null,
          guideComponentList: [],
        };

        // 遍历步骤中的标记
        let stepOrderInModule = 0;
        for (const snapshot of subMod.steps) {
          const marks = snapshot.marks || [];
          for (const mark of marks) {
            stepOrderInModule++;

            // 构建 selector JSON 字符串
            const selectorObj = {
              placeClassStyle: 'border: 2px dashed #fd8d22;',
              placeSelector: '#' + (mark.elementId || ''),
              clickSelector: '#' + (mark.elementId || ''),
            };
            if (mark.showNextStep !== undefined) {
              selectorObj.showNextStep = !!mark.showNextStep;
            }
            // 最后一个步骤的最后一个标记设为 isAutoNextStep
            if (stepOrderInModule === marks.length && snapshot.isEndRecording) {
              selectorObj.isAutoNextStep = true;
            }

            // ★ 构建 url 数组（双元素：[HTML地址, S3网关地址]）
            let htmlUrl;
            if (environment === 'local' || !envBaseUrl) {
              // 本地：相对路径
              htmlUrl = './' + snapshot.htmlFile;
            } else {
              // 远端：envBaseUrl + sceneCode + / + filename
              const base = envBaseUrl.endsWith('/') ? envBaseUrl : envBaseUrl + '/';
              const sc = sceneCode || '';
              htmlUrl = base + sc + '/' + snapshot.htmlFile;
            }

            const guideComponent = {
              guideCode: code,
              url: [htmlUrl, s3Gateway], // ★ 双元素数组
              title: mark.subTitle || null,
              mainTitle: mark.mainTitle || '',
              position: mark.position || 'right',
              selector: JSON.stringify(selectorObj),
              extendData: null,
              img: [],
            };

            detailResponse.guideComponentList.push(guideComponent);
          }
        }

        if (detailResponse.guideComponentList.length > 0) {
          moduleConfig.outlineDetailResponses.push(detailResponse);
        }
      }

      if (moduleConfig.outlineDetailResponses.length > 0) {
        topObject.stepModuleConfigs.push(moduleConfig);
      }
    }

    return [topObject];
  }
}

module.exports = { Exporter };
