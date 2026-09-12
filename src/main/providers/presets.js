'use strict';
// 内置厂商预设。只是「预填值」——添加之后所有字段都能在设置里改。
// 模型名会随厂商更新而变化，所以设置里提供「拉取模型」按钮列出真实可用模型。

const DEFAULT_VOICE_DESIGN = '一个沉稳、清晰、带一点科技感的中文青年男声：音色干净、偏中性偏低，语速中等偏慢，吐字清楚，语气专业冷静而不冷漠，像一位可靠的技术助手在耐心讲解；句尾自然收束，不过分热情，不做播音腔。';

const CHAT_PRESETS = [
  {
    id: 'deepseek', name: 'DeepSeek', protocol: 'openai',
    baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash',
    supportsVision: true, supportsThinking: true, thinkingParam: true,
    note: 'deepseek-flash 支持图像理解；deepseek-v4-pro 是纯文本模型',
  },
  {
    id: 'openai', name: 'OpenAI', protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o',
    supportsVision: true,
    note: 'o 系列 / GPT-5 系列请把「输出上限参数名」改成 max_completion_tokens',
  },
  {
    id: 'anthropic', name: 'Anthropic Claude', protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5',
    authHeader: 'x-api-key', supportsVision: true, supportsThinking: true,
  },
  {
    id: 'gemini', name: 'Google Gemini', protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash',
    authHeader: 'x-goog-api-key', supportsVision: true,
  },
  {
    id: 'openrouter', name: 'OpenRouter（聚合网关）', protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o',
    supportsVision: true,
    extraHeaders: { 'HTTP-Referer': 'https://github.com/cyy13045/deepseek-desktop-assistant', 'X-Title': 'DeepSeek Desktop Assistant' },
    note: '一个 Key 可调多家模型，模型名带厂商前缀',
  },
  {
    id: 'siliconflow', name: '硅基流动 SiliconFlow', protocol: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-VL-72B-Instruct',
    supportsVision: true,
  },
  {
    id: 'xai', name: 'xAI Grok', protocol: 'openai',
    baseUrl: 'https://api.x.ai/v1', model: 'grok-4',
    supportsVision: true,
  },
  {
    id: 'moonshot', name: 'Moonshot Kimi', protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2-0905-preview',
    supportsVision: false,
  },
  {
    id: 'zhipu', name: '智谱 GLM', protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.5v',
    supportsVision: true,
  },
  {
    id: 'qwen', name: '阿里通义千问', protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max',
    supportsVision: true,
  },
  {
    id: 'doubao', name: '字节豆包（方舟）', protocol: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-1-6-250615',
    supportsVision: true,
    note: '方舟的模型名通常是「推理接入点 ID」，建议用「拉取模型」确认',
  },
  {
    id: 'minimax', name: 'MiniMax', protocol: 'openai',
    baseUrl: 'https://api.minimax.chat/v1', model: 'MiniMax-Text-01',
    supportsVision: false,
  },
  {
    id: 'ollama', name: 'Ollama（本地）', protocol: 'openai',
    baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5vl:7b',
    apiKey: 'ollama', authHeader: 'none', supportsVision: true,
    note: '本地服务通常不校验 Key，认证方式选「无需认证」',
  },
  {
    id: 'lmstudio', name: 'LM Studio（本地）', protocol: 'openai',
    baseUrl: 'http://localhost:1234/v1', model: 'local-model',
    apiKey: 'lm-studio', authHeader: 'none', supportsVision: true,
  },
  {
    id: 'custom', name: '自定义（OpenAI 兼容）', protocol: 'openai',
    baseUrl: 'https://your-endpoint.example.com/v1', model: '',
    supportsVision: true,
    note: '任何 OpenAI 兼容服务：vLLM / one-api / new-api / Azure OpenAI 等',
  },
];

const MIMO_VOICES = ['mimo_default', '冰糖', '茉莉', '苏打', '白桦', 'Mia', 'Chloe', 'Milo', 'Dean'];
const OPENAI_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'coral', 'sage', 'ash', 'ballad', 'verse'];

