/**
 * 地图预览模块（仅预览，绝对不影响导出）
 * ---------------------------------------------------------
 * 将录制的场景配置（recording_data.json）转换成地图静态页（src/map-template，已随项目打包，
 * 不依赖任何外部目录）所需的 MockData 格式，并把录制的步骤页面"作为内容"塞进地图页右侧 iframe 中展示。
 *
 * 关键约束（用户明确要求）：
 *   - 预览时「展示地图」所做的所有修改（内联配置、给步骤 HTML 注入引导引擎 + mock 配置、重排文件名）
 *     一律只写入【系统临时目录】，绝不触碰源录制文件与 recorder 内存数据。
 *   - 因此用户最终「下载 / 导出」时，html 与导出配置仍是原始样子。
 *   - 地图页静态模板（index.html/app.js/styles.css/img）已内置在项目 src/map-template/，
 *     用户下载后功能即齐全，无需任何外部文件或 CDN。
 *
 * 气泡实现方式（用户最新要求）：
 *   - 若真实引擎（招行 xft-help-autouse.js）实在取不到/在沙箱离线场景不稳定，就「按 SDK 渲染样式自己实现气泡」，
 *     且这个自定义气泡【只注入地图预览的临时副本、不进导出 HTML】，对录制内容零语义修改。
 *   - 做法（仅作用于步骤 HTML 的【预览副本】）：
 *       1) 注入一段自实现脚本 + 官方气泡样式，在录制元素旁画出 .xftautouseplugin-tour-guide 气泡；
 *       2) 气泡「下一步」按钮：实际点击录制元素 + postMessage(next-by-click) 驱动地图前进；
 *          点击录制元素本身同样 postMessage(next-by-click)；
 *       3) 不加载任何外部/本地 SDK 引擎，因此 file://、离线、沙箱均能稳定出气泡。
 */
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { resolveRecordingDataPath } = require('./export');

// 地图页静态模板目录（已随项目打包在 src/map-template，不再依赖外部 shot-temp）
const MAP_TEMPLATE_DIR = path.join(__dirname, 'map-template');

// 自定义引导气泡（SDK 风格渲染，预览期注入，不加载外部 SDK / 不进导出 HTML）。
// 背景：录制页（内容 iframe）在地图预览里跑的是「录制 HTML 的预览副本」，直接加载招行 xft-help-autouse.js
//       引擎在沙箱/离线场景不稳定（外部 CDN 被网络策略拦截、file:// 下协议不兼容）。
//       故改为在预览副本里注入一段自实现的引导气泡脚本，复刻 SDK 的 .xftautouseplugin-tour-guide 视觉与交互：
//         - 读本步骤 marks（elementId / mainTitle / subTitle / position）定位录制元素并画气泡；
//         - 气泡「下一步」按钮 + 点击录制元素 → parent.postMessage(iframe-autouse-message / next-by-click) 驱动地图前进；
//       仅注入地图预览临时副本（src/map-preview.js 内部），对录制内容零语义修改，导出仍保持原样。
// 下方 AUTOUSE_BUBBLE_CSS 为从 xft-help-autouse.js 提取的官方气泡样式（蓝色 #1966ff、圆角、小三角箭头、白底下一步按钮）。
const AUTOUSE_BUBBLE_CSS = `.xftautouseplugin-tour-guide {
  width: 220px;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 2000;
  max-width: 400px;
  pointer-events: none;
}
/* 挂载指引的元素高亮（对齐 SDK 的 placeClassStyle: border:2px dashed #fd8d22） */
.autouse-mount-element {
  border: 2px dashed #fd8d22 !important;
}
.xftautouseplugin-tour-guide .tour-guide-container {
  position: relative;
  min-width: 188px;
  padding: 16px;
  color: #fff;
  background: #1966ff;
  border-radius: 6px;
}
.xftautouseplugin-tour-guide .tour-guide-container .tour-guide-header {
  margin: 0 0 16px;
}
.xftautouseplugin-tour-guide .tour-guide-container .tour-guide-header .tour-guide-title {
  color: #fff;
  font-weight: 600;
  font-size: 14px;
  line-height: 20px;
  white-space: pre-wrap;
  word-break: break-all;
  margin-right: 16px;
}
.xftautouseplugin-tour-guide .tour-guide-container .tour-guide-header .tour-guide-subtitle {
  margin-top: 4px;
  color: #fff;
  font-size: 12px;
  line-height: 20px;
}
.xftautouseplugin-tour-guide .tour-guide-container .tour-guide-header .tour-guide-close {
  position: absolute;
  top: 16px;
  right: 16px;
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  pointer-events: all;
}
.xftautouseplugin-tour-guide .tour-guide-container .tour-guide-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.xftautouseplugin-tour-guide .tour-guide-container .tour-guide-footer .tour-guide-finish {
  width: 72px;
  height: 24px;
  margin: 0;
  padding: 0 8px;
  color: #1966ff;
  font-size: 14px;
  line-height: 24px;
  text-align: center;
  background: #fff;
  border-radius: 4px;
  cursor: pointer;
  pointer-events: all;
}
.xftautouseplugin-tour-guide .tour-guide-arrow {
  position: absolute;
  width: 16px;
  height: 16px;
  background: #1966ff;
  transform: rotate(45deg);
}
.xftautouseplugin-tour-guide.simpleGuide {
  width: auto;
}
.xftautouseplugin-tour-guide.simpleGuide .tour-guide-container {
  min-width: 0;
  max-width: 160px;
}
.xftautouseplugin-tour-guide.simpleGuide .tour-guide-header {
  margin: 0;
}
.xftautouseplugin-tour-guide.simpleGuide .tour-guide-header .tour-guide-subtitle {
  display: none;
}
.xftautouseplugin-tour-guide.simpleGuide .tour-guide-header .tour-guide-close {
  display: none;
}
.xftautouseplugin-tour-guide.simpleGuide .tour-guide-footer {
  display: none;
}`;

