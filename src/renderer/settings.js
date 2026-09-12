'use strict';
const API = window.api;
const $ = id => document.getElementById(id);
let cfg = null;
let voices = [];
let voicePresets = [];
const DEFAULT_MODELS = ['deepseek-flash', 'deepseek-v4-pro'];

function setState(id, text, kind) {
  const e = $(id);
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

function applyConfig(c, appVersion, configPath, voiceList, presetList) {
  cfg = c;
  if (voiceList && voiceList.length) voices = voiceList;
  if (presetList && presetList.length) voicePresets = presetList;

  $('dsKey').value = '';
  $('dsKey').placeholder = c.deepseek.apiKeySet ? '已配置，留空则不改动' : 'sk-...';
  setState('dsKeyState', c.deepseek.apiKeySet ? ('当前已配置：' + c.deepseek.apiKeyMask) : '尚未配置 API Key');
  $('dsBase').value = c.deepseek.baseUrl || '';
  $('dsModel').value = c.deepseek.model || '';
  $('dsThinking').checked = !!c.deepseek.thinking;
  $('dsEffort').value = c.deepseek.reasoningEffort || 'low';
  $('dsDetail').value = c.deepseek.imageDetail || 'original';
  $('dsSystem').value = c.systemPrompt || '';

  $('miKey').value = '';
  $('miKey').placeholder = c.mimo.apiKeySet ? '已配置，留空则不改动' : 'sk-...';
  setState('miKeyState', c.mimo.apiKeySet ? ('当前已配置：' + c.mimo.apiKeyMask) : '尚未配置 API Key');
  $('miBase').value = c.mimo.baseUrl || '';
  $('miModel').value = c.mimo.ttsModel || '';
  $('miFormat').value = c.mimo.format || 'mp3';
  $('miStyle').value = c.mimo.style || '';
  $('miAuto').checked = !!c.mimo.autoSpeak;
  $('miChunk').value = c.mimo.chunkSize || 60;
  const vs = $('miVoice');
  vs.innerHTML = '';
  (voices.length ? voices : [c.mimo.voice || '白桦']).forEach(v => {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    vs.appendChild(o);
  });
  vs.value = c.mimo.voice || (voices[0] || '白桦');

  $('miVoiceMode').value = c.mimo.voiceMode === 'preset' ? 'preset' : 'design';
  $('miVoiceDesign').value = c.mimo.voiceDesign || '';
  const ps = $('miVoicePreset');
  ps.innerHTML = '';
  (voicePresets.length ? voicePresets : [{ id: 'default', name: '默认描述', desc: c.mimo.voiceDesign || '' }]).forEach(p => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.name;
    ps.appendChild(o);
  });
  syncVoiceBoxes();
  refreshVoiceRef();

  $('uiEdge').value = c.ui.edge || 'right';
  $('uiSize').value = c.ui.size || 56;
  $('uiOpacity').value = c.ui.opacity == null ? 0.96 : c.ui.opacity;
  $('uiTop').checked = !!c.ui.alwaysOnTop;
  $('uiAuto').checked = !!c.ui.autoLaunch;
  syncRangeLabels();

  $('aboutVersion').textContent = appVersion || '-';
  $('aboutPath').textContent = configPath || '-';
  const ml = $('modelList');
  ml.innerHTML = '';
  DEFAULT_MODELS.forEach(m => { const o = document.createElement('option'); o.value = m; ml.appendChild(o); });
}

function syncRangeLabels() {
  $('uiSizeVal').textContent = $('uiSize').value + 'px';
  $('uiOpacityVal').textContent = Math.round($('uiOpacity').value * 100) + '%';
}

$('uiSize').addEventListener('input', syncRangeLabels);
$('uiOpacity').addEventListener('input', syncRangeLabels);

for (const [btn, input] of [['dsKeyToggle', 'dsKey'], ['miKeyToggle', 'miKey']]) {
  $(btn).onclick = () => {
    const i = $(input);
    const show = i.type === 'password';
    i.type = show ? 'text' : 'password';
    $(btn).textContent = show ? '隐藏' : '显示';
  };
}
$('dsKeyClear').onclick = () => { $('dsKey').value = '__CLEAR__'; setState('dsKeyState', '保存后将清空 DeepSeek API Key', 'err'); };
$('miKeyClear').onclick = () => { $('miKey').value = '__CLEAR__'; setState('miKeyState', '保存后将清空 MiMo API Key', 'err'); };

$('dsModelRefresh').onclick = async () => {
  setState('dsModelState', '正在拉取模型列表…');
  const r = await API.deepseek.models();
  if (!r.ok) { setState('dsModelState', r.error, 'err'); return; }
  const ml = $('modelList');
  ml.innerHTML = '';
  r.models.forEach(m => { const o = document.createElement('option'); o.value = m; ml.appendChild(o); });
  setState('dsModelState', '可用模型：' + r.models.join('、'), 'ok');
};

$('dsTest').onclick = async () => {
  setState('dsTestState', '测试中…');
  const r = await API.deepseek.test();
  setState('dsTestState', r.ok ? ('连接正常：' + r.message) : r.error, r.ok ? 'ok' : 'err');
};

