'use strict';
// 极简 i18n：主进程 require()、渲染进程 <script src> 共用同一份实现与字典。
// UMD 包装让它同时满足两种加载方式（不引入任何依赖、不用打包器）。
// 新增语言：在 locales/ 里加一份字典 -> 在下面的注册表里 require -> 在 3 个渲染页面的
// <script src> 列表里引入 -> settings.html 的 uiLanguage 下拉加一个 option。
// scripts/check-i18n.js 会校验 key 完整性、占位符一致性和自动语言匹配。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory({
      'zh-CN': require('./locales/zh-CN.js'),
      'zh-TW': require('./locales/zh-TW.js'),
      'en-US': require('./locales/en-US.js'),
      'ja-JP': require('./locales/ja-JP.js'),
      'ko-KR': require('./locales/ko-KR.js'),
      'ru-RU': require('./locales/ru-RU.js'),
      'es-ES': require('./locales/es-ES.js'),
      'fr-FR': require('./locales/fr-FR.js'),
      'de-DE': require('./locales/de-DE.js'),
    });
  } else {
    root.DSA_I18N = factory(root.DSA_LOCALES || {});
  }
})(typeof self !== 'undefined' ? self : globalThis, function (dicts) {
  var DEFAULT = 'zh-CN';
  var DICTS = dicts || {};
  var available = Object.keys(DICTS);
  var lang = DEFAULT;

  /** 'zh-tw' / 'zh_HK' / 'ja' 这类 BCP-47 标签 -> 已注册的语言代码；不认识返回 '' */
  function normalize(tag) {
    var s = String(tag || '').trim();
    if (!s) return '';
    if (Object.prototype.hasOwnProperty.call(DICTS, s)) return s;
    var lower = s.toLowerCase();
    for (var i = 0; i < available.length; i++) {
      if (available[i].toLowerCase() === lower) return available[i];
    }
    var base = lower.split(/[-_]/)[0];
    if (base === 'zh') {
      // 繁体：zh-TW / zh-HK / zh-MO / zh-Hant*（也覆盖 zh-Hant-CN 这类组合）
      if (/(^|[-_])(tw|hk|mo|hant)([-_]|$)/.test(lower)) {
        return Object.prototype.hasOwnProperty.call(DICTS, 'zh-TW') ? 'zh-TW' : DEFAULT;
      }
      return Object.prototype.hasOwnProperty.call(DICTS, 'zh-CN') ? 'zh-CN' : DEFAULT;
    }
    for (var j = 0; j < available.length; j++) {
      if (available[j].toLowerCase().split('-')[0] === base) return available[j];
    }
    return '';
  }

  /** pref 可为 'auto' 或语言代码；systemTag 传系统语言（如 Electron app.getLocale()）。 */
  function resolve(pref, systemTag) {
    if (pref && pref !== 'auto') {
      var hit = normalize(pref);
      if (hit) return hit;
    }
    var sys = normalize(systemTag);
    if (sys) return sys;
    return Object.prototype.hasOwnProperty.call(DICTS, 'en-US') ? 'en-US' : DEFAULT;
  }

  function setLang(next) {
    lang = normalize(next) || DEFAULT;
    if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = lang;
    return lang;
  }
  function getLang() { return lang; }

  function lookup(dict, key) {
    if (dict && Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
    return undefined;
  }

  /** vars 支持 {name} 占位符；未提供的占位符原样保留 */
  function format(text, vars) {
    if (!vars) return text;
    return String(text).replace(/\{(\w+)\}/g, function (m, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m;
    });
  }

  /** 回退链：中文系 -> zh-CN -> en-US；其它语言 -> en-US -> zh-CN；最后回退 key 本身 */
  function fallbackChain() {
    var list = [lang];
    var zhFamily = lang === 'zh-CN' || lang.indexOf('zh-') === 0;
    if (zhFamily) {
      if (lang !== 'zh-CN') list.push('zh-CN');
      if (lang !== 'en-US' && list.indexOf('en-US') < 0) list.push('en-US');
    } else {
      if (lang !== 'en-US' && list.indexOf('en-US') < 0) list.push('en-US');
      if (lang !== 'zh-CN' && list.indexOf('zh-CN') < 0) list.push('zh-CN');
    }
    return list;
  }

  /** 找不到 key 时按回退链取，最后回退 key 本身 */
  function t(key, vars) {
    if (key == null) return '';
    var k = String(key);
    var order = fallbackChain();
    for (var i = 0; i < order.length; i++) {
      var s = lookup(DICTS[order[i]], k);
      if (s !== undefined) return format(s, vars);
    }
    return format(k, vars);
  }

  function one(root, selector, apply) {
    var nodes = root.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute(selector.slice(1, -1));
      if (key) apply(nodes[i], t(key));
    }
  }

  /**
   * 把当前语言应用到 DOM：
   *   [data-i18n]              -> textContent
   *   [data-i18n-html]         -> innerHTML
   *   [data-i18n-title]        -> title 属性
   *   [data-i18n-placeholder]  -> placeholder 属性
   */
  function applyDom(rootEl) {
    var root = rootEl || (typeof document !== 'undefined' ? document : null);
    if (!root || typeof root.querySelectorAll !== 'function') return 0;
    one(root, '[data-i18n]', function (el, v) { el.textContent = v; });
    one(root, '[data-i18n-html]', function (el, v) { el.innerHTML = v; });
    one(root, '[data-i18n-title]', function (el, v) { el.setAttribute('title', v); });
    one(root, '[data-i18n-placeholder]', function (el, v) { el.setAttribute('placeholder', v); });
    if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = lang;
    return root.querySelectorAll('[data-i18n],[data-i18n-html],[data-i18n-title],[data-i18n-placeholder]').length;
  }

  return { t: t, setLang: setLang, getLang: getLang, available: available, normalize: normalize, resolve: resolve, applyDom: applyDom };
});
