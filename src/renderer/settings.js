'use strict';
const API = window.api;
const $ = id => document.getElementById(id);

let meta = { chatProtocols: [], ttsProtocols: [], authChoices: [], chatPresets: [], ttsPresets: [], voicePresets: [] };
let chatList = [];
let ttsList = [];
let selChat = null;      // 当前界面上选中的聊天服务 id
let selTts = null;
let appVer = '';
let cfgPath = '';

// ---------------------------------------------------------------- 小工具
function setState(id, text, kind) {
  const e = $(id);
  if (!e) return;
  e.textContent = text || '';
  e.className = 'state' + (kind ? ' ' + kind : '');
}
let toastTimer = null;
function toast(t) {
  const el = $('toast');
  el.textContent = t;
  el.className = 'toast show';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2400);
}
function options(sel, items, valueKey, labelKey, current) {
  sel.innerHTML = '';
  items.forEach(it => {
    const o = document.createElement('option');
    o.value = it[valueKey];
    o.textContent = it[labelKey];
    sel.appendChild(o);
  });
  if (current != null) sel.value = current;
}
function uniqueId(base, list) {
  let id = base, n = 2;
  while (list.some(p => p.id === id)) { id = base + '-' + n; n++; }
  return id;
}
function stripProvider(p) {
  const q = Object.assign({}, p);
  delete q.apiKeySet;
  delete q.apiKeyMask;
  delete q.note;
  return q;
}
function headersText(h) {
  if (!h || !Object.keys(h).length) return '';
  try { return JSON.stringify(h, null, 2); } catch (e) { return ''; }
}
function parseHeaders(text) {
  const t = String(text || '').trim();
  if (!t) return {};
  let j = null;
  try { j = JSON.parse(t); } catch (e) { throw new Error('额外请求头不是合法 JSON'); }
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('额外请求头必须是 JSON 对象');
  const out = {};
  for (const [k, v] of Object.entries(j)) out[k] = String(v);
  return out;
}
function numOr(v, dflt) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

// ---------------------------------------------------------------- 聊天表单
function readChatForm() {
  return {
    name: $('cName').value.trim(),
    protocol: $('cProtocol').value,
    baseUrl: $('cBaseUrl').value.trim(),
    apiKey: $('cApiKey').value.trim(),
    authHeader: $('cAuthHeader').value,
    authHeaderName: $('cAuthHeaderName').value.trim(),
    model: $('cModel').value.trim(),
    path: $('cPath').value.trim(),
    maxTokens: numOr($('cMaxTokens').value, 4096),
    maxTokensParam: $('cMaxTokensParam').value,
    imageDetail: $('cImageDetail').value,
    temperature: $('cTemperature').value.trim() === '' ? null : Number($('cTemperature').value),
    supportsVision: $('cSupportsVision').checked,
    supportsThinking: $('cSupportsThinking').checked,
    thinking: $('cThinking').checked,
    reasoningEffort: $('cReasoningEffort').value,
    extraHeaders: parseHeaders($('cExtraHeaders').value),
  };
}
function writeChatForm(p) {
  $('cName').value = p.name || '';
  $('cProtocol').value = p.protocol || 'openai';
  $('cBaseUrl').value = p.baseUrl || '';
  $('cApiKey').value = '';
  const noAuth = (p.authHeader || 'bearer') === 'none';
  $('cApiKey').placeholder = p.apiKeySet ? '已配置，留空则不改动' : (noAuth ? '本地服务通常不需要' : 'sk-...');
  setState('cKeyState', p.apiKeySet ? ('当前已配置：' + (p.apiKeyMask || '')) : (noAuth ? '该服务不需要 API Key' : '尚未配置 API Key'));
  $('cAuthHeader').value = p.authHeader || 'bearer';
  $('cAuthHeaderName').value = p.authHeaderName || '';
  $('cModel').value = p.model || '';
  $('cPath').value = p.path || '';
  $('cMaxTokens').value = p.maxTokens || 4096;
  $('cMaxTokensParam').value = p.maxTokensParam || 'max_tokens';
  $('cImageDetail').value = p.imageDetail || 'original';
  $('cTemperature').value = (p.temperature == null ? '' : String(p.temperature));
  $('cSupportsVision').checked = !!p.supportsVision;
  $('cSupportsThinking').checked = !!p.supportsThinking;
  $('cThinking').checked = !!p.thinking;
  $('cReasoningEffort').value = p.reasoningEffort || 'low';
  $('cExtraHeaders').value = headersText(p.extraHeaders);
  $('cNote').textContent = p.note || '';
  setState('cModelState', '');
  setState('cTestState', '');
  syncChatVisibility();
}
function syncChatVisibility() {
  const proto = $('cProtocol').value;
  $('cAuthNameWrap').style.display = $('cAuthHeader').value === 'custom' ? 'block' : 'none';
  $('cThinkingWrap').style.display = (proto === 'openai' && $('cSupportsThinking').checked) ? 'block' : 'none';
  const detail = $('cImageDetail').closest('label');
  if (detail) detail.style.display = proto === 'openai' ? '' : 'none';
  const mtp = $('cMaxTokensParam').closest('label');
  if (mtp) mtp.style.display = proto === 'openai' ? '' : 'none';
}
function commitChatForm() {
  const cur = chatList.find(p => p.id === selChat);
  if (!cur) return true;
  let form;
  try { form = readChatForm(); } catch (e) { toast(String(e.message || e)); return false; }
  const typed = form.apiKey && form.apiKey !== '__CLEAR__';
  const cleared = form.apiKey === '__CLEAR__';
  const apiKeySet = typed ? true : (cleared ? false : !!cur.apiKeySet);
  const apiKeyMask = typed ? ('…' + form.apiKey.slice(-4)) : (cleared ? '' : cur.apiKeyMask);
  Object.assign(cur, form, { apiKeySet, apiKeyMask });
  return true;
}

