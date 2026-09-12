'use strict';
const API = window.api;
const orb = document.getElementById('orb');
const body = document.body;

let down = null, dragging = false;

API.on('ball:state', p => {
  body.classList.toggle('hidden', p.state === 'hidden');
});
// 主进程按精确命中结果驱动：不依赖渲染进程能否收到 mouseenter
API.on('ball:hover', p => body.classList.toggle('hover', !!p.on));
API.on('ball:edge', p => {
  body.dataset.edge = p.edge;
});
API.on('ball:config', p => {
  if (p.size) document.documentElement.style.setProperty('--size', p.size + 'px');
  if (typeof p.opacity === 'number') document.documentElement.style.setProperty('--op', String(p.opacity));
});

(function initSize() {
  API.config.get().then(({ config }) => {
    document.documentElement.style.setProperty('--size', (config.ui.size || 56) + 'px');
    document.documentElement.style.setProperty('--op', String(config.ui.opacity == null ? .96 : config.ui.opacity));
  }).catch(() => {});
})();

orb.addEventListener('mouseenter', () => body.classList.add('hover'));
orb.addEventListener('mouseleave', () => { if (!dragging) body.classList.remove('hover'); });

orb.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  e.preventDefault();
  down = { sx: e.screenX, sy: e.screenY, wx: window.screenX, wy: window.screenY };
  dragging = false;
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp, { once: true });
});

function onMove(e) {
  if (!down) return;
  const dist = Math.abs(e.screenX - down.sx) + Math.abs(e.screenY - down.sy);
  if (!dragging && dist > 4) {
    dragging = true;
    body.classList.add('dragging');
    API.ball.dragStart();
  }
  if (!dragging) return;
  const grabX = down.sx - down.wx;
  const grabY = down.sy - down.wy;
  API.ball.dragMove({ x: e.screenX - grabX, y: e.screenY - grabY });
}

function onUp(e) {
  window.removeEventListener('mousemove', onMove);
  const wasDragging = dragging;
  dragging = false;
  down = null;
  body.classList.remove('dragging');
  if (wasDragging) { API.ball.dragEnd(); return; }
  if (e.shiftKey) API.ball.region();
  else API.ball.click();
}

orb.addEventListener('contextmenu', e => {
  e.preventDefault();
  body.classList.remove('hover');
  API.ball.context();
});