'use strict';
// 一次性初始化配置：写入 %APPDATA%\deepseek-desktop-assistant\config.json
//
// 出于安全考虑，这里不硬编码任何 Key。两种用法：
//   1) 直接运行，生成一份默认配置（DeepSeek + MiMo），之后在「设置」界面里填 Key
//   2) 通过环境变量预置第一个聊天/语音服务的 Key：
//        $env:DS_API_KEY='sk-...'; $env:MIMO_API_KEY='sk-...'; npm run initconfig
//
// 已存在的非空 Key 不会被覆盖。
const fs = require('fs');
const path = require('path');
const os = require('os');

// store.js 在纯 Node 下也能 require（electron 依赖只在真正调用时才需要）
const { DEFAULTS } = require('../src/main/store');

const APP_NAME = 'deepseek-desktop-assistant';
const dir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), APP_NAME);
const file = path.join(dir, 'config.json');
fs.mkdirSync(dir, { recursive: true });

let cfg = JSON.parse(JSON.stringify(DEFAULTS));
let legacy = null;
if (fs.existsSync(file)) {
  try {
    const old = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (old && old.providers) {
      cfg = old;
    } else if (old) {
      legacy = old;
      cfg.ui = Object.assign({}, cfg.ui, old.ui || {});
      if (old.systemPrompt) cfg.systemPrompt = old.systemPrompt;
      if (old.maxContextMessages) cfg.maxContextMessages = old.maxContextMessages;
      if (old.maxImagesInContext != null) cfg.maxImagesInContext = old.maxImagesInContext;
    }
  } catch (e) { /* 损坏就用默认值 */ }
}

const seedChat = process.env.DS_API_KEY;
const seedTts = process.env.MIMO_API_KEY;
let seeded = 0;
if (seedChat && cfg.providers.chat[0] && !cfg.providers.chat[0].apiKey) { cfg.providers.chat[0].apiKey = seedChat; seeded++; }
if (seedTts && cfg.providers.tts[0] && !cfg.providers.tts[0].apiKey) { cfg.providers.tts[0].apiKey = seedTts; seeded++; }

if (legacy) {
  console.log('检测到旧版配置（顶层 deepseek / mimo）：保留原文件不动，应用启动时会自动迁移成多服务结构。');
} else {
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8');
  console.log('配置已写入:', file);
  console.log('聊天服务:', cfg.providers.chat.map(p => p.name).join('、'));
  console.log('语音服务:', cfg.providers.tts.map(p => p.name).join('、'));
}
if (seeded) console.log('本次通过环境变量写入了', seeded, '个 Key');