// ---------------------------------------------------------------- 语音表单
function readTtsForm() {
  return {
    name: $('tName').value.trim(),
    protocol: $('tProtocol').value,
    baseUrl: $('tBaseUrl').value.trim(),
    apiKey: $('tApiKey').value.trim(),
    authHeader: $('tAuthHeader').value,
    authHeaderName: $('tAuthHeaderName').value.trim(),
    ttsModel: $('tModel').value.trim(),
    voice: $('tVoice').value,
    format: $('tFormat').value,
    style: $('tStyle').value,
    autoSpeak: $('tAutoSpeak').checked,
    chunkSize: Math.max(20, Math.min(200, numOr($('tChunk').value, 60))),
    voiceMode: $('tVoiceMode') ? $('tVoiceMode').value : 'design',
    voiceDesign: $('tVoiceDesign').value,
  };
}
function writeTtsForm(p) {
  $('tName').value = p.name || '';
  $('tProtocol').value = p.protocol || 'mimo-tts';
  $('tBaseUrl').value = p.baseUrl || '';
  $('tApiKey').value = '';
  const noAuth = (p.authHeader || 'bearer') === 'none';
  $('tApiKey').placeholder = p.apiKeySet ? '已配置，留空则不改动' : (noAuth ? '本地服务通常不需要' : 'sk-...');
  setState('tKeyState', p.apiKeySet ? ('当前已配置：' + (p.apiKeyMask || '')) : (noAuth ? '该服务不需要 API Key' : '尚未配置 API Key'));
  $('tAuthHeader').value = p.authHeader || 'bearer';
  $('tAuthHeaderName').value = p.authHeaderName || '';
  $('tModel').value = p.ttsModel || '';
  $('tFormat').value = p.format || 'mp3';
  $('tStyle').value = p.style || '';
  $('tAutoSpeak').checked = p.autoSpeak !== false;
  $('tChunk').value = p.chunkSize || 60;
  if ($('tVoiceMode')) $('tVoiceMode').value = p.voiceMode === 'preset' ? 'preset' : 'design';
  $('tVoiceDesign').value = p.voiceDesign || '';
  const voices = (p.voices && p.voices.length) ? p.voices : (p.voice ? [p.voice] : []);
  options($('tVoice'), voices.map(v => ({ v, label: v })), 'v', 'label', p.voice || voices[0] || '');
  const ps = $('tVoicePreset');
  ps.innerHTML = '';
  (meta.voicePresets.length ? meta.voicePresets : [{ id: 'x', name: '默认', desc: p.voiceDesign || '' }]).forEach(vp => {
    const o = document.createElement('option');
    o.value = vp.id; o.textContent = vp.name;
    ps.appendChild(o);
  });
  $('tNote').textContent = p.note || '';
  setState('tTestState', '');
  refreshVoiceRef();
  syncTtsVisibility();
}
function syncTtsVisibility() {
  const isMimo = $('tProtocol').value === 'mimo-tts';
  $('tDesignBox').style.display = isMimo ? 'block' : 'none';
  $('tAuthNameWrap').style.display = $('tAuthHeader').value === 'custom' ? 'block' : 'none';
  if (isMimo && $('tDesignSub')) {
    $('tDesignSub').style.display = $('tVoiceMode').value === 'preset' ? 'none' : 'block';
  }
}
function commitTtsForm() {
  const cur = ttsList.find(p => p.id === selTts);
  if (!cur) return true;
  const form = readTtsForm();
  const typed = form.apiKey && form.apiKey !== '__CLEAR__';
  const cleared = form.apiKey === '__CLEAR__';
  const apiKeySet = typed ? true : (cleared ? false : !!cur.apiKeySet);
  const apiKeyMask = typed ? ('…' + form.apiKey.slice(-4)) : (cleared ? '' : cur.apiKeyMask);
  Object.assign(cur, form, { apiKeySet, apiKeyMask });
  return true;
}

