'use strict';
// Google Gemini generateContent API：
//   POST {baseUrl}/v1beta/models/{model}:generateContent
//   POST {baseUrl}/v1beta/models/{model}:streamGenerateContent?alt=sse
// 与 OpenAI 的差别：contents/parts 结构、角色是 user/model、图片用 inline_data、
// system 用 systemInstruction、参数放在 generationConfig 里。
const { joinUrl, baseHeaders, readSse, mergeAlternating } = require('./http');

const id = 'gemini';
const label = 'Google Gemini';

function buildRequest(p, { systemPrompt, turns, stream }) {
  const merged = mergeAlternating(turns);
  const contents = merged.map(t => {
    const imgs = t.images || [];
    const canSee = imgs.length > 0 && !!p.supportsVision;
    const note = (!canSee && imgs.length) ? '\n[截图已省略：当前模型未开启图片能力]' : '';
    const parts = [];
    if (t.text || note) parts.push({ text: (t.text || '') + note });
    if (canSee) for (const im of imgs) parts.push({ inline_data: { mime_type: im.mime, data: im.base64 } });
    if (!parts.length) parts.push({ text: '' });
    return { role: t.role === 'assistant' ? 'model' : 'user', parts };
  });
  if (!contents.length) contents.push({ role: 'user', parts: [{ text: '' }] });

  const body = { contents };
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };
  const gen = {};
  if (p.maxTokens) gen.maxOutputTokens = Number(p.maxTokens);
  if (p.temperature != null && p.temperature !== '') gen.temperature = Number(p.temperature);
  if (Object.keys(gen).length) body.generationConfig = gen;

  const verb = stream ? 'streamGenerateContent' : 'generateContent';
  const path = p.path || ('/v1beta/models/' + encodeURIComponent(p.model || '') + ':' + verb);
  let url = joinUrl(p.baseUrl, path);
  if (stream && !/[?&]alt=/.test(url)) url += (url.includes('?') ? '&' : '?') + 'alt=sse';
  return { url, headers: baseHeaders(p), body };
}

function partsToDelta(json) {
  const cand = json && json.candidates && json.candidates[0];
  const parts = cand && cand.content && cand.content.parts;
  if (!Array.isArray(parts)) return null;
  let delta = '', reasoning = '';
  for (const pt of parts) {
    if (!pt || typeof pt.text !== 'string') continue;
    if (pt.thought) reasoning += pt.text; else delta += pt.text;
  }
  return (delta || reasoning) ? { delta, reasoning } : null;
}

const parseSse = partsToDelta;
const parseResponse = json => partsToDelta(json) || { content: '', reasoning: '' };

function modelsRequest(p) {
  return { url: joinUrl(p.baseUrl, p.modelsPath || '/v1beta/models'), headers: baseHeaders(p) };
}
function parseModels(json) {
  const arr = json && json.models;
  if (!Array.isArray(arr)) return [];
  return arr.map(m => (m && m.name ? String(m.name).replace(/^models\//, '') : null)).filter(Boolean);
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
    msg = (j.error && (j.error.message || j.error.status)) || j.message || msg;
  } catch (e) { /* 保留原文 */ }
  const where = (p && p.name) || '该服务';
  if (res.status === 400 && /API key not valid/i.test(msg)) return where + ' API Key 无效：请在设置里检查 Key。' + (msg ? ' 详情: ' + msg : '');
  if (res.status === 401 || res.status === 403) return where + ' 鉴权失败（HTTP ' + res.status + '）：API Key 或认证方式不对。' + (msg ? ' 详情: ' + msg : '');
  if (res.status === 404) return where + ' 模型或路径不存在（HTTP 404）：检查模型名与 Base URL。' + (msg ? ' 详情: ' + msg : '');
  if (res.status === 429) return where + ' 请求过于频繁（HTTP 429）。' + (msg ? ' 详情: ' + msg : '');
  return where + ' 请求失败（HTTP ' + res.status + '）' + (msg ? ': ' + msg : '');
}

const fields = ['baseUrl', 'apiKey', 'authHeader', 'authHeaderName', 'model', 'path', 'maxTokens', 'temperature'];
const capabilities = ['supportsVision'];

module.exports = { id, label, buildRequest, parseSse, parseResponse, modelsRequest, parseModels, chatStream, chatOnce, listModels, describeHttp, fields, capabilities };
