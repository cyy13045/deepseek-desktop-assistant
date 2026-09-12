'use strict';
// 纯 Node 跑（不依赖 Electron）：npm run check-fixes
// 针对本轮修复做定向验证，每条断言都能区分「修好了」和「没修」
const http = require('http');
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

let fail = 0, pass = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  OK   ' + label + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  ' + extra : '')); }
};

// ---------- 一个故意很慢的 TTS 服务 ----------
function startSlow(port, delayMs) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let raw = '';
      req.on('data', c => { raw += c; });
      req.on('end', () => {
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            choices: [{ message: { audio: { data: Buffer.from('RIFFxxxxWAVE').toString('base64') } } }],
          }));
        }, delayMs);
      });
    });
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

const mimo = require('../src/main/mimo');

async function testTimeout(port) {
  console.log('P1  mimo.js 超时与取消');
  const cfg = {
    baseUrl: 'http://127.0.0.1:' + port + '/v1',
    apiKey: 'dummy', ttsModel: 'mimo-v2.5-tts', voice: '白桦', format: 'mp3',
    timeoutMs: 700,
  };
  const t0 = Date.now();
  let msg = '';
  try { await mimo.synthesize(cfg, '这是一段用于测试超时的文本。', {}); }
  catch (e) { msg = String(e.message || e); }
  const dt = Date.now() - t0;
  ok('服务端不返回时按 timeoutMs 超时', /超时/.test(msg) && dt < 3000, dt + 'ms :: ' + msg.slice(0, 48));

  // 外部取消：应立刻中断，而不是等超时
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 250);
  const t1 = Date.now();
  let msg2 = '';
  try { await mimo.synthesize(cfg, '这一段应该在取消时被打断。', { signal: ctrl.signal }); }
  catch (e) { msg2 = String(e.message || e); }
  const dt2 = Date.now() - t1;
  ok('外部 AbortSignal 能中断飞行中的请求', /取消/.test(msg2) && dt2 < 3000, dt2 + 'ms :: ' + msg2.slice(0, 48));

  // 正常返回时不应被误判
  const fast = Object.assign({}, cfg, { timeoutMs: 20000 });
  const r = await mimo.synthesize(fast, '正常情况。', {});
  ok('正常返回不受影响', !!(r && r.base64), 'mime=' + (r && r.mime));
}

async function testMergeArity() {
  console.log('P1  mergeAlternating 签名');
  const http2 = require('../src/main/providers/http');
  ok('已去掉未使用的第二个参数', http2.mergeAlternating.length === 1, 'arity=' + http2.mergeAlternating.length);
  const merged = http2.mergeAlternating([
    { role: 'user', text: 'a' }, { role: 'assistant', text: 'b' },
    { role: 'assistant', text: 'c' }, { role: 'user', text: 'd' },
  ]);
  ok('仍然正确合并连续同角色', merged.length === 3 && merged[1].text === 'b\nc', JSON.stringify(merged.map(m => m.role + ':' + m.text)));
  const lead = http2.mergeAlternating([{ role: 'assistant', text: 'x' }, { role: 'user', text: 'y' }]);
  ok('仍然保证首条是 user', lead[0].role === 'user', JSON.stringify(lead.map(m => m.role)));
}

function testStoreSnapshot() {
  console.log('P2  store.get() 返回不可变快照');
  const { Store } = require('../src/main/store');
  // 必须用临时目录！纯 Node 下没有 safeStorage，解密一律返回空串，
  // 一旦对这个 Store 调 update() 就会把空 Key 写回真实配置 —— 之前就是这么把用户的 Key 弄丢的。
  const realDir = path.join(process.env.APPDATA || '', 'deepseek-desktop-assistant');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsa-store-check-'));
  if (path.resolve(dir) === path.resolve(realDir)) throw new Error('拒绝在真实配置目录上跑测试');
  const s = new Store(dir);
  const a = s.get();
  ok('快照被冻结', Object.isFrozen(a) && Object.isFrozen(a.providers) && Object.isFrozen(a.providers.chat));
  ok('同版本重复 get 返回同一对象（有缓存，不做无谓克隆）', s.get() === s.get());

  const before = s.get().systemPrompt;
  try { s.get().systemPrompt = 'HACKED'; } catch (e) { /* 严格模式会抛 */ }
  ok('外部写入无法污染内部状态', s.get().systemPrompt === before);

  const originalSize = s.get().ui.size;   // 来自 DEFAULTS（临时目录里没有 config.json）

  // 记录真实配置的 Key 长度，跑完再核对一遍，确保这个测试没有碰它
  const realBefore = (() => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(realDir, 'config.json'), 'utf8'));
      return (raw.providers.chat[0].apiKey || '').length + '/' + (raw.providers.tts[0].apiKey || '').length;
    } catch (e) { return 'n/a'; }
  })();
  const upd = s.update({ ui: { size: 60 } });
  ok('update 后拿到新快照', upd.ui.size === 60 && s.get().ui.size === 60);
  ok('新快照同样被冻结', Object.isFrozen(s.get()));
  const oldRef = s.get();
  s.update({ ui: { size: originalSize } });
  ok('更新后旧快照不被就地改写（无半更新状态）', oldRef.ui.size === 60 && s.get().ui.size === originalSize);
  ok('已恢复原值', s.get().ui.size === originalSize, String(originalSize));

  const realAfter = (() => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(realDir, 'config.json'), 'utf8'));
      return (raw.providers.chat[0].apiKey || '').length + '/' + (raw.providers.tts[0].apiKey || '').length;
    } catch (e) { return 'n/a'; }
  })();
  ok('没有碰真实配置文件', realBefore === realAfter, '真实 Key 密文长度 ' + realBefore + ' -> ' + realAfter);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}

(async () => {
  const PORT = 8799;
  const srv = await startSlow(PORT, 6000);
  try {
    await testTimeout(PORT);
    await testMergeArity();
    testStoreSnapshot();
  } catch (e) {
    console.log('  异常:', e && e.stack ? e.stack : String(e));
    fail++;
  } finally {
    srv.close();
  }
  console.log('');
  console.log(fail === 0 ? ('全部通过（' + pass + ' 项）') : ('失败 ' + fail + ' 项 / 共 ' + (pass + fail)));
  process.exit(fail === 0 ? 0 : 1);
})();