// ---------------------------------------------------------------- 列表与切换
function renderChatSelect() {
  options($('cList'), chatList.map(p => ({ id: p.id, label: p.name + (p.model ? '  ·  ' + p.model : '') })), 'id', 'label', selChat);
}
function renderTtsSelect() {
  options($('tList'), ttsList.map(p => ({ id: p.id, label: p.name + (p.ttsModel ? '  ·  ' + p.ttsModel : '') })), 'id', 'label', selTts);
}
function selectChat(id) {
  if (!commitChatForm()) { renderChatSelect(); return; }
  selChat = id;
  renderChatSelect();
  const p = chatList.find(x => x.id === id);
  if (p) writeChatForm(p);
}
function selectTts(id) {
  commitTtsForm();
  selTts = id;
  renderTtsSelect();
  const p = ttsList.find(x => x.id === id);
  if (p) writeTtsForm(p);
}

// ---------------------------------------------------------------- 事件
$('cList').addEventListener('change', () => selectChat($('cList').value));
$('tList').addEventListener('change', () => selectTts($('tList').value));
$('cProtocol').addEventListener('change', syncChatVisibility);
$('cAuthHeader').addEventListener('change', syncChatVisibility);
$('cSupportsThinking').addEventListener('change', syncChatVisibility);
$('tProtocol').addEventListener('change', () => { syncTtsVisibility(); });
$('tAuthHeader').addEventListener('change', syncTtsVisibility);
$('tVoiceMode').addEventListener('change', syncTtsVisibility);

for (const [btn, input] of [['cKeyToggle', 'cApiKey'], ['tKeyToggle', 'tApiKey']]) {
  $(btn).onclick = () => {
    const i = $(input);
    const show = i.type === 'password';
    i.type = show ? 'text' : 'password';
    $(btn).textContent = show ? '隐藏' : '显示';
  };
}
$('cKeyClear').onclick = () => { $('cApiKey').value = '__CLEAR__'; setState('cKeyState', '保存后将清空该服务的 API Key', 'err'); };
$('tKeyClear').onclick = () => { $('tApiKey').value = '__CLEAR__'; setState('tKeyState', '保存后将清空该服务的 API Key', 'err'); };

