'use strict';
// DeepSeek API 客户端（OpenAI 兼容）。
// 注意：deepseek-flash 支持图像理解；思考模式默认开启，桌面助手场景默认关闭以省 token、降延迟。
const fs = require('fs');

function buildBody(cfg, messages, stream) {
  const body = {
    model: cfg.model,
    messages,
    max_tokens: cfg.maxTokens || 4096,
    stream: !!stream,
  };
  if (cfg.thinking) {
    body.thinking = { type: 'enabled' };
    if (cfg.reasoningEffort) body.reasoning_effort = cfg.reasoningEffort;
  } else {
    body.thinking = { type: 'disabled' };
  }
  return body;
}

function headers(cfg) {
  return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey };
}

function base(cfg) {
  return String(cfg.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
}

async function listModels(cfg) {
  const r = await fetch(base(cfg) + '/models', { headers: headers(cfg) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(describeHttp(r.status, j));
  return (j && j.data ? j.data : []).map(m => m.id);
}

/** 非流式，用于“测试连接” */
async function chatOnce(cfg, messages) {
  const r = await fetch(base(cfg) + '/chat/completions', {
    method: 'POST', headers: headers(cfg), body: JSON.stringify(buildBody(cfg, messages, false)),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(describeHttp(r.status, j));
  return j.choices && j.choices[0] && j.choices[0].message ? (j.choices[0].message.content || '') : '';
}

/** 流式；onDelta(text) / onReasoning(text)。返回 {content, reasoning} */
async function chatStream(cfg, messages, { onDelta, onReasoning, signal } = {}) {
  const r = await fetch(base(cfg) + '/chat/completions', {
    method: 'POST', headers: headers(cfg), body: JSON.stringify(buildBody(cfg, messages, true)), signal,
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    let j = null; try { j = JSON.parse(t); } catch (e) {}
    throw new Error(describeHttp(r.status, j || t));
  }
  let content = '', reasoning = '';
  let buf = '';
  const decoder = new TextDecoder();
  for await (const chunk of r.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let d = null;
      try { d = JSON.parse(payload); } catch (e) { continue; }
      const delta = d.choices && d.choices[0] && d.choices[0].delta;
      if (!delta) continue;
      if (delta.reasoning_content) { reasoning += delta.reasoning_content; if (onReasoning) onReasoning(delta.reasoning_content); }
      if (delta.content) { content += delta.content; if (onDelta) onDelta(delta.content); }
    }
  }
  return { content, reasoning };
}

/** 由历史构造 API messages：只在最近 N 条带图的消息上携带图片 */
function buildApiMessages(cfg, systemPrompt, historyMessages, opts = {}) {
  const maxMsgs = opts.maxContextMessages || 20;
  const maxImages = opts.maxImagesInContext == null ? 2 : opts.maxImagesInContext;
  const recent = historyMessages.slice(-maxMsgs).filter(m => m && (m.text || m.image));
  const withImage = [];
  recent.forEach((m, i) => { if (m.role === 'user' && m.image && m.image.file) withImage.push(i); });
  const keepImages = new Set(withImage.slice(-maxImages));

  const out = [];
  if (systemPrompt) out.push({ role: 'system', content: systemPrompt });
  recent.forEach((m, i) => {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    if (role === 'user' && m.image && m.image.file) {
      if (keepImages.has(i)) {
        let url = null;
        try {
          url = 'data:image/png;base64,' + fs.readFileSync(m.image.file).toString('base64');
        } catch (e) { url = null; }
        if (url) {
          out.push({
            role: 'user',
            content: [
              { type: 'text', text: m.text || '请看这张截图。' },
              { type: 'image_url', image_url: { url, detail: cfg.imageDetail || 'original' } },
            ],
          });
          return;
        }
      }
      out.push({ role: 'user', content: (m.text ? m.text + '\n' : '') + '[截图已省略]' });
      return;
    }
    out.push({ role, content: m.text || '' });
  });
  return out;
}

function describeHttp(status, j) {
  let msg = '';
  if (j && typeof j === 'object') {
    msg = (j.error && (j.error.message || j.error.code)) || j.message || JSON.stringify(j);
  } else if (typeof j === 'string') {
    msg = j.slice(0, 300);
  }
  if (status === 401) return 'DeepSeek API Key 无效或未授权（HTTP 401）。请在设置中检查 Key。' + (msg ? ' 详情: ' + msg : '');
  if (status === 402) return 'DeepSeek 账户余额不足（HTTP 402）。' + (msg ? ' 详情: ' + msg : '');
  if (status === 429) return 'DeepSeek 请求过于频繁（HTTP 429），请稍后重试。' + (msg ? ' 详情: ' + msg : '');
  return 'DeepSeek 请求失败（HTTP ' + status + '）' + (msg ? ': ' + msg : '');
}

module.exports = { listModels, chatOnce, chatStream, buildApiMessages, buildBody };
