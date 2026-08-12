/**
 * electron-builder 配置（CommonJS）
 * 相比原 electron-builder.yml 的改进：
 *  - 内置 Chromium 目录由 playwright 运行时解析，不再硬编码 `C:\Users\123\...`
 *    （换机器 / 升级 playwright 后只要执行过 `npm run install:browser` 就能正确打包）
 *  - executableName 用 ASCII，避免中文 exe 路径导致 Playwright/Chromium 启动异常
 *  - 显式声明 icon，Windows 下 electron-builder 会自动把 PNG 转成 ICO
 */
const path = require('path');
const { chromium } = require('playwright');

/** 解析本机已安装的 Chromium 根目录（如 .../ms-playwright/chromium-1234） */
function getChromiumDir() {
  const exe = chromium.executablePath(); // .../chromium-1234/chrome-win64/chrome.exe
  return path.dirname(path.dirname(exe)); // 去掉 chrome-win64/chrome.exe
}

const chromiumDir = getChromiumDir();
const chromiumRev = path.basename(chromiumDir); // chromium-1234

module.exports = {
  appId: 'com.playwright-page-shot.app',
  productName: '场景录制助手',
  executableName: 'scene-recorder',
  directories: {
    output: 'dist',
    buildResources: 'build',
  },
  // ★ 只保留中文(简体)与英文语言包，砍掉其余约 100 种 locale（省约 40MB）
  electronLanguages: ['zh-CN', 'en'],
  files: [
    'main/**/*',
    'renderer/**/*',
    'src/**/*',
    'package.json',
    '!node_modules/playwright-core/lib/server/dispatcher/**/*',
    '!node_modules/playwright-core/lib/server/hash_catalog/**/*',
  ],
  // 将 Playwright Chromium 打包进安装包，运行时由 BrowserManager 指向
  // process.resourcesPath/playwright-browser/<rev>
  extraResources: [
    {
      from: chromiumDir,
      to: `playwright-browser/${chromiumRev}`,
      filter: ['**/*'],
    },
  ],
  win: {
    target: [{ target: 'nsis', arch: 'x64' }],
    artifactName: '${productName}-${version}-win-setup.${ext}',
    icon: 'build/icon.ico',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
  mac: {
    target: [{ target: 'dmg', arch: ['x64', 'arm64'] }],
    category: 'public.app-category.developer-tools',
  },
  linux: {
    target: [{ target: 'AppImage', arch: 'x64' }],
    category: 'Development',
  },
};
