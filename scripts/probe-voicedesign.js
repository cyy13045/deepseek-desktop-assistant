'use strict';
// 通过 Electron 运行（需要 safeStorage 解密配置）：electron scripts/probe-voicedesign.js
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

app.setName('deepseek-desktop-assistant');

const DESIGN = '一个沉稳、清晰、带一点科技感的中文青年男声：音色干净、偏中性偏低，语速中等偏慢，吐字清楚，语气专业冷静而不冷漠，像一位可靠的技术助手在耐心讲解；句尾自然收束，不过分热情，不做播音腔。';
const SAMPLE = '你好，我是 DeepSeek 桌面助手。我可以帮你看屏幕上的内容、回答问题，也可以把答案读给你听。';

app.whenReady().then(async () => {
  const { Store } = require(path.join(__dirname, '..', 'src', 'main', 'store'));
  const cfg = new Store(app.getPath('userData')).get().mimo;
  const H = { 'Content-Type': 'application/json', 'api-key': cfg.apiKey };
  const base = String(cfg.baseUrl).replace(/\/+$/, '');
  const log = (...a) => console.log(...a);

  async function call(body, label) {
    const t0 = Date.now();
    const r = await fetch(base + '/chat/completions', { method: 'POST', headers: H, body: JSON.stringify(body) });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch (e) {}
    if (!r.ok) { log(label, 'HTTP', r.status, txt.slice(0, 400)); return null; }
    const msg = j && j.choices && j.choices[0] && j.choices[0].message;
    const audio = msg && msg.audio && msg.audio.data;
    if (!audio) { log(label, '无 audio 字段; message keys =', msg ? Object.keys(msg).join(',') : 'null'); return null; }
    const bytes = Buffer.from(audio, 'base64').length;
    log(label, '| 音频', Math.round(bytes / 1024) + ' KB', '|', (Date.now() - t0) + 'ms');
    return { b64: audio, bytes, msg };
  }

  async function asr(b64, mime, label) {
    const r = await fetch(base + '/chat/completions', {
      method: 'POST', headers: H,
      body: JSON.stringify({
        model: 'mimo-v2.5-asr',
        messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: 'data:' + mime + ';base64,' + b64, format: mime === 'audio/mpeg' ? 'mp3' : 'wav' } }] }],
      }),
    });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch (e) {}
    if (!r.ok) { log(label, 'ASR HTTP', r.status, t.slice(0, 300)); return null; }
    const c = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    log(label, '识别结果 =', JSON.stringify(c));
    return c;
  }

  const dir = path.join(os.tmpdir(), 'dsa-voice-probe');
  fs.mkdirSync(dir, { recursive: true });

  log('=== A) voicedesign（只用文字描述，不带 voice 字段）===');
  const a = await call({ model: 'mimo-v2.5-tts-voicedesign', messages: [{ role: 'user', content: DESIGN }, { role: 'assistant', content: SAMPLE }], audio: { format: 'mp3' } }, 'A');
  if (a) {
    fs.writeFileSync(path.join(dir, 'A-design.mp3'), Buffer.from(a.b64, 'base64'));
    await asr(a.b64, 'audio/mpeg', 'A');
  }

  log('');
  log('=== B) 同一个描述再生成一次（看音色是否稳定）===');
  const b = await call({ model: 'mimo-v2.5-tts-voicedesign', messages: [{ role: 'user', content: DESIGN }, { role: 'assistant', content: SAMPLE }], audio: { format: 'mp3' } }, 'B');
  if (b && a) log('   A vs B 字节差 =', Math.abs(a.bytes - b.bytes), '| 完全相同 =', a.b64 === b.b64);
  if (b) fs.writeFileSync(path.join(dir, 'B-design2.mp3'), Buffer.from(b.b64, 'base64'));

  log('');
  log('=== C) 用 A 的音色做 voiceclone（保证分块间音色一致）===');
  const shorter = '这是第二句话，用来验证克隆音色在分块朗读时是否保持一致。';
  const c = await call({ model: 'mimo-v2.5-tts-voiceclone', messages: [{ role: 'assistant', content: shorter }], audio: { voice: 'data:audio/mpeg;base64,' + a.b64, format: 'mp3' } }, 'C(mp3参考)');
  if (c) { fs.writeFileSync(path.join(dir, 'C-clone.mp3'), Buffer.from(c.b64, 'base64')); await asr(c.b64, 'audio/mpeg', 'C'); }

  log('');
  log('=== D) 参考音频改用 wav，看是否更稳 ===');
  const dw = await call({ model: 'mimo-v2.5-tts-voicedesign', messages: [{ role: 'user', content: DESIGN }, { role: 'assistant', content: SAMPLE }], audio: { format: 'wav' } }, 'D-design(wav)');
  if (dw) {
    const c2 = await call({ model: 'mimo-v2.5-tts-voiceclone', messages: [{ role: 'assistant', content: shorter }], audio: { voice: 'data:audio/wav;base64,' + dw.b64, format: 'mp3' } }, 'D-clone(wav参考)');
    if (c2) { fs.writeFileSync(path.join(dir, 'D-clone-wavref.mp3'), Buffer.from(c2.b64, 'base64')); await asr(c2.b64, 'audio/mpeg', 'D'); }
  }

  log('');
  log('产物目录:', dir);
  app.exit(0);
}).catch(e => { console.error('FATAL', e); app.exit(1); });
