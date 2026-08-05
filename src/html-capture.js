/**
 * HTML 捕获引擎 - 捕获页面快照并处理 CSS/资源/iframe
 * 核心逻辑移植自 google-single-page content.js captureStep
 */
const cheerio = require('cheerio');
const { fixCssUrls, deduplicateCSS } = require('./css-utils');

class HtmlCapture {
  constructor(page) {
    this.page = page;
  }

  /**
   * 捕获当前页面的完整快照
   * @param {object} options
   * @param {string} options.stepId - 步骤ID
   * @param {string|null} options.nextStepId - 下一步ID
   * @param {Array} options.marks - 当前步骤的标记元素列表
   * @param {boolean} options.isEndRecording - 是否是录制的最后一步
   * @returns {object} 快照对象
   */
  async captureStep({ stepId, nextStepId, marks, isEndRecording }) {
    const currentUrl = this.page.url();

    // 1. 在浏览器上下文中做 DOM 清理
    const cleanedHtml = await this.page
      .evaluate(() => {
        const clone = document.documentElement.cloneNode(true);

        // 移除录制面板相关元素
        clone.querySelectorAll('#__rec_panel').forEach((el) => el.remove());
        clone.querySelectorAll('#__rec_panel_overlay').forEach((el) => el.remove());
        clone.querySelectorAll('#__rec_highlight_overlay').forEach((el) => el.remove());
        clone.querySelectorAll('#__rec_selection_style').forEach((el) => el.remove());
        clone.querySelectorAll('.__rec_iframe_selection_active__').forEach((el) => {
          el.classList.remove('__rec_iframe_selection_active__');
        });

        // 移除 script, noscript
        clone.querySelectorAll('script').forEach((el) => el.remove());
        clone.querySelectorAll('noscript').forEach((el) => el.remove());

        // 移除 CSP meta 和 base 标签
        clone.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').forEach((el) => el.remove());
        clone.querySelectorAll('base').forEach((el) => el.remove());

        // 移除事件处理器
        clone.querySelectorAll('*').forEach((el) => {
          [...el.attributes].forEach((attr) => {
            if (attr.name.startsWith('on')) {
              el.removeAttribute(attr.name);
            }
          });
        });

        return '<!DOCTYPE html>\n' + clone.outerHTML;
      })
      .catch((err) => {
        console.warn('[HtmlCapture] DOM 清理失败，使用原始 HTML:', err.message);
        return null;
      });

    // 回退：如果 page.evaluate 失败，使用 page.content()
    const rawHtml = cleanedHtml || (await this.page.content());

    // 2. 使用 cheerio 解析 HTML
    const $ = cheerio.load(rawHtml, { decodeEntities: false });
    let cssContent = '';

    // 3. 处理外部 CSS link - 在浏览器上下文中 fetch（保留 cookie/鉴权）
    const cssLinks = $('link[rel="stylesheet"]');
    const cssTotal = cssLinks.length;
    let cssCount = 0;

    for (let i = 0; i < cssLinks.length; i++) {
      const link = cssLinks[i];
      const href = $(link).attr('href');
      if (!href) continue;

      let absUrl = href;
      if (!href.startsWith('data:') && !href.startsWith('http')) {
        try {
          absUrl = new URL(href, currentUrl).href;
        } catch (e) {
          continue;
        }
      }

      try {
        // 在浏览器上下文中 fetch CSS（利用页面的 cookie/鉴权）
        const css = await this.page.evaluate(async (url) => {
          try {
            const resp = await fetch(url);
            return await resp.text();
          } catch (e) {
            return null;
          }
        }, absUrl);

        if (css) {
          const fixedCss = fixCssUrls(css, absUrl);
          cssContent += '/* ===== ' + absUrl + ' ===== */\n' + fixedCss + '\n\n';
        }
        $(link).remove();
      } catch (e) {
        $(link).remove();
      }
      cssCount++;
    }

    // 4. 提取内联 style 标签
    $('style').each((_, el) => {
      const styleContent = $(el).text() || '';
      const fixedStyle = fixCssUrls(styleContent, currentUrl);
      cssContent += '/* ===== inline style ===== */\n' + fixedStyle + '\n\n';
      $(el).remove();
    });

    cssContent = deduplicateCSS(cssContent);

    // 5. 处理资源 URL（相对路径转绝对路径）
    this._fixResourceUrls($, currentUrl);

    // 6. 添加 CSS 引用
    const cssFilename = stepId + '.css';
    if (cssContent.trim()) {
      const cssLink = `<link rel="stylesheet" href="./${cssFilename}">`;
      if ($('head').length) {
        $('head').append(cssLink);
      } else if ($('body').length) {
        $('body').before(cssLink);
      }
    }

    // 7. 处理 iframe 内容
    const iframeFiles = await this._captureIframes($, stepId, currentUrl);

    // 8. 添加步骤跳转脚本
    const currentStepMarks = marks || [];
    const currentStepElementIds = currentStepMarks.map((m) => m.elementId).filter(Boolean);

    if (currentStepElementIds.length > 0 && !isEndRecording && nextStepId) {
      const navScript = this._buildNavScript(currentStepElementIds, nextStepId);
      if ($('body').length) {
        $('body').append(navScript);
      }
    }

    const htmlFilename = stepId + '.html';
    const htmlContent = $.html();

    return {
      stepId,
      nextStepId,
      htmlContent,
      cssContent,
      htmlFile: htmlFilename,
      cssFile: cssFilename,
      elementIds: currentStepElementIds,
      marks: currentStepMarks.map((m) => ({
        elementId: m.elementId,
        mainTitle: m.mainTitle,
        subTitle: m.subTitle || '',
        isInIframe: !!m.isInIframe,
        iframeSrc: m.iframeSrc || '',
      })),
      isEndRecording,
      iframeFiles,
    };
  }