// 从预设添加 / 复制 / 删除
$('cAddPreset').onclick = async () => {
  const r = await API.provider.fromPreset({ kind: 'chat', presetId: $('cPresetSelect').value });
  if (!r || !r.ok) { toast(r && r.error || '添加失败'); return; }
  commitChatForm();
  const p = r.provider;
  p.id = uniqueId(p.id, chatList);
  p.name = p.name + (p.id === p.name ? '' : '');
  chatList.push(p);
  renderChatSelect();
  selectChat(p.id);
  toast('已添加「' + p.name + '」，填好 API Key 后保存');
};
$('cDup').onclick = () => {
  const cur = chatList.find(p => p.id === selChat);
  if (!cur) return;
  const copy = Object.assign({}, cur, { id: uniqueId(cur.id, chatList), name: cur.name + ' 副本', apiKey: '', apiKeySet: !!cur.apiKeySet });
  chatList.push(copy);
  renderChatSelect();
  selChat = copy.id;
  renderChatSelect();
  writeChatForm(copy);
};
$('cDel').onclick = () => {
  if (chatList.length <= 1) { toast('至少保留一个聊天服务'); return; }
  const i = chatList.findIndex(p => p.id === selChat);
  if (i < 0) return;
  const name = chatList[i].name;
  chatList.splice(i, 1);
  selChat = chatList[Math.max(0, i - 1)].id;
  renderChatSelect();
  writeChatForm(chatList.find(p => p.id === selChat));
  toast('已删除「' + name + '」，点保存后生效');
};
$('tAddPreset').onclick = async () => {
  const r = await API.provider.fromPreset({ kind: 'tts', presetId: $('tPresetSelect').value });
  if (!r || !r.ok) { toast(r && r.error || '添加失败'); return; }
  commitTtsForm();
  const p = r.provider;
  p.id = uniqueId(p.id, ttsList);
  ttsList.push(p);
  renderTtsSelect();
  selectTts(p.id);
  toast('已添加「' + p.name + '」');
};
$('tDup').onclick = () => {
  const cur = ttsList.find(p => p.id === selTts);
  if (!cur) return;
  const copy = Object.assign({}, cur, { id: uniqueId(cur.id, ttsList), name: cur.name + ' 副本', apiKey: '', apiKeySet: !!cur.apiKeySet });
  ttsList.push(copy);
  selTts = copy.id;
  renderTtsSelect();
  writeTtsForm(copy);
};
$('tDel').onclick = () => {
  if (ttsList.length <= 1) { toast('至少保留一个语音服务'); return; }
  const i = ttsList.findIndex(p => p.id === selTts);
  if (i < 0) return;
  const name = ttsList[i].name;
  ttsList.splice(i, 1);
  selTts = ttsList[Math.max(0, i - 1)].id;
  renderTtsSelect();
  writeTtsForm(ttsList.find(p => p.id === selTts));
  toast('已删除「' + name + '」，点保存后生效');
};

// 拉取模型
$('cModelsBtn').onclick = async () => {
  setState('cModelState', '正在拉取模型列表…');
  if (!commitChatForm()) return;
  const p = chatList.find(x => x.id === selChat);
  const r = await API.provider.models({ provider: stripProvider(p) });
  if (!r.ok) { setState('cModelState', r.error, 'err'); return; }
  if (!r.models.length) { setState('cModelState', '该服务没有返回模型列表，请手动填写模型名', 'err'); return; }
  setState('cModelState', '共 ' + r.models.length + ' 个模型，例如：' + r.models.slice(0, 6).join('、'), 'ok');
  const cur = $('cModel').value;
  $('cModel').list = '';
  const dl = document.createElement('datalist');
  dl.id = 'modelListDyn';
  r.models.forEach(m => { const o = document.createElement('option'); o.value = m; dl.appendChild(o); });
  const old = $('modelListDyn');
  if (old) old.remove();
  document.body.appendChild(dl);
  $('cModel').setAttribute('list', 'modelListDyn');
  if (!cur && r.models[0]) $('cModel').value = r.models[0];
};

// 测试连接
$('cTestBtn').onclick = async () => {
  if (!commitChatForm()) return;
  setState('cTestState', '测试中…');
  const p = chatList.find(x => x.id === selChat);
  const r = await API.provider.test({ provider: stripProvider(p) });
  setState('cTestState', r.ok ? ('连接正常（' + r.provider + '）：' + r.message) : r.error, r.ok ? 'ok' : 'err');
};

