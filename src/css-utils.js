/**
 * CSS 工具函数 - 移植自 google-single-page content.js
 * 提供 CSS URL 修复和去重功能
 */

/**
 * 修复 CSS 中的 url() 引用，将相对路径转为绝对路径
 * @param {string} css - CSS 文本
 * @param {string} cssUrl - CSS 文件的原始 URL（用于解析相对路径）
 * @returns {string} 修复后的 CSS
 */
function fixCssUrls(css, cssUrl) {
  if (!css) return css;
  let baseUrl;
  try {
    const urlObj = new URL(cssUrl);
    const pathDir = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
    baseUrl = urlObj.origin + pathDir;
  } catch (e) {
    return css;
  }

  return css.replace(
    /url\(\s*(['"]?)(.*?)\1\s*\)/gi,
    (match, quote, urlPath) => {
      urlPath = urlPath.trim();

      if (
        !urlPath ||
        urlPath.startsWith('data:') ||
        urlPath.startsWith('http://') ||
        urlPath.startsWith('https://') ||
        urlPath.startsWith('//') ||
        urlPath.startsWith('#') ||
        urlPath.startsWith('chrome:') ||
        urlPath.startsWith('chrome-extension:')
      ) {
        return match;
      }

      try {
        let absUrl;
        if (urlPath.startsWith('/')) {
          absUrl = new URL(urlPath, new URL(cssUrl).origin).href;
        } else {
          absUrl = new URL(urlPath, baseUrl).href;
        }
        return 'url(' + quote + absUrl + quote + ')';
      } catch (e) {
        return match;
      }
    }
  );
}

/**
 * CSS 去重 - 移除重复的 CSS 规则
 * @param {string} css - CSS 文本
 * @returns {string} 去重后的 CSS
 */
function deduplicateCSS(css) {
  if (!css || !css.trim()) return css;

  let normalized = css.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const resultLines = [];
  let currentRule = '';

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    currentRule += (currentRule ? ' ' : '') + line;

    if (line.endsWith('}')) {
      const rule = normalizeCSSRule(currentRule);
      if (rule && !resultLines.includes(rule)) {
        resultLines.push(rule);
      } else if (!rule) {
        resultLines.push(currentRule);
      }
      currentRule = '';
    }
  }

  return resultLines.join('\n');
}

/**
 * 规范化单条 CSS 规则
 * @param {string} rule - CSS 规则文本
 * @returns {string} 规范化后的规则
 */
function normalizeCSSRule(rule) {
  if (!rule || !rule.trim()) return '';

  const openBrace = rule.indexOf('{');
  const closeBrace = rule.lastIndexOf('}');

  if (openBrace === -1 || closeBrace === -1 || closeBrace <= openBrace) {
    return '';
  }

  let selector = rule.substring(0, openBrace).trim();
  let properties = rule.substring(openBrace + 1, closeBrace).trim();

  if (!selector || !properties) return '';

  selector = selector.replace(/\s+/g, ' ').trim();
  properties = properties.replace(/\s+/g, ' ').trim().replace(/;$/, '');

  return selector + ' { ' + properties + ' }';
}

module.exports = { fixCssUrls, deduplicateCSS, normalizeCSSRule };