  /**
   * ★ 从预捕获的数据处理快照（用于应用内 webview 模式）
   * 不需要 Playwright page 对象，直接使用渲染进程捕获的 HTML 和 CSS 数据
   * @param {object} options
   * @param {string} options.url - 页面 URL
   * @param {string} options.html - 已清理的 HTML（由 webview executeJavaScript 获取）
   * @param {Array} options.cssContents - 预获取的 CSS 内容 [{url, content}, ...]
   * @param {string} options.stepId - 步骤ID
   * @param {string|null} options.nextStepId - 下一步ID
   * @param {Array} options.marks - 当前步骤的标记元素列表
   * @param {boolean} options.isEndRecording - 是否是录制的最后一步
   * @returns {object} 快照对象
   */
  async processFromCapturedData({ url, html, cssContents, stepId, nextStepId, marks, isEndRecording }) {
    const currentUrl = url || '';
    const rawHtml = html || '<!DOCTYPE html><html><body></body></html>';

    // 1. 使用 cheerio 解析 HTML
    const $ = cheerio.load(rawHtml, { decodeEntities: false });
    let cssContent = '';

    // 2. 处理预获取的外部 CSS（替换 page.evaluate fetch 逻辑）
    for (const cssItem of (cssContents || [])) {
      if (cssItem.content) {
        const fixedCss = fixCssUrls(cssItem.content, cssItem.url);
        cssContent += '/* ===== ' + cssItem.url + ' ===== */\n' + fixedCss + '\n\n';
      }
    }
    // 移除所有外部 CSS link 标签（内容已内联到 cssContent）
    $('link[rel="stylesheet"]').remove();

    // 3. 提取内联 style 标签
    $('style').each((_, el) => {
      const styleContent = $(el).text() || '';
      const fixedStyle = fixCssUrls(styleContent, currentUrl);
      cssContent += '/* ===== inline style ===== */\n' + fixedStyle + '\n\n';
      $(el).remove();
    });

    cssContent = deduplicateCSS(cssContent);

    // 4. 处理资源 URL（相对路径转绝对路径）
    this._fixResourceUrls($, currentUrl);

    // 5. 添加 CSS 引用
    const cssFilename = stepId + '.css';
    if (cssContent.trim()) {
      const cssLink = `<link rel="stylesheet" href="./${cssFilename}">`;
      if ($('head').length) {
        $('head').append(cssLink);
      } else if ($('body').length) {
        $('body').before(cssLink);
      }
    }

    // 6. iframe 处理 — webview 模式下跳过（返回空数组）
    const iframeFiles = [];

    // 7. 添加步骤跳转脚本
    const currentStepMarks = marks || [];
    const currentStepElementIds = currentStepMarks.map((m) => m.elementId).filter(Boolean);

    if (currentStepElementIds.length > 0 && !isEndRecording && nextStepId) {
      const navScript = this._buildNavScript(currentStepElementIds, nextStepId);
      if ($('body').length) {
        $('body').append(navScript);
      }
    }

    const htmlFilename = stepId + '.html';
    const htmlContent = $.html();

    return {
      stepId,
      nextStepId,
      htmlContent,
      cssContent,
      htmlFile: htmlFilename,
      cssFile: cssFilename,
      elementIds: currentStepElementIds,
      marks: currentStepMarks.map((m) => ({
        elementId: m.elementId,
        mainTitle: m.mainTitle,
        subTitle: m.subTitle || '',
        isInIframe: !!m.isInIframe,
        iframeSrc: m.iframeSrc || '',
      })),
      isEndRecording,
      iframeFiles,
    };
  }

