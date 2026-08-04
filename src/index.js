#!/usr/bin/env node
/**
 * playwright-page-shot - 基于 Playwright 的网页录制工具
 * CLI 入口
 */
const { Command } = require('commander');
const path = require('path');
const { BrowserManager } = require('./browser-manager');
const { WsServer } = require('./ws-server');
const { Recorder } = require('./recorder');

const program = new Command();

program
  .name('playwright-page-shot')
  .description('基于 Playwright 的网页录制工具')
  .version('1.0.0')
  .option('--url <url>', '初始导航 URL', '')
  .option('--port <port>', 'WebSocket 端口', '9222')
  .option('--output <dir>', '输出目录', path.join(__dirname, '..', 'output'))
  .option('--viewport-width <width>', '视口宽度', '1920')
  .option('--viewport-height <height>', '视口高度', '1080')
  .parse();

async function main() {
  const opts = program.opts();
  const wsPort = parseInt(opts.port, 10);
  const outputDir = path.resolve(opts.output);

  console.log('====================================');
  console.log('  Playwright 页面录制工具');
  console.log('====================================');
  console.log(`  WebSocket 端口: ${wsPort}`);
  console.log(`  输出目录: ${outputDir}`);
  console.log(`  视口: ${opts.viewportWidth}x${opts.viewportHeight}`);
  if (opts.url) console.log(`  初始 URL: ${opts.url}`);
  console.log('====================================\n');

  // 1. 创建录制器 (状态中心)
  const recorder = new Recorder({ outputDir });

  // 2. 创建 WebSocket 服务
  const wsServer = new WsServer({ port: wsPort, recorder });
  wsServer.start();

  // 3. 创建浏览器管理器
  const browserManager = new BrowserManager({
    wsServer,
    recorder,
    viewport: { width: parseInt(opts.viewportWidth, 10), height: parseInt(opts.viewportHeight, 10) },
  });

  // 将 browserManager 注入 recorder 以便调用 HtmlCapture
  recorder.setBrowserManager(browserManager);

  // 4. 启动浏览器
  await browserManager.launch(opts.url);

  // 5. 等待用户操作
  console.log('[main] 录制会话已启动，请在浏览器中进行操作...');
  console.log('[main] 按 Ctrl+C 结束会话\n');

  // 优雅关闭
  const cleanup = async () => {
    console.log('\n[main] 正在关闭...');
    try {
      await browserManager.close();
    } catch (e) { /* ignore */ }
    try {
      wsServer.close();
    } catch (e) { /* ignore */ }
    console.log('[main] 已关闭');
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // 防止进程退出
  process.stdin.resume();
}

main().catch((err) => {
  console.error('[main] 启动失败:', err);
  process.exit(1);
});
