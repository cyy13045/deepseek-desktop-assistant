'use strict';
// provider 注册表：按 protocol 分发，并把应用里的对话历史转成协议无关的 turns。
const fs = require('fs');

const openai = require('./openai');
const anthropic = require('./anthropic');
const gemini = require('./gemini');
const ttsMimo = require('./tts-mimo');
const ttsOpenai = require('./tts-openai');
const presets = require('./presets');

const CHAT_PROTOCOLS = { openai, anthropic, gemini };
const TTS_PROTOCOLS = { 'mimo-tts': ttsMimo, 'openai-tts': ttsOpenai };

const CHAT_PROTOCOL_LIST = [
  { id: 'openai', label: openai.label },
  { id: 'anthropic', label: anthropic.label },
  { id: 'gemini', label: gemini.label },
];
const TTS_PROTOCOL_LIST = [
  { id: 'mimo-tts', label: ttsMimo.label },
  { id: 'openai-tts', label: ttsOpenai.label },
];
const AUTH_LIST = [
  { id: 'bearer', label: 'Authorization: Bearer' },
  { id: 'api-key', label: 'api-key 头（MiMo / Azure）' },
  { id: 'x-api-key', label: 'x-api-key 头（Anthropic）' },
  { id: 'x-goog-api-key', label: 'x-goog-api-key 头（Gemini）' },
  { id: 'custom', label: '自定义头名' },
  { id: 'none', label: '无需认证（本地服务）' },
];

function chatProtocol(p) { return CHAT_PROTOCOLS[(p && p.protocol) || 'openai'] || openai; }
function ttsProtocol(p) { return TTS_PROTOCOLS[(p && p.protocol) || 'openai-tts'] || ttsOpenai; }

/** 历史消息 → 协议无关的 turns（图片在这里读成 base64，协议层不碰文件系统） */
function loadTurns(historyMessages, opts = {}) {
  const maxMsgs = opts.maxContextMessages || 20;
  const maxImages = opts.maxImagesInContext == null ? 2 : opts.maxImagesInContext;
  const recent = (historyMessages || []).slice(-maxMsgs).filter(m => m && (m.text || m.image));
  const withImage = [];
  recent.forEach((m, i) => { if (m.role === 'user' && m.image && m.image.file) withImage.push(i); });
  const keep = new Set(withImage.slice(-maxImages));

  return recent.map((m, i) => {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const t = { role, text: m.text || '', images: [] };
    if (role === 'user' && m.image && m.image.file && keep.has(i)) {
      try {
        t.images.push({ mime: 'image/png', base64: fs.readFileSync(m.image.file).toString('base64') });
      } catch (e) { /* 截图丢了就只发文字 */ }
    }
    return t;
  });
}

async function chatStream(provider, { systemPrompt, history, onDelta, onReasoning, signal, context }) {
  const turns = loadTurns(history, context);
  return chatProtocol(provider).chatStream(provider, { systemPrompt, turns, onDelta, onReasoning, signal });
}

async function chatOnce(provider, { systemPrompt, text, turns }) {
  const t = turns || [{ role: 'user', text: text || '', images: [] }];
  return chatProtocol(provider).chatOnce(provider, { systemPrompt: systemPrompt || '', turns: t });
}

const listModels = provider => chatProtocol(provider).listModels(provider);

async function synthesize(provider, text, opts) { return ttsProtocol(provider).synthesize(provider, text, opts || {}); }
async function designVoice(provider, desc, sample, opts) { return ttsProtocol(provider).designVoice(provider, desc, sample, opts || {}); }
const ttsNeedsVoiceRef = provider => !!ttsProtocol(provider).needsVoiceRef;
const ttsSupportsVoiceDesign = provider => !!ttsProtocol(provider).supportsVoiceDesign;

/** 供设置界面渲染用 */
function describe(provider, kind) {
  const proto = kind === 'tts' ? ttsProtocol(provider) : chatProtocol(provider);
  return {
    protocolLabel: proto.label,
    fields: proto.fields || [],
    capabilities: proto.capabilities || [],
    needsVoiceRef: !!proto.needsVoiceRef,
  };
}

/** 当前生效的 provider */
function activeChat(cfg) {
  const list = (cfg && cfg.providers && cfg.providers.chat) || [];
  return list.find(p => p.id === cfg.activeChatId) || list[0] || null;
}
function activeTts(cfg) {
  const list = (cfg && cfg.providers && cfg.providers.tts) || [];
  return list.find(p => p.id === cfg.activeTtsId) || list[0] || null;
}
function byId(cfg, kind, id) {
  const list = (cfg && cfg.providers && cfg.providers[kind]) || [];
  return list.find(p => p.id === id) || null;
}

module.exports = {
  activeChat, activeTts, byId,
  chatProtocol, ttsProtocol, loadTurns,
  chatStream, chatOnce, listModels,
  synthesize, designVoice, ttsNeedsVoiceRef, ttsSupportsVoiceDesign,
  describe,
  CHAT_PROTOCOL_LIST, TTS_PROTOCOL_LIST, AUTH_LIST,
  CHAT_PRESETS: presets.CHAT_PRESETS, TTS_PRESETS: presets.TTS_PRESETS,
  chatFromPreset: presets.chatFromPreset, ttsFromPreset: presets.ttsFromPreset, defined: presets.defined,
  DEFAULT_VOICE_DESIGN: presets.DEFAULT_VOICE_DESIGN, VOICE_DESIGN_PRESETS: presets.VOICE_DESIGN_PRESETS,
};