// 预览模板版本标记：模板/注入逻辑有结构性变更时 +1，使旧缓存目录自动失效、强制重建
// （避免用户之前生成的"缺 #globalTool 导致 init 崩溃"或"旧版加载 SDK 气泡"的旧预览被幂等缓存复用）
// 11: 修复 stripNavScripts 正则跨 </script> 吞掉整个 body 正文，导致地图预览中间区域空白
// 13: 移动端预览（外部手机壳）、场景故事展示/收起、地图收起样式；移动端跳过 FIT 缩放脚本
// 15: 移动端判定改为「按步骤」（每步读自身 isMobileGuide，支持同场景 PC/移动混合）；
//     手机壳尺寸改用视口高度计算（修复 webview 下 body.clientHeight≈0 导致壳子过小）；
//     FIT 脚本始终注入并按当前步骤守卫（移动步骤跳过、PC 步骤仍等比缩放）
// 16: 移动端判定改以「页面内容」为权威（viewport meta 启发式），覆盖录制端全局开关
//     污染的 introduction.isMobileGuide——同一场景内可同时正确展示 PC 步骤（全屏）
//     和移动步骤（套外部手机壳），不再被错误地全部套进手机壳
// 17: 移动端手机壳加 overflow:hidden 裁剪（iframe 内容超出壳子不再视觉外溢），
//     iframe 自身加底部圆角（30px）、背景图加 z-index 防止遮挡圆角外框
// 18: 修复 v17 引入的回归——去掉 iframeContentBg 的 z-index:2 与 iframe 的 z-index:1
//     （导致 m_bg.png 透明图覆盖在 iframe 之上，壳子变空）
// 19: 移动端 FIT_SCRIPT 检测到移动步骤时显式清除残留 transform（PC 步骤遗留的
//     transform:scale 会让移动端内容也被缩放，表现为「内容溢出壳子」）+ iframe 加
//     显式 overflow:hidden 兜底
// 20: 移动端自动适配——测量 iframe 内容自然宽高，按手机壳可视区域等比缩放，
//     解决录制页宽高比与手机壳不适配导致内容超出壳子的问题
// 21: 修复 v20 引入的回归（连续进入移动端步骤时底部超出）——改用 iframe 元素
//     自身的 clientWidth/Height 作为目标算 scale（不用父容器壳子的尺寸），
//     同时不再覆盖 iframe.style.width/height（让 handleMobileResize 设置的设计
//     尺寸生效），只通过 transform: scale 做视觉适配
const MAP_PREVIEW_VERSION = '21';

// 导航脚本全局正则（与 recorder._sequentialRenumber 一致）：预览副本中清除原有跳转脚本
// ⚠️ 关键约束：正则必须限定在【单个 <script> 标签内】，用 (?:(?!<\/script>)[\s\S])*? 阻止跨 </script> 匹配。
// 否则会从文档第一个 <script>（如录制页 head 里的资源定位脚本 __R_ORIGIN__）一路匹配到 body 内的跳转脚本，
// 把 </head> 与整个 body 正文一并删除，表现为「地图预览中间页面空白、仅右侧地图配置可见」。
// 同时把 var nextStep = 的等号两侧空格放宽（\s*=\s*），兼容更多录制产物写法。
const NAV_SCRIPT_REGEX = /<script>(?:(?!<\/script>)[\s\S])*?var nextStep\s*=\s*"[^"]*";(?:(?!<\/script>)[\s\S])*?\}\)\(\);\s*<\/script>/g;

/**
 * 从 asar 内「逐文件读取写出」式复制（替代 fs-extra.copy）。
 * 背景（用户报障）：打包安装后源码位于 app.asar 内，fs-extra.copy 对 asar 内的【目录】
 *   会触发 ENOENT（opendir 失败），表现就是「点击地图预览 → No such file or directory」，
 *   且用户装到任何路径都会复现（与安装位置无关，纯粹是 asar 内目录复制不被 fs-extra 支持）。
 * 本函数只用 readFileSync / readdirSync / statSync / writeFileSync，这三者 Electron 对 asar 全支持，
 * 因此开发期（普通磁盘路径）与打包后（app.asar 内）均能稳定复制，用户任意安装位置都可用。
 * @param {string} src  源文件或目录（可位于 app.asar 内）
 * @param {string} dest 目标路径（写入系统临时目录，真实磁盘）
 */
function copyAsarSafe(src, dest) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirpSync(dest);
    for (const name of fs.readdirSync(src)) {
      copyAsarSafe(path.join(src, name), path.join(dest, name));
    }
  } else {
    fs.mkdirpSync(path.dirname(dest));
    fs.writeFileSync(dest, fs.readFileSync(src));
  }
}

/**
 * 地图预览「等比缩放（fit）」注入：让嵌入的录制步骤页面随窗口/容器大小整体缩放。
 * 背景：iframe 元素本身已 width/height:100% 跟随容器，但 iframe 内部的录制页面按固定设计宽度
 *       渲染（如 1280px 宽的页面壳），放进 iframe 后不会整体缩放，导致「地图外壳变、内嵌页面不变」。
 * 做法：以录制页面原始渲染宽度为基准，按 iframe 容器宽度计算 transform: scale()，窗口 resize / iframe 切换时重算。
 * 仅注入到复制后的临时 index.html，shot-temp 源模板与导出逻辑零改动。
 */
const FIT_STYLE = [
  '<style id="map-preview-fit-style">',
  '  .iframeContent { overflow: hidden; }',
  '  #demoIframe { transform-origin: top left; }',
  '</style>',
].join('\n');

/**
 * 步骤切换后强制重新计算 FIT 缩放（保证切换 PC/移动步骤时缩放同步生效）。
 * 注意：FIT_SCRIPT 本身已在 iframe load / resize 时自动调用，这里仅用于 jumpStep 后立即触发。
 */
