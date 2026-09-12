'use strict';
// 用 Electron 运行：electron scripts/probe-providers.js
// A) 起一个本地「OpenAI 兼容」模拟服务，验证自定义 API 的完整链路
// B) 用假 Key 打真实端点，确认 URL / 鉴权头 / 请求体是被服务端接受的（返回鉴权错误而不是 404/结构错误）
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const providers = require('../src/main/providers');

app.setName('deepseek-desktop-assistant');
const log = (...a) => console.log(...a);

const PORT = 8791;
const received = [];
let fail = 0;
let skipped = 0;
const check = (label, ok, extra) => { log((ok ? '  OK   ' : '  FAIL ') + label + (extra ? '  ' + extra : '')); if (!ok) fail++; };

// 1x1 透明 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function startMock() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model-a' }, { id: 'mock-model-b' }] }));
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        let raw = '';
        req.on('data', c => { raw += c; });
        req.on('end', () => {
          const auth = req.headers['authorization'] || '';
          if (!auth.startsWith('Bearer mock-key')) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Invalid mock key' } }));
            return;
          }
          const body = JSON.parse(raw || '{}');
          received.push(body);
          if (body.stream) {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            for (const piece of ['这是', '模拟', '流式', '回复']) {
              res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: piece } }] }) + '\n\n');
            }
            res.write('data: [DONE]\n\n');
            res.end();
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ choices: [{ message: { content: '模拟非流式回复', reasoning_content: '想了想' } }] }));
          }
        });
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'no such path' } }));
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

async function partA() {
  log('===== A) 自定义 API（本地模拟 OpenAI 兼容服务）=====');
  const dir = path.join(os.tmpdir(), 'dsa-provider-probe');
  fs.mkdirSync(dir, { recursive: true });
  const imgFile = path.join(dir, 'shot.png');
  fs.writeFileSync(imgFile, PNG);

  const custom = {
    id: 'mock', name: '本地模拟服务', protocol: 'openai',
    baseUrl: 'http://127.0.0.1:' + PORT + '/v1',
    apiKey: 'mock-key', authHeader: 'bearer', model: 'mock-model-a',
    supportsVision: true, maxTokens: 128, maxTokensParam: 'max_tokens',
    imageDetail: 'original',
  };

  const models = await providers.listModels(custom);
  check('listModels 走自定义 Base URL', models.length === 2 && models[0] === 'mock-model-a', JSON.stringify(models));

  const once = await providers.chatOnce(custom, { systemPrompt: 'SYS', text: '你好' });
  check('chatOnce 返回内容', once.content === '模拟非流式回复', JSON.stringify(once.content));
  check('chatOnce 解析 reasoning', once.reasoning === '想了想');
  const b0 = received[received.length - 1];
  check('请求体含 system 消息', b0.messages[0].role === 'system' && b0.messages[0].content === 'SYS');
  check('请求体 stream=false', b0.stream === false);
  check('自定义路径生效（未带 /chat/completions 之外的路径）', b0.model === 'mock-model-a');

  let packed = '';
  const streamed = await providers.chatStream(custom, {
    systemPrompt: '', history: [{ role: 'user', text: '讲个笑话' }],
    context: { maxContextMessages: 10, maxImagesInContext: 2 },
    onDelta: d => { packed += d; },
  });
  check('chatStream 拼接完整', streamed.content === '这是模拟流式回复', JSON.stringify(streamed.content));
  check('onDelta 逐块回调', packed === '这是模拟流式回复');

  // 带截图
  received.length = 0;
  await providers.chatStream(custom, {
    systemPrompt: '', history: [{ role: 'user', text: '看图', image: { file: imgFile } }],
    context: { maxContextMessages: 10, maxImagesInContext: 2 },
  });
  const withImg = received[0];
  const blocks = withImg.messages[0].content;
  check('支持图片时发送 image_url 块', Array.isArray(blocks) && blocks[1].type === 'image_url' && blocks[1].image_url.url.startsWith('data:image/png;base64,'));

  // 关闭视觉能力后应降级为纯文本
  received.length = 0;
  await providers.chatStream(custom, {
    systemPrompt: '', history: [{ role: 'user', text: '看图', image: { file: imgFile } }],
    context: { maxContextMessages: 10, maxImagesInContext: 2 },
  });
  const noVis = Object.assign({}, custom, { supportsVision: false });
  received.length = 0;
  await providers.chatStream(noVis, {
    systemPrompt: '', history: [{ role: 'user', text: '看图', image: { file: imgFile } }],
    context: { maxContextMessages: 10, maxImagesInContext: 2 },
  });
  check('不勾「支持图片」时降级为纯文本并加说明', typeof received[0].messages[0].content === 'string' && received[0].messages[0].content.includes('截图已省略'), JSON.stringify(received[0].messages[0].content));

  // 鉴权失败信息
  let errMsg = '';
  try { await providers.chatOnce(Object.assign({}, custom, { apiKey: 'wrong' }), { systemPrompt: '', text: 'hi' }); }
  catch (e) { errMsg = String(e.message || e); }
  check('错 Key 时给出可读的鉴权错误', /鉴权失败/.test(errMsg), errMsg.slice(0, 80));

  // 404 路径提示
  let err404 = '';
  try { await providers.chatOnce(Object.assign({}, custom, { baseUrl: 'http://127.0.0.1:' + PORT + '/nope' }), { systemPrompt: '', text: 'hi' }); }
  catch (e) { err404 = String(e.message || e); }
  check('错误路径给出 404 提示', /404/.test(err404), err404.slice(0, 80));

  // 预设完整性
  const ids = providers.CHAT_PRESETS.map(p => p.id);
  check('聊天预设数量 >= 15', ids.length >= 15, ids.join(','));
  check('每个预设都能构造成完整 provider', providers.CHAT_PRESETS.every(p => { const q = providers.chatFromPreset(p.id); return q.id && q.protocol && q.baseUrl !== undefined && typeof q.maxTokens === 'number'; }));
  check('TTS 预设可构造', providers.TTS_PRESETS.every(p => { const q = providers.ttsFromPreset(p.id); return q.id && q.protocol; }));
}