const testAudio = { el: null };
function playTest(b64, mime) {
  if (testAudio.el) { try { testAudio.el.pause(); } catch (e) {} }
  testAudio.el = new Audio('data:' + mime + ';base64,' + b64);
  return testAudio.el.play();
}
$('miStop').onclick = () => { if (testAudio.el) { try { testAudio.el.pause(); } catch (e) {} testAudio.el = null; } };

$('miTest').onclick = async () => {
  setState('miTestState', '合成中…');
  const r = await API.mimo.test();
  if (!r.ok) { setState('miTestState', r.error, 'err'); return; }
  setState('miTestState', r.message, 'ok');
  try { await playTest(r.audio, r.mime); }
  catch (e) { setState('miTestState', r.message + '（播放失败：' + e.message + '）', 'err'); }
};

// ---------- 音色来源切换 / 设计音色 ----------
function syncVoiceBoxes() {
  const design = $('miVoiceMode').value !== 'preset';
  $('miDesignBox').style.display = design ? 'block' : 'none';
  $('miPresetBox').style.display = design ? 'none' : 'block';
}
$('miVoiceMode').addEventListener('change', syncVoiceBoxes);

$('miVoiceApplyPreset').onclick = () => {
  const p = voicePresets.find(x => x.id === $('miVoicePreset').value);
  if (!p) return;
  $('miVoiceDesign').value = p.desc;
  setState('miVoiceState', '已套用「' + p.name + '」，保存后生效', 'ok');
};

async function refreshVoiceRef() {
  const r = await API.mimo.voiceRefInfo();
  if (!r || !r.ok) return;
  if (r.exists) {
    setState('miVoiceState', '已固化参考音色：' + Math.round(r.bytes / 1024) + ' KB · ' + new Date(r.createdAt).toLocaleString());
  } else {
    setState('miVoiceState', '尚未生成音色，首次朗读或点「生成 / 重新生成音色」时自动生成');
  }
}

$('miVoiceRegen').onclick = async () => {
  setState('miVoiceState', '保存描述并生成音色…');
  // 先把当前描述落盘，否则生成的是上一次保存的描述
  const sr = await API.config.save({ mimo: { voiceMode: $('miVoiceMode').value, voiceDesign: $('miVoiceDesign').value } });
  if (!sr || !sr.ok) { setState('miVoiceState', '保存失败', 'err'); return; }
  const r = await API.mimo.designVoice({ reuse: false });
  if (!r.ok) { setState('miVoiceState', r.error, 'err'); return; }
  setState('miVoiceState', '已生成并固化 ' + Math.round(r.bytes / 1024) + ' KB', 'ok');
  try { await playTest(r.audio, r.mime); } catch (e) {}
};

$('btnOpenDir').onclick = () => API.app.openUserData();
$('btnClose').onclick = () => API.win.close();
$('btnCancel').onclick = () => API.win.close();

$('btnSave').onclick = async () => {
  const patch = {
    deepseek: {
      baseUrl: $('dsBase').value.trim(),
      model: $('dsModel').value.trim(),
      thinking: $('dsThinking').checked,
      reasoningEffort: $('dsEffort').value,
      imageDetail: $('dsDetail').value,
    },
    mimo: {
      baseUrl: $('miBase').value.trim(),
      ttsModel: $('miModel').value.trim(),
      voiceMode: $('miVoiceMode').value,
      voiceDesign: $('miVoiceDesign').value,
      format: $('miFormat').value,
      voice: $('miVoice').value,
      style: $('miStyle').value,
      autoSpeak: $('miAuto').checked,
      chunkSize: Math.max(20, Math.min(200, parseInt($('miChunk').value, 10) || 60)),
    },
    ui: {
      edge: $('uiEdge').value,
      size: parseInt($('uiSize').value, 10),
      opacity: parseFloat($('uiOpacity').value),
      alwaysOnTop: $('uiTop').checked,
      autoLaunch: $('uiAuto').checked,
    },
    systemPrompt: $('dsSystem').value,
  };
  const dsv = $('dsKey').value.trim();
  if (dsv) patch.deepseek.apiKey = dsv;
  const miv = $('miKey').value.trim();
  if (miv) patch.mimo.apiKey = miv;

  setState('saveState', '保存中…');
  const r = await API.config.save(patch);
  if (!r || !r.ok) { setState('saveState', '保存失败', 'err'); return; }
  const ver = $('aboutVersion').textContent;
  const p = $('aboutPath').textContent;
  applyConfig(r.config, ver, p, voices, voicePresets);
  setState('saveState', '已保存', 'ok');
  toast('设置已保存');
};

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

document.querySelectorAll('a[data-ext]').forEach(a => {
  a.addEventListener('click', e => { e.preventDefault(); API.app.openExternal(a.getAttribute('href')); });
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') API.win.close(); });

(async function init() {
  const r = await API.config.get();
  applyConfig(r.config, r.appVersion, r.configPath, r.voices, r.voicePresets);
})();