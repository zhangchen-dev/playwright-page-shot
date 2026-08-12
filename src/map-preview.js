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
const MAP_PREVIEW_VERSION = '10';

// 导航脚本全局正则（与 recorder._sequentialRenumber 一致）：预览副本中清除原有跳转脚本
const NAV_SCRIPT_REGEX = /<script>\s*\(function\(\)\s*\{[\s\S]*?var nextStep = "[^"]*";[\s\S]*?\}\)\(\);\s*<\/script>/g;

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
 * 自动开始演示（仅注入到生成的预览 index.html，源模板不动）。
 * 背景：预览的核心目的是"看引导气泡 + 看内容"，但地图模板默认 stepState='0' 会盖一层蒙版且不加载步骤 iframe。
 * 这里在页面 load 后自动调用 DemoApp.startDemo()，移除蒙版并加载第一个步骤，使气泡一打开就可见。
 * 注意：仅影响预览临时页；用户最终"下载/导出"仍使用原始录制 html 与配置，与此无关。
 */
const AUTO_START_SCRIPT = [
  '<script id="map-preview-autostart-script">',
  'window.addEventListener("load", function () {',
  '  setTimeout(function () {',
  '    try { if (window.DemoApp && window.DemoApp.startDemo) window.DemoApp.startDemo(); } catch (e) {}',
  '  }, 400);',
  '});',
  '</script>',
].join('\n');

const FIT_SCRIPT = [
  '<script id="map-preview-fit-script">',
  '(function() {',
  '  function fitDemoIframe() {',
  '    var iframe = document.getElementById("demoIframe");',
  '    if (!iframe) return;',
  '    var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);',
  '    if (!doc) return;',
  '    var base = doc.documentElement.scrollWidth || (doc.body && doc.body.scrollWidth) || 1280;',
  '    var parent = iframe.parentElement;',
  '    var cw = parent.clientWidth, ch = parent.clientHeight;',
  '    if (!cw || !ch) return;',
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
function transformRecordingToMockConfig(recData) {
  const sceneConfig = recData.sceneConfig || {};
  const sceneCode = recData.sceneCode || 'scene';
  const mainModules = recData.mainModules || [];

  const moduleList = mainModules.map((m) => {
    // ★ 每个 subModule = 地图一个主步骤（右侧导航项；点击跳转该主步骤的子步骤 0）
    const stepList = (m.subModules || []).map((subMod) => {
      // ★ 每个 captured page（step）= 该主步骤下的一个子步骤（页面跳转），仅在气泡中体现，不在地图展开
      const subStepList = (subMod.steps || []).map((snapshot) => {
        const marks = Array.isArray(snapshot.marks) ? snapshot.marks : [];
        const firstMark = marks[0] || {};
        const stepTitle = firstMark.subTitle || (snapshot.elementIds && snapshot.elementIds[0]) || '录制步骤';
        const question = firstMark.mainTitle || firstMark.subTitle || '';
        const position = firstMark.position || 'right';
        // ★ 是否展示「下一步」按钮：与录制选择一致（默认 true；用户取消勾选为 false）
        const showNextStep = firstMark.showNextStep !== false;
        return {
          title: stepTitle,
          content: question,
          position: position,
          showNextStep: showNextStep,
        };
      });
      return {
        stepTitle: subMod.mainStepTitle || '演示主步骤',
        stepName: subMod.mainStepTitle || '演示主步骤',
        introduction: subMod.introduction || {},
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

  return {
    demonstrationCode: sceneCode,
    demonstrationTitle: sceneConfig.sceneTitle || sceneCode,
    demonstrationSubTitle: sceneConfig.sceneSubTitle || '',
    demonstrationHeaderNavTitle: '',
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
        fs.ensureDirSync(path.dirname(destFile));
        fs.copySync(srcFile, destFile);
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

    // 1) 转换配置
    const mockConfig = transformRecordingToMockConfig(recData);
    const code = recData.sceneCode || path.basename(dirPath);

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
        stale = prev.indexOf('map-preview-version:' + MAP_PREVIEW_VERSION) === -1;
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
    await fs.copy(path.join(MAP_TEMPLATE_DIR, 'index.html'), path.join(mapDir, 'index.html'));
    await fs.copy(path.join(MAP_TEMPLATE_DIR, 'app.js'), path.join(mapDir, 'app.js'));
    await fs.copy(path.join(MAP_TEMPLATE_DIR, 'styles.css'), path.join(mapDir, 'styles.css'));
    // 注：步骤气泡已在预览副本内自实现（buildAutouseBootstrapScript），不再复制/加载 xft-help-autouse.js 引擎。
    const imgSrc = path.join(MAP_TEMPLATE_DIR, 'img');
    if (fs.existsSync(imgSrc)) {
      await fs.copy(imgSrc, path.join(mapDir, 'img'));
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
    const finalIdxHtml = newIdxHtml.replace(
      '</body>',
      '<!-- map-preview-version:' + MAP_PREVIEW_VERSION + ' -->\n' +
        FIT_STYLE + '\n' + FIT_SCRIPT + '\n' + AUTO_START_SCRIPT + '\n</body>'
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
};