const testAudio = { el: null };
function playTest(b64, mime) {
  if (testAudio.el) { try { testAudio.el.pause(); } catch (e) {} }
  testAudio.el = new Audio('data:' + mime + ';base64,' + b64);
  return testAudio.el.play();
}
$('tStopBtn').onclick = () => { if (testAudio.el) { try { testAudio.el.pause(); } catch (e) {} testAudio.el = null; } };
$('tTestBtn').onclick = async () => {
  if (!commitTtsForm()) return;
  setState('tTestState', '合成中…');
  const p = ttsList.find(x => x.id === selTts);
  const r = await API.tts.test({ provider: stripProvider(p) });
  if (!r.ok) { setState('tTestState', r.error, 'err'); return; }
  setState('tTestState', r.message, 'ok');
  try { await playTest(r.audio, r.mime); } catch (e) { setState('tTestState', r.message + '（播放失败：' + e.message + '）', 'err'); }
};

// 音色设计
$('tApplyPreset').onclick = () => {
  const vp = meta.voicePresets.find(x => x.id === $('tVoicePreset').value);
  if (!vp) return;
  $('tVoiceDesign').value = vp.desc;
  setState('tVoiceState', '已套用「' + vp.name + '」，保存后生效', 'ok');
};
async function refreshVoiceRef() {
  const cur = ttsList.find(x => x.id === selTts);
  if (!cur || cur.protocol !== 'mimo-tts') return;
  const r = await API.tts.voiceRefInfo({ provider: stripProvider(cur) });
  if (!r || !r.ok) return;
  if (r.exists) setState('tVoiceState', '已固化参考音色：' + Math.round(r.bytes / 1024) + ' KB · ' + new Date(r.createdAt).toLocaleString());
  else setState('tVoiceState', '尚未生成音色，首次朗读或点「生成 / 重新生成音色」时自动生成');
}
$('tRegen').onclick = async () => {
  if (!commitChatForm() || !commitTtsForm()) return;
  setState('tVoiceState', '保存描述并生成音色…');
  const sr = await API.config.save({
    providers: { chat: chatList.map(stripProvider), tts: ttsList.map(stripProvider) },
    activeChatId: selChat, activeTtsId: selTts,
  });
  if (!sr || !sr.ok) { setState('tVoiceState', '保存失败', 'err'); return; }
  const r = await API.tts.designVoice({ id: selTts, reuse: false });
  if (!r.ok) { setState('tVoiceState', r.error, 'err'); return; }
  setState('tVoiceState', '已生成并固化 ' + Math.round(r.bytes / 1024) + ' KB', 'ok');
  try { await playTest(r.audio, r.mime); } catch (e) {}
};

// 界面与行为
function syncRangeLabels() {
  $('uiSizeVal').textContent = $('uiSize').value + 'px';
  $('uiOpacityVal').textContent = Math.round($('uiOpacity').value * 100) + '%';
}
$('uiSize').addEventListener('input', syncRangeLabels);
$('uiOpacity').addEventListener('input', syncRangeLabels);

$('btnOpenDir').onclick = () => API.app.openUserData();
$('btnClose').onclick = () => API.win.close();
$('btnCancel').onclick = () => API.win.close();

$('btnSave').onclick = async () => {
  if (!commitChatForm() || !commitTtsForm()) return;
  if (!chatList.length) { toast('至少保留一个聊天服务'); return; }
  if (!ttsList.length) { toast('至少保留一个语音服务'); return; }
  const patch = {
    providers: { chat: chatList.map(stripProvider), tts: ttsList.map(stripProvider) },
    activeChatId: selChat,
    activeTtsId: selTts,
    systemPrompt: $('systemPrompt').value,
    maxContextMessages: numOr($('maxContextMessages').value, 20),
    maxImagesInContext: Math.max(0, parseInt($('maxImagesInContext').value, 10) || 0),
    ui: {
      edge: $('uiEdge').value,
      size: parseInt($('uiSize').value, 10),
      opacity: parseFloat($('uiOpacity').value),
      alwaysOnTop: $('uiTop').checked,
      autoLaunch: $('uiAuto').checked,
    },
  };
  setState('saveState', '保存中…');
  const r = await API.config.save(patch);
  if (!r || !r.ok) { setState('saveState', '保存失败', 'err'); return; }
  applyConfig(r.config, appVer, cfgPath, meta);
  setState('saveState', '已保存', 'ok');
  toast('设置已保存');
};