  /**
   * 修复资源 URL（相对路径转绝对路径）
   */
  _fixResourceUrls($, baseUrl) {
    const urlSelectors = [
      { sel: 'img[src]', attr: 'src' },
      { sel: 'video[src]', attr: 'src' },
      { sel: 'audio[src]', attr: 'src' },
      { sel: 'source[src]', attr: 'src' },
      { sel: 'video[poster]', attr: 'poster' },
      { sel: 'iframe[src]', attr: 'src' },
      { sel: 'embed[src]', attr: 'src' },
      { sel: 'object[data]', attr: 'data' },
      { sel: 'track[src]', attr: 'src' },
    ];

    for (const { sel, attr } of urlSelectors) {
      $(sel).each((_, el) => {
        const val = $(el).attr(attr);
        if (val && !val.startsWith('data:') && !val.startsWith('http')) {
          try {
            const absUrl = new URL(val, baseUrl).href;
            $(el).attr(attr, absUrl);
          } catch (e) {
            // ignore
          }
        }
      });
    }

    // 处理 srcset
    $('img[srcset], source[srcset]').each((_, el) => {
      const srcset = $(el).attr('srcset');
      if (!srcset) return;
      const newSrcset = srcset
        .split(',')
        .map((part) => {
          const [url, ...rest] = part.trim().split(/\s+/);
          if (!url || url.startsWith('data:') || url.startsWith('http')) return part;
          try {
            const absUrl = new URL(url, baseUrl).href;
            return rest.length > 0 ? absUrl + ' ' + rest.join(' ') : absUrl;
          } catch (e) {
            return part;
          }
        })
        .join(', ');
      $(el).attr('srcset', newSrcset);
    });
  }

  /**
   * 捕获 iframe 内容
   * Playwright 优势：page.frames() 直接访问所有 frame
   */
  async _captureIframes($, stepId, baseUrl) {
    const iframeFiles = [];
    const frames = this.page.frames();
    const iframeElements = $('iframe[src]');

    let iframeIndex = 0;
    for (let i = 0; i < iframeElements.length; i++) {
      const iframeEl = iframeElements[i];
      let src = $(iframeEl).attr('src');
      if (!src) continue;

      if (!src.startsWith('data:') && !src.startsWith('http')) {
        try {
          src = new URL(src, baseUrl).href;
        } catch (e) {
          continue;
        }
      }

      // 在 Playwright frames 中查找匹配的 frame
      let matchedFrame = null;
      for (const frame of frames) {
        try {
          const frameUrl = frame.url();
          const srcBase = src.split('?')[0].split('#')[0];
          const frameBase = frameUrl.split('?')[0].split('#')[0];
          if (frameBase === srcBase || frameUrl === src) {
            matchedFrame = frame;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!matchedFrame) continue;

      try {
        const iframeHtml = await matchedFrame.content();
        const processedIframe = this._processIframeHtml(iframeHtml, src);

        iframeIndex++;
        const iframeFilename = stepId + '_iframe_' + iframeIndex + '.html';
        const iframeCssFilename = stepId + '_iframe_' + iframeIndex + '.css';

        iframeFiles.push({
          filename: iframeFilename,
          content: processedIframe.html,
          cssContent: processedIframe.cssContent,
          cssFilename: iframeCssFilename,
          originalUrl: src,
        });

        $(iframeEl).attr('src', './' + iframeFilename);
        $(iframeEl).removeAttr('srcdoc');
      } catch (err) {
        console.warn('[HtmlCapture] 捕获 iframe 失败:', src, err.message);
      }
    }

    return iframeFiles;
  }

  /**
   * 处理 iframe HTML 内容
   * 移植自 google-single-page content.js processIframeHtml
   */
  _processIframeHtml(html, baseUrl) {
    const $ = cheerio.load(html, { decodeEntities: false });

    // 移除脚本和事件
    $('script').remove();
    $('noscript').remove();
    $('*').each((_, el) => {
      const attribs = el.attribs;
      if (attribs) {
        Object.keys(attribs).forEach((attr) => {
          if (attr.startsWith('on')) {
            delete attribs[attr];
          }
        });
      }
    });

    // 移除录制面板相关元素
    $('#__rec_iframe_selection_style').remove();
    $('.__rec_iframe_selection_active__').removeClass('__rec_iframe_selection_active__');
    $('meta[http-equiv="Content-Security-Policy"]').remove();
    $('base').remove();

    // 修复 CSS link href
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && !href.startsWith('data:') && !href.startsWith('http')) {
        try {
          $(el).attr('href', new URL(href, baseUrl).href);
        } catch (e) {
          // ignore
        }
      }
    });

    // 提取内联样式
    let cssContent = '';
    $('style').each((_, el) => {
      const content = $(el).text() || '';
      cssContent += '/* ===== inline style (iframe) ===== */\n' + fixCssUrls(content, baseUrl) + '\n\n';
    });

    // 修复资源 URL
    this._fixResourceUrls($, baseUrl);

    cssContent = deduplicateCSS(cssContent);

    return {
      html: '<!DOCTYPE html>\n' + $.html(),
      cssContent,
    };
  }

  /**
   * 构建步骤跳转脚本
   * ★ 协议检测：file:// 用相对路径，http/https 用 originName 绝对路径
   * originName 默认 null（本地预览），保存时由 recorder._injectOriginName() 注入远端地址
   */
  _buildNavScript(elementIds, nextStepId) {
    const elementIdsJson = JSON.stringify(elementIds);
    return `<script>(function() {
  var elementIds = ${elementIdsJson};
  var nextStep = "${nextStepId}";
  var originName = null;
  function handleClick() {
    var baseUrl = (window.location.protocol === 'file:' || !originName)
      ? './'
      : originName;
    window.location.href = baseUrl + nextStep + '.html';
  }
  elementIds.forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', handleClick);
    el.style.cursor = 'pointer';
  });
})();</script>`;
  }
}

module.exports = { HtmlCapture };
