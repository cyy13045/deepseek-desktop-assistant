'use strict';
const API = window.api;
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