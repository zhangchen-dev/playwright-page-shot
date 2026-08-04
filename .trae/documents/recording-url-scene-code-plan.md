# 录制工具改造计划：本地/远端同 HTML + 环境配置 + 场景码自动生成

## 概述

三项改造：
1. **本地预览与远端加载共用同一份 HTML** — 导航脚本运行时检测协议，`file://` 用相对路径，`http/https` 用嵌入的 `originName` 绝对地址
2. **保存时地址配置改造** — 用环境选择器（本地/开发/生产）+ 场景码替代当前的单 URL 输入框；远端 URL 格式为 `域名 + 场景码 + / + 文件名.html`
3. **场景码自动生成** — 用户输入场景名称时自动生成 `场景名称 + _ + 4位随机码`（如 `userManagement_A3B2`），在保存对话框中预填且可编辑

## 当前状态分析

### 关键文件与逻辑

| 文件 | 关键逻辑 | 需要改动 |
|------|----------|----------|
| [html-capture.js](file:///d:/code_prj/playwright-page-shot/src/html-capture.js#L350-L365) | `_buildNavScript()` 生成导航脚本，固定用 `window.location.href = "./" + nextStep + ".html"` | 改为协议检测 |
| [recorder.js](file:///d:/code_prj/playwright-page-shot/src/recorder.js#L298-L360) | `_endAndSave()` 接收 `resourceBaseUrl`；`_fixStepNavigationLinks()` 修复导航链接；`_applyResourceBaseUrl()` 已弃用（未调用） | 新增 sceneCode 字段 + originName 注入 |
| [export.js](file:///d:/code_prj/playwright-page-shot/src/export.js#L74-L176) | `_buildConfig()` 生成 demo_config.json，url 数组当前为单元素 | 改为双元素数组 + 新 URL 格式 |
| [panel.js](file:///d:/code_prj/playwright-page-shot/src/renderer/panel.js#L311-L370) | `renderConfigPhase()` 场景配置 UI（sceneTitle/sceneSubTitle/sceneName） | 新增场景码自动生成显示 |
| [panel.js](file:///d:/code_prj/playwright-page-shot/src/renderer/panel.js#L977-L1017) | `handleEndAndSave()` + `showBaseUrlDialog()` | 替换为新环境配置对话框 |

### 当前 URL 生成逻辑（export.js L146-L148）

```javascript
const htmlUrl = resourceBaseUrl
  ? resourceBaseUrl + '/' + snapshot.htmlFile
  : '/' + sceneConfig.sceneName + '/' + snapshot.htmlFile;
```

### 参考格式（D:\code_prj\google-single-page\demo_config.json）

```json
"url": [
  "https://xft-service-marketing-g01.paas.cmbchina.cn/resource/file/demonstration/step1_xxx.html",
  "https://s3gw.paas.cmbchina.cn"
]
```

- url 是**双元素数组**：[HTML 文件地址, S3 网关地址]
- S3 网关地址固定为 `https://s3gw.paas.cmbchina.cn`

---

## 改动详情

### 1. `src/html-capture.js` — 导航脚本协议检测

**修改 `_buildNavScript(elementIds, nextStepId)` 方法**：

将固定的相对路径导航改为运行时协议检测：

```javascript
_buildNavScript(elementIds, nextStepId) {
  const elementIdsJson = JSON.stringify(elementIds);
  return `<script>(function() {
  var elementIds = ${elementIdsJson};
  var nextStep = "${nextStepId}";
  var originName = null; // ★ 保存时由 recorder 注入远端地址
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
```

- `originName` 默认 `null` → 使用 `./`（相对路径，本地预览生效）
- 保存时由 recorder 替换为远端绝对路径（如 `https://xft-service-marketing.paas.cmbchina.cn/resource/file/demonstration/userManagement_A3B2/`）
- 当页面通过 `http/https` 加载且 `originName` 不为 null → 使用绝对路径跳转

**同步修改 `recorder.js` 中的 `_fixStepNavigationLinks()`**（L428-L466）：

该方法在修复 nextStepId 时会重建导航脚本。需要同步更新其中的 navScript 模板，保持与 `_buildNavScript` 一致的协议检测逻辑：

```javascript
// L457-L458 附近的 navScript 构建也要改为协议检测版本
const navScript =
  '<script>(function() {\n' +
  '  var elementIds = ' + elementIdsJson + ';\n' +
  '  var nextStep = "' + correctNextStepId + '";\n' +
  '  var originName = null;\n' +
  '  function handleClick() {\n' +
  '    var baseUrl = (window.location.protocol === "file:" || !originName) ? "./" : originName;\n' +
  '    window.location.href = baseUrl + nextStep + ".html";\n' +
  '  }\n' +
  // ... rest same
```

### 2. `src/recorder.js` — 场景码 + originName 注入

#### 2.1 新增字段

构造函数中新增：
```javascript
this.sceneCode = '';       // ★ 场景码（场景名称+随机码）
this.environment = 'local'; // ★ 环境选择: 'local' | 'dev' | 'prd'
this.envBaseUrl = '';      // ★ 环境对应的远端基地址
```

`getState()` 中新增返回 `sceneCode`。

#### 2.2 修改 `_startRecording(msg)`

接收 `sceneCode` 参数：
```javascript
_startRecording(msg) {
  const { sceneTitle, sceneSubTitle, sceneName, sceneCode } = msg;
  // ... existing logic ...
  this.sceneCode = sceneCode || sceneName;
  // ...
}
```

#### 2.3 新增 `_injectOriginName(originName)` 方法

在 `_endAndSave()` 中、`_fixStepNavigationLinks()` 之后调用：

```javascript
_injectOriginName(originName) {
  if (!originName) return;
  // 确保末尾有 /
  if (!originName.endsWith('/')) originName += '/';
  
  for (const mainMod of this.mainModules) {
    for (const subMod of mainMod.subModules) {
      if (!subMod.steps) continue;
      for (const snapshot of subMod.steps) {
        // 替换导航脚本中的 originName
        const oldVar = 'var originName = null;';
        const newVar = 'var originName = "' + originName + '";';
        if (snapshot.htmlContent.includes(oldVar)) {
          snapshot.htmlContent = snapshot.htmlContent.split(oldVar).join(newVar);
        }
      }
    }
  }
}
```

#### 2.4 修改 `_endAndSave(msg)`

接收新参数 `environment`, `sceneCode`, `envBaseUrl`：

```javascript
async _endAndSave(msg) {
  const { pageId, modName, mainModName, mainModDesc, introduction,
          environment, sceneCode, envBaseUrl } = msg;
  
  // ... existing mark/module logic ...
  
  this.environment = environment || 'local';
  this.sceneCode = sceneCode || this.sceneCode;
  this.envBaseUrl = envBaseUrl || '';
  
  try {
    this._fixStepNavigationLinks();
    
    // ★ 注入 originName（仅远端环境）
    if (this.environment !== 'local' && this.envBaseUrl) {
      const originName = this.envBaseUrl + this.sceneCode + '/';
      this._injectOriginName(originName);
    }
    
    const exporter = new Exporter({ outputDir: this.outputDir });
    const result = await exporter.exportRecording(this);
    // ... rest same
  }
}
```

### 3. `src/export.js` — URL 格式改造

#### 3.1 修改导出目录名

使用 `sceneCode` 作为导出目录名（替代 `sceneName`）：

```javascript
async exportRecording(recorder) {
  const { mainModules, sceneConfig, resourceBaseUrl, sceneCode } = recorder;
  const dirName = sceneCode || sceneConfig.sceneName || 'recording';
  // ... rest same
}
```

#### 3.2 修改 `_buildConfig()` URL 生成

```javascript
_buildConfig(recorder) {
  const { sceneConfig, mainModules, environment, envBaseUrl, sceneCode } = recorder;
  const code = sceneCode || sceneConfig.sceneName || 'demonstrationCaseCode';
  const s3Gateway = 'https://s3gw.paas.cmbchina.cn'; // ★ S3 网关固定地址
  
  // ... topObject construction same, but use `code` from sceneCode ...
  
  // 在 guideComponent 中构建 url 数组
  for (const snapshot of subMod.steps) {
    // ...
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
      // ... rest same
    };
  }
}
```

### 4. `renderer/panel.js` — 场景码生成 + 环境配置对话框

#### 4.1 场景码自动生成（配置阶段）

在 `renderConfigPhase()` 中，当用户输入「场景名称」时自动生成场景码：

```javascript
// 在 sceneNameInput 旁边新增场景码显示
configBox.appendChild(labelEl('场景码（自动生成）', false));
const sceneCodeInput = el('input', 'input-field');
sceneCodeInput.type = 'text';
sceneCodeInput.id = 'sceneCodeInput';
sceneCodeInput.placeholder = '输入场景名称后自动生成';
sceneCodeInput.readOnly = true;
sceneCodeInput.style.opacity = '0.7';
configBox.appendChild(sceneCodeInput);

// 监听 sceneName 输入，自动生成场景码
nameInput.addEventListener('input', () => {
  const name = nameInput.value.trim();
  if (name) {
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    sceneCodeInput.value = name + '_' + random;
  } else {
    sceneCodeInput.value = '';
  }
  updateStartBtn();
});
```

修改 `startRecording` 发送数据，增加 `sceneCode`：
```javascript
sendAction('startRecording', {
  sceneTitle: title,
  sceneSubTitle: subtitleInput.value.trim(),
  sceneName: name,
  sceneCode: sceneCodeInput.value.trim(), // ★ 新增
});
```

#### 4.2 替换 `showBaseUrlDialog()` 为 `showEnvConfigDialog()`

新对话框包含：
- 环境选择器（单选按钮组）：本地预览 / 开发环境(dev) / 生产环境(prd)
- 场景码输入框（预填，可编辑）
- URL 预览（实时显示最终拼接格式）

```javascript
function showEnvConfigDialog(defaultSceneCode) {
  return new Promise((resolve) => {
    const ENV_URLS = {
      dev: 'https://xft-service-marketing.paas.cmbchina.cn/resource/file/demonstration/',
      prd: 'https://xft-service-marketing.paas.cmbchina.cn/resource/file/demonstration/',
    };
    
    const overlay = el('div', 'dialog-overlay');
    const dialog = el('div', 'dialog');
    dialog.style.width = '380px';
    
    dialog.appendChild(el('div', 'dialog-title', '资源配置'));
    
    // 环境选择
    dialog.appendChild(labelEl('选择环境', true));
    const envGroup = el('div', 'env-radio-group');
    
    const envs = [
      { value: 'local', label: '🏠 本地预览（相对路径）' },
      { value: 'dev', label: '🔧 开发环境 (dev)' },
      { value: 'prd', label: '🚀 生产环境 (prd)' },
    ];
    
    let selectedEnv = 'local';
    
    envs.forEach((env) => {
      const radioLabel = el('label', 'env-radio-item');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'envSelect';
      radio.value = env.value;
      radio.checked = env.value === 'local';
      radio.addEventListener('change', () => {
        selectedEnv = env.value;
        updateUrlPreview();
      });
      radioLabel.appendChild(radio);
      radioLabel.appendChild(el('span', '', env.label));
      envGroup.appendChild(radioLabel);
    });
    dialog.appendChild(envGroup);
    
    // 场景码输入
    dialog.appendChild(labelEl('场景码', true));
    const sceneCodeInput = el('input', 'dialog-input');
    sceneCodeInput.type = 'text';
    sceneCodeInput.value = defaultSceneCode || '';
    sceneCodeInput.placeholder = '请输入场景码';
    sceneCodeInput.addEventListener('input', updateUrlPreview);
    dialog.appendChild(sceneCodeInput);
    
    // URL 预览
    const previewBox = el('div', 'env-url-preview');
    dialog.appendChild(previewBox);
    
    function updateUrlPreview() {
      const code = sceneCodeInput.value.trim() || '场景码';
      if (selectedEnv === 'local') {
        previewBox.textContent = '本地: ./step1.html';
      } else {
        const base = ENV_URLS[selectedEnv];
        previewBox.textContent = '远端: ' + base + code + '/step1.html';
      }
    }
    updateUrlPreview();
    
    // 按钮
    const btnRow = el('div', 'dialog-btn-row');
    const confirmBtn = el('button', 'dialog-confirm-btn blue', '确认');
    confirmBtn.addEventListener('click', () => {
      const sceneCode = sceneCodeInput.value.trim();
      if (selectedEnv !== 'local' && !sceneCode) {
        // 远端环境必须填写场景码
        sceneCodeInput.style.borderColor = 'var(--accent-red)';
        return;
      }
      overlay.remove();
      resolve({
        environment: selectedEnv,
        sceneCode: sceneCode,
        envBaseUrl: selectedEnv === 'local' ? '' : ENV_URLS[selectedEnv],
      });
    });
    btnRow.appendChild(confirmBtn);
    dialog.appendChild(btnRow);
    
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    setTimeout(() => sceneCodeInput.focus(), 50);
  });
}
```

#### 4.3 修改 `handleEndAndSave()`

```javascript
async function handleEndAndSave() {
  // ... existing mark logic ...
  
  const saveDir = await api.selectSaveDirectory();
  if (!saveDir) { ... }
  await api.setOutputDir(saveDir);
  
  // ★ 替换 showBaseUrlDialog 为 showEnvConfigDialog
  const envConfig = await showEnvConfigDialog(state.sceneCode || state.sceneConfig.sceneName);
  
  // ... collect form data ...
  
  const result = await sendAction('endAndSave', {
    // ... existing fields ...
    environment: envConfig.environment,     // ★ 新增
    sceneCode: envConfig.sceneCode,         // ★ 新增
    envBaseUrl: envConfig.envBaseUrl,       // ★ 新增
    // resourceBaseUrl 字段保留向后兼容，但不再主要使用
    resourceBaseUrl: envConfig.envBaseUrl,
  });
  
  // ... rest same
}
```

### 5. `renderer/panel.css` — 新增样式

```css
/* ===== 环境配置对话框 ===== */

.env-radio-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}

.env-radio-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  transition: all 0.15s;
}

.env-radio-item:hover {
  background: var(--bg-hover);
  border-color: var(--border-accent);
}

.env-radio-item input[type="radio"] {
  accent-color: var(--accent-blue);
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.env-url-preview {
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: 11px;
  color: var(--accent-blue-light);
  word-break: break-all;
  line-height: 1.6;
  margin-bottom: 16px;
}

/* 场景码只读输入框 */
#sceneCodeInput {
  cursor: default;
  font-family: 'Courier New', monospace;
}
```

---

## 数据流总结

```
配置阶段:
  用户输入 sceneName → 自动生成 sceneCode (sceneName_XXXX)
  → startRecording(sceneTitle, sceneName, sceneCode)

录制阶段:
  captureStep() → HTML 导航脚本含 var originName = null;

保存阶段:
  showEnvConfigDialog() → 用户选择环境 + 确认/编辑场景码
  → endAndSave(environment, sceneCode, envBaseUrl)
  → _fixStepNavigationLinks()
  → _injectOriginName(envBaseUrl + sceneCode + '/')  [仅远端]
  → exporter.exportRecording()
    → 导出目录名 = sceneCode
    → JSON url = [envBaseUrl/sceneCode/filename.html, s3gw]  [远端]
    → JSON url = [./filename.html, s3gw]  [本地]

HTML 运行时:
  file:// 协议 → originName 为 null → 用 ./ 相对路径
  http/https 协议 → originName 已注入 → 用绝对路径
```

## 环境地址配置

| 环境 | 地址 |
|------|------|
| 本地 | 无（相对路径 `./filename.html`） |
| 开发 (dev) | `https://xft-service-marketing.paas.cmbchina.cn/resource/file/demonstration/` |
| 生产 (prd) | `https://xft-service-marketing.paas.cmbchina.cn/resource/file/demonstration/` |

S3 网关地址（url 数组第二元素，固定）：`https://s3gw.paas.cmbchina.cn`

## 假设与决策

1. **场景码 = sceneName + `_` + 4位大写随机字母数字**（如 `userManagement_A3B2`），在配置阶段自动生成，保存对话框中可编辑
2. **导出目录名改用 sceneCode**（替代原来的 sceneName），确保远端上传路径一致
3. **demo_config.json 中的 demonstrationCode 等字段使用 sceneCode**（替代原来的 sceneName）
4. **HTML 导航脚本的 originName 在保存时注入**，本地预览时为 null（用相对路径）
5. **url 数组保持双元素格式** `[HTML地址, S3网关地址]`
6. **dev 和 prd 地址相同**，用户已确认这是当前状态，保留两个选项方便未来分拆
7. **CSS 和 iframe 引用保持相对路径** `./filename`，在本地和远端同目录下均能正常工作

## 验证步骤

1. 启动应用，在配置阶段输入场景名称 → 确认场景码自动生成（如 `userManagement_A3B2`）
2. 开始录制，录制 2-3 个步骤，结束保存
3. 保存对话框中选择「本地预览」→ 确认导出的 JSON url 为 `./step1.html` 格式
4. 在应用内预览导出的 HTML → 确认步骤间导航正常（相对路径跳转）
5. 重新录制保存，选择「开发环境」→ 确认 JSON url 为 `https://xft-service-marketing.paas.cmbchina.cn/resource/file/demonstration/userManagement_A3B2/step1.html`
6. 打开导出的 HTML 文件，检查导航脚本中 `originName` 已注入远端地址
7. 用浏览器以 `file://` 协议打开 HTML → 确认导航使用相对路径
8. 模拟远端加载（本地搭建 HTTP 服务器服务导出目录）→ 确认导航使用绝对路径
9. 确认 JSON url 数组为双元素 `[HTML地址, "https://s3gw.paas.cmbchina.cn"]`
