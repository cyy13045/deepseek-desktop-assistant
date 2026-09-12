'use strict';
// Anthropic Messages API：POST {baseUrl}/v1/messages
// 与 OpenAI 的差别：system 是顶层参数、消息必须 user/assistant 交替且首条为 user、
// 图片用 image block 的 base64 source、max_tokens 必填、思考模式要 budget_tokens。
const { joinUrl, baseHeaders, readSse, mergeAlternating } = require('./http');

const id = 'anthropic';
const label = 'Anthropic Messages';
const API_VERSION = '2023-06-01';

function buildRequest(p, { systemPrompt, turns, stream }) {
  const merged = mergeAlternating(turns);
  const messages = merged.map(t => {
    const imgs = t.images || [];
    const canSee = imgs.length > 0 && !!p.supportsVision;
    if (!canSee) {
      const note = imgs.length ? '\n[截图已省略：当前模型未开启图片能力]' : '';
      return { role: t.role, content: (t.text || '') + note };
    }
    const content = [];
    if (t.text) content.push({ type: 'text', text: t.text });
    for (const im of imgs) {
      content.push({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.base64 } });
    }
    return { role: t.role, content };
  });
  if (!messages.length) messages.push({ role: 'user', content: '(空)' });

  let maxTokens = Math.max(256, Number(p.maxTokens) || 4096);
  const body = { model: p.model, max_tokens: maxTokens, messages, stream: !!stream };
  if (systemPrompt) body.system = systemPrompt;

  if (p.supportsThinking && p.thinking) {
    const budget = Math.max(1024, Math.min(8192, Math.floor(maxTokens / 2)));
    body.thinking = { type: 'enabled', budget_tokens: budget };
    if (maxTokens <= budget) body.max_tokens = budget + 2048; // budget 必须小于 max_tokens
    // 开启思考时不允许设置 temperature，这里刻意不发送
  } else if (p.temperature != null && p.temperature !== '') {
    body.temperature = Number(p.temperature);
  }

  const headers = Object.assign({ 'anthropic-version': API_VERSION }, baseHeaders(p));
  return { url: joinUrl(p.baseUrl, p.path || '/v1/messages'), headers, body };
}

function parseSse(json) {
  if (!json) return null;
  const t = json.type;
  if (t === 'content_block_delta' && json.delta) {
    if (json.delta.type === 'text_delta' && json.delta.text) return { delta: json.delta.text };
    if (json.delta.type === 'thinking_delta' && json.delta.thinking) return { reasoning: json.delta.thinking };
  }
  return null;
}

function parseResponse(json) {
  const blocks = (json && json.content) || [];
  let content = '', reasoning = '';
  for (const b of blocks) {
    if (b.type === 'text') content += b.text || '';
    else if (b.type === 'thinking') reasoning += b.thinking || '';
  }
  return { content, reasoning };
}

function modelsRequest(p) {
  const headers = Object.assign({ 'anthropic-version': API_VERSION }, baseHeaders(p));
  return { url: joinUrl(p.baseUrl, p.modelsPath || '/v1/models'), headers };
}
function parseModels(json) {
  const arr = json && json.data;
  if (!Array.isArray(arr)) return [];
  return arr.map(m => m && m.id).filter(Boolean);
}

async function chatStream(p, { systemPrompt, turns, onDelta, onReasoning, signal }) {
  const { url, headers, body } = buildRequest(p, { systemPrompt, turns, stream: true });
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(await describeHttp(res, p));
  let content = '', reasoning = '';
  await readSse(res, json => {
    const d = parseSse(json);
    if (!d) return;
    if (d.reasoning) { reasoning += d.reasoning; if (onReasoning) onReasoning(d.reasoning); }
    if (d.delta) { content += d.delta; if (onDelta) onDelta(d.delta); }
  });
  return { content, reasoning };
}

async function chatOnce(p, { systemPrompt, turns, signal }) {
  const { url, headers, body } = buildRequest(p, { systemPrompt, turns, stream: false });
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(await describeHttp(res, p));
  return parseResponse(await res.json());
}

async function listModels(p) {
  const { url, headers } = modelsRequest(p);
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(await describeHttp(res, p));
  return parseModels(await res.json());
}

async function describeHttp(res, p) {
  const text = await res.text().catch(() => '');
  let msg = text.slice(0, 400);
  try {
    const j = JSON.parse(text);
    msg = (j.error && (j.error.message || j.error.type)) || j.message || msg;
  } catch (e) { /* 保留原文 */ }
  const where = (p && p.name) || '该服务';
  if (res.status === 401 || res.status === 403) return where + ' 鉴权失败（HTTP ' + res.status + '）：API Key 或认证方式不对。' + (msg ? ' 详情: ' + msg : '');
  if (res.status === 404) return where + ' 接口路径不存在（HTTP 404）：检查 Base URL 与「自定义路径」。' + (msg ? ' 详情: ' + msg : '');
  if (res.status === 429) return where + ' 请求过于频繁（HTTP 429）。' + (msg ? ' 详情: ' + msg : '');
  return where + ' 请求失败（HTTP ' + res.status + '）' + (msg ? ': ' + msg : '');
}

const fields = ['baseUrl', 'apiKey', 'authHeader', 'authHeaderName', 'model', 'path', 'maxTokens', 'temperature'];
const capabilities = ['supportsVision', 'supportsThinking', 'thinking'];

module.exports = { id, label, buildRequest, parseSse, parseResponse, modelsRequest, parseModels, chatStream, chatOnce, listModels, describeHttp, fields, capabilities };