const FIT_SCRIPT = [
  '<script id="map-preview-fit-script">',
  '(function() {',
      '  function fitDemoIframe() {',
      '    var iframe = document.getElementById("demoIframe");',
      '    if (!iframe) return;',
      '    var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);',
  '    if (!doc) return;',
      '    var isMobile = false;',
      '    try { isMobile = !!(window.DemoApp && typeof window.DemoApp.isMobileScene === "function" && window.DemoApp.isMobileScene()); } catch (e) {}',
      '    if (isMobile) {',
      '      // ★ v21 移动端适配（关键修复）：用 iframe 元素本身的 clientWidth/Height 作为目标，',
      '      //   不是用父容器 .iframeContent 的尺寸。',
      '      //   v20 的 bug：用 parent 尺寸（壳子 422×852）算 scale，但 iframe 设计尺寸是 375×736，',
      '      //   内容宽高比偏向纵向时视觉高度超过 iframe 设计高度，连续进入移动端步骤时易底部超出。',
      '      //   现在改为用 iframe 自身的 clientWidth/Height 算 scale，确保内容完整装入 iframe bounds。',
      '      //',
      '      //   ★ 同时不在 mobile 模式下覆盖 iframe.style.width/height/top/left（让 handleMobileResize 设置生效），',
      '      //   只通过 transform: scale 做视觉缩放（transform 不影响 layout，iframe 元素始终是 handleMobileResize 设的尺寸）。',
      '      var iframeW = iframe.clientWidth;',
      '      var iframeH = iframe.clientHeight;',
      '      if (!iframeW || !iframeH) return;  // iframe 还没尺寸（handleMobileResize 还没跑），跳过',
      '      var contentW = doc.documentElement.scrollWidth || (doc.body && doc.body.scrollWidth) || 0;',
      '      var contentH = doc.documentElement.scrollHeight || (doc.body && doc.body.scrollHeight) || 0;',
      '      if (!contentW || !contentH) return;  // 内容还没尺寸（DOM 还没渲染完），跳过',
      '      var scaleW = iframeW / contentW;',
      '      var scaleH = iframeH / contentH;',
      '      var fitScale = Math.min(scaleW, scaleH);',
      '      if (fitScale > 1) fitScale = 1;',
      '      // ★ 不修改 iframe 元素的 width/height（保持 handleMobileResize 设置的设计尺寸）',
      '      //   只通过 transform 让内容视觉缩放填满 iframe。',
      '      iframe.style.transformOrigin = "top left";',
      '      if (fitScale < 1) {',
      '        iframe.style.transform = "scale(" + fitScale + ")";',
      '      } else {',
      '        // 内容自然尺寸已在 iframe 内，清除 transform（恢复 1:1 显示）',
      '        if (iframe.style.transform) iframe.style.transform = "";',
      '      }',
      '      return;',
      '    }',
      '    // PC 步骤：原 FIT 缩放逻辑',
      '    var parent = iframe.parentElement;',
      '    var cw = parent.clientWidth, ch = parent.clientHeight;',
      '    if (!cw || !ch) return;',
      '    var base = doc.documentElement.scrollWidth || (doc.body && doc.body.scrollWidth) || 1280;',
      '    var scale = cw / base;',
      '    if (scale > 1) scale = 1;',
      '    iframe.style.width = base + "px";',
      '    iframe.style.height = ch + "px";',
      '    iframe.style.transform = "scale(" + scale + ")";',
  '  }',
  '  window.addEventListener("resize", fitDemoIframe);',
  '  var _ifr = document.getElementById("demoIframe");',
  '  if (_ifr) { _ifr.addEventListener("load", function () { setTimeout(fitDemoIframe, 60); }); }',
  '  window.addEventListener("load", function () { setTimeout(fitDemoIframe, 300); });',
  '  setTimeout(fitDemoIframe, 500);',
  '  // ★ v21：监听步骤切换事件（app.js updateIframeUrl 派发），立即重新计算',
  '  window.addEventListener("map-step-changed", function () { setTimeout(fitDemoIframe, 30); });',
  '})();',
  '</script>',
].join('\n');

/**
 * 扁平收集所有步骤（mainModules → subModules → steps，播放顺序）
 * 与 recorder._sequentialRenumber 的扁平顺序保持一致，确保步骤文件编号对齐。
 */
function flattenSteps(mainModules) {
  const out = [];
  for (const mainMod of (mainModules || [])) {
    for (const subMod of (mainMod.subModules || [])) {
      if (subMod.steps) out.push(...subMod.steps);
    }
  }
  return out;
}

/**
 * 探测场景是否为「移动端录制」。
 * 判定优先级：
 *   1) recording_data.json 直接携带的 isMobileMode（新录制/继续录制/重录均会持久化）；
 *   2) 任意子步骤 introduction.isMobileGuide 为 true（向前兼容分步标记）；
 *   3) 兜底：从导出目录 demo_config.json 的 selector.isMobileGuide 探测
 *      （旧场景在启用移动端录制时，导出配置里已写入该字段，可据此还原）。
 * @param {object} recData  录制的 recording_data.json 解析结果
 * @param {string} dirPath  场景目录（含 demo_config.json 的导出目录）
 * @returns {boolean}
 */
function detectMobileMode(recData, dirPath) {
  if (recData && recData.isMobileMode) return true;
  for (const m of (recData.mainModules || [])) {
    for (const sub of (m.subModules || [])) {
      if (sub.introduction && sub.introduction.isMobileGuide) return true;
    }
  }
  // 兜底：旧场景从 demo_config.json 探测
  try {
    const cfgPath = path.join(dirPath, 'demo_config.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      const arr = Array.isArray(cfg) ? cfg : [cfg];
      for (const top of arr) {
        for (const mod of (top.stepModuleConfigs || [])) {
          for (const det of (mod.outlineDetailResponses || [])) {
            for (const gc of (det.guideComponentList || [])) {
              if (gc.selector) {
                try {
                  const sel = JSON.parse(gc.selector);
                  if (sel.isMobileGuide) return true;
                } catch (e) {}
              }
            }
          }
        }
      }
    }
  } catch (e) {}
  return false;
}

/**
 * ★ 从步骤 HTML 内容反推本步骤是否为「移动端页面」。
 * 用 viewport meta 的差异区分（移动页通常带 user-scalable=no / maximum-scale=1 锁定缩放；
 * 桌面页通常只有 width=device-width, initial-scale=1）。
 * 录制端会将全局 isMobileMode 开关统一写到每步 introduction.isMobileGuide，
 * 但同一场景里用户可能既录了 PC 页又录了移动页，导致全局标记污染每步——这种情况下必须以
 * 实际页面内容为准，否则会被错误地套上手机壳。
 *
 * @param {string} html  步骤 htmlContent（录制时保存的完整 HTML 副本）
 * @returns {boolean|null}  true=确认为移动端，false=确认为 PC，null=无法判定（按既有逻辑兜底）
 */
