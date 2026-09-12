'use strict';
// 协议适配器共用的 HTTP 细节：鉴权头、URL 拼接、SSE 读取。

function joinUrl(baseUrl, pathPart) {
  const b = String(baseUrl || '').replace(/\/+$/, '');
  const p = String(pathPart || '');
  if (!p) return b;
  return b + (p.startsWith('/') ? p : '/' + p);
}

const AUTH_CHOICES = ['bearer', 'api-key', 'x-api-key', 'x-goog-api-key', 'custom', 'none'];

function authHeaders(p) {
  const h = {};
  const mode = p.authHeader || 'bearer';
  const key = p.apiKey || '';
  if (mode === 'bearer' && key) h['Authorization'] = 'Bearer ' + key;
  else if (mode === 'api-key' && key) h['api-key'] = key;
  else if (mode === 'x-api-key' && key) h['x-api-key'] = key;
  else if (mode === 'x-goog-api-key' && key) h['x-goog-api-key'] = key;
  else if (mode === 'custom' && p.authHeaderName) h[p.authHeaderName] = key;
  return h;
}

function extraHeaders(p) {
  const out = {};
  const src = p && p.extraHeaders;
  if (src && typeof src === 'object') {
    for (const [k, v] of Object.entries(src)) {
      if (k && typeof v === 'string') out[k] = v;
    }
  }
  return out;
}

function baseHeaders(p) {
  return Object.assign({ 'Content-Type': 'application/json' }, authHeaders(p), extraHeaders(p));
}

/** 读取 SSE：逐条把 data: 后的负载交给 onPayload */
async function readSse(response, onPayload) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of response.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let json = null;
      try { json = JSON.parse(payload); } catch (e) { continue; }
      onPayload(json);
    }
  }
}

/** 把连续同角色的轮次合并，并保证首条是 user —— Anthropic 与 Gemini 都要求这样 */
function mergeAlternating(turns, userRole) {
  const out = [];
  for (const t of turns) {
    const role = t.role === 'assistant' ? 'assistant' : 'user';
    const last = out[out.length - 1];
    if (last && last.role === role) {
      if (t.text) last.text = last.text ? (last.text + '\n' + t.text) : t.text;
      if (t.images && t.images.length) last.images = (last.images || []).concat(t.images);
    } else {
      out.push({ role, text: t.text || '', images: (t.images || []).slice() });
    }
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

module.exports = { joinUrl, authHeaders, extraHeaders, baseHeaders, readSse, mergeAlternating, AUTH_CHOICES };
