'use strict';
const API = window.api;
const $ = id => document.getElementById(id);
const T = (key, vars) => window.DSA_I18N.t(key, vars);
// 语言由主进程通过 ?lang= 传入（auto 已在主进程解析成实际语言），随后把静态文案刷一遍
(function initI18n() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q) window.DSA_I18N.setLang(q);
  window.DSA_I18N.applyDom();
})();

const el = {
  messages: $('messages'), empty: $('empty'), input: $('input'), send: $('btnSend'),
  attachments: $('attachments'), status: $('status'), subtitle: $('subtitle'),
  drawer: $('drawer'), historyList: $('historyList'), toast: $('toast'),
  btnNew: $('btnNew'), btnHistory: $('btnHistory'), btnSettings: $('btnSettings'),
  btnClose: $('btnClose'), btnAutoSpeak: $('btnAutoSpeak'), btnFull: $('btnFull'),
  btnRegion: $('btnRegion'), btnClearAll: $('btnClearAll'), titlebar: $('titlebar'),
  playbar: $('playbar'), pbText: $('pbText'), pbPause: $('pbPause'), pbStop: $('pbStop'), pbSpeaker: $('pbSpeaker'),
};

const state = {
  conversationId: null,
  messages: [],          // {id, role, text, image, error, reasoning}
  pendingImage: null,    // {file, thumb, width, height}
  streaming: false,
  autoSpeak: true,
  voice: '',
  streamEl: null,
  streamText: '',
  streamReasonEl: null,
  streamReason: '',
  speakingMsgId: null,
  chatProvider: null,    // {id, name, model, supportsVision}
};