function detectMobileFromContent(html) {
  if (!html || typeof html !== 'string') return null;
  const m = html.match(/<meta[^>]*\bname\s*=\s*["']viewport["'][^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*>/i);
  if (!m) {
    // ★ 无 viewport meta：按 PC 处理。纯桌面/SSR 站点通常没有此 meta，而绝大多数移动 SPA/H5
    //   必带 viewport meta（哪怕只有 width=device-width）。这是「无 meta → 非移动」的安全默认。
    //   注：recorder 自身不会注入 viewport meta（已 grep 确认），所以 meta 全部来自被录制页面本身。
    return false;
  }
  const content = String(m[1] || '').toLowerCase();
  // ★ 强移动端特征：禁用缩放（user-scalable=no + maximum-scale=1）—— 桌面站点从不主动锁定缩放，
  //   几乎所有现代移动端 H5/响应式站点都会加上这条防止误触缩放，故认为是确凿的移动端信号。
  const hasUserScalableNo = /user-scalable\s*=\s*no/.test(content);
  const hasMaxScale1 = /maximum-scale\s*=\s*1\b/.test(content);
  if (hasUserScalableNo && hasMaxScale1) return true;
  // ★ 强 PC 特征：仅 "width=device-width, initial-scale=1"（无缩放锁定）。
  //   这是 cmbchina.com 等纯桌面站点最常见的 viewport 形态；移动端绝少用这种"宽松"配置。
  const isRelaxed = /^width\s*=\s*device-width\s*,\s*initial-scale\s*=\s*1(?:\.0+)?\s*$/.test(content.trim());
  if (isRelaxed) return false;
  // ★ viewport-fit=cover 是移动端刘海屏适配特征，几乎只出现在移动端 H5/响应式页面
  if (/viewport-fit\s*=\s*cover/.test(content)) return true;
  // ★ 仅有 initial-scale=1 但还带其他内容的（如 minimum-scale=1 + initial-scale=1），
  //   倾向于移动端（移动端常同时锁定 min/max），否则 PC
  if (/initial-scale\s*=\s*1/.test(content) && /minimum-scale\s*=\s*1/.test(content) && /maximum-scale/.test(content)) {
    return true;
  }
  return null;
}

/**
 * 将录制配置（recording_data.json 形状）转换为地图页所需的 MockData（raw 格式）。
 * 注意：地图页 app.js 会再用 transformData() 处理一次，所以这里输出的是它期望的"原料"格式：
 *   { demonstrationCode, demonstrationTitle, demonstrationSubTitle, demonstrationHeaderNavTitle,
 *     moduleList: [ { moduleTitle, moduleDesc, moduleType, stepList: [ { stepTitle, introduction, subStepList:[{title,content,position}] } ] } ] }
 *
 * 映射关系：
 *   mainModule      -> moduleList 项
 *   subModules+steps 扁平 -> stepList（每个录制步骤 = 地图一个子步骤节点 = 一个 stepN.html）
 *   步骤 marks[0]   -> 该节点的标题/引导文案/位置
 */
function transformRecordingToMockConfig(recData, isMobileMode) {
  const sceneConfig = recData.sceneConfig || {};
  const sceneCode = recData.sceneCode || 'scene';
  const mainModules = recData.mainModules || [];

  const moduleList = mainModules.map((m) => {
    // ★ 每个 subModule = 地图一个主步骤（右侧导航项；点击跳转该主步骤的子步骤 0）
    const stepList = (m.subModules || []).map((subMod) => {
      // ★ 移动端标记判定（优先级从高到低）：
      //   1) 【按页面内容反推】（viewport meta 决定）—— 录制端会把全局 isMobileMode 写到每步
      //      introduction.isMobileGuide，导致同一场景里既录 PC 页又录移动页时被全部打上
      //      isMobileGuide=true（用户报错"我 PC 页面也被套进移动端"）。以内容为准可正确分类。
      //   2) 子步骤自身的 introduction.isMobileGuide（仅当内容反推无法判定时使用，避免覆盖用户显式标记的旧场景）
      //   3) 场景级 isMobileMode（最后兜底）
      const subIntro = subMod.introduction || {};
      const subHasOwnFlag = typeof subIntro.isMobileGuide === 'boolean';
      const subFallbackMobile = subHasOwnFlag ? !!subIntro.isMobileGuide : !!isMobileMode;

      // ★ 每个 captured page（step）= 该主步骤下的一个子步骤（页面跳转），仅在气泡中体现，不在地图展开
      //   ★ 移动端标记必须在 subStep 级别独立计算——同一 subModule 内可能既有 PC 页又有移动页，
      //     仅看第一步 HTML 会漏掉混合场景。这里每步独立反推，失败时回退到 subModule/场景级标记。
      const subStepList = (subMod.steps || []).map((snapshot) => {
        const marks = Array.isArray(snapshot.marks) ? snapshot.marks : [];
        const firstMark = marks[0] || {};
        const stepTitle = firstMark.subTitle || (snapshot.elementIds && snapshot.elementIds[0]) || '录制步骤';
        const question = firstMark.mainTitle || firstMark.subTitle || '';
        const position = firstMark.position || 'right';
        // ★ 是否展示「下一步」按钮：与录制选择一致（默认 true；用户取消勾选为 false）
        const showNextStep = firstMark.showNextStep !== false;
        // ★ 该子步骤的移动端标记：以本子步骤自身 HTML 为权威，失败回退 subModule/场景级
        const contentMobile = detectMobileFromContent(snapshot.htmlContent || '');
        const subStepIsMobile = contentMobile !== null ? contentMobile : subFallbackMobile;
        return {
          title: stepTitle,
          content: question,
          position: position,
          showNextStep: showNextStep,
          // ★ 子步骤级 selector：app.js 的 transformData() 会把这里已有的 selector.isMobileGuide
          //   直接使用，避免把同一 subModule 内的 PC 步骤和移动步骤统一套上同一种壳子
          selector: {
            placeSelector: '#' + (firstMark.elementId || ''),
            clickSelector: '#' + (firstMark.elementId || ''),
            isMobileGuide: subStepIsMobile,
          },
        };
      });
      // ★ 移动端标记：subModule 级别（用于地图卡片/UI 上展示），取 subStep 列表中真值优先
      const introduction = Object.assign({}, subIntro, {
        isMobileGuide: subFallbackMobile,
      });
      return {
        stepTitle: subMod.mainStepTitle || '演示主步骤',
        stepName: subMod.mainStepTitle || '演示主步骤',
        introduction: introduction,
        // 子步骤（页面跳转），仅体现在气泡，不展开为地图层
        subStepList: subStepList,
      };
    });
    return {
      moduleTitle: m.mainModuleName || '演示模块',
      moduleDesc: m.mainModuleDesc || '',
      moduleType: 'enterprise',
      stepList: stepList,
    };
  });

  // ★ 任意主步骤含非空「场景故事」文案时，地图预览自动在右下角展示（用户无需手动点「场景故事」按钮）
  const hasSceneStory = moduleList.some((m) =>
    (m.stepList || []).some((s) => s.introduction && (s.introduction.question || s.introduction.answer)),
  );

  return {
    demonstrationCode: sceneCode,
    demonstrationTitle: sceneConfig.sceneTitle || sceneCode,
    demonstrationSubTitle: sceneConfig.sceneSubTitle || '',
    demonstrationHeaderNavTitle: '',
    sceneStoryShow: hasSceneStory,
    moduleList: moduleList,
  };
}

/**
 * 生成「自定义引导气泡」注入（仅注入到步骤 HTML 的【预览副本】，源文件/导出零改动）。
 *
 * 做法（用户最新要求：若 SDK 实在不行，就按 SDK 渲染样式自己实现，且不要放到导出 HTML、仅供地图预览）：
 *   不再加载外部/本地 xft-help-autouse.js 引擎（沙箱/离线下不稳定），改为注入一段自实现脚本：
 *     1) 注入官方气泡样式（AUTO_USE_BUBBLE_CSS，蓝色 #1966ff、圆角、小三角箭头、白底"下一步"按钮）；
 *     2) DOM 就绪后按 marks[0] 定位录制元素（#elementId，回退 [data-marked]，再回退子 iframe 内元素），
 *        在该元素旁边画出 .xftautouseplugin-tour-guide 气泡（标题=mainTitle，副标题=subTitle）；
 *     3) 气泡「下一步」按钮：实际点击录制元素 + postMessage(next-by-click) 驱动地图前进；
 *        点击录制元素本身同样 postMessage(next-by-click)（SDK 的 next-by-click 语义）；
 *     4) 渲染完成 postMessage(xft-autouseplugin-loaded) 让地图关闭 loading。
 *   以上全部只在地图预览临时副本里，导出 HTML / 录制源文件不做任何改动。
 */
function buildAutouseBootstrapScript(step) {
  const marks = Array.isArray(step.marks) ? step.marks : [];
  const mark = marks[0] || {};
  const rawElId = mark.elementId || (step.elementIds && step.elementIds[0]) || '';
  const elId = String(rawElId).replace(/[^a-zA-Z0-9_-]/g, '');
  const mainTitle = mark.mainTitle || '';
  const subTitle = mark.subTitle || '';
  const position = mark.position || 'right';
  // 是否展示「下一步」按钮：与录制配置一致（recorder.js 默认 true；导出时写入 selector.showNextStep）。
  // 仅当录制标记显式 showNextStep===false 时才隐藏「下一步」按钮，仅展示指引气泡；
  // 字段缺失（旧录制）按默认 true 处理，保持向后兼容（仍显示按钮）。
  const showNext = mark.showNextStep !== false;
  return [
    '<script>',
    '(function () {',
    '  var __elId = ' + JSON.stringify(elId) + ';',
    '  var __title = ' + JSON.stringify(mainTitle) + ';',
    '  var __sub = ' + JSON.stringify(subTitle) + ';',
    '  var __pos = ' + JSON.stringify(position) + ';',
    '  var __showNext = ' + JSON.stringify(showNext) + ';',
    '  (function () {',
    '    var s = document.getElementById("__autouse_custom_css");',
    '    if (!s) {',
    '      s = document.createElement("style");',
    '      s.id = "__autouse_custom_css";',
    '      s.textContent = ' + JSON.stringify(AUTOUSE_BUBBLE_CSS) + ';',
    '      (document.head || document.documentElement).appendChild(s);',
    '    }',
    '  })();',
    '  var __advancing = false;',
    '  function __postNext() {',
    '    if (__advancing) return;',
    '    __advancing = true;',
    '    setTimeout(function () { __advancing = false; }, 350);',
    '    try { parent.postMessage(JSON.stringify({ type: "iframe-autouse-message", key: "next-by-click" }), "*"); } catch (e) {}',
    '  }',
    '  function __postLoaded() {',
    '    try { parent.postMessage(JSON.stringify({ type: "iframe-autouse-message", key: "xft-autouseplugin-loaded" }), "*"); } catch (e) {}',
    '  }',
    '  function __findTarget() {',
    '    window.__autouse_iframeCtx = null;',
    '    var t = null;',
    '    if (__elId) { try { t = document.getElementById(__elId); } catch (e) {} }',
    '    if (!t) { try { t = document.querySelector("[data-marked]"); } catch (e) {} }',
    '    if (!t) {',
    '      var ifs = document.querySelectorAll("iframe");',
    '      for (var i = 0; i < ifs.length; i++) {',
    '        try {',
    '          var d = ifs[i].contentDocument;',
    '          if (d) { var it = d.getElementById(__elId) || d.querySelector("[data-marked]"); if (it) { t = it; window.__autouse_iframeCtx = d; } }',
    '        } catch (e) {}',
    '      }',
    '    }',
    '    return t;',
    '  }',
    '  var __bubble = null, __target = null;',
    '  function __reposition() { if (__bubble && __target) __position(); }',
    '  function __position() {',
    '    if (!__bubble || !__target) return;',
    '    var r = __target.getBoundingClientRect();',
    '    var bw = __bubble.offsetWidth, bh = __bubble.offsetHeight;',
    '    var doc = __bubble.ownerDocument;',
    '    var left = r.left, top = r.top;',
    '    var pos = __pos;',
    '    if (pos === "right" && left + r.width + 12 + bw > doc.documentElement.clientWidth) pos = "left";',
    '    var bl, bt, ah = {};',
    '    if (pos === "left") {',
    '      bl = left - bw - 12; bt = top + r.height / 2 - bh / 2; ah.right = "-8px"; ah.top = (bh / 2 - 8) + "px";',
    '    } else if (pos === "top") {',
    '      bt = top - bh - 12; bl = left + r.width / 2 - bw / 2; ah.bottom = "-8px"; ah.left = (bw / 2 - 8) + "px";',
    '    } else if (pos === "bottom") {',
    '      bt = top + r.height + 12; bl = left + r.width / 2 - bw / 2; ah.top = "-8px"; ah.left = (bw / 2 - 8) + "px";',
    '    } else {',
    '      bl = left + r.width + 12; bt = top + r.height / 2 - bh / 2; ah.left = "-8px"; ah.top = (bh / 2 - 8) + "px";',
    '    }',
    '    // 把气泡 clamp 到视口内，确保永不跑到屏幕外（fixed 定位，视口坐标）',
    '    var vw2 = doc.documentElement.clientWidth, vh = doc.documentElement.clientHeight;',
    '    var maxLeft = Math.max(4, vw2 - bw - 8), maxTop = Math.max(4, vh - bh - 8);',
    '    __bubble.style.left = Math.min(Math.max(4, bl), maxLeft) + "px";',
    '    __bubble.style.top = Math.min(Math.max(4, bt), maxTop) + "px";',
    '    var arrow = __bubble.querySelector(".tour-guide-arrow");',
    '    if (arrow) { for (var k in ah) { if (ah.hasOwnProperty(k)) arrow.style[k] = ah[k]; } }',
    '  }',
    '  function __render() {',
    '    __target = __findTarget();',
    '    if (!__target) return false;',
    '    // 高亮「挂载指引的元素」：橙色虚线边框（对齐 SDK 的 placeClassStyle），便于一眼看到被指引的目标',
    '    try { if (__target.classList) __target.classList.add("autouse-mount-element"); } catch (e) {}',
    '    // 先把目标滚动进可视区，避免目标/气泡落在可视区外（如绝对定位、或在大页面里偏下的元素）',
    '    try { __target.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }); }',
    '    catch (e) { try { __target.scrollIntoView(true); } catch (e2) {} }',
    '    var ctx = window.__autouse_iframeCtx || document;',
    '    var old = ctx.getElementById("__autouse_custom_bubble");',
    '    if (old && old.parentNode) old.parentNode.removeChild(old);',
    '    var b = ctx.createElement("div");',
    '    b.className = "xftautouseplugin-tour-guide";',
    '    b.id = "__autouse_custom_bubble";',
    '    var c = ctx.createElement("div"); c.className = "tour-guide-container";',
    '    var h = ctx.createElement("div"); h.className = "tour-guide-header";',
    '    var t = ctx.createElement("div"); t.className = "tour-guide-title"; t.textContent = __title; h.appendChild(t);',
    '    if (__sub) { var s = ctx.createElement("div"); s.className = "tour-guide-subtitle"; s.textContent = __sub; h.appendChild(s); }',
    '    c.appendChild(h);',
    '    var f = null, fin = null;',
    '    if (__showNext) {',
    '      f = ctx.createElement("div"); f.className = "tour-guide-footer";',
    '      fin = ctx.createElement("span"); fin.className = "tour-guide-finish"; fin.textContent = "下一步"; f.appendChild(fin);',
    '      c.appendChild(f);',
    '      b.className = "xftautouseplugin-tour-guide";',
    '    } else {',
    '      // 未配置「下一步」：仅展示指引气泡，不渲染「下一步」按钮（对齐 SDK 的 showNextBtn 语义）',
    '      b.className = "xftautouseplugin-tour-guide simpleGuide";',
    '    }',
    '    var ar = ctx.createElement("div"); ar.className = "tour-guide-arrow"; c.appendChild(ar);',
    '    b.appendChild(c);',
    '    ctx.body.appendChild(b);',
    '    __bubble = b;',
    '    __position();',
    '    // 页面滚动 / 窗口缩放时跟随重定位（fixed 定位，目标移动则气泡同步跟随）',
    '    try {',
    '      window.addEventListener("scroll", __reposition, true);',
    '      window.addEventListener("resize", __reposition);',
    '      if (window.__autouse_iframeCtx && window.__autouse_iframeCtx.defaultView) {',
    '        window.__autouse_iframeCtx.defaultView.addEventListener("scroll", __reposition, true);',
    '        window.__autouse_iframeCtx.defaultView.addEventListener("resize", __reposition);',
    '      }',
    '    } catch (e) {}',
    '    if (fin) { fin.addEventListener("click", function (e) { e.stopPropagation(); try { if (__target && __target.click) __target.click(); } catch (e2) {} __postNext(); }); }',
    '    __target.addEventListener("click", function () { __postNext(); });',
    '    return true;',
    '  }',
    '  function __start() { if (__render()) { __postLoaded(); } else { setTimeout(__start, 200); } }',
    '  if (document.readyState !== "loading") __start();',
    '  else document.addEventListener("DOMContentLoaded", __start);',
    '  window.addEventListener("resize", function () { if (__bubble) __position(); });',
    '})();',
    '</script>',
  ].join('\n');
}

/** 去除步骤 HTML 中原有的跳转脚本（预览副本不需要，避免与地图桥接脚本冲突） */
function stripNavScripts(html) {
  return (html || '').replace(NAV_SCRIPT_REGEX, '');
}

/**
 * 去除步骤 HTML 中「外部 CDN 版」xft-help-autouse 脚本。
 * 背景：录制产物现在会在 head 注入外部 CDN 版 SDK（用户要求录制 html 自带该脚本，平台据此渲染气泡）。
 *       但地图预览采用「自定义 SDK 风格气泡」自实现，不加载任何本地/外部 SDK 引擎，
 *       若再加载外部 CDN 版会多余且可能与离线/沙箱环境冲突。
 *       故生成预览副本时，仅移除录制 HTML 里的【绝对 http(s) URL】外部 autouse 脚本，
 *       导出逻辑零影响，源文件不动。
 */
function stripExternalAutouse(html) {
  return (html || '').replace(
    /<script[^>]*src=["']https?:\/\/[^"']*xft[_-]?help[_-]?autouse[^"']*["'][^>]*>\s*<\/script>/gi,
    ''
  );
}

/**
 * 把步骤 HTML 内部引用的【本地相对资源】（iframe / 图片等）从源目录递归复制到临时目录。
 * 否则地图 iframe 加载 stepN.html 时，其内部 <iframe src="./stepN_iframe_1.html"> 等会因文件缺失而 ERR_FILE_NOT_FOUND。
 * 仅复制以 "./" 开头的相对引用（跳过 http(s)://、绝对路径、以及步骤自身的 stepN.html 引用）。
 * 设为递归：被复制的若为本地 HTML（如 iframe），其内部的 ./ 引用也会一并带过来。
 */
function copyLocalRefs(html, srcDir, destDir, _seen) {
  if (!html) return;
  const seen = _seen || new Set();
  const refRegex = /(?:src|href)\s*=\s*["']\.\/([^"']+)["']/gi;
  let m;
  while ((m = refRegex.exec(html)) !== null) {
    const rel = m[1];
    // 跳过步骤自身引用（nextStep 已清除，这里基本不会出现；保险起见排除）
    if (/^step\d+\.html$/i.test(rel)) continue;
    if (seen.has(rel)) continue;
    seen.add(rel);
    const srcFile = path.join(srcDir, rel);
    const destFile = path.join(destDir, rel);
    try {
      if (fs.existsSync(srcFile)) {
        // 用 copyAsarSafe 逐文件写出（不依赖 fs.copy 目录复制，避免 asar 环境下的 ENOENT 隐患）
        copyAsarSafe(srcFile, destFile);
        // 递归：被复制的若是本地 HTML（如 iframe），其内部 ./ 引用也一并带过来
        if (/\.html?$/i.test(rel)) {
          const childHtml = fs.readFileSync(destFile, 'utf-8');
          copyLocalRefs(childHtml, srcDir, destDir, seen);
        }
      }
    } catch (e) {
      // 单个资源复制失败不影响整体预览
    }
  }
}

/**
 * 将步骤 HTML 中本地相对 CSS（href="./xxx.css"）内联为 <style>，
 * 彻底消除「临时目录没带 css 文件 → 样式丢失」的风险（CSS 直接写进 HTML，不再依赖外部文件加载）。
 * 仅内联本地 ./ 引用的 css；CDN（http(s)://）保持不变。
 */
function inlineLocalCss(html, srcDir) {
  if (!html) return html;
  return html.replace(/<link\b[^>]*href="\.\/([^"]+\.css)"[^>]*>/gi, (full, cssRel) => {
    const cssFile = path.join(srcDir, cssRel);
    try {
      if (fs.existsSync(cssFile)) {
        const css = fs.readFileSync(cssFile, 'utf-8');
        return '<style data-inline-css="' + cssRel + '">\n' + css + '\n</style>';
      }
    } catch (e) {
      // 读不到则保留原 link，交给 copyLocalRefs 兜底复制
    }
    return full;
  });
}

