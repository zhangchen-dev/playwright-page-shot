/**
 * 真单测：require 真实 recorder.js，用 aaa-test 真实"带缺口+陈旧双脚本"数据验证 _sequentialRenumber
 */
const fs = require('fs');
const path = require('path');
const { Recorder } = require('./src/recorder');

const SRC = 'D:/shots-htmls/aaa-test';
function read(f) { return fs.readFileSync(path.join(SRC, f), 'utf-8'); }

// 从导出文件构造快照（复现 bug：stepId 带缺口、step2 含双脚本、跨主模块）
const raw = [
  { stepId: 'step1', file: 'step1.html', mod: 0 },
  { stepId: 'step2', file: 'step2.html', mod: 0 }, // 含 step3 + step9 两条陈旧脚本
  { stepId: 'step9', file: 'step9.html', mod: 1 },
  { stepId: 'step12', file: 'step12.html', mod: 1 },
];

const mainModules = [
  { mainModuleName: 'M1', subModules: [{ mainStepTitle: '', steps: [], introduction: null }] },
  { mainModuleName: 'M2', subModules: [{ mainStepTitle: '', steps: [], introduction: null }] },
];

for (const r of raw) {
  const htmlContent = read(r.file);
  const snapshot = {
    stepId: r.stepId,
    htmlFile: r.file,
    cssFile: r.stepId + '.css',
    htmlContent,
    // 陈旧/错误的 nextStepId（复现录制时的 bug 值）
    nextStepId: r.stepId === 'step1' ? 'step2'
      : r.stepId === 'step2' ? 'step3'   // 指向不存在的 step3
      : r.stepId === 'step9' ? 'step10'  // 指向不存在的 step10
      : 'step13',                        // 指向不存在的 step13
    elementIds: ['__TEST_EL__'],
    iframeFiles: [{
      filename: r.stepId + '_iframe_1.html',
      content: '<!DOCTYPE html><html><head></head><body>iframe</body></html>',
      cssFilename: null,
      cssContent: '',
    }],
    isEndRecording: false,
    marks: [],
  };
  mainModules[r.mod].subModules[0].steps.push(snapshot);
}

const rec = new Recorder({ outputDir: 'D:/tmp_test_out', onStateChange() {}, onCaptureProgress() {} });
rec.mainModules = mainModules;
rec.stepCount = 12; // 模拟会话内累计计数

// 执行被修复的核心方法
rec._sequentialRenumber();

// ===== 断言 =====
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')); }
}

const flat = [
  ...mainModules[0].subModules[0].steps,
  ...mainModules[1].subModules[0].steps,
];

console.log('\n[1] 命名是否顺序无缺口 step1..step4');
const expectFiles = ['step1.html', 'step2.html', 'step3.html', 'step4.html'];
flat.forEach((s, i) => check('  ' + s.stepId + ' → ' + s.htmlFile, s.htmlFile === expectFiles[i], s.htmlFile));

console.log('\n[2] nextStepId 跨模块连续（step2 不再断链为 null，指 step3）');
const expectNext = ['step2', 'step3', 'step4', null];
flat.forEach((s, i) => check('  ' + s.stepId + ' nextStepId=' + s.nextStepId, s.nextStepId === expectNext[i], s.nextStepId));
check('  step2 跨模块指向 step3（关键修复）', flat[1].nextStepId === 'step3', flat[1].nextStepId);

console.log('\n[3] 每页导航脚本数量：非末页=1，末页=0');
const navRe = /<script>\s*\(function\(\)\s*\{[\s\S]*?var nextStep = "[^"]*";[\s\S]*?\}\)\(\);\s*<\/script>/g;
flat.forEach((s, i) => {
  const n = (s.htmlContent.match(navRe) || []).length;
  const want = i < 3 ? 1 : 0;
  check('  ' + s.stepId + ' nav脚本数=' + n, n === want, 'want ' + want);
});

console.log('\n[4] 陈旧脚本是否清除（不应残留指向缺失文件的 step9/step10/step13 目标；step3 现为合法目标）');
flat.forEach((s) => {
  check('  ' + s.stepId + ' 无陈旧 step9/step10/step13 目标',
    !/var nextStep = "(step9|step10|step13)";/.test(s.htmlContent));
});

console.log('\n[5] 非末页脚本的 nextStep 值与字段一致 + 使用 iframe 感知 findElementById');
for (let i = 0; i < 3; i++) {
  const s = flat[i];
  const m = s.htmlContent.match(/var nextStep = "([^"]*)";/);
  check('  ' + s.stepId + ' 脚本nextStep=' + (m && m[1]), m && m[1] === s.nextStepId, m && m[1]);
  check('  ' + s.stepId + ' 含 findElementById（iframe 感知）', s.htmlContent.includes('function findElementById'));
}

console.log('\n[6] 资源引用改名：原 step9/step12 的 css/iframe 引用已更新，无旧名残留');
const step3 = flat[2]; // 原 step9
check('  原step9 页面引用 ./step3.css', step3.htmlContent.includes('./step3.css'), 'missing');
check('  原step9 页面引用 ./step3_iframe_1.html', step3.htmlContent.includes('./step3_iframe_1.html'), 'missing');
check('  原step9 页面无 ./step9.css 残留', !step3.htmlContent.includes('./step9.css'));
const step4 = flat[3];
check('  原step12 页面引用 ./step4.css', step4.htmlContent.includes('./step4.css'));

console.log('\n[7] stepCount 已重置为实际步数 4');
check('  rec.stepCount=4', rec.stepCount === 4, rec.stepCount);

console.log(`\n==== 结果：通过 ${pass}，失败 ${fail} ====`);
process.exit(fail === 0 ? 0 : 1);
