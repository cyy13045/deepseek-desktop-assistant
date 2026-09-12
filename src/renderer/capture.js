'use strict';
const API = window.api;
// 语言由主进程通过 ?lang= 传入（auto 已在主进程解析成实际语言）
(function initI18n() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q) window.DSA_I18N.setLang(q);
  window.DSA_I18N.applyDom();
})();
const dim = document.getElementById('dim');
const sel = document.getElementById('sel');
const sizeLbl = document.getElementById('size');
const hint = document.getElementById('hint');

let start = null, rect = null, dragging = false, finished = false;

function update(cx, cy) {
  const x = Math.min(start.x, cx), y = Math.min(start.y, cy);
  const w = Math.abs(cx - start.x), h = Math.abs(cy - start.y);
  rect = { x, y, width: w, height: h };
  sel.style.left = x + 'px'; sel.style.top = y + 'px';
  sel.style.width = w + 'px'; sel.style.height = h + 'px';
  const show = w > 4 && h > 4;
  sizeLbl.style.display = show ? 'block' : 'none';
  if (show) {
    sizeLbl.textContent = Math.round(w) + ' × ' + Math.round(h);
    sizeLbl.style.left = Math.max(4, x) + 'px';
    sizeLbl.style.top = Math.max(4, y - 26) + 'px';
  }
}

function done(r) {
  if (finished) return;
  finished = true;
  API.captureOverlay.done(r);
}
function cancel() {
  if (finished) return;
  finished = true;
  API.captureOverlay.cancel();
}

document.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  e.preventDefault();
  dragging = true;
  start = { x: e.clientX, y: e.clientY };
  dim.style.display = 'none';
  sel.style.display = 'block';
  hint.style.display = 'none';
  update(e.clientX, e.clientY);
});

document.addEventListener('mousemove', e => { if (dragging) update(e.clientX, e.clientY); });

document.addEventListener('mouseup', e => {
  if (!dragging) return;
  dragging = false;
  if (!rect || rect.width < 4 || rect.height < 4) {
    done({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
    return;
  }
  done(rect);
});

document.addEventListener('contextmenu', e => { e.preventDefault(); cancel(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') cancel(); });