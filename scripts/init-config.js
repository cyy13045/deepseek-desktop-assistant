'use strict';
// 一次性初始化配置：把 API Key 写入 %APPDATA%\deepseek-desktop-assistant\config.json
//
// 出于安全考虑，这里不硬编码任何 Key。两种用法：
//   1) 不传 Key，只生成默认配置文件，之后在「设置」界面里填 Key（推荐）
//   2) 通过环境变量传入，便于脚本化部署：
//        $env:DS_API_KEY='sk-...'; $env:MIMO_API_KEY='sk-...'; npm run initconfig
//
// 已存在的非空 Key 不会被覆盖。
const fs = require('fs');
const path = require('path');
const os = require('os');

const APP_NAME = 'deepseek-desktop-assistant';
const dir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), APP_NAME);
const file = path.join(dir, 'config.json');
fs.mkdirSync(dir, { recursive: true });

const defaults = {
  deepseek: { apiKey: '', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', thinking: false, reasoningEffort: 'low', imageDetail: 'original', maxTokens: 4096 },
  mimo: { apiKey: '', baseUrl: 'https://api.xiaomimimo.com/v1', ttsModel: 'mimo-v2.5-tts', voice: '白桦', format: 'mp3', autoSpeak: true, style: '', chunkSize: 60 },
  ui: { edge: 'right', offsetY: null, size: 56, opacity: 0.96, alwaysOnTop: true, autoLaunch: false, hideDelayMs: 380 },
  systemPrompt: '你是一个中文桌面助手。用户会发来屏幕截图和问题：请结合截图中的实际内容回答，条理清晰、简明扼要；看不清或不确定的地方要明说，不要编造。',
  maxContextMessages: 20,
  maxImagesInContext: 2,
};

let cfg = defaults;
if (fs.existsSync(file)) {
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')) || defaults; } catch (e) { /* 损坏则重建 */ }
}
const merge = (base, cur) => Object.assign({}, base, cur || {});
cfg.deepseek = merge(defaults.deepseek, cfg.deepseek);
cfg.mimo = merge(defaults.mimo, cfg.mimo);
cfg.ui = merge(defaults.ui, cfg.ui);

const seed = { deepseek: process.env.DS_API_KEY, mimo: process.env.MIMO_API_KEY };
let seeded = 0;
for (const [section, val] of Object.entries(seed)) {
  if (val && !cfg[section].apiKey) { cfg[section].apiKey = val; seeded++; }
}

fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8');
console.log('配置已写入:', file);
console.log('DeepSeek Key:', cfg.deepseek.apiKey ? '已配置' : '未配置（请在设置界面填写）');
console.log('MiMo Key    :', cfg.mimo.apiKey ? '已配置' : '未配置（请在设置界面填写）');
if (seeded) console.log('本次通过环境变量写入了', seeded, '个 Key');
