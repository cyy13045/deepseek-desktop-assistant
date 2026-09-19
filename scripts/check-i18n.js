'use strict';
// 纯 Node 跑（不依赖 Electron）：npm run check-i18n
// 覆盖：字典注册 / key 与占位符一致性 / 自动语言匹配 / 回退链 / 渲染页面的脚本引入
const fs = require('fs');
const path = require('path');

let fail = 0, pass = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  OK   ' + label + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  FAIL ' + label + (extra ? '  ' + extra : '')); }
};

const ROOT = path.join(__dirname, '..');
const LOCALE_DIR = path.join(ROOT, 'src', 'shared', 'locales');
const i18n = require(path.join(ROOT, 'src', 'shared', 'i18n.js'));

const EXPECTED = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'ru-RU', 'es-ES', 'fr-FR', 'de-DE'];
const LANG_NAME_KEYS = ['settings.lang.auto', 'settings.lang.zh', 'settings.lang.zhTW', 'settings.lang.en',
  'settings.lang.ja', 'settings.lang.ko', 'settings.lang.ru', 'settings.lang.es', 'settings.lang.fr', 'settings.lang.de'];

// ---------- P1 字典注册与文件 ----------
console.log('P1  字典注册与文件');
ok('i18n.available 与预期一致', JSON.stringify(i18n.available) === JSON.stringify(EXPECTED), i18n.available.join(', '));
const dicts = {};
for (const tag of EXPECTED) {
  const file = path.join(LOCALE_DIR, tag + '.js');
  ok(tag + '.js 存在且可 require', fs.existsSync(file) && !!require(file));
  dicts[tag] = require(file);
}

// ---------- P2 key / 占位符一致性 ----------
console.log('P2  key / 占位符一致性（基准 zh-CN）');
const base = dicts['zh-CN'];
const baseKeys = Object.keys(base);
const ph = s => (String(s).match(/\{(\w+)\}/g) || []).sort().join(',');
console.log('  基准 zh-CN 共 ' + baseKeys.length + ' 个 key');
for (const tag of EXPECTED) {
  const text = fs.readFileSync(path.join(LOCALE_DIR, tag + '.js'), 'utf8');
  const seen = new Set(), dup = [];
  for (const m of text.matchAll(/^\s*'([^']+)':/gm)) {
    if (seen.has(m[1])) dup.push(m[1]); else seen.add(m[1]);
  }
  ok(tag + ' 无重复 key', dup.length === 0, dup.slice(0, 4).join(', '));
}
for (const tag of EXPECTED.filter(t => t !== 'zh-CN')) {
  const d = dicts[tag];
  const missing = baseKeys.filter(k => !(k in d));
  const extra = Object.keys(d).filter(k => !(k in base));
  ok(tag + ' key 齐全', missing.length === 0 && extra.length === 0,
    missing.length ? ('缺 ' + missing.length + ' 个: ' + missing.slice(0, 4).join(', '))
      : (extra.length ? ('多 ' + extra.length + ' 个: ' + extra.slice(0, 4).join(', ')) : ''));
  const badPh = baseKeys.filter(k => (k in d) && ph(base[k]) !== ph(d[k]));
  ok(tag + ' 占位符与基准一致', badPh.length === 0, badPh.slice(0, 4).join(', '));
  const empty = baseKeys.filter(k => (k in d) && (typeof d[k] !== 'string' || d[k].length === 0));
  ok(tag + ' 无空字符串', empty.length === 0, empty.slice(0, 4).join(', '));
}

// ---------- P3 自动语言匹配 ----------
console.log('P3  resolve(pref, systemLocale)');
const cases = [
  ['auto', 'zh-TW', 'zh-TW'],
  ['auto', 'ZH_tw', 'zh-TW'],
  ['auto', 'zh-HK', 'zh-TW'],
  ['auto', 'zh-Hant', 'zh-TW'],
  ['auto', 'zh-Hans-CN', 'zh-CN'],
  ['auto', 'zh', 'zh-CN'],
  ['auto', 'ja', 'ja-JP'],
  ['auto', 'ja-JP', 'ja-JP'],
  ['auto', 'ko-KR', 'ko-KR'],
  ['auto', 'ru', 'ru-RU'],
  ['auto', 'es-MX', 'es-ES'],
  ['auto', 'fr-CA', 'fr-FR'],
  ['auto', 'de', 'de-DE'],
  ['auto', 'en-GB', 'en-US'],
  ['auto', 'pt-BR', 'en-US'],
  ['auto', '', 'en-US'],
  ['de-DE', 'zh-CN', 'de-DE'],
  ['xx-XX', 'fr-FR', 'fr-FR'],
];
for (const [pref, sys, want] of cases) {
  const got = i18n.resolve(pref, sys);
  ok(`resolve(${pref}, ${sys || "''"}) -> ${want}`, got === want, got === want ? '' : 'got ' + got);
}