function sanitizeName(s) {
  return String(s || 'scene').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
}

/**
 * 生成地图预览（写入临时目录，返回地图页 file:// URL）。
 * @param {{dirPath:string}} param dirPath 为录制场景目录（含 recording_data.json 与 step*.html）
 * @returns {Promise<{success:boolean, url?:string, mapDir?:string, stepsDir?:string, error?:string}>}
 */
async function generateMapPreview({ dirPath, outputDir } = {}) {
  try {
    if (!dirPath || !fs.existsSync(dirPath)) {
      return { success: false, error: '场景目录不存在: ' + dirPath };
    }
    // ★ recording_data.json 已移出导出目录，改从 recordingsRoot 上一级的
    //    recording-meta/<dirName>/ 读取（outputDir 即 recordingsRoot），并兼容旧版导出目录内文件。
    const recDataPath = resolveRecordingDataPath(outputDir, path.basename(dirPath));
    if (!fs.existsSync(recDataPath)) {
      return { success: false, error: '该场景没有录制数据（recording-meta），无法生成地图预览（请先保存一次录制）' };
    }
    const recData = JSON.parse(fs.readFileSync(recDataPath, 'utf-8'));

    const flatSteps = flattenSteps(recData.mainModules);
    if (flatSteps.length === 0) {
      return { success: false, error: '该场景没有录制步骤' };
    }

    // 1) 转换配置（含移动端标记探测，供手机壳渲染 + FIT 脚本跳过）
    const isMobileMode = detectMobileMode(recData, dirPath);
    const mockConfig = transformRecordingToMockConfig(recData, isMobileMode);
    const code = recData.sceneCode || path.basename(dirPath);
    // ★ 缓存版本标记（仅版本号，不再区分 -m/-p）：移动端判定已改为「按步骤」，
    //   同一场景可能同时含 PC 步骤与移动步骤，FIT 脚本始终注入并按当前步骤守卫跳过移动步骤。
    const versionMarker = 'map-preview-v' + MAP_PREVIEW_VERSION;

    // 2) 准备临时目录（基于场景目录名固定，避免每次点击都重新生成导致卡顿）
    const dirKey = sanitizeName(path.basename(dirPath));
    const base = path.join(os.tmpdir(), 'map-preview-' + dirKey);
    const democode = 'steps-' + dirKey; // 与 app.js 的 ../${democode}/stepN.html 约定对齐
    mockConfig.demonstrationCode = democode;

    const mapDir = path.join(base, 'map');
    const stepsDir = path.join(base, democode);

    // 幂等：同一场景已生成过则直接复用，避免重复复制造成的「反应慢」/ 多点几次生成多个临时目录
    // 但若旧预览版本标记不符（如模板修复前的破损版本），强制清掉重建，确保修复生效
    const existingIndex = path.join(mapDir, 'index.html');
    if (fs.existsSync(existingIndex)) {
      let stale = true;
      try {
        const prev = fs.readFileSync(existingIndex, 'utf-8');
        stale = prev.indexOf(versionMarker) === -1;
      } catch (e) {}
      if (!stale) {
        const url = 'file://' + existingIndex.replace(/\\/g, '/');
        console.log('[map-preview] 复用已生成地图预览:', url);
        return { success: true, url: url, mapDir: mapDir, stepsDir: stepsDir, cached: true };
      }
      console.log('[map-preview] 检测到旧版本预览，清除并重建');
      try { fs.removeSync(mapDir); fs.removeSync(stepsDir); } catch (e) {}
    }

    await fs.ensureDir(mapDir);
    await fs.ensureDir(stepsDir);

    // 3) 复制静态地图页模板（index.html / app.js / styles.css / img）
    // ⚠️ 必须用「逐文件读取写出」(copyAsarSafe)，不能直接 fs.copy 目录：
    // 打包安装后代码在 app.asar 内，fs-extra.copy 对 asar 内目录会 ENOENT（opendir 失败），
    // 表现为「地图预览报错 No such file or directory」。copyAsarSafe 仅用 Electron 对 asar 全支持的 API，
    // 开发期与打包后、任意安装位置均稳定。
    copyAsarSafe(path.join(MAP_TEMPLATE_DIR, 'index.html'), path.join(mapDir, 'index.html'));
    copyAsarSafe(path.join(MAP_TEMPLATE_DIR, 'app.js'), path.join(mapDir, 'app.js'));
    copyAsarSafe(path.join(MAP_TEMPLATE_DIR, 'styles.css'), path.join(mapDir, 'styles.css'));
    // 注：步骤气泡已在预览副本内自实现（buildAutouseBootstrapScript），不再复制/加载 xft-help-autouse.js 引擎。
    const imgSrc = path.join(MAP_TEMPLATE_DIR, 'img');
    if (fs.existsSync(imgSrc)) {
      copyAsarSafe(imgSrc, path.join(mapDir, 'img'));
    }

    // 4) 将 window.MockData 内联进复制后的 index.html，并保留 app.js 加载（复用现有逻辑，不改模板）
    const mockJson = JSON.stringify(mockConfig).replace(/</g, '\\u003c');
    const idxHtml = fs.readFileSync(path.join(mapDir, 'index.html'), 'utf-8');
    const loaderRegex = /<script>\s*\/\/ 根据url中的 democode[\s\S]*?<\/script>/;
    const newLoader =
      '<script>window.MockData = ' + mockJson + ';</script>\n' +
      '    <script src="app.js"></script>';
    const newIdxHtml = idxHtml.replace(loaderRegex, newLoader);
    // 注入「等比缩放（fit）」逻辑：让嵌入的录制页面随窗口/容器大小整体缩放（仅预览副本，源模板不动）
    // 同时注入「自动开始演示」脚本，使气泡引导一打开地图预览就可见（仅预览页，导出逻辑零改动）
    // 移动端判定已改为「按步骤」：同一场景可能同时含 PC 步骤与移动步骤。故【始终注入 FIT 脚本】，
    // 由 FIT_SCRIPT 内的 isMobileScene 守卫按当前步骤自动判断——仅对 PC 步骤等比缩放，对移动步骤跳过
    // （移动步骤的 iframe 尺寸由 handleMobileResize 自行定义），保证混合场景下 PC 步骤仍能随容器缩放。
    const fitInjection = FIT_STYLE + '\n' + FIT_SCRIPT + '\n';
    const finalIdxHtml = newIdxHtml.replace(
      '</body>',
      '<!-- ' + versionMarker + ' -->\n' +
        fitInjection + '\n</body>'
    );
    fs.writeFileSync(path.join(mapDir, 'index.html'), finalIdxHtml, 'utf-8');

    // 5) 为每个步骤生成预览副本（去除原跳转脚本 + 注入真实气泡引擎 + 本步骤 mock 配置）
    for (let i = 0; i < flatSteps.length; i++) {
      const step = flatSteps[i];
      const srcFile = path.join(dirPath, step.htmlFile);
      let html = '';
      if (fs.existsSync(srcFile)) {
        html = fs.readFileSync(srcFile, 'utf-8');
      } else if (typeof step.htmlContent === 'string') {
        html = step.htmlContent;
      } else {
        html = '<!DOCTYPE html><html><body>步骤内容缺失: ' + (step.htmlFile || step.stepId) + '</body></html>';
      }
      html = inlineLocalCss(html, dirPath);
      html = stripNavScripts(html);
      // 移除录制 HTML 里自带的外部 CDN 版 autouse 脚本，避免与预览本地打包引擎重复加载
      html = stripExternalAutouse(html);
      // 注入「自定义 SDK 风格引导气泡」脚本（仅预览副本，源文件不动；导出 HTML 不含此逻辑）
      const injection = buildAutouseBootstrapScript(step);
      if (html.includes('</body>')) {
        html = html.replace('</body>', injection + '\n</body>');
      } else {
        html += injection;
      }
      fs.writeFileSync(path.join(stepsDir, 'step' + (i + 1) + '.html'), html, 'utf-8');
      // 复制与步骤同名的 css（录制页常通过 document.write('./stepN.css') 动态注入样式，
      // 不是静态 ./ 引用，copyLocalRefs 抓不到；不复制则地图预览的步骤页缺失样式、看起来"没加载出来"）
      const stepName = (step.htmlFile || ('step' + (i + 1) + '.html')).replace(/\.html?$/i, '');
      const cssSrc = path.join(dirPath, stepName + '.css');
      if (fs.existsSync(cssSrc)) {
        try { copyAsarSafe(cssSrc, path.join(stepsDir, 'step' + (i + 1) + '.css')); } catch (e) {}
      }
      // 把步骤 HTML 内部引用的本地资源（iframe / css / 图片等）一并复制到临时目录，避免 ERR_FILE_NOT_FOUND
      copyLocalRefs(html, dirPath, stepsDir);
    }

    const url = 'file://' + path.join(mapDir, 'index.html').replace(/\\/g, '/');
    console.log('[map-preview] 已生成地图预览:', url, ' 步骤数:', flatSteps.length);
    return { success: true, url: url, mapDir: mapDir, stepsDir: stepsDir };
  } catch (err) {
    console.error('[map-preview] 生成失败:', err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  generateMapPreview,
  transformRecordingToMockConfig,
  flattenSteps,
  buildAutouseBootstrapScript,
  stripNavScripts,
  stripExternalAutouse,
  detectMobileFromContent,
};
