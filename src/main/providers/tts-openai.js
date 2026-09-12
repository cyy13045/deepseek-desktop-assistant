'use strict';
// OpenAI 兼容语音合成：POST {baseUrl}/audio/speech
// 返回的是二进制音频（不是 JSON），所以这里直接转 base64 交给渲染进程。
// 同一套协议也能对付实现了 /audio/speech 的第三方服务。
const { joinUrl, baseHeaders } = require('./http');

const id = 'openai-tts';
const label = 'OpenAI 兼容 TTS';

const MIME = {
  mp3: 'audio/mpeg', opus: 'audio/ogg', aac: 'audio/aac',
  flac: 'audio/flac', wav: 'audio/wav', pcm: 'audio/pcm',
};

const needsVoiceRef = false;
const supportsVoiceDesign = false;

async function synthesize(p, text, opts = {}) {
  const format = opts.format || p.format || 'mp3';
  const body = {
    model: p.ttsModel || 'gpt-4o-mini-tts',
    input: text,
    voice: opts.voice || p.voice || 'alloy',
    response_format: format,
  };
  // gpt-4o-mini-tts 支持 instructions 控制语气；老模型传了会报错
  const style = opts.style != null ? opts.style : p.style;
  if (style && /gpt-4o/i.test(body.model)) body.instructions = style;

  const url = joinUrl(p.baseUrl, p.path || '/audio/speech');
  const res = await fetch(url, { method: 'POST', headers: baseHeaders(p), body: JSON.stringify(body), signal: opts.signal });
  if (!res.ok) throw new Error(await describeHttp(res, p));
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('TTS 返回了空音频');
  return { base64: buf.toString('base64'), mime: MIME[format] || 'audio/mpeg', format };
}

// 该协议不支持文字设计音色
async function designVoice() {
  const e = new Error('当前语音服务不支持文字设计音色，请在设置里改用小米 MiMo，或关闭音色设计');
  e.code = 'NO_VOICE_DESIGN';
  throw e;
}

async function describeHttp(res, p) {
  const text = await res.text().catch(() => '');
  let msg = text.slice(0, 400);
  try {
    const j = JSON.parse(text);
    msg = (j.error && (j.error.message || j.error.code)) || j.message || msg;
  } catch (e) { /* 保留原文 */ }
  const where = (p && p.name) || '该服务';
  if (res.status === 401 || res.status === 403) return where + ' 鉴权失败（HTTP ' + res.status + '）：API Key 或认证方式不对。' + (msg ? ' 详情: ' + msg : '');
  if (res.status === 404) return where + ' 接口路径不存在（HTTP 404）：检查 Base URL 与「自定义路径」。' + (msg ? ' 详情: ' + msg : '');
  if (res.status === 429) return where + ' 请求过于频繁（HTTP 429）。' + (msg ? ' 详情: ' + msg : '');
  return where + ' 语音合成失败（HTTP ' + res.status + '）' + (msg ? ': ' + msg : '');
}

const fields = ['baseUrl', 'apiKey', 'authHeader', 'authHeaderName', 'ttsModel', 'voice', 'format', 'chunkSize', 'style'];
const capabilities = ['voice'];

module.exports = { id, label, needsVoiceRef, supportsVoiceDesign, synthesize, designVoice, describeHttp, MIME, fields, capabilities };
