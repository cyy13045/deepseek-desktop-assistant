'use strict';
// 配置持久化：%APPDATA%\deepseek-desktop-assistant\config.json
// API Key 使用 Electron safeStorage（Windows 下走 DPAPI）加密后落盘，不可用时退回明文。
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const ENC_PREFIX = 'enc:v1:';

// 用文字描述设计音色时的预设描述。默认这条是按 DeepSeek 桌面助手的使用场景调的：
// 冷静、清晰、有一点科技感，不做播音腔，适合念技术结论和代码说明。
const VOICE_PRESETS = [
  {
    id: 'deepseek',
    name: '沉稳科技感（推荐 · 贴合 DeepSeek）',
    desc: '一个沉稳、清晰、带一点科技感的中文青年男声：音色干净、偏中性偏低，语速中等偏慢，吐字清楚，语气专业冷静而不冷漠，像一位可靠的技术助手在耐心讲解；句尾自然收束，不过分热情，不做播音腔。',
  },
  {
    id: 'neutral',
    name: '中性电子感',
    desc: '一个中性、略带电子感的中文声音：音色干净平衡、不刻意强调性别，语速中等，吐字均匀清晰，语气平静克制而友好，带有轻微的智能助手气质，适合长时间聆听。',
  },
  {
    id: 'calm_female',
    name: '清亮冷静女声',
    desc: '一个清亮、干净的中文青年女声：音色偏中性，不带甜腻感，语速中等，吐字清洁干脆，语气冷静理性、温和有分寸，像一位专业的技术顾问在条理分明地说明问题。',
  },
  {
    id: 'warm',
    name: '温和亲切男声',
    desc: '一个温和、亲切的中文男声：音色偏暖略带厚度，语速偏慢，吐字柔和清楚，语气耐心友好而不轻浮，像一位愿意慢慢把问题讲明白的朋友。',
  },
];

const DEFAULT_VOICE_DESIGN = VOICE_PRESETS[0].desc;

const DEFAULTS = {
  deepseek: {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    thinking: false,
    reasoningEffort: 'low',
    imageDetail: 'original',
    maxTokens: 4096,
  },
  mimo: {
    apiKey: '',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    // voiceMode:
    //   'design' = 用文字描述设计专属音色。voicedesign 生成一次后把参考音频固化到本地，
    //              之后所有分块都用 voiceclone 复用同一份参考，保证音色前后一致。
    //   'preset' = 直接用 mimo-v2.5-tts 的 9 个内置音色。
    voiceMode: 'design',
    ttsModel: 'mimo-v2.5-tts',
    designModel: 'mimo-v2.5-tts-voicedesign',
    cloneModel: 'mimo-v2.5-tts-voiceclone',
    voice: '白桦',
    voiceDesign: DEFAULT_VOICE_DESIGN,
    format: 'mp3',
    autoSpeak: true,
    style: '',
    chunkSize: 60,
  },
  ui: {
    edge: 'right',
    offsetY: null,
    size: 56,
    opacity: 0.96,
    alwaysOnTop: true,
    autoLaunch: false,
    hideDelayMs: 380,
  },
  systemPrompt: '你是一个中文桌面助手。用户会发来屏幕截图和问题：请结合截图中的实际内容回答，条理清晰、简明扼要；看不清或不确定的地方要明说，不要编造。',
  maxContextMessages: 20,
  maxImagesInContext: 2,
};

const VOICES = ['mimo_default', '冰糖', '茉莉', '苏打', '白桦', 'Mia', 'Chloe', 'Milo', 'Dean'];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const [k, v] of Object.entries(patch || {})) {
    if (isPlainObject(v) && isPlainObject(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function encryptSecret(plain) {
  if (!plain) return '';
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return ENC_PREFIX + safeStorage.encryptString(String(plain)).toString('base64');
    }
  } catch (e) { /* 退回明文 */ }
  return String(plain);
}

function decryptSecret(v) {
  if (typeof v !== 'string' || !v) return '';
  if (!v.startsWith(ENC_PREFIX)) return v; // 明文（例如 init-config 写入的）
  try {
    return safeStorage.decryptString(Buffer.from(v.slice(ENC_PREFIX.length), 'base64'));
  } catch (e) {
    return '';
  }
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'config.json');
    this._cfg = null;
  }

  load(force) {
    if (this._cfg && !force) return this._cfg;
    let raw = {};
    try {
      if (fs.existsSync(this.file)) raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {};
    } catch (e) { raw = {}; }
    const cfg = deepMerge(DEFAULTS, raw);
    // 老配置没有 voiceDesign，或留空时补上默认描述
    if (!cfg.mimo.voiceDesign) cfg.mimo.voiceDesign = DEFAULT_VOICE_DESIGN;
    cfg.deepseek.apiKey = decryptSecret(cfg.deepseek.apiKey);
    cfg.mimo.apiKey = decryptSecret(cfg.mimo.apiKey);
    this._cfg = cfg;
    return cfg;
  }

  /** 明文配置（主进程内部用） */
  get() { return this.load(); }

  /** 写入部分配置；patch 中的 Key 会被加密。返回新的明文配置。 */
  update(patch) {
    const merged = deepMerge(this.load(), patch || {});
    this._cfg = merged;
    this._persist();
    return merged;
  }

  _persist() {
    const cfg = this._cfg;
    const onDisk = deepMerge(cfg, {
      deepseek: { apiKey: encryptSecret(cfg.deepseek.apiKey) },
      mimo: { apiKey: encryptSecret(cfg.mimo.apiKey) },
    });
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(onDisk, null, 2), 'utf8');
    } catch (e) {
      console.error('[store] 写入配置失败:', e.message);
    }
  }

  /** 供设置界面展示：Key 只回传掩码，绝不回传明文 */
  publicView() {
    const cfg = this.load();
    return deepMerge(cfg, {
      deepseek: { apiKey: '', apiKeySet: !!cfg.deepseek.apiKey, apiKeyMask: mask(cfg.deepseek.apiKey) },
      mimo: { apiKey: '', apiKeySet: !!cfg.mimo.apiKey, apiKeyMask: mask(cfg.mimo.apiKey) },
    });
  }
}

function mask(key) {
  if (!key) return '';
  if (key.length <= 10) return key.slice(0, 3) + '***';
  return key.slice(0, 6) + '...' + key.slice(-4);
}

module.exports = { Store, DEFAULTS, VOICES, VOICE_PRESETS, DEFAULT_VOICE_DESIGN, deepMerge, mask, encryptSecret, decryptSecret };