// 标题栏拖拽
let drag = null;
$('titlebar').addEventListener('mousedown', e => {
  if (e.button !== 0 || e.target.closest('button')) return;
  drag = { x: e.screenX, y: e.screenY };
  window.addEventListener('mousemove', onDrag);
  window.addEventListener('mouseup', () => { window.removeEventListener('mousemove', onDrag); drag = null; }, { once: true });
});
function onDrag(e) {
  if (!drag) return;
  API.win.drag({ dx: e.screenX - drag.x, dy: e.screenY - drag.y });
  drag = { x: e.screenX, y: e.screenY };
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') API.win.close(); });

// ---------------------------------------------------------------- 应用配置
function applyConfig(c, appVersion, configPath, metaIn) {
  if (appVersion) appVer = appVersion;
  if (configPath) cfgPath = configPath;
  if (metaIn) meta = metaIn;

  chatList = (c.providers && c.providers.chat ? c.providers.chat : []).map(p => Object.assign({}, p));
  ttsList = (c.providers && c.providers.tts ? c.providers.tts : []).map(p => Object.assign({}, p));
  selChat = chatList.some(p => p.id === c.activeChatId) ? c.activeChatId : (chatList[0] && chatList[0].id);
  selTts = ttsList.some(p => p.id === c.activeTtsId) ? c.activeTtsId : (ttsList[0] && ttsList[0].id);

  options($('cProtocol'), meta.chatProtocols, 'id', 'label', 'openai');
  options($('tProtocol'), meta.ttsProtocols, 'id', 'label', 'mimo-tts');
  options($('cAuthHeader'), meta.authChoices, 'id', 'label', 'bearer');
  options($('tAuthHeader'), meta.authChoices, 'id', 'label', 'bearer');
  options($('cPresetSelect'), meta.chatPresets.map(p => ({ id: p.id, label: p.name })), 'id', 'label', meta.chatPresets[0] && meta.chatPresets[0].id);
  options($('tPresetSelect'), meta.ttsPresets.map(p => ({ id: p.id, label: p.name })), 'id', 'label', meta.ttsPresets[0] && meta.ttsPresets[0].id);

  renderChatSelect();
  renderTtsSelect();
  const cSel = chatList.find(p => p.id === selChat);
  if (cSel) writeChatForm(cSel);
  const tSel = ttsList.find(p => p.id === selTts);
  if (tSel) writeTtsForm(tSel);

  $('systemPrompt').value = c.systemPrompt || '';
  $('maxContextMessages').value = c.maxContextMessages || 20;
  $('maxImagesInContext').value = c.maxImagesInContext == null ? 2 : c.maxImagesInContext;
  $('uiEdge').value = c.ui.edge || 'right';
  $('uiSize').value = c.ui.size || 56;
  $('uiOpacity').value = c.ui.opacity == null ? 0.96 : c.ui.opacity;
  $('uiTop').checked = !!c.ui.alwaysOnTop;
  $('uiAuto').checked = !!c.ui.autoLaunch;
  syncRangeLabels();

  $('aboutVersion').textContent = appVer || '-';
  $('aboutPath').textContent = cfgPath || '-';
}

document.querySelectorAll('a[data-ext]').forEach(a => {
  a.addEventListener('click', e => { e.preventDefault(); API.app.openExternal(a.getAttribute('href')); });
});

(async function init() {
  const r = await API.config.get();
  applyConfig(r.config, r.appVersion, r.configPath, {
    chatProtocols: r.chatProtocols || [],
    ttsProtocols: r.ttsProtocols || [],
    authChoices: r.authChoices || [],
    chatPresets: r.chatPresets || [],
    ttsPresets: r.ttsPresets || [],
    voicePresets: r.voicePresets || [],
  });
})();
