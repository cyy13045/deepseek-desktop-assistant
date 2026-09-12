'use strict';
// 小米 MiMo 语音合成客户端。
// 接口：POST {baseUrl}/chat/completions，鉴权头 api-key。
// 待合成文本必须放在 role=assistant 的 message 里；role=user 用于传递语气/风格指令。
//
// 音色有两种模式：
//   preset —— mimo-v2.5-tts + audio.voice（9 个内置音色）
//   design —— 先用 mimo-v2.5-tts-voicedesign 按文字描述生成专属音色（此时 user 消息
//             是必需的音色描述，且不能带 audio.voice），再把生成的音频固化成参考样本，
//             之后所有分块都用 mimo-v2.5-tts-voiceclone 复用同一份参考。
//             必须这样做：实测同一个描述连续两次 voicedesign 的音频并不相同（字节差
//             约 1KB），逐块调用会让音色在分块之间漂移。
//
// 实测：wav 体积约为 mp3 的 6.4 倍，耗时与字数近似线性（约 55ms/字），
//       因此按句切块（默认 ~60 字）逐块合成，由渲染进程边下边播。

const MIME = { mp3: 'audio/mpeg', wav: 'audio/wav', pcm: 'audio/pcm', pcm16: 'audio/pcm' };

function base(cfg) {
  return String(cfg.baseUrl || 'https://api.xiaomimimo.com/v1').replace(/\/+$/, '');
}

// 合成一段长文本可能要几十秒，但必须有上限：否则接口卡住时请求永远挂着，
// 用户点「停止」也中断不了（之前只有外部 signal，而调用方从来不传）。
const DEFAULT_TIMEOUT_MS = 180000;

/** 把「外部取消信号」与「超时」合并成一个 signal，并返回清理函数 */
function withTimeout(external, timeoutMs) {
  const ctrl = new AbortController();
  const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => ctrl.abort(new Error('__tts_timeout__')), ms);
  const onAbort = () => { try { ctrl.abort(external.reason); } catch (e) {} };
  if (external) {
    if (external.aborted) onAbort();
    else external.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: ctrl.signal,
    ms,
    done() {
      clearTimeout(timer);
      if (external) external.removeEventListener('abort', onAbort);
    },
  };
}

/** 统一的「发请求 → 取出 audio.data」流程 */
async function requestAudio(cfg, body, signal) {
  if (process.env.DSA_MIMO_DEBUG) {
    console.log('[mimo:req]', JSON.stringify({
      url: base(cfg) + '/chat/completions',
      model: body.model,
      keyLen: String(cfg.apiKey || '').length,
      keyHead: String(cfg.apiKey || '').slice(0, 6),
      keyTail: String(cfg.apiKey || '').slice(-4),
      audio: (body.audio && body.audio.voice)
        ? { format: body.audio.format, voice: '参考音频 ' + Math.round(String(body.audio.voice).length / 1024) + ' KB(base64)' }
        : body.audio,
      msgs: (body.messages || []).map(m => m.role + ':' + String(m.content == null ? 'NULL' : m.content).length),
    }));
  }
  const guard = withTimeout(signal, cfg.timeoutMs);
  try {
    const r = await fetch(base(cfg) + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': cfg.apiKey },
      body: JSON.stringify(body),
      signal: guard.signal,
    });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch (e) {}
    if (process.env.DSA_MIMO_DEBUG && !r.ok) console.log('[mimo:resp]', r.status, txt.slice(0, 240));
    if (!r.ok) throw new Error(describeHttp(r.status, j || txt));
    const audio = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.audio;
    if (!audio || !audio.data) throw new Error('MiMo 未返回音频数据（choices[0].message.audio.data 为空）');
    const fmt = body.audio.format || 'mp3';
    return { base64: audio.data, mime: MIME[fmt] || 'audio/mpeg', format: fmt };
  } catch (e) {
    if (guard.signal.aborted || (e && e.name === 'AbortError')) {
      throw new Error(signal && signal.aborted
        ? '语音合成已取消'
        : '语音合成超时（' + Math.round(guard.ms / 1000) + ' 秒未返回），可调小「分块字数」后重试');
    }
    throw e;
  } finally {
    guard.done();
  }
}

/** 按文字描述设计一个音色，返回可作为参考的音频（base64） */
async function designVoice(cfg, designPrompt, sampleText, opts = {}) {
  const body = {
    model: opts.designModel || cfg.designModel || 'mimo-v2.5-tts-voicedesign',
    // voicedesign 必须提供 user 消息作为音色描述，且不支持 audio.voice
    messages: [
      { role: 'user', content: designPrompt },
      { role: 'assistant', content: sampleText },
    ],
    audio: { format: opts.format || 'mp3' },
  };
  return requestAudio(cfg, body, opts.signal);
}