// ---------- P4 setLang / t 回退链 ----------
console.log('P4  setLang / t 回退链');
ok('非法语言回落 zh-CN', i18n.setLang('nope') === 'zh-CN');
ok('未命中 key 原样返回', i18n.t('no.such.key') === 'no.such.key');
for (const tag of EXPECTED) {
  i18n.setLang(tag);
  ok(tag + ' 取到自身字典', i18n.t('panel.send') === dicts[tag]['panel.send'], i18n.t('panel.send'));
}
i18n.setLang('ja-JP');
ok('占位符替换生效', i18n.t('panel.history.count', { count: 3 }) === '3 件', i18n.t('panel.history.count', { count: 3 }));
const savedJa = dicts['ja-JP']['panel.send'];
delete dicts['ja-JP']['panel.send'];
ok('ja 缺 key 回退 en-US', i18n.t('panel.send') === dicts['en-US']['panel.send'], i18n.t('panel.send'));
dicts['ja-JP']['panel.send'] = savedJa;
const savedTw = dicts['zh-TW']['panel.send'];
delete dicts['zh-TW']['panel.send'];
i18n.setLang('zh-TW');
ok('zh-TW 缺 key 回退 zh-CN', i18n.t('panel.send') === dicts['zh-CN']['panel.send'], i18n.t('panel.send'));
dicts['zh-TW']['panel.send'] = savedTw;

// ---------- P5 渲染页面引入与下拉 ----------
console.log('P5  渲染页面引入与语言下拉');
for (const page of ['panel.html', 'capture.html', 'settings.html']) {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', page), 'utf8');
  const missing = EXPECTED.filter(tag => html.indexOf('locales/' + tag + '.js') < 0);
  ok(page + ' 引入全部 ' + EXPECTED.length + ' 份字典', missing.length === 0, missing.join(', '));
  ok(page + ' 引入 i18n.js', html.indexOf('shared/i18n.js') >= 0);
}
const settingsHtml = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'settings.html'), 'utf8');
const langSelect = (settingsHtml.match(/<select id="uiLanguage">([\s\S]*?)<\/select>/) || [])[1] || '';
const options = [...langSelect.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
ok('语言下拉 = auto + ' + EXPECTED.length + ' 种语言', options.length === EXPECTED.length + 1 && options[0] === 'auto' && EXPECTED.every(t => options.includes(t)), options.join(', '));
for (const tag of EXPECTED) {
  const missing = LANG_NAME_KEYS.filter(k => !(k in dicts[tag]));
  ok(tag + ' 语言名称齐全', missing.length === 0, missing.join(', '));
}

// ---------- P6 浏览器（UMD 全局）加载路径 ----------
console.log('P6  浏览器 UMD 全局路径（渲染进程实际走法）');
const vm = require('vm');
const ctx = {};
vm.createContext(ctx);
ctx.self = ctx;
for (const tag of EXPECTED) {
  vm.runInContext(fs.readFileSync(path.join(LOCALE_DIR, tag + '.js'), 'utf8'), ctx, { filename: tag + '.js' });
}
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'shared', 'i18n.js'), 'utf8'), ctx, { filename: 'i18n.js' });
const browser = ctx.DSA_I18N;
ok('window.DSA_I18N 已挂载', !!browser);
ok('浏览器路径识别 9 种语言', !!browser && JSON.stringify(browser.available) === JSON.stringify(EXPECTED), browser && browser.available.join(', '));
if (browser) {
  browser.setLang('ja-JP');
  ok('浏览器路径 t() 生效', browser.t('panel.send') === dicts['ja-JP']['panel.send'], browser.t('panel.send'));
  ok('浏览器路径 resolve() 生效', browser.resolve('auto', 'de') === 'de-DE', browser.resolve('auto', 'de'));
}

console.log('\n' + (fail ? `失败 ${fail} 项 / 共 ${pass + fail} 项` : `全部通过：${pass} 项`));
process.exit(fail ? 1 : 0);
