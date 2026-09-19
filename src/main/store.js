'use strict';
// 配置持久化：%APPDATA%\deepseek-desktop-assistant\config.json
// 支持任意多个「聊天服务」与「语音服务」，每个都是独立的 provider 对象。
// 所有 provider 的 apiKey 都用 Electron safeStorage（Windows 下走 DPAPI）加密后落盘。
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');
const { chatFromPreset, ttsFromPreset, defined } = require('./providers/presets');

const ENC_PREFIX = 'enc:v1:';

const DEFAULT_SYSTEM_PROMPT = '你是一个中文桌面助手。用户会发来屏幕截图和问题：请结合截图中的实际内容回答，条理清晰、简明扼要；看不清或不确定的地方要明说，不要编造。';

const DEFAULTS = {
  providers: {
    chat: [chatFromPreset('deepseek')],
    tts: [ttsFromPreset('mimo')],
  },
  activeChatId: 'deepseek',
  activeTtsId: 'mimo',
  ui: {
    edge: 'right',
    offsetY: null,
    size: 56,
    opacity: 0.96,
    alwaysOnTop: true,
    autoLaunch: false,
    hideDelayMs: 380,
    language: 'auto',        // auto | zh-CN | zh-TW | en-US | ja-JP | ko-KR | ru-RU | es-ES | fr-FR | de-DE
  },
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  maxContextMessages: 20,
  maxImagesInContext: 2,
};

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
  if (!v.startsWith(ENC_PREFIX)) return v;
  try {
    return safeStorage.decryptString(Buffer.from(v.slice(ENC_PREFIX.length), 'base64'));
  } catch (e) {
    return '';
  }
}

function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}

function mask(key) {
  if (!key) return '';
  if (key.length <= 10) return key.slice(0, 3) + '***';
  return key.slice(0, 6) + '...' + key.slice(-4);
}

/** 老版本配置（顶层 deepseek / mimo 两段）→ 多 provider 结构 */
function migrateLegacy(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const hasNew = raw.providers && (Array.isArray(raw.providers.chat) || Array.isArray(raw.providers.tts));
  if (hasNew) return raw;
  const ds = raw.deepseek || {};
  const mi = raw.mimo || {};
  const out = Object.assign({}, raw);
  out.providers = {
    chat: [chatFromPreset('deepseek', defined({
      apiKey: ds.apiKey,
      baseUrl: ds.baseUrl,
      model: ds.model,
      thinking: ds.thinking,
      reasoningEffort: ds.reasoningEffort,
      imageDetail: ds.imageDetail,
      maxTokens: ds.maxTokens,
    }))],
    tts: [ttsFromPreset('mimo', defined({
      apiKey: mi.apiKey,
      baseUrl: mi.baseUrl,
      ttsModel: mi.ttsModel,
      designModel: mi.designModel,
      cloneModel: mi.cloneModel,
      voiceMode: mi.voiceMode,
      voice: mi.voice,
      voiceDesign: mi.voiceDesign,
      format: mi.format,
      style: mi.style,
      chunkSize: mi.chunkSize,
    }))],
  };
  delete out.deepseek;
  delete out.mimo;
  return out;
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'config.json');
    this._cfg = null;
    this._rev = 0;            // 内部配置版本号，配置一变就 +1
    this._snapshot = null;    // 对外只读快照（按版本号缓存）
    this._snapshotRev = -1;
  }

  load(force) {
    if (this._cfg && !force) return this._cfg;
    let raw = {};
    try {
      if (fs.existsSync(this.file)) raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {};
    } catch (e) { raw = {}; }
    // 老格式（顶层 deepseek / mimo）在内存里迁移一次，并立刻落盘升级，避免长期维持两种结构
    const wasLegacy = !!(raw && !raw.providers && (raw.deepseek || raw.mimo));
    const cfg = deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), migrateLegacy(raw));

    if (!Array.isArray(cfg.providers.chat) || !cfg.providers.chat.length) cfg.providers.chat = [chatFromPreset('deepseek')];
    if (!Array.isArray(cfg.providers.tts) || !cfg.providers.tts.length) cfg.providers.tts = [ttsFromPreset('mimo')];
    if (!cfg.providers.chat.some(p => p && p.id === cfg.activeChatId)) cfg.activeChatId = cfg.providers.chat[0].id;
    if (!cfg.providers.tts.some(p => p && p.id === cfg.activeTtsId)) cfg.activeTtsId = cfg.providers.tts[0].id;
    if (!cfg.systemPrompt) cfg.systemPrompt = DEFAULT_SYSTEM_PROMPT;

    for (const kind of ['chat', 'tts']) {
      for (const p of cfg.providers[kind]) {
        if (p) p.apiKey = decryptSecret(p.apiKey);
      }
    }
    this._cfg = cfg;
    this._rev++;
    if (wasLegacy) {
      try { this._persist(); console.log('[store] 已把旧版配置升级为多服务结构'); } catch (e) {}
    }
    return cfg;
  }

  /**
   * 返回一份不可变快照。
   * 之前直接返回内部对象：调用方一旦就地改写就会污染实时配置；而且配置热更新期间
   * 读到的对象与后续读取可能来自不同版本，出现「半更新」的混合状态。
   * 现在按版本号缓存一份深拷贝并冻结 —— 调用方拿到的永远是一致的只读视图，
   * 又不会每次调用都重新克隆（悬浮球的悬停轮询每 45ms 会读一次）。
   */
  get() {
    const cfg = this.load();
    if (!this._snapshot || this._snapshotRev !== this._rev) {
      this._snapshot = deepFreeze(JSON.parse(JSON.stringify(cfg)));
      this._snapshotRev = this._rev;
    }
    return this._snapshot;
  }

  update(patch) {
    const merged = deepMerge(this.load(), patch || {});
    // 深拷贝一份再存：把外部快照传进来的冻结对象解冻，保证内部状态始终可写
    this._cfg = JSON.parse(JSON.stringify(merged));
    this._rev++;
    this._persist();
    return this.get();
  }

  _persist() {
    const onDisk = JSON.parse(JSON.stringify(this._cfg));
    for (const kind of ['chat', 'tts']) {
      for (const p of onDisk.providers[kind] || []) {
        if (p) p.apiKey = encryptSecret(p.apiKey);
      }
    }
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(onDisk, null, 2), 'utf8');
    } catch (e) {
      console.error('[store] 写入配置失败:', e.message);
    }
  }

  /** 供设置界面展示：所有 Key 只回传掩码，绝不回传明文 */
  publicView() {
    const cfg = JSON.parse(JSON.stringify(this.load()));
    for (const kind of ['chat', 'tts']) {
      cfg.providers[kind] = (cfg.providers[kind] || []).map(p => {
        const view = Object.assign({}, p);
        view.apiKeySet = !!p.apiKey;
        view.apiKeyMask = mask(p.apiKey);
        view.apiKey = '';
        return view;
      });
    }
    return cfg;
  }
}

module.exports = { Store, DEFAULTS, DEFAULT_SYSTEM_PROMPT, deepMerge, mask, encryptSecret, decryptSecret };