// ---------------------------------------------------------------- Markdown
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function renderMarkdown(src) {
  const blocks = [];
  let s = String(src == null ? '' : src);
  s = s.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    blocks.push('<pre class="code"><code>' + escapeHtml(code.replace(/\n$/, '')) + '</code></pre>');
    return '\u0000B' + (blocks.length - 1) + '\u0000';
  });
  s = escapeHtml(s);
  const inl = [];
  s = s.replace(/`([^`]+)`/g, (_m, c) => { inl.push('<code>' + c + '</code>'); return '\u0000I' + (inl.length - 1) + '\u0000'; });
  s = s.replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  const lines = s.split(/\n/);
  const outLines = [];
  let inList = false;
  for (const line of lines) {
    const m = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)$/);
    if (m) {
      if (!inList) { outLines.push('<ul>'); inList = true; }
      outLines.push('<li>' + m[1] + '</li>');
    } else {
      if (inList) { outLines.push('</ul>'); inList = false; }
      outLines.push(line);
    }
  }
  if (inList) outLines.push('</ul>');
  s = outLines.join('\n');
  s = s.replace(/\n/g, '<br>');
  s = s.replace(/<\/ul><br>/g, '</ul>').replace(/<ul><br>/g, '<ul>').replace(/<\/li><br>/g, '</li>');
  s = s.replace(/\u0000I(\d+)\u0000/g, (_m, i) => inl[+i]);
  s = s.replace(/\u0000B(\d+)\u0000/g, (_m, i) => blocks[+i]);
  return s;
}
function fmtTime(ts) {
  const d = new Date(ts || Date.now());
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// ---------------------------------------------------------------- 消息渲染
function hideEmpty() { if (el.empty) el.empty.style.display = 'none'; }
function showEmpty() {
  if (!el.empty) return;
  const has = el.messages.querySelector('.msg');
  el.empty.style.display = has ? 'none' : 'flex';
}
function atBottom() { return el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight < 90; }
function scrollDown(force) { if (force || atBottom()) el.messages.scrollTop = el.messages.scrollHeight; }

function addMsgNode(kind) {
  hideEmpty();
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + kind;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  wrap.appendChild(bubble);
  el.messages.appendChild(wrap);
  scrollDown(true);
  return { wrap, bubble };
}

function renderUser(m) {
  const { wrap, bubble } = addMsgNode('user');
  wrap.dataset.id = m.id || '';
  if (m.image && m.image.thumb) {
    const img = document.createElement('img');
    img.className = 'shot'; img.src = m.image.thumb; img.draggable = false;
    bubble.appendChild(img);
  }
  if (m.text) {
    const d = document.createElement('div');
    d.textContent = m.text;
    bubble.appendChild(d);
  }
  scrollDown(true);
}

function renderAssistant(m) {
  const { wrap, bubble } = addMsgNode('assistant');
  wrap.dataset.id = m.id || '';
  if (m.reasoning) {
    const det = document.createElement('details');
    det.className = 'think';
    const sum = document.createElement('summary');
    sum.textContent = T('panel.thinking');
    const box = document.createElement('div');
    box.textContent = m.reasoning;
    det.appendChild(sum); det.appendChild(box);
    bubble.appendChild(det);
  }
  const content = document.createElement('div');
  content.className = 'content';
  content.innerHTML = renderMarkdown(m.text || '');
  bubble.appendChild(content);
  addActions(wrap, bubble, m);
  scrollDown(true);
}

function addActions(wrap, bubble, m) {
  const bar = document.createElement('div');
  bar.className = 'msg-actions';
  const speak = document.createElement('button');
  speak.textContent = T('panel.speak');
  speak.onclick = () => {
    if (state.speakingMsgId === m.id) stopSpeaking();
    else speakText(m.text, m.id);
  };
  const copy = document.createElement('button');
  copy.textContent = T('panel.copy');
  copy.onclick = async () => {
    try { await navigator.clipboard.writeText(m.text || ''); toast(T('panel.copied')); } catch (e) { toast(T('panel.copyFailed'), true); }
  };
  bar.appendChild(speak); bar.appendChild(copy);
  wrap.appendChild(bar);
  wrap._speakBtn = speak;
  wrap._copyBtn = copy;
}

function renderError(text) {
  const { bubble } = addMsgNode('error');
  bubble.textContent = text;
  scrollDown(true);
}

function renderAll(messages) {
  el.messages.querySelectorAll('.msg').forEach(n => n.remove());
  state.messages = messages.slice();
  messages.forEach(m => {
    if (m.role === 'user') renderUser(m);
    else if (m.role === 'assistant') renderAssistant(m);
  });
  showEmpty();
  scrollDown(true);
}

// ---------------------------------------------------------------- 附件
function renderAttachment() {
  el.attachments.innerHTML = '';
  const img = state.pendingImage;
  if (!img || !img.thumb) return;
  const chip = document.createElement('div');
  chip.className = 'chip';
  const i = document.createElement('img');
  i.src = img.thumb; i.draggable = false;
  const x = document.createElement('button');
  x.className = 'x'; x.textContent = '✕'; x.title = T('panel.removeShot');
  x.onclick = () => { state.pendingImage = null; renderAttachment(); };
  chip.appendChild(i); chip.appendChild(x);
  el.attachments.appendChild(chip);
}

// ---------------------------------------------------------------- 发送
function setStatus(t) { el.status.textContent = t || ''; }
function setStreaming(on) {
  state.streaming = on;
  el.send.textContent = on ? T('panel.stop') : T('panel.send');
  el.send.classList.toggle('stop', on);
  el.btnFull.disabled = on; el.btnRegion.disabled = on;
}
function autoGrow() {
  el.input.style.height = 'auto';
  el.input.style.height = Math.min(el.input.scrollHeight, 150) + 'px';
}

async function send() {
  if (state.streaming) { await API.chat.abort(); return; }
  const text = el.input.value.trim();
  if (!text && !state.pendingImage) { toast(T('panel.needInput')); return; }
  const payload = { conversationId: state.conversationId, text, image: state.pendingImage };
  el.input.value = ''; autoGrow();
  state.pendingImage = null; renderAttachment();
  setStreaming(true);
  setStatus(T('panel.requesting'));
  const res = await API.chat.send(payload);
  if (res && res.conversationId) state.conversationId = res.conversationId;
  if (res && !res.ok && !res.aborted) {
    setStreaming(false);
    setStatus('');
    if (res.error && !state.streamErrorShown) renderError(res.error);
  }
  state.streamErrorShown = false;
}

// ---------------------------------------------------------------- 语音（支持暂停 / 继续 / 停止）
// 播放队列：主进程按块把音频推过来，这里顺序播放。
// 暂停是双重的 —— 渲染进程暂停当前 <audio>，主进程也停在合成门控上不再继续请求，
// 这样暂停期间不会继续烧接口、也不会堆积未播放的音频。
const tts = { queue: [], playing: false, audio: null, paused: false, total: 0, done: false, started: false };

function showPlaybar(on) { el.playbar.classList.toggle('show', !!on); }
function setPbText(t) { el.pbText.textContent = t; }
function setPauseUi() {
  el.pbPause.textContent = tts.paused ? T('panel.tts.resume') : T('panel.tts.pause');
  el.pbPause.classList.toggle('primary', tts.paused);
  el.pbSpeaker.classList.toggle('playing', !tts.paused && tts.playing);
}
function finishTts() {
  tts.playing = false;
  tts.paused = false;
  tts.started = false;
  tts.done = false;
  tts.total = 0;
  setPauseUi();
  showPlaybar(false);
  clearSpeaking();
}

function speakText(text, msgId) {
  if (!text || !text.trim()) { toast(T('panel.tts.nothing')); return; }
  stopSpeaking(true);
  markSpeaking(msgId || null);
  tts.started = true;
  tts.done = false;
  tts.total = 0;
  showPlaybar(true);
  setPbText(T('panel.tts.preparing'));
  setPauseUi();
  setStatus(T('panel.tts.synthesizing'));
  API.tts.speak({ text, voice: state.voice || undefined }).then(r => {
    if (r && !r.ok && !r.aborted) {
      setStatus('');
      toast(r.error || T('panel.tts.failed'), true);
      finishTts();
    }
  });
}

function stopSpeaking(quiet) {
  tts.queue.length = 0;
  if (tts.audio) { try { tts.audio.pause(); } catch (e) {} tts.audio = null; }
  tts.playing = false;
  tts.paused = false;
  tts.done = false;
  API.tts.stop();
  finishTts();
  setPbText(T('panel.tts.label'));
  if (!quiet) setStatus('');
}

function pauseSpeaking() {
  if (!tts.started) return;
  tts.paused = true;
  if (tts.audio) { try { tts.audio.pause(); } catch (e) {} }
  API.tts.pause();
  setPauseUi();
  setPbText(T('panel.tts.pausedSync'));
  setStatus(T('panel.tts.paused'));
  applySpeakingButtons();
}

function resumeSpeaking() {
  tts.paused = false;
  API.tts.resume();
  if (tts.audio) {
    tts.audio.play().catch(() => {});
    setPbText(T('panel.tts.playing'));
  } else {
    pump();   // 可能在两块之间暂停，继续时需要主动取下一块
  }
  setPauseUi();
  setStatus('');
}

/** 队列泵：暂停中不取新块；已有正在播放的块也不重复取 */
function pump() {
  if (tts.paused) return;
  if (tts.audio) return;
  const item = tts.queue.shift();
  if (!item) {
    tts.playing = false;
    setPauseUi();
    if (tts.done && tts.started) { setPbText(T('panel.tts.ended')); setTimeout(() => { if (!tts.playing && !tts.queue.length) finishTts(); }, 900); }
    return;
  }
  tts.playing = true;
  const total = item.total || tts.total || 0;
  const a = new Audio(item.src);
  tts.audio = a;
  a.onended = () => { tts.audio = null; pump(); };
  a.onerror = () => { tts.audio = null; pump(); };
  a.play().catch(() => { tts.audio = null; pump(); });
  setPbText(T('panel.tts.playingChunk', { index: item.index + 1, total }));
  setStatus(T('panel.tts.playingStatus', { index: item.index + 1, total }));
  setPauseUi();
}

function markSpeaking(msgId) {
  state.speakingMsgId = msgId || null;
  applySpeakingButtons();
}
function applySpeakingButtons() {
  const id = state.speakingMsgId;
  document.querySelectorAll('.msg').forEach(w => {
    const btn = w._speakBtn;
    if (!btn) return;
    const on = !!id && w.dataset.id === id;
    btn.classList.toggle('speaking', on);
    btn.textContent = on ? (tts.paused ? T('panel.speak.paused') : T('panel.tts.stop')) : T('panel.speak');
  });
}
function clearSpeaking() { markSpeaking(null); }

el.pbPause.onclick = () => { if (tts.paused) resumeSpeaking(); else pauseSpeaking(); };
el.pbStop.onclick = () => { stopSpeaking(); setPbText(T('panel.tts.label')); toast(T('panel.tts.stopped')); };

// ---------------------------------------------------------------- 历史
async function openDrawer(on) {
  el.drawer.classList.toggle('open', on);
  if (on) await refreshHistory();
}
async function refreshHistory() {
  const list = await API.history.list();
  el.historyList.innerHTML = '';
  if (!list.length) {
    const d = document.createElement('div');
    d.className = 'drawer-empty';
    d.textContent = T('panel.history.empty');
    el.historyList.appendChild(d);
    return;
  }
  for (const c of list) {
    const item = document.createElement('div');
    item.className = 'hitem' + (c.id === state.conversationId ? ' active' : '');
    const t = document.createElement('div'); t.className = 'ht'; t.textContent = c.title || T('panel.history.new');
    const m = document.createElement('div'); m.className = 'hm'; m.textContent = fmtTime(c.updatedAt) + ' · ' + T('panel.history.count', { count: c.count });
    const x = document.createElement('button'); x.className = 'hx'; x.textContent = '✕'; x.title = T('panel.history.delete');
    x.onclick = async ev => {
      ev.stopPropagation();
      await API.history.remove(c.id);
      if (state.conversationId === c.id) { state.conversationId = null; renderAll([]); }
      refreshHistory();
    };
    item.appendChild(t); item.appendChild(m); item.appendChild(x);
    item.onclick = async () => {
      const conv = await API.history.get(c.id);
      if (!conv) return;
      state.conversationId = conv.id;
      renderAll(conv.messages || []);
      el.subtitle.textContent = conv.title || T('panel.history.chat');
      openDrawer(false);
    };
    el.historyList.appendChild(item);
  }
}

// ---------------------------------------------------------------- Toast
let toastTimer = null;
function toast(text, isError) {
  el.toast.textContent = text;
  el.toast.className = 'toast show' + (isError ? ' error' : '');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.className = 'toast' + (isError ? ' error' : ''); }, 2600);
}

// ---------------------------------------------------------------- 事件
el.input.addEventListener('input', autoGrow);
el.input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});
el.send.onclick = send;
el.btnFull.onclick = async () => { setStatus(T('panel.capture.fullDoing')); await API.capture.full(); setStatus(''); };
el.btnRegion.onclick = async () => { setStatus(T('panel.capture.regionDoing')); await API.capture.region(); setStatus(''); };
el.btnSettings.onclick = () => API.panel.openSettings();
el.btnClose.onclick = () => API.panel.hide();
el.btnNew.onclick = async () => {
  stopSpeaking(true);
  state.conversationId = null;
  renderAll([]);
  el.subtitle.textContent = T('panel.subtitle');
  openDrawer(false);
};
el.btnHistory.onclick = () => openDrawer(!el.drawer.classList.contains('open'));
el.btnAutoSpeak.onclick = async () => {
  state.autoSpeak = !state.autoSpeak;
  el.btnAutoSpeak.classList.toggle('on', state.autoSpeak);
  await API.tts.setAutoSpeak(state.autoSpeak);
  toast(state.autoSpeak ? T('panel.autoSpeak.on') : T('panel.autoSpeak.off'));
};
el.btnClearAll.onclick = async () => {
  await API.history.clear();
  state.conversationId = null;
  renderAll([]);
  refreshHistory();
  toast(T('panel.history.cleared'));
};

// 标题栏拖拽
let drag = null;
el.titlebar.addEventListener('mousedown', e => {
  if (e.button !== 0 || e.target.closest('button')) return;
  drag = { x: e.screenX, y: e.screenY };
  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup', endDrag, { once: true });
});
function onDrag(e) {
  if (!drag) return;
  API.win.drag({ dx: e.screenX - drag.x, dy: e.screenY - drag.y });
  drag = { x: e.screenX, y: e.screenY };
}
function endDrag() { window.removeEventListener('mousemove', onDrag); drag = null; }

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (el.drawer.classList.contains('open')) openDrawer(false); else API.panel.hide(); }
  if (e.ctrlKey && e.key === 'Enter') send();
});

// 主进程事件
API.on('capture:new', shot => {
  state.pendingImage = shot;
  renderAttachment();
  if (el.drawer.classList.contains('open')) openDrawer(false);
  el.input.focus();
  if (state.chatProvider && state.chatProvider.supportsVision === false) {
    toast(T('panel.visionUnsupported', { name: state.chatProvider.name }), true);
  } else {
    toast(T('panel.shotTaken'));
  }
});
API.on('app:toast', p => toast(p.text, p.kind === 'error'));

API.on('chat:start', ({ conversationId, userMessage, provider }) => {
  state.conversationId = conversationId;
  if (provider) state.chatProvider = provider;
  state.messages.push(userMessage);
  renderUser(userMessage);
  setStatus(T('panel.thinkingStatus', { name: (provider && provider.name) ? provider.name : T('panel.model') }));
  const { wrap, bubble } = addMsgNode('assistant');
  state.streamEl = bubble;
  state.streamWrap = wrap;
  state.streamText = '';
  state.streamReason = '';
  state.streamReasonEl = null;
  const content = document.createElement('div');
  content.className = 'content';
  content.innerHTML = '<span class="caret"></span>';
  bubble.appendChild(content);
  state.streamContent = content;
});
API.on('chat:reasoning', ({ delta }) => {
  if (!state.streamEl) return;
  state.streamReason += delta;
  setStatus(T('panel.reasoningStatus', { count: state.streamReason.length }));
});
API.on('chat:delta', ({ delta }) => {
  if (!state.streamEl) return;
  state.streamText += delta;
  state.streamContent.innerHTML = renderMarkdown(state.streamText) + '<span class="caret"></span>';
  setStatus(T('panel.answering'));
  scrollDown();
});
API.on('chat:done', ({ message, autoSpeak }) => {
  if (state.streamEl) {
    if (state.streamReason) {
      const det = document.createElement('details');
      det.className = 'think';
      const sum = document.createElement('summary'); sum.textContent = T('panel.thinking');
      const box = document.createElement('div'); box.textContent = state.streamReason;
      det.appendChild(sum); det.appendChild(box);
      state.streamEl.insertBefore(det, state.streamEl.firstChild);
    }
    state.streamContent.innerHTML = renderMarkdown((message && message.text) || state.streamText);
    if (message) state.messages.push(message);
    addActions(state.streamWrap, state.streamEl, message || { id: 'x' + Date.now(), text: state.streamText });
    state.streamEl = null;
  }
  setStreaming(false);
  setStatus('');
  scrollDown();
  if (autoSpeak && state.autoSpeak && message && message.text) {
    if (state.streamWrap && message.id) state.streamWrap.dataset.id = message.id;
    speakText(message.text, message.id);
  }
});
API.on('chat:aborted', () => {
  if (state.streamEl) {
    state.streamContent.innerHTML = renderMarkdown(state.streamText + '\n\n_' + T('chat.interrupted') + '_');
    state.streamEl = null;
  }
  setStreaming(false);
  setStatus(T('panel.aborted'));
  setTimeout(() => setStatus(''), 1500);
});
API.on('chat:error', ({ error }) => {
  if (state.streamEl) { state.streamEl.parentElement.remove(); state.streamEl = null; }
  state.streamErrorShown = true;
  renderError(error);
  setStreaming(false);
  setStatus('');
});

API.on('tts:voice-ref', p => setPbText(p.cached ? T('panel.tts.voiceCached') : T('panel.tts.voiceGenerated', { kb: Math.round((p.bytes || 0) / 1024) })));
API.on('tts:begin', ({ total, voice }) => {
  tts.total = total || 0;
  tts.done = false;
  tts.started = true;
  showPlaybar(true);
  setPauseUi();
  const label = T('panel.tts.begin', { done: 0, total }) + (voice ? ' · ' + voice : '');
  setPbText(label);
  setStatus(label);
});
API.on('tts:audio', p => {
  tts.queue.push({ src: 'data:' + p.mime + ';base64,' + p.base64, index: p.index, total: p.total });
  tts.total = p.total || tts.total;
  if (!tts.paused && !tts.audio) pump();
  else if (!tts.audio) setStatus(T('panel.tts.chunk', { index: p.index + 1, total: p.total }));
});
API.on('tts:done', () => {
  tts.done = true;
  if (!tts.audio && !tts.queue.length && !tts.paused) { setPbText(T('panel.tts.ended')); setTimeout(() => { if (!tts.playing && !tts.queue.length) finishTts(); }, 900); }
});
API.on('tts:paused', p => { tts.paused = !!p.paused; setPauseUi(); applySpeakingButtons(); });
API.on('tts:error', ({ error }) => { toast(error, true); setStatus(''); finishTts(); });

// ---------------------------------------------------------------- 初始化
(async function init() {
  try {
    const r = await API.config.get();
    if (r && r.language) window.DSA_I18N.setLang(r.language);
    applyProviders(r.config);
  } catch (e) {}
  try {
    const list = await API.history.list();
    if (list.length) {
      const conv = await API.history.get(list[0].id);
      if (conv) {
        state.conversationId = conv.id;
        renderAll(conv.messages || []);
        el.subtitle.textContent = conv.title || T('panel.history.chat');
      }
    }
  } catch (e) {}
  showEmpty();
  el.input.focus();
  // 若首次打开时已带截图（主进程排队中），由主进程在 did-finish-load 后推送
})();

/** 根据当前生效的 provider 更新界面提示 */
function applyProviders(config) {
  const chatList = (config.providers && config.providers.chat) || [];
  const ttsList = (config.providers && config.providers.tts) || [];
  const chat = chatList.find(p => p.id === config.activeChatId) || chatList[0];
  const tts = ttsList.find(p => p.id === config.activeTtsId) || ttsList[0];
  if (chat) {
    state.chatProvider = { id: chat.id, name: chat.name, model: chat.model, supportsVision: !!chat.supportsVision };
    el.subtitle.textContent = chat.name + (chat.model ? ' · ' + chat.model : '')
      + (chat.supportsVision ? '' : T('panel.visionOff'));
  }
  if (tts) {
    state.autoSpeak = !!tts.autoSpeak;
    state.voice = tts.voice || '';
  }
  el.btnAutoSpeak.classList.toggle('on', state.autoSpeak);
  el.btnAutoSpeak.title = state.autoSpeak ? T('panel.autoSpeak.titleOn') : T('panel.autoSpeak.titleOff');
}

// 设置里换了服务就即时刷新
API.on('config:changed', ({ config }) => { try { applyProviders(config); } catch (e) {} });

// 设置里切了语言：立刻换语言，并把静态文案与所有动态文案一起刷新
function refreshI18n() {
  window.DSA_I18N.applyDom();
  if (state.chatProvider) {
    el.subtitle.textContent = state.chatProvider.name + (state.chatProvider.model ? ' · ' + state.chatProvider.model : '')
      + (state.chatProvider.supportsVision ? '' : T('panel.visionOff'));
  } else {
    el.subtitle.textContent = T('panel.subtitle');
  }
  el.btnAutoSpeak.title = state.autoSpeak ? T('panel.autoSpeak.titleOn') : T('panel.autoSpeak.titleOff');
  if (!state.streaming) { el.send.textContent = T('panel.send'); el.send.classList.remove('stop'); }
  // 已经渲染出来的消息：只换按钮与「深度思考」标题，不动消息内容本身
  document.querySelectorAll('.msg').forEach(w => { if (w._copyBtn) w._copyBtn.textContent = T('panel.copy'); });
  document.querySelectorAll('.think summary').forEach(s => { s.textContent = T('panel.thinking'); });
  applySpeakingButtons();
  if (!tts.started) setPbText(T('panel.tts.label'));
  setPauseUi();
}
API.on('i18n:changed', ({ language }) => {
  window.DSA_I18N.setLang(language);
  refreshI18n();
});