/**
 * 合成一段文本。
 * opts: { mode, voiceRef, voice, style, format, model, cloneModel, signal }
 *   mode='design' 时必须提供 voiceRef（形如 data:audio/mpeg;base64,...）
 */
async function synthesize(cfg, text, opts = {}) {
  const mode = opts.mode || cfg.voiceMode || 'preset';
  const format = opts.format || cfg.format || 'mp3';
  const style = opts.style != null ? opts.style : cfg.style;

  const messages = [];
  if (style) messages.push({ role: 'user', content: style });
  messages.push({ role: 'assistant', content: text });

  let model, voice;
  if (mode === 'design') {
    model = opts.cloneModel || cfg.cloneModel || 'mimo-v2.5-tts-voiceclone';
    voice = opts.voiceRef;
    if (!voice) {
      const e = new Error('缺少已固化的音色参考音频，无法用设计音色朗读');
      e.code = 'NO_VOICE_REF';
      throw e;
    }
  } else {
    model = opts.model || cfg.ttsModel || 'mimo-v2.5-tts';
    voice = opts.voice || cfg.voice || '白桦';
  }

  return requestAudio(cfg, { model, messages, audio: { voice, format } }, opts.signal);
}

/** 去掉 Markdown 标记，避免朗读出「星号」「反引号」 */
function cleanForSpeech(md) {
  if (!md) return '';
  let t = String(md);
  t = t.replace(/```[\s\S]*?```/g, '。代码块略过。');
  t = t.replace(/`([^`]*)`/g, '$1');
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  t = t.replace(/https?:\/\/\S+/g, '');
  t = t.replace(/^\s{0,3}#{1,6}\s*/gm, '');
  t = t.replace(/^\s{0,3}[-*+]\s+/gm, '');
  t = t.replace(/^\s{0,3}>\s?/gm, '');
  t = t.replace(/^\s*\d+\.\s+/gm, '');
  t = t.replace(/(\*\*|__|\*|_|~~)/g, '');
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/\n{2,}/g, '。\n');
  return t.replace(/\n/g, '。').replace(/([。！？!?；;：，、,])\。+/g, '$1').replace(/。{2,}/g, '。').trim();
}

function hardSplit(s, maxLen) {
  const out = [];
  let cur = '';
  const seps = s.match(/[^，,、\s]+[，,、\s]?/g) || [s];
  for (const p of seps) {
    if ((cur + p).length <= maxLen) { cur += p; continue; }
    if (cur) { out.push(cur); cur = ''; }
    if (p.length > maxLen) {
      for (let i = 0; i < p.length; i += maxLen) out.push(p.slice(i, i + maxLen));
    } else { cur = p; }
  }
  if (cur) out.push(cur);
  return out;
}

/** 按句切块，尽量保持语义完整以维持语调自然 */
function splitForSpeech(text, maxLen = 60) {
  const clean = cleanForSpeech(text);
  if (!clean) return [];
  const limit = Math.max(20, maxLen | 0);
  const parts = clean.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [clean];
  const chunks = [];
  let cur = '';
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    if (p.length > limit * 1.6) {
      if (cur) { chunks.push(cur); cur = ''; }
      hardSplit(p, limit).forEach(x => chunks.push(x));
      continue;
    }
    if ((cur + p).length <= limit) cur += p;
    else { if (cur) chunks.push(cur); cur = p; }
  }
  if (cur) chunks.push(cur);
  return chunks.map(s => s.trim()).filter(Boolean);
}

function describeHttp(status, j) {
  let msg = '';
  if (j && typeof j === 'object') msg = (j.error && (j.error.message || j.error.code)) || j.message || JSON.stringify(j);
  else if (typeof j === 'string') msg = j.slice(0, 300);
  if (status === 401 || status === 403) return '小米 MiMo API Key 无效或未授权（HTTP ' + status + '）。请在设置中检查 Key。' + (msg ? ' 详情: ' + msg : '');
  if (status === 429) return '小米 MiMo 请求过于频繁（HTTP 429），请稍后重试。' + (msg ? ' 详情: ' + msg : '');
  return 'MiMo 语音合成失败（HTTP ' + status + '）' + (msg ? ': ' + msg : '');
}

module.exports = { synthesize, designVoice, splitForSpeech, cleanForSpeech, MIME };