async function reachable(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try { await fetch(url, { method: 'GET', signal: ctrl.signal }); return true; }
  catch (e) { return false; }
  finally { clearTimeout(timer); }
}

async function partB() {
  log('');
  log('===== B) 真实端点可达性（用假 Key，只确认请求结构被接受）=====');
  const probes = [
    ['OpenAI', { id: 'openai', name: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'DUMMY-KEY-NOT-REAL', authHeader: 'bearer', model: 'gpt-4o', maxTokens: 16 }],
    ['Anthropic', { id: 'anthropic', name: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'DUMMY-KEY-NOT-REAL', authHeader: 'x-api-key', model: 'claude-sonnet-4-5', maxTokens: 16 }],
    ['Gemini', { id: 'gemini', name: 'Gemini', protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'DUMMY-KEY-NOT-REAL', authHeader: 'x-goog-api-key', model: 'gemini-2.5-flash', maxTokens: 16 }],
  ];
  for (const [label, p] of probes) {
    const origin = new URL(p.baseUrl).origin;
    if (!(await reachable(origin))) {
      log('  SKIP  ' + label + ' 网络不可达（' + origin + '）——请求结构未经真实端点验证，不计为通过');
      skipped++;
      continue;
    }
    try {
      await providers.chatOnce(p, { systemPrompt: '', text: 'ping' });
      check(label + ' 未鉴权却成功（异常）', false);
    } catch (e) {
      const m = String(e.message || e);
      // 401/403/400 说明请求结构被服务端接受、只是 Key 无效；404 说明路径或鉴权头写错了
      check(label + ' 请求结构正确（收到鉴权错误而非 404）', !/404/.test(m), m.slice(0, 110));
    }
  }

  // OpenAI 兼容 TTS 的端点结构（同样用假 Key）
  const ttsOrigin = 'https://api.openai.com';
  if (!(await reachable(ttsOrigin))) {
    log('  SKIP  OpenAI TTS 网络不可达（' + ttsOrigin + '）——未验证');
    skipped++;
  } else {
    try {
      await providers.synthesize({ id: 'openai-tts', name: 'OpenAI TTS', protocol: 'openai-tts', baseUrl: 'https://api.openai.com/v1', apiKey: 'DUMMY-KEY-NOT-REAL', authHeader: 'bearer', ttsModel: 'gpt-4o-mini-tts', voice: 'alloy', format: 'mp3' }, '测试');
      check('OpenAI TTS 未鉴权却成功（异常）', false);
    } catch (e) {
      check('OpenAI TTS 请求结构正确（鉴权错误而非 404）', !/404/.test(String(e.message || e)), String(e.message || e).slice(0, 110));
    }
  }
}

(async () => {
  const server = await startMock();
  try {
    await partA();
    await partB();
  } catch (e) {
    log('异常:', e && e.stack ? e.stack : String(e));
    fail++;
  }
  server.close();
  log('');
  log(fail === 0
    ? ('通过' + (skipped ? '（另有 ' + skipped + ' 项因网络不可达而跳过，未验证）' : '，全部通过'))
    : '失败项: ' + fail);
  app.exit(fail === 0 ? 0 : 1);
})();
