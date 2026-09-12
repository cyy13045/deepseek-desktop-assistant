'use strict';
// 极简 i18n：主进程 require()、渲染进程 <script src> 共用同一份实现与字典。
// UMD 包装让它同时满足两种加载方式（不引入任何依赖、不用打包器）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./locales/zh-CN.js'), require('./locales/en-US.js'));
  else root.DSA_I18N = factory(root.DSA_LOCALES['zh-CN'], root.DSA_LOCALES['en-US']);
})(typeof self !== 'undefined' ? self : globalThis, function (zh, en) {
  var DEFAULT = 'zh-CN';
  var DICTS = { 'zh-CN': zh || {}, 'en-US': en || {} };
  var available = ['zh-CN', 'en-US'];
  var lang = DEFAULT;

  function setLang(next) {
    lang = available.indexOf(next) >= 0 ? next : DEFAULT;
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

  /** 找不到 key 时先回退 zh-CN，再回退 key 本身 */
  function t(key, vars) {
    if (key == null) return '';
    var k = String(key);
    var s = lookup(DICTS[lang], k);
    if (s === undefined) s = lookup(DICTS[DEFAULT], k);
    if (s === undefined) return format(k, vars);
    return format(s, vars);
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

  return { t: t, setLang: setLang, getLang: getLang, available: available, applyDom: applyDom };
});
