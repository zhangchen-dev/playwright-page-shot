/**
 * electron-builder 配置（CommonJS）
 *
 * ★ 2026-08-20：移除外部 Playwright 依赖。
 *   应用仅使用 Electron 自带的 webview（<webview> 标签）进行录制 / 预览，
 *   不再打包 Playwright 的 Chromium（约 150MB+），安装包显著变小。
 *   executableName 用 ASCII，避免中文 exe 路径导致 Electron 启动异常。
 */
const path = require('path');

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