const TTS_PRESETS = [
  {
    id: 'mimo', name: '小米 MiMo', protocol: 'mimo-tts',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    ttsModel: 'mimo-v2.5-tts', designModel: 'mimo-v2.5-tts-voicedesign', cloneModel: 'mimo-v2.5-tts-voiceclone',
    voiceMode: 'design', voice: '白桦', voiceDesign: DEFAULT_VOICE_DESIGN,
    format: 'mp3', authHeader: 'api-key',
    supportsVoiceDesign: true, voices: MIMO_VOICES,
    note: '支持用文字设计专属音色，并固化为参考音频后复用',
  },
  {
    id: 'openai-tts', name: 'OpenAI TTS', protocol: 'openai-tts',
    baseUrl: 'https://api.openai.com/v1',
    ttsModel: 'gpt-4o-mini-tts', voice: 'alloy', format: 'mp3', authHeader: 'bearer',
    supportsVoiceDesign: false, voices: OPENAI_VOICES,
    note: 'gpt-4o-mini-tts 支持用「朗读风格指令」控制语气',
  },
  {
    id: 'custom-tts', name: '自定义（OpenAI 兼容 TTS）', protocol: 'openai-tts',
    baseUrl: 'https://your-endpoint.example.com/v1',
    ttsModel: '', voice: 'alloy', format: 'mp3', authHeader: 'bearer',
    supportsVoiceDesign: false, voices: OPENAI_VOICES,
    note: '任何实现了 /audio/speech 的服务',
  },
];

// 用文字设计音色时的描述预设（MiMo voicedesign 用）
const VOICE_DESIGN_PRESETS = [
  { id: 'deepseek', name: '沉稳科技感（推荐 · 贴合 DeepSeek）', desc: DEFAULT_VOICE_DESIGN },
  { id: 'neutral', name: '中性电子感', desc: '一个中性、略带电子感的中文声音：音色干净平衡、不刻意强调性别，语速中等，吐字均匀清晰，语气平静克制而友好，带有轻微的智能助手气质，适合长时间聆听。' },
  { id: 'calm_female', name: '清亮冷静女声', desc: '一个清亮、干净的中文青年女声：音色偏中性，不带甜腻感，语速中等，吐字清洁干脆，语气冷静理性、温和有分寸，像一位专业的技术顾问在条理分明地说明问题。' },
  { id: 'warm', name: '温和亲切男声', desc: '一个温和、亲切的中文男声：音色偏暖略带厚度，语速偏慢，吐字柔和清楚，语气耐心友好而不轻浮，像一位愿意慢慢把问题讲明白的朋友。' },
];

/** 预设 → 完整 provider 对象（补齐默认字段） */
function chatFromPreset(presetId, overrides) {
  const p = CHAT_PRESETS.find(x => x.id === presetId) || CHAT_PRESETS[CHAT_PRESETS.length - 1];
  return Object.assign({
    id: p.id, name: p.name, protocol: p.protocol, baseUrl: p.baseUrl, model: p.model,
    apiKey: '', authHeader: 'bearer', authHeaderName: '', extraHeaders: {},
    path: '', maxTokensParam: 'max_tokens', maxTokens: 4096, temperature: null,
    imageDetail: 'original', thinking: false, reasoningEffort: 'low',
    supportsVision: !!p.supportsVision, supportsThinking: !!p.supportsThinking,
    thinkingParam: !!p.thinkingParam,
  }, p, overrides || {});
}

function ttsFromPreset(presetId, overrides) {
  const p = TTS_PRESETS.find(x => x.id === presetId) || TTS_PRESETS[TTS_PRESETS.length - 1];
  return Object.assign({
    id: p.id, name: p.name, protocol: p.protocol, baseUrl: p.baseUrl, apiKey: '',
    authHeader: p.authHeader || 'bearer', authHeaderName: '', extraHeaders: {},
    ttsModel: p.ttsModel || '', voice: p.voice || '', format: p.format || 'mp3',
    style: '', chunkSize: 60, autoSpeak: true, designModel: '', cloneModel: '', voiceMode: 'preset',
    voiceDesign: '', supportsVoiceDesign: false, voices: [],
  }, p, overrides || {});
}

function defined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out;
}

module.exports = { CHAT_PRESETS, TTS_PRESETS, MIMO_VOICES, OPENAI_VOICES, VOICE_DESIGN_PRESETS, DEFAULT_VOICE_DESIGN, chatFromPreset, ttsFromPreset, defined };
