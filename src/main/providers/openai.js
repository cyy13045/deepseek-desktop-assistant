'use strict';
// OpenAI 兼容协议。覆盖绝大多数厂商：
// DeepSeek / OpenAI / Moonshot / 智谱 / 通义千问 / 豆包 / MiniMax / Grok /
// OpenRouter / SiliconFlow / Ollama / LM Studio / vLLM / one-api 等网关。
const { joinUrl, baseHeaders, readSse } = require('./http');

const id = 'openai';
const label = 'OpenAI 兼容（覆盖绝大多数厂商）';

function chatPath(p) { return p.path || '/chat/completions'; }

function buildRequest(p, { systemPrompt, turns, stream }) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });

  for (const t of turns) {
    if (t.role === 'assistant') { messages.push({ role: 'assistant', content: t.text || '' }); continue; }
    const imgs = t.images || [];
    const canSee = imgs.length > 0 && !!p.supportsVision;
    if (canSee) {
      const content = [];
      if (t.text) content.push({ type: 'text', text: t.text });
      for (const im of imgs) {
        content.push({ type: 'image_url', image_url: { url: 'data:' + im.mime + ';base64,' + im.base64, detail: p.imageDetail || 'original' } });
      }
      messages.push({ role: 'user', content });
    } else {
      const note = imgs.length ? '\n[截图已省略：当前模型未开启图片能力]' : '';
      messages.push({ role: 'user', content: (t.text || '') + note });
    }
  }

  const body = { model: p.model, messages, stream: !!stream };
  const mtParam = p.maxTokensParam || 'max_tokens';
  if (p.maxTokens) body[mtParam] = p.maxTokens;
  if (p.temperature != null && p.temperature !== '') body.temperature = Number(p.temperature);
  // DeepSeek 专有的思考模式开关：只有声明支持的厂商才发，否则会 400
  if (p.thinkingParam) {
    body.thinking = p.thinking ? { type: 'enabled' } : { type: 'disabled' };
    if (p.thinking && p.reasoningEffort) body.reasoning_effort = p.reasoningEffort;
  }
  return { url: joinUrl(p.baseUrl, chatPath(p)), headers: baseHeaders(p), body };
}

function parseSse(json) {
  const d = json && json.choices && json.choices[0] && json.choices[0].delta;
  if (!d) return null;
  const out = {};
  if (typeof d.content === 'string' && d.content) out.delta = d.content;
  const r = d.reasoning_content || d.reasoning;
  if (typeof r === 'string' && r) out.reasoning = r;
  return (out.delta || out.reasoning) ? out : null;
}

function parseResponse(json) {
  const m = json && json.choices && json.choices[0] && json.choices[0].message;
  if (!m) return { content: '', reasoning: '' };
  return { content: m.content || '', reasoning: m.reasoning_content || m.reasoning || '' };
}

function modelsRequest(p) {
  return { url: joinUrl(p.baseUrl, p.modelsPath || '/models'), headers: baseHeaders(p) };
}
function parseModels(json) {
  const arr = json && (json.data || json.models);
  if (!Array.isArray(arr)) return [];
  return arr.map(m => m && (m.id || m.name)).filter(Boolean);
}

/** 流式对话；返回 {content, reasoning} */
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
    msg = (j.error && (j.error.message || j.error.code)) || j.message || msg;
  } catch (e) { /* 保留原文 */ }
  const where = p && p.name ? p.name : '该服务';
  if (res.status === 401 || res.status === 403) return where + ' 鉴权失败（HTTP ' + res.status + '）：API Key 或认证方式不对。' + (msg ? ' 详情: ' + msg : '');
  if (res.status === 404) return where + ' 接口路径不存在（HTTP 404）：检查 Base URL 与「自定义路径」。' + (msg ? ' 详情: ' + msg : '');
  if (res.status === 429) return where + ' 请求过于频繁（HTTP 429）。' + (msg ? ' 详情: ' + msg : '');
  return where + ' 请求失败（HTTP ' + res.status + '）' + (msg ? ': ' + msg : '');
}

/** 该协议在设置界面需要显示哪些字段 */
const fields = ['baseUrl', 'apiKey', 'authHeader', 'authHeaderName', 'model', 'path', 'maxTokensParam', 'maxTokens', 'imageDetail', 'temperature'];
const capabilities = ['supportsVision', 'supportsThinking', 'thinking'];

module.exports = { id, label, buildRequest, buildStreamRequest: buildRequest, parseSse, parseResponse, modelsRequest, parseModels, chatStream, chatOnce, listModels, describeHttp, fields, capabilities };
