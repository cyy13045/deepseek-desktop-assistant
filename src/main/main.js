'use strict';
const { app, BrowserWindow, ipcMain, screen, desktopCapturer, nativeImage, Tray, Menu, shell, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

app.setName('deepseek-desktop-assistant');
if (process.platform === 'win32') app.setAppUserModelId('com.deepseek.desktop-assistant');

// 悬浮球是一个又小、又贴边、大部分在屏幕外的透明置顶窗口。
// Chromium 在 Windows 上的「原生窗口遮挡检测」会把它判定为被遮挡，于是 isPainting 变成 false ——
// 页面明明渲染好了却不再绘制到屏幕上（capturePage 仍能拿到内容，所以截图自检看不出来）。
// 必须关掉遮挡检测与后台化，否则悬浮球在屏幕上是不可见的。
// 这台机器上出现过「Electron 窗口内容从不呈现到屏幕」的问题：
// 窗口存在、isVisible/isAlwaysOnTop 都为真、capturePage 能拿到完整内容，
// 但屏幕上什么都没有；而普通 WinForms 窗口却正常显示。
// 悬浮球只是 2D 小窗口，关掉硬件加速改用软件渲染即可稳定显示。
// 需要强制使用 GPU 时设环境变量 DSA_FORCE_GPU=1。
if (process.env.DSA_FORCE_GPU !== '1') {
  app.disableHardwareAcceleration();
}

{
  const existing = app.commandLine.getSwitchValue('disable-features');
  const list = ['CalculateNativeWinOcclusion'];
  app.commandLine.appendSwitch('disable-features', existing ? existing + ',' + list.join(',') : list.join(','));
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
}

const { Store } = require('./store');
const { History } = require('./history');
const providers = require('./providers');
// 分块与 Markdown 清洗与具体厂商无关，仍由 mimo.js 提供
const { splitForSpeech } = require('./mimo');

const SELFTEST = process.argv.includes('--selftest');
const UI_CHECK = process.argv.includes('--ui-check');
const DIAG = process.argv.includes('--diag');
const DEV_MODE = SELFTEST || UI_CHECK || DIAG;
const ROOT = path.join(__dirname, '..', '..');
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let store = null, history = null;
let ballWin = null, panelWin = null, settingsWin = null, captureWin = null, tray = null;
let hovering = false, dragging = false, suppressHover = false, lastInteractive = false;
let lastTopAssert = 0;
let hoverTimer = null, hideTimer = null, animTimer = null;
let ballState = 'shown';
let activeChat = null;
let ttsToken = 0;
let ttsPaused = false;      // 语音暂停：既暂停播放，也暂停后台的合成推进
let ttsResume = null;
let panelLoaded = false;
let pendingShot = null;

const GAP = 12;
const SLIVER = 8;

// ---------------------------------------------------------------- 工具
function send(win, channel, payload) {
  if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, payload);
  }
}
function sendPanel(channel, payload) { send(panelWin, channel, payload); }

function ballMetrics() {
  const size = Math.max(36, Math.min(96, (store.get().ui.size | 0) || 56));
  const win = size + 16;
  return { size, win, pad: (win - size) / 2 };
}
function displayForBall() {
  if (ballWin && !ballWin.isDestroyed()) {
    const b = ballWin.getBounds();
    return screen.getDisplayNearestPoint({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) });
  }
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}
function inflate(r, n) { return { x: r.x - n, y: r.y - n, width: r.width + 2 * n, height: r.height + 2 * n }; }
function inside(pt, r) { return pt.x >= r.x && pt.x <= r.x + r.width && pt.y >= r.y && pt.y <= r.y + r.height; }
function intersect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width), y2 = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, x2 - x), height: Math.max(0, y2 - y) };
}

function ballPosition(state) {
  const cfg = store.get();
  const { size, win, pad } = ballMetrics();
  const wa = displayForBall().workArea;
  let x;
  if (cfg.ui.edge === 'left') {
    x = state === 'shown' ? wa.x + GAP - pad : wa.x + SLIVER - pad - size;
  } else {
    x = state === 'shown' ? wa.x + wa.width - GAP - pad - size : wa.x + wa.width - SLIVER - pad;
  }
  let cy = cfg.ui.offsetY;
  if (typeof cy !== 'number' || !isFinite(cy)) cy = wa.y + wa.height / 2;
  const y = Math.max(wa.y, Math.min(Math.round(cy - win / 2), wa.y + wa.height - win));
  return { x: Math.round(x), y };
}

function animateBall(tx, ty, dur) {
  if (!ballWin || ballWin.isDestroyed()) return;
  if (animTimer) { clearInterval(animTimer); animTimer = null; }
  const from = ballWin.getBounds();
  const t0 = Date.now();
  animTimer = setInterval(() => {
    if (!ballWin || ballWin.isDestroyed()) { clearInterval(animTimer); animTimer = null; return; }
    const p = Math.min(1, (Date.now() - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    try { ballWin.setPosition(Math.round(from.x + (tx - from.x) * e), Math.round(from.y + (ty - from.y) * e)); } catch (err) {}
    if (p >= 1) { clearInterval(animTimer); animTimer = null; }
  }, 16);
}

function setBallState(state, animate) {
  ballState = state;
  const pos = ballPosition(state);
  send(ballWin, 'ball:state', { state });
  if (animate) animateBall(pos.x, pos.y, state === 'shown' ? 180 : 200);
  else if (ballWin && !ballWin.isDestroyed()) { try { ballWin.setPosition(pos.x, pos.y); } catch (e) {} }
}

function showBall(animate) {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (ballState === 'shown') return;
  setBallState('shown', animate !== false);
  try { ballWin.moveTop(); } catch (e) {}
}
function scheduleHide() {
  if (ballState !== 'shown' || dragging || suppressHover) return;
  if (hideTimer) return;
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (!dragging && !hovering && !suppressHover) setBallState('hidden', true);
  }, (store.get().ui.hideDelayMs | 0) || 380);
}

// ---------------------------------------------------------------- 悬浮球
function createBall() {
  const { win } = ballMetrics();
  const pos = ballPosition('hidden');
  ballWin = new BrowserWindow({
    width: win, height: win, x: pos.x, y: pos.y,
    frame: false, transparent: true, resizable: true, movable: false, focusable: true,
    skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: true,
    fullscreenable: false, maximizable: false, minimizable: false,
    title: 'DeepSeek 桌面助手',
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  // resizable:true 才能用 setSize 改尺寸；再用 min/max 锁死，避免用户拖到不可见的边框
  try { ballWin.setMinimumSize(win, win); ballWin.setMaximumSize(win, win); } catch (e) {}
  ballWin.setAlwaysOnTop(true, 'floating');
  ballWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  ballWin.loadFile(path.join(ROOT, 'src', 'renderer', 'ball.html'));
  ballWin.once('ready-to-show', () => {
    const p = ballPosition(ballState);
    ballWin.setPosition(p.x, p.y);
    ballWin.showInactive();
  });
  ballWin.on('closed', () => { ballWin = null; });
  startHoverLoop();
}

function startHoverLoop() {
  if (hoverTimer) clearInterval(hoverTimer);
  hoverTimer = setInterval(() => {
    if (!ballWin || ballWin.isDestroyed() || dragging || suppressHover) return;
    if (!ballWin.isVisible()) return;

    // 悬浮球是用 showInactive() 显示的，从不激活，所以在「置顶窗口」这一层里它会排在
    // 后来激活过的其它置顶程序下面（输入法面板 TabTip、加速器/安全软件的悬浮窗等会整个盖住它）。
    // 定期把它重新抬到置顶层最上面 —— moveTop 不抢焦点，也不会打断用户正在做的事。
    if (Date.now() - lastTopAssert > 1000) {
      lastTopAssert = Date.now();
      try { ballWin.moveTop(); } catch (e) {}
    }

    const pt = screen.getCursorScreenPoint();
    const b = ballWin.getBounds();
    const { size, pad } = ballMetrics();
    const ballRect = { x: b.x + pad, y: b.y + pad, width: size, height: size };

    if (ballState === 'shown') {
      hovering = inside(pt, inflate(ballRect, 14));
      const interactive = inside(pt, inflate(ballRect, 6));
      try { ballWin.setIgnoreMouseEvents(!interactive, { forward: true }); } catch (e) {}
      // 关键：球是透明置顶窗口，开启鼠标交互前光标可能已停在球上，
      // 此时 Chromium 不会补发 mouseenter，CSS :hover 永远不生效。
      // 所以悬停高亮改由主进程的精确命中结果驱动。
      if (interactive !== lastInteractive) {
        lastInteractive = interactive;
        send(ballWin, 'ball:hover', { on: interactive });
      }
      if (hovering) { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } }
      else scheduleHide();
    } else {
      hovering = false;
      if (lastInteractive) { lastInteractive = false; send(ballWin, 'ball:hover', { on: false }); }
      try { ballWin.setIgnoreMouseEvents(true, { forward: true }); } catch (e) {}
      const wa = displayForBall().workArea;
      const sliver = intersect(ballRect, { x: wa.x, y: wa.y, width: wa.width, height: wa.height });
      if (sliver.width > 0 && sliver.height > 0 && inside(pt, inflate(sliver, 6))) showBall(true);
    }
  }, 45);
}

function markDragging(on) {
  dragging = on;
  if (on) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (animTimer) { clearInterval(animTimer); animTimer = null; }
    showBall(false);
    try { ballWin.setIgnoreMouseEvents(false); } catch (e) {}
    if (!lastInteractive) { lastInteractive = true; send(ballWin, 'ball:hover', { on: true }); }
    return;
  }
  const wa = displayForBall().workArea;
  const b = ballWin.getBounds();
  const cx = b.x + b.width / 2;
  const edge = cx < wa.x + wa.width / 2 ? 'left' : 'right';
  const cy = Math.max(wa.y + 20, Math.min(Math.round(b.y + b.height / 2), wa.y + wa.height - 20));
  store.update({ ui: { edge, offsetY: cy } });
  send(ballWin, 'ball:edge', { edge });
  setBallState('shown', false);
  const pos = ballPosition('shown');
  animateBall(pos.x, pos.y, 220);
}

// ---------------------------------------------------------------- 截图
async function captureDisplay(display) {
  const sf = display.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(display.size.width * sf), height: Math.round(display.size.height * sf) },
  });
  let src = sources.find(s => String(s.display_id) === String(display.id));
  if (!src) src = sources.find(s => s.id.startsWith('screen:')) || sources[0];
  if (!src) throw new Error('未找到可用的屏幕捕获源');
  return { image: src.thumbnail, display };
}

async function captureFullScreen(display) {
  const disp = display || screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { image } = await captureDisplay(disp);
  const sz = image.getSize();
  return history.saveShot(image.toPNG(), { width: sz.width, height: sz.height });
}

/** 截图期间临时隐藏自身窗口，避免把悬浮球/面板拍进去 */
async function withUiHidden(fn) {
  suppressHover = true;
  const ballVisible = !!(ballWin && !ballWin.isDestroyed() && ballWin.isVisible());
  const panelVisible = !!(panelWin && !panelWin.isDestroyed() && panelWin.isVisible());
  if (ballVisible) ballWin.hide();
  if (panelVisible) panelWin.hide();
  await sleep(130);
  try {
    return await fn();
  } finally {
    suppressHover = false;
    if (ballVisible && ballWin && !ballWin.isDestroyed()) {
      const p = ballPosition(ballState);
      ballWin.setPosition(p.x, p.y);
      ballWin.showInactive();
    }
    if (panelVisible && panelWin && !panelWin.isDestroyed()) panelWin.show();
  }
}

function openRegionSelector() {
  return new Promise(resolve => {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const b = display.bounds;
    const win = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height,
      frame: false, transparent: true, resizable: false, movable: false, hasShadow: false,
      skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, enableLargerThanScreen: true,
      webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
    });
    captureWin = win;
    win.setAlwaysOnTop(true, 'screen-saver');
    win.loadFile(path.join(ROOT, 'src', 'renderer', 'capture.html'));
    win.once('ready-to-show', () => { win.show(); win.focus(); });

    const cleanup = () => {
      ipcMain.removeListener('capture:rect', onRect);
      ipcMain.removeListener('capture:cancel', onCancel);
      if (captureWin === win) captureWin = null;
    };
    const onCancel = () => {
      cleanup();
      if (!win.isDestroyed()) win.close();
      resolve(null);
    };
    const onRect = (_e, rect) => {
      cleanup();
      const ok = rect && rect.width > 2 && rect.height > 2;
      if (!win.isDestroyed()) win.close();
      if (!ok) { resolve(null); return; }
      setTimeout(async () => {
        try {
          const { image } = await captureDisplay(display);
          const size = image.getSize();
          const scale = size.width / display.size.width;
          const crop = {
            x: Math.max(0, Math.round(rect.x * scale)),
            y: Math.max(0, Math.round(rect.y * scale)),
            width: Math.round(rect.width * scale),
            height: Math.round(rect.height * scale),
          };
          crop.width = Math.max(1, Math.min(crop.width, size.width - crop.x));
          crop.height = Math.max(1, Math.min(crop.height, size.height - crop.y));
          resolve(history.saveShot(image.crop(crop).toPNG(), { width: crop.width, height: crop.height }));
        } catch (err) {
          resolve({ error: String(err.message || err) });
        }
      }, 150);
    };
    ipcMain.on('capture:rect', onRect);
    ipcMain.on('capture:cancel', onCancel);
    win.on('closed', () => { if (captureWin === win) captureWin = null; });
  });
}

function deliverShot(shot) {
  const w = ensurePanel();
  if (panelLoaded && w && !w.isDestroyed()) send(w, 'capture:new', shot);
  else pendingShot = shot;
}

async function startCaptureFlow({ region }) {
  ensurePanel();
  try {
    if (region) {
      const shot = await withUiHidden(() => openRegionSelector());
      ensurePanel();
      if (!shot) { focusPanel(); return; }
      if (shot.error) throw new Error(shot.error);
      deliverShot(shot);
      focusPanel();
    } else {
      const shot = await withUiHidden(() => captureFullScreen());
      deliverShot(shot);
      focusPanel();
    }
  } catch (err) {
    ensurePanel();
    focusPanel();
    sendPanel('app:toast', { kind: 'error', text: '截图失败: ' + (err.message || err) });
  }
}

// ---------------------------------------------------------------- 面板
function ensurePanel() {
  if (panelWin && !panelWin.isDestroyed()) return panelWin;
  const wa = displayForBall().workArea;
  const W = 460, H = 680;
  const bb = ballWin && !ballWin.isDestroyed() ? ballWin.getBounds() : null;
  const cfg = store.get();
  let x, y;
  if (bb) {
    x = cfg.ui.edge === 'left' ? bb.x + bb.width + 10 : bb.x - W - 10;
    y = Math.round(bb.y + bb.height / 2 - H / 2);
  } else {
    x = wa.x + wa.width - W - 24; y = wa.y + 60;
  }
  x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - W - 8));
  y = Math.max(wa.y + 8, Math.min(y, wa.y + wa.height - H - 8));

  panelLoaded = false;
  panelWin = new BrowserWindow({
    width: W, height: H, x, y, minWidth: 380, minHeight: 460,
    frame: false, transparent: true, resizable: true, skipTaskbar: true, show: false,
    alwaysOnTop: !!cfg.ui.alwaysOnTop, hasShadow: true, title: 'DeepSeek 桌面助手',
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  panelWin.loadFile(path.join(ROOT, 'src', 'renderer', 'panel.html'));
  panelWin.webContents.once('did-finish-load', () => {
    panelLoaded = true;
    if (pendingShot && panelWin && !panelWin.isDestroyed()) {
      const s = pendingShot; pendingShot = null;
      send(panelWin, 'capture:new', s);
    }
  });
  panelWin.once('ready-to-show', () => panelWin.show());
  panelWin.on('closed', () => { panelWin = null; panelLoaded = false; });
  return panelWin;
}
function focusPanel() {
  const w = ensurePanel();
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
}
function togglePanel() {
  const w = ensurePanel();
  if (w.isVisible()) w.hide(); else focusPanel();
}

// ---------------------------------------------------------------- 设置
function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  const wa = displayForBall().workArea;
  const W = 620, H = 730;
  settingsWin = new BrowserWindow({
    width: W, height: H,
    x: Math.round(wa.x + (wa.width - W) / 2), y: Math.round(wa.y + Math.max(0, (wa.height - H) / 2)),
    frame: false, transparent: true, resizable: false, skipTaskbar: false, show: false,
    alwaysOnTop: true, title: '设置 - DeepSeek 桌面助手',
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  settingsWin.loadFile(path.join(ROOT, 'src', 'renderer', 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ---------------------------------------------------------------- 托盘
function createTray() {
  let img = nativeImage.createFromPath(path.join(ROOT, 'assets', 'tray.png'));
  if (img.isEmpty()) img = nativeImage.createEmpty();
  try { tray = new Tray(img); } catch (e) { console.error('[tray] 创建失败:', e.message); return; }
  tray.setToolTip('DeepSeek 桌面助手');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开对话面板', click: () => focusPanel() },
    { label: '截图提问（整屏）', click: () => startCaptureFlow({ region: false }) },
    { label: '截图提问（框选区域）', click: () => startCaptureFlow({ region: true }) },
    { type: 'separator' },
    { label: '显示/隐藏悬浮球', click: () => {
        if (!ballWin || ballWin.isDestroyed()) return;
        if (ballWin.isVisible()) ballWin.hide();
        else { setBallState('shown', false); const p = ballPosition('shown'); ballWin.setPosition(p.x, p.y); ballWin.showInactive(); }
      } },
    { label: '设置…', click: () => openSettings() },
    { type: 'separator' },
    { label: '打开配置文件夹', click: () => shell.openPath(app.getPath('userData')) },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', () => togglePanel());
}

// ---------------------------------------------------------------- IPC
function registerIpc() {
  ipcMain.handle('config:get', () => ({
    config: store.publicView(),
    chatProtocols: providers.CHAT_PROTOCOL_LIST,
    ttsProtocols: providers.TTS_PROTOCOL_LIST,
    authChoices: providers.AUTH_LIST,
    chatPresets: providers.CHAT_PRESETS,
    ttsPresets: providers.TTS_PRESETS,
    voicePresets: providers.VOICE_DESIGN_PRESETS,
    appVersion: app.getVersion(),
    configPath: store.file,
  }));

  ipcMain.handle('config:save', (_e, patch) => {
    const clean = JSON.parse(JSON.stringify(patch || {}));
    if (clean.providers) {
      const cur = store.get();
      for (const kind of ['chat', 'tts']) {
        const incoming = clean.providers[kind];
        if (!Array.isArray(incoming)) continue;
        const oldById = new Map((cur.providers[kind] || []).map(p => [p.id, p]));
        clean.providers[kind] = incoming.map(p => {
          const q = Object.assign({}, p);
          const old = oldById.get(q.id);
          if (q.apiKey === '' || q.apiKey == null) q.apiKey = old ? old.apiKey : '';   // 空 = 不改动
          else if (q.apiKey === '__CLEAR__') q.apiKey = '';                            // 显式清空
          return q;
        });
      }
    }
    const cfg = store.update(clean);
    if (ballWin && !ballWin.isDestroyed()) {
      const { win } = ballMetrics();
      try { ballWin.setMinimumSize(win, win); ballWin.setMaximumSize(win, win); ballWin.setSize(win, win); } catch (e) {}
      send(ballWin, 'ball:config', { size: cfg.ui.size, opacity: cfg.ui.opacity });
      const pos = ballPosition(ballState);
      animateBall(pos.x, pos.y, 220);
    }
    if (panelWin && !panelWin.isDestroyed()) panelWin.setAlwaysOnTop(!!cfg.ui.alwaysOnTop);
    try { app.setLoginItemSettings({ openAtLogin: !!cfg.ui.autoLaunch, path: process.execPath }); } catch (e) {}
    sendPanel('config:changed', { config: store.publicView() });
    return { ok: true, config: store.publicView() };
  });

  // ---- 聊天服务 ----
  const resolveChat = (cfg, id) => providers.byId(cfg, 'chat', id) || providers.activeChat(cfg);
  const resolveTts = (cfg, id) => providers.byId(cfg, 'tts', id) || providers.activeTts(cfg);

  // 设置界面可以直接把「还没保存的表单」传过来测试；此时空的 apiKey 用已存的那把补齐
  function pickChat(cfg, payload) {
    const raw = payload && payload.provider;
    if (raw && typeof raw === 'object') {
      const stored = providers.byId(cfg, 'chat', raw.id);
      return Object.assign({}, raw, { apiKey: raw.apiKey || (stored ? stored.apiKey : '') });
    }
    return resolveChat(cfg, payload && payload.id);
  }
  function pickTts(cfg, payload) {
    const raw = payload && payload.provider;
    if (raw && typeof raw === 'object') {
      const stored = providers.byId(cfg, 'tts', raw.id);
      return Object.assign({}, raw, { apiKey: raw.apiKey || (stored ? stored.apiKey : '') });
    }
    return resolveTts(cfg, payload && payload.id);
  }

  // 让设置界面不用重复维护一份「预设默认值」
  ipcMain.handle('provider:from-preset', (_e, payload) => {
    try {
      const kind = payload && payload.kind === 'tts' ? 'tts' : 'chat';
      const p = kind === 'tts' ? providers.ttsFromPreset(payload && payload.presetId) : providers.chatFromPreset(payload && payload.presetId);
      p.apiKey = ''; p.apiKeySet = false; p.apiKeyMask = '';
      return { ok: true, provider: p };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  ipcMain.handle('provider:models', async (_e, payload) => {
    try {
      const p = pickChat(store.get(), payload);
      if (!p) return { ok: false, error: '找不到对应的聊天服务。' };
      return { ok: true, models: await providers.listModels(p) };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  ipcMain.handle('provider:test', async (_e, payload) => {
    try {
      const p = pickChat(store.get(), payload);
      if (!p) return { ok: false, error: '找不到对应的聊天服务。' };
      if (!p.apiKey && p.authHeader !== 'none') return { ok: false, error: '请先填写「' + p.name + '」的 API Key。' };
      const res = await providers.chatOnce(p, { systemPrompt: '', text: '回复"连接正常"四个字，不要有其他内容。' });
      return { ok: true, message: (res.content || '').slice(0, 120) || '(返回内容为空)', provider: p.name };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // ---- 语音服务 ----
  ipcMain.handle('tts:test', async (_e, payload) => {
    try {
      const p = pickTts(store.get(), payload);
      if (!p) return { ok: false, error: '找不到对应的语音服务。' };
      if (!p.apiKey && p.authHeader !== 'none') return { ok: false, error: '请先填写「' + p.name + '」的 API Key。' };
      let voiceRef = null;
      let label = p.voice || p.name;
      if (voiceNeeded(p)) {
        const ref = await ensureVoiceRef(p, false);
        voiceRef = 'data:' + ref.mime + ';base64,' + ref.base64;
        label = 'AI 设计音色' + (ref.cached ? '' : '（刚生成）');
      }
      const r = await providers.synthesize(p, '语音合成连接正常，这是当前音色的试听效果。', { voiceRef });
      const bytes = Buffer.from(r.base64, 'base64').length;
      return { ok: true, message: '合成成功 · ' + p.name + ' · ' + label + ' · ' + Math.round(bytes / 1024) + ' KB', audio: r.base64, mime: r.mime, voice: label };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  ipcMain.handle('tts:design-voice', async (_e, payload) => {
    try {
      const p = pickTts(store.get(), payload);
      if (!p) return { ok: false, error: '找不到对应的语音服务。' };
      if (!providers.ttsSupportsVoiceDesign(p)) return { ok: false, error: '「' + p.name + '」不支持文字设计音色。' };
      if (!p.apiKey && p.authHeader !== 'none') return { ok: false, error: '请先填写「' + p.name + '」的 API Key。' };
      const ref = await ensureVoiceRef(p, !(payload && payload.reuse));
      return { ok: true, cached: ref.cached, bytes: ref.bytes, file: ref.file, audio: ref.base64, mime: ref.mime };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  ipcMain.handle('tts:voice-ref-info', (_e, payload) => {
    try {
      const p = resolveTts(store.get(), payload && payload.id);
      if (!p) return { ok: false, error: '找不到对应的语音服务。' };
      return Object.assign({ ok: true, supported: providers.ttsSupportsVoiceDesign(p) }, voiceRefInfo(p));
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  });

  // 面板上的「自动播报」开关：直接改当前语音服务的设置，不必让渲染进程回传整个 providers 数组
  ipcMain.handle('tts:set-autospeak', (_e, on) => {
    const cfg = store.get();
    const p = providers.activeTts(cfg);
    if (!p) return { ok: false };
    const list = cfg.providers.tts.map(x => x.id === p.id ? Object.assign({}, x, { autoSpeak: !!on }) : x);
    store.update({ providers: { tts: list } });
    return { ok: true, autoSpeak: !!on };
  });

  ipcMain.handle('history:list', () => history.list());
  ipcMain.handle('history:get', (_e, id) => history.get(id));
  ipcMain.handle('history:create', () => history.create());
  ipcMain.handle('history:remove', (_e, id) => history.remove(id));
  ipcMain.handle('history:clear', () => history.clear());

  ipcMain.handle('capture:full', async () => {
    // 与悬浮球点击走同一条流程，否则面板拿不到附件
    await startCaptureFlow({ region: false });
    return { ok: true };
  });
  ipcMain.handle('capture:region', async () => {
    await startCaptureFlow({ region: true });
    return { ok: true };
  });

  ipcMain.handle('panel:hide', () => { if (panelWin && !panelWin.isDestroyed()) panelWin.hide(); });
  ipcMain.handle('panel:open-settings', () => openSettings());
  ipcMain.handle('app:quit', () => { app.isQuitting = true; app.quit(); });
  ipcMain.handle('shell:open-userdata', () => shell.openPath(app.getPath('userData')));
  ipcMain.handle('shell:open-external', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
    return { ok: true };
  });
  ipcMain.handle('ball:context', () => { openBallMenu(); });

  ipcMain.handle('chat:send', async (_e, payload) => {
    const cfg = store.get();
    const prov = resolveChat(cfg, payload.providerId);
    if (!prov) return { ok: false, error: '还没有可用的聊天服务，请先到设置里添加一个。' };
    if (!prov.apiKey && prov.authHeader !== 'none') return { ok: false, error: '请先在设置中填写「' + prov.name + '」的 API Key。' };
    let convId = payload.conversationId;
    if (!convId || !history.get(convId)) convId = history.create().id;
    if (activeChat) { try { activeChat.controller.abort(); } catch (e) {} }
    const userMsg = history.append(convId, { role: 'user', text: payload.text || '', image: payload.image || null });
    const conv = history.get(convId);
    const controller = new AbortController();
    activeChat = { controller, convId };
    sendPanel('chat:start', {
      conversationId: convId, userMessage: userMsg,
      provider: { id: prov.id, name: prov.name, model: prov.model, supportsVision: !!prov.supportsVision },
    });
    let acc = '', accReason = '';
    try {
      const res = await providers.chatStream(prov, {
        systemPrompt: cfg.systemPrompt,
        history: conv.messages,
        context: cfg,
        signal: controller.signal,
        onDelta: d => { acc += d; sendPanel('chat:delta', { conversationId: convId, delta: d }); },
        onReasoning: d => { accReason += d; sendPanel('chat:reasoning', { conversationId: convId, delta: d }); },
      });
      const text = res.content || acc;
      const aiMsg = history.append(convId, { role: 'assistant', text, reasoning: res.reasoning || accReason || undefined, provider: prov.name });
      const ttsP = providers.activeTts(cfg);
      sendPanel('chat:done', { conversationId: convId, message: aiMsg, autoSpeak: !!(ttsP && ttsP.autoSpeak), providerName: prov.name });
      return { ok: true, conversationId: convId, message: aiMsg };
    } catch (err) {
      if (err && (err.name === 'AbortError' || /abort/i.test(String(err.message)))) {
        if (acc) history.append(convId, { role: 'assistant', text: acc + '\n\n_（已中断）_', interrupted: true });
        sendPanel('chat:aborted', { conversationId: convId });
        return { ok: false, aborted: true, conversationId: convId };
      }
      const msg = String(err.message || err);
      sendPanel('chat:error', { conversationId: convId, error: msg });
      return { ok: false, error: msg, conversationId: convId };
    } finally {
      activeChat = null;
    }
  });
  ipcMain.handle('chat:abort', () => { if (activeChat) { try { activeChat.controller.abort(); } catch (e) {} } return { ok: true }; });

  ipcMain.handle('tts:speak', async (_e, payload) => {
    const cfg = store.get();
    const prov = providers.activeTts(cfg);
    if (!prov) return { ok: false, error: '还没有可用的语音服务，请先到设置里添加一个。' };
    if (!prov.apiKey && prov.authHeader !== 'none') return { ok: false, error: '请先在设置中填写「' + prov.name + '」的 API Key。' };
    const my = ++ttsToken;
    setTtsPaused(false, true);   // 新的一轮朗读从「未暂停」开始

    const chunks = splitForSpeech(payload.text || '', prov.chunkSize || 60);
    if (!chunks.length) return { ok: false, error: '没有可朗读的文本。' };

    // 需要参考音频的协议（MiMo 设计音色）：先确保已固化（首次约 2~3 秒，之后命中缓存）
    let voiceRef = null;
    let voiceLabel = prov.voice || prov.name;
    if (voiceNeeded(prov)) {
      try {
        const ref = await ensureVoiceRef(prov, !!payload.regenerateVoice);
        voiceRef = 'data:' + ref.mime + ';base64,' + ref.base64;
        voiceLabel = 'AI 设计音色';
        sendPanel('tts:voice-ref', { cached: ref.cached, bytes: ref.bytes, file: ref.file });
      } catch (err) {
        const msg = '音色设计失败：' + String(err.message || err);
        sendPanel('tts:error', { index: 0, total: 1, error: msg });
        return { ok: false, error: msg };
      }
    }
    if (my !== ttsToken) return { ok: false, aborted: true };

    sendPanel('tts:begin', { total: chunks.length, voice: voiceLabel, provider: prov.name, paused: false });
    for (let i = 0; i < chunks.length; i++) {
      if (my !== ttsToken) return { ok: false, aborted: true };
      await ttsGate(my);                                     // 暂停时停在这里，不再继续合成
      if (my !== ttsToken) return { ok: false, aborted: true };
      try {
        const r = await providers.synthesize(prov, chunks[i], { voiceRef, format: prov.format });
        if (my !== ttsToken) return { ok: false, aborted: true };
        sendPanel('tts:audio', { index: i, total: chunks.length, base64: r.base64, mime: r.mime, text: chunks[i] });
      } catch (err) {
        const msg = String(err.message || err);
        sendPanel('tts:error', { index: i, total: chunks.length, error: msg });
        return { ok: false, error: msg, chunk: i };
      }
    }
    sendPanel('tts:done', { total: chunks.length });
    return { ok: true, chunks: chunks.length, voice: voiceLabel, provider: prov.name };
  });
  ipcMain.handle('tts:pause', () => { setTtsPaused(true); return { ok: true, paused: true }; });
  ipcMain.handle('tts:resume', () => { setTtsPaused(false); return { ok: true, paused: false }; });
  ipcMain.handle('tts:stop', () => {
    ttsToken++;                    // 让正在跑的合成循环失效
    setTtsPaused(false, true);     // 并把它从暂停门里放出来，好让它看到 token 变化后退出
    return { ok: true };
  });

  ipcMain.on('ball:drag-start', () => markDragging(true));
  let lastDragPos = null;
  ipcMain.on('ball:drag-move', (_e, p) => {
    if (!ballWin || ballWin.isDestroyed() || !p) return;
    if (lastDragPos && Math.abs(p.x - lastDragPos.x) < 1 && Math.abs(p.y - lastDragPos.y) < 1) return;
    lastDragPos = { x: p.x, y: p.y };
    try { ballWin.setPosition(Math.round(p.x), Math.round(p.y)); } catch (e) {}
  });
  ipcMain.on('ball:drag-end', () => { lastDragPos = null; markDragging(false); });
  ipcMain.on('ball:click', () => { startCaptureFlow({ region: false }); });
  ipcMain.on('ball:region', () => { startCaptureFlow({ region: true }); });

  ipcMain.on('window:drag', (e, delta) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w || !delta) return;
    const b = w.getBounds();
    w.setPosition(Math.round(b.x + (delta.dx || 0)), Math.round(b.y + (delta.dy || 0)));
  });
  ipcMain.on('window:close', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close(); });
  ipcMain.on('window:hide', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.hide(); });
  ipcMain.on('window:minimize', (e) => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.minimize(); });
  ipcMain.on('capture:cancel', () => { if (captureWin && !captureWin.isDestroyed()) captureWin.close(); });
}

function openBallMenu() {
  if (!ballWin || ballWin.isDestroyed()) return;
  Menu.buildFromTemplate([
    { label: '截图提问（整屏）', click: () => startCaptureFlow({ region: false }) },
    { label: '截图提问（框选区域）', click: () => startCaptureFlow({ region: true }) },
    { type: 'separator' },
    { label: '打开对话面板', click: () => focusPanel() },
    { label: '设置…', click: () => openSettings() },
    { type: 'separator' },
    { label: '隐藏悬浮球', click: () => ballWin.hide() },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
  ]).popup({ window: ballWin });
}

// ---------------------------------------------------------------- 设计音色（voicedesign → 固化参考音频 → voiceclone 复用）
// 参考音频固定用 mp3：wav 体积是 mp3 的 6.4 倍，而这份参考每个分块请求都要带上。
const VOICE_REF_SAMPLE = '你好，我是 DeepSeek 桌面助手。我可以帮你看屏幕上的内容、回答问题，也可以把答案读给你听。';

/** 只有需要参考音频的语音协议（目前是 MiMo）才走这条路径 */
function voiceNeeded(p) {
  return !!(p && providers.ttsNeedsVoiceRef(p) && p.voiceMode !== 'preset');
}

function voiceRefFile(cfg) {
  const h = crypto.createHash('sha1')
    .update(['ref-mp3-v1', cfg.id || '', cfg.designModel || '', cfg.voiceDesign || ''].join('|'))
    .digest('hex').slice(0, 16);
  return path.join(app.getPath('userData'), 'voices', 'ref-' + h + '.mp3');
}

function voiceRefInfo(cfg) {
  const file = voiceRefFile(cfg);
  try {
    const st = fs.statSync(file);
    return { exists: true, file, bytes: st.size, createdAt: st.mtimeMs };
  } catch (e) { return { exists: false, file }; }
}

/** 保证音色参考音频存在；force=true 时重新设计（描述变了 hash 也会变，自动生成新音色） */
async function ensureVoiceRef(cfg, force) {
  const file = voiceRefFile(cfg);
  if (!force) {
    try {
      const st = fs.statSync(file);
      if (st.size > 1024) {
        return { file, base64: fs.readFileSync(file).toString('base64'), mime: 'audio/mpeg', cached: true, bytes: st.size };
      }
    } catch (e) { /* 未生成过，往下走 */ }
  }
  const r = await providers.designVoice(cfg, cfg.voiceDesign, VOICE_REF_SAMPLE, { format: 'mp3' });
  const buf = Buffer.from(r.base64, 'base64');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return { file, base64: r.base64, mime: 'audio/mpeg', cached: false, bytes: buf.length };
}

function setTtsPaused(v, silent) {
  ttsPaused = !!v;
  if (!ttsPaused && ttsResume) { const r = ttsResume; ttsResume = null; r(); }
  if (!silent) sendPanel('tts:paused', { paused: ttsPaused });
}
/** 暂停期间挡在合成循环前面，避免继续烧接口和堆缓冲 */
function ttsGate(token) {
  if (!ttsPaused || token !== ttsToken) return Promise.resolve();
  return new Promise(res => { ttsResume = res; });
}

// ---------------------------------------------------------------- 自检
async function runSelftest() {
  const log = (...a) => console.log('[selftest]', ...a);
  let failed = 0;
  try {
    const cfg = store.get();
    const chatP = providers.activeChat(cfg);
    const ttsP = providers.activeTts(cfg);
    log('配置文件:', store.file);
    log('聊天服务:', chatP ? chatP.name + '（' + chatP.protocol + ' / ' + chatP.model + ' / 图片=' + (chatP.supportsVision ? '支持' : '不支持') + '）' : '无',
        '| Key:', chatP && chatP.apiKey ? '已配置' : '缺失');
    log('语音服务:', ttsP ? ttsP.name + '（' + ttsP.protocol + '）' : '无', '| Key:', ttsP && ttsP.apiKey ? '已配置' : '缺失');
    if (!chatP || !ttsP) failed++;
    if (chatP && !chatP.apiKey && chatP.authHeader !== 'none') failed++;
    if (ttsP && !ttsP.apiKey && ttsP.authHeader !== 'none') failed++;

    log('--- 1) 屏幕捕获 ---');
    const shot = await captureFullScreen();
    const sz = nativeImage.createFromPath(shot.file).getSize();
    log('截图:', shot.file, sz.width + 'x' + sz.height, Math.round(fs.statSync(shot.file).size / 1024) + ' KB');
    if (!sz.width) failed++;

    log('--- 2) 截图 + 图像理解 ---');
    if (chatP && chatP.supportsVision) {
      const t0 = Date.now();
      const res = await providers.chatOnce(chatP, {
        systemPrompt: '',
        turns: [{
          role: 'user',
          text: '用一句话（30字以内）描述这张屏幕截图的内容。',
          images: [{ mime: 'image/png', base64: fs.readFileSync(shot.file).toString('base64') }],
        }],
      });
      log(chatP.name + ' 回答:', JSON.stringify((res.content || '').slice(0, 140)), '(' + (Date.now() - t0) + 'ms)');
      if (!res.content) failed++;
    } else {
      log('跳过：当前聊天服务未开启图片能力');
    }

    log('--- 3) 语音合成（分块 + 音色）---');
    const chunks = splitForSpeech('截图助手自检通过，现在可以点击悬浮球提问了。', ttsP.chunkSize || 60);
    log('分块:', JSON.stringify(chunks));
    const t1 = Date.now();
    let voiceRef = null;
    if (voiceNeeded(ttsP)) {
      const ref = await ensureVoiceRef(ttsP, false);
      voiceRef = 'data:' + ref.mime + ';base64,' + ref.base64;
      log('设计音色参考:', ref.cached ? '命中缓存' : '新生成', Math.round(ref.bytes / 1024) + ' KB', '->', path.basename(ref.file));
    }
    const audio = await providers.synthesize(ttsP, chunks[0], { voiceRef });
    const bytes = Buffer.from(audio.base64, 'base64').length;
    const out = path.join(os.tmpdir(), 'dsa_selftest.' + (audio.format === 'mp3' ? 'mp3' : 'wav'));
    fs.writeFileSync(out, Buffer.from(audio.base64, 'base64'));
    log('音频:', ttsP.name, audio.format, Math.round(bytes / 1024) + ' KB', '(' + (Date.now() - t1) + 'ms) ->', out);
    if (bytes < 1000) failed++;

    log('--- 4) 流式对话 ---');
    let streamed = '';
    await providers.chatStream(chatP, {
      systemPrompt: '', history: [{ role: 'user', text: '只回复：OK' }],
      context: { maxContextMessages: 4, maxImagesInContext: 0 },
      onDelta: d => { streamed += d; },
    });
    log('流式结果:', JSON.stringify(streamed));
    if (!streamed) failed++;

    log('--- 5) 思考模式 token 对比 ---');
    if (chatP.protocol === 'openai' && chatP.thinkingParam) {
      for (const on of [false, true]) {
        const probe = Object.assign({}, chatP, { thinking: on, maxTokens: 300 });
        const req = providers.chatProtocol(probe).buildRequest(probe, { systemPrompt: '', turns: [{ role: 'user', text: '用一句话说明什么是栈。' }], stream: false });
        const t0 = Date.now();
        const resp = await fetch(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) });
        const j = await resp.json();
        if (!resp.ok) { log('思考' + (on ? '开启' : '关闭'), '失败 HTTP', resp.status); failed++; continue; }
        const u = j.usage || {};
        const rt = u.completion_tokens_details ? u.completion_tokens_details.reasoning_tokens : '?';
        log('思考' + (on ? '开启' : '关闭') + ':', 'reasoning_tokens=' + rt, 'completion_tokens=' + u.completion_tokens, (Date.now() - t0) + 'ms');
      }
    } else {
      log('跳过：当前服务未声明支持思考模式开关');
    }
  } catch (e) {
    log('异常:', e && e.stack ? e.stack : String(e));
    failed++;
  }
  log(failed === 0 ? '全部通过' : '存在失败项: ' + failed);
  app.exit(failed === 0 ? 0 : 1);
}

// ---------------------------------------------------------------- 悬浮球渲染诊断
async function runBallDiag() {
  const log = (...a) => console.log('[diag]', ...a);
  try {
    createBall();
    ballWin.webContents.on('console-message', (...a) => {
      let m = '';
      if (a.length >= 3 && typeof a[2] === 'string') m = a[1] + ': ' + a[2];
      else if (a[1] && typeof a[1] === 'object') m = (a[1].level || '') + ': ' + (a[1].message || '');
      log('[ball console]', m);
    });
    ballWin.webContents.on('did-fail-load', (_e, c, d, u) => log('[ball] 加载失败', c, d, u));
    ballWin.webContents.on('render-process-gone', (_e, d) => log('[ball] 渲染进程消失', JSON.stringify(d)));
    ballWin.webContents.on('unresponsive', () => log('[ball] 渲染进程无响应'));

    await sleep(4000);
    if (!ballWin || ballWin.isDestroyed()) { log('悬浮球窗口不存在'); app.exit(1); return; }

    log('ballState        =', ballState);
    log('isVisible        =', ballWin.isVisible());
    log('isAlwaysOnTop    =', ballWin.isAlwaysOnTop());
    log('bounds           =', JSON.stringify(ballWin.getBounds()));
    log('workArea         =', JSON.stringify(displayForBall().workArea));
    try { log('isPainting       =', ballWin.webContents.isPainting()); } catch (e) { log('isPainting 出错', e.message); }
    try { log('isLoading        =', ballWin.webContents.isLoading()); } catch (e) {}
    try { log('isCrashed        =', ballWin.webContents.isCrashed()); } catch (e) {}
    try { log('getBackgroundThrottling =', ballWin.webContents.getBackgroundThrottling()); } catch (e) {}

    const img = await ballWin.webContents.capturePage();
    const size = img.getSize();
    const bmp = img.toBitmap();
    let opaque = 0, total = 0, solid = 0;
    for (let i = 0; i < bmp.length; i += 4) {
      total++;
      if (bmp[i + 3] > 30) opaque++;
      if (bmp[i + 3] > 200) solid++;
    }
    log('capturePage      =', size.width + 'x' + size.height, '| 不透明像素', opaque + '/' + total, '| 实心', solid);

    const html = await ballWin.webContents.executeJavaScript(
      "JSON.stringify({ready:document.readyState,orb:!!document.getElementById('orb'),orbW:(document.getElementById('orb')||{}).offsetWidth,css:getComputedStyle(document.documentElement).getPropertyValue('--size'),bg:(document.getElementById('orb')&&getComputedStyle(document.getElementById('orb')).backgroundImage||'').slice(0,60),bodyCls:document.body.className})"
    );
    log('页面状态         =', html);

    log('硬件加速是否关闭 =', app.isHardwareAccelerationEnabled ? !app.isHardwareAccelerationEnabled() : '(未知)');
    log('提示: 若屏幕上看不到悬浮球，先确认这里不是「硬件加速开着」——');
    log('      本机出现过 GPU 呈现失效：窗口内容进不了屏幕，但 capturePage 仍然正常。');
  } catch (e) {
    log('异常:', e && e.stack ? e.stack : String(e));
  }
  app.exit(0);
}

// ---------------------------------------------------------------- 界面自检（开发用：把三个页面渲染结果截图保存）
async function runUiCheck() {
  const log = (...a) => console.log('[ui-check]', ...a);
  const outDir = path.join(ROOT, 'ui-check');
  fs.mkdirSync(outDir, { recursive: true });
  const attach = (name, win) => {
    if (!win || win.isDestroyed()) return;
    win.webContents.on('console-message', (...a) => {
      let msg = '';
      if (a.length >= 3 && typeof a[2] === 'string') msg = a[1] + ': ' + a[2];
      else if (a[1] && typeof a[1] === 'object') msg = (a[1].level || '') + ': ' + (a[1].message || '');
      log('[' + name + ' console]', msg);
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url) => log('[' + name + '] 加载失败', code, desc, url));
    win.webContents.on('render-process-gone', (_e, d) => log('[' + name + '] 渲染进程崩溃', JSON.stringify(d)));
  };
  const save = async (name, win) => {
    if (!win || win.isDestroyed()) { log(name, '窗口不存在'); return; }
    try {
      const img = await win.webContents.capturePage();
      const file = path.join(outDir, name + '.png');
      fs.writeFileSync(file, img.toPNG());
      const s = img.getSize();
      log(name, s.width + 'x' + s.height, Math.round(fs.statSync(file).size / 1024) + ' KB');
    } catch (e) { log(name, '捕获失败:', e.message); }
  };

  try {
    const shot = await captureFullScreen();
    log('测试截图:', shot.width + 'x' + shot.height);

    createBall();
    attach('ball', ballWin);
    await sleep(1600);
    if (ballWin) {
      setBallState('shown', false);
      await sleep(350);
      await save('ball-idle', ballWin);
      await ballWin.webContents.executeJavaScript("document.body.classList.add('hover')");
      await sleep(600);
      await save('ball-hover', ballWin);
    }

    const p = ensurePanel();
    attach('panel', p);
    if (!panelLoaded) await new Promise(r => p.webContents.once('did-finish-load', r));
    await sleep(900);
    log('panel probe:', await p.webContents.executeJavaScript('typeof renderAll + " / " + typeof window.api + " / " + typeof window.api.config'));
    const seed = [
      { id: 'u1', role: 'user', text: '这张截图里讲了什么？', image: { thumb: shot.thumb, width: shot.width, height: shot.height } },
      { id: 'a1', role: 'assistant', text: '**屏幕内容概览**：\n\n- 左侧是一个课程页面\n- 右侧是对话窗口\n\n\`\`\`js\nconsole.log("hello")\n\`\`\`\n\n需要我针对某一部分再细看吗？' },
    ];
    await p.webContents.executeJavaScript('renderAll(' + JSON.stringify(seed) + ')');
    await sleep(600);
    await save('panel', p);

    openSettings();
    attach('settings', settingsWin);
    await sleep(2200);
    await save('settings', settingsWin);
    // 滚到音色设置那一段，单独留一张截图
    try {
      await settingsWin.webContents.executeJavaScript("document.getElementById('tDesignBox').scrollIntoView({block:'start'}); true");
      await sleep(500);
      await save('settings-voice', settingsWin);
    } catch (e) { log('音色截图失败:', e.message); }
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();

    // ---- 走真实 IPC 的流程校验 ----
    const js = code => p.webContents.executeJavaScript(code);
    const flow = [];

    await js('state.pendingImage = null; true');
    await js('window.api.capture.full()');
    await sleep(1500);
    flow.push('capture.full() 后面板收到附件: ' + await js('!!state.pendingImage'));

    await js('state.pendingImage = null; true');
    await startCaptureFlow({ region: false });
    await sleep(1600);
    flow.push('点击悬浮球同路径 startCaptureFlow 后收到附件: ' + await js('!!state.pendingImage'));

    const wBefore = ballWin.getBounds().width;
    const saveRes = await js("window.api.config.save({ui:{size:64}})");
    const wAfter = ballWin.getBounds().width;
    flow.push('config.save 成功=' + !!(saveRes && saveRes.ok) + ' | 悬浮球宽度 ' + wBefore + ' -> ' + wAfter);

    const chat0 = saveRes.config.providers.chat[0];
    const tts0 = saveRes.config.providers.tts[0];
    flow.push('服务数: 聊天=' + saveRes.config.providers.chat.length + ' 语音=' + saveRes.config.providers.tts.length
      + ' | 当前=' + saveRes.config.activeChatId + '/' + saveRes.config.activeTtsId);
    flow.push('Key 掩码=' + (chat0.apiKeyMask || '(空)') + ' / ' + (tts0.apiKeyMask || '(空)')
      + ' | publicView 不回传明文=' + (chat0.apiKey === '' && tts0.apiKey === ''));
    flow.push('provider 定义完整性: protocol=' + chat0.protocol + ' 字段数=' + Object.keys(chat0).length);
    flow.push('落盘 DPAPI 加密=' + fs.readFileSync(store.file, 'utf8').includes('enc:v1:'));

    setBallState('hidden', false);
    const hp = ballWin.getBounds();
    setBallState('shown', false);
    const sp = ballWin.getBounds();
    const wa = displayForBall().workArea;
    flow.push('贴边隐藏 x=' + hp.x + ' / 展开 x=' + sp.x + ' / 滑动距离=' + (sp.x - hp.x) + ' / 露出=' + (wa.x + wa.width - hp.x - ballMetrics().pad) + 'px');

    const waitUntil = async (expr, ms) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (await js(expr)) return true;
        await sleep(300);
      }
      return false;
    };

    await js("window.__tts={audio:0,done:0,err:0,errMsg:'',ref:0}; API.on('tts:audio',()=>window.__tts.audio++); API.on('tts:done',()=>window.__tts.done++); API.on('tts:error',p=>{window.__tts.err++;window.__tts.errMsg=p.error;}); API.on('tts:voice-ref',()=>window.__tts.ref++); true");
    const ttsText = '这是第一句语音播放测试，用来验证设计出来的音色能不能正常出声，并且第一块音频不需要等很久。'
      + '这是第二句话，用来验证分块合成与顺序播放是否前后衔接顺畅，音色保持一致。'
      + '这是第三句话，用来保证确实被切成了多个分块，这样暂停的时候才能检验出后台合成是否也一起停了下来。';
    const mk = providers.activeTts(store.get());
    flow.push('语音服务=' + mk.name + '(' + mk.protocol + ')' + ' | 音色模式=' + (mk.voiceMode || '-')
      + ' | 分块数=' + splitForSpeech(ttsText, mk.chunkSize || 60).length
      + ' | 运行期 key len=' + mk.apiKey.length + ' tail=' + mk.apiKey.slice(-4));
    await js('window.api.tts.speak(' + JSON.stringify({ text: ttsText }) + ')');

    const started = await waitUntil("!!(tts.audio && tts.audio.currentTime > 0.15)", 30000);
    flow.push('音频开始出声=' + started + ' | ' + await js("JSON.stringify({ref:window.__tts.ref, chunks:window.__tts.audio, bar:document.getElementById('playbar').classList.contains('show'), barText:document.getElementById('pbText').textContent, pauseLabel:document.getElementById('pbPause').textContent})"));

    await js("document.getElementById('pbPause').click(); true");
    await sleep(4200);
    const paused1 = await js("JSON.stringify({t:+(tts.audio?tts.audio.currentTime:0).toFixed(2), chunks:window.__tts.audio, paused:tts.paused, label:document.getElementById('pbPause').textContent, barText:document.getElementById('pbText').textContent})");
    await sleep(3200);
    const paused2 = await js("JSON.stringify({t:+(tts.audio?tts.audio.currentTime:0).toFixed(2), chunks:window.__tts.audio})");
    flow.push('暂停中: ' + paused1);
    flow.push('暂停 3 秒后: ' + paused2 + '  ← currentTime 应不变、chunks 应不再增长');

    await js("document.getElementById('pbPause').click(); true");
    await sleep(2200);
    flow.push('继续后: ' + await js("JSON.stringify({t:+(tts.audio?tts.audio.currentTime:0).toFixed(2), chunks:window.__tts.audio, paused:tts.paused, label:document.getElementById('pbPause').textContent})") + '  ← currentTime 应大于暂停时');

    await waitUntil("!!window.__tts.done", 40000);
    await sleep(1500);
    flow.push('播报结束: ' + await js("JSON.stringify({ref:window.__tts.ref, chunks:window.__tts.audio, done:window.__tts.done, err:window.__tts.err, errMsg:window.__tts.errMsg})"));
    const barHidden = await waitUntil("!document.getElementById('playbar').classList.contains('show')", 25000);
    flow.push('播放结束后控制条自动隐藏=' + barHidden);

    // 停止按钮也要能立刻收掉控制条
    await js('window.api.tts.speak(' + JSON.stringify({ text: '这是一句用来验证停止按钮的测试文本。' }) + ')');
    await waitUntil("document.getElementById('playbar').classList.contains('show')", 20000);
    await js("document.getElementById('pbStop').click(); true");
    await sleep(600);
    flow.push('点击停止后控制条隐藏=' + await js("!document.getElementById('playbar').classList.contains('show')"));
    await js('window.api.tts.stop()');
    await sleep(300);

    await js("window.api.config.save({ui:{size:56}})");
    const rp = providers.activeTts(store.get());
    flow.push('已恢复默认: size=' + ballWin.getBounds().width + ' 语音=' + rp.name + ' 音色=' + rp.voice);

    flow.forEach(x => log('流程 ', x));
    log('界面自检完成');
    app.exit(0);
  } catch (e) {
    log('异常:', e && e.stack ? e.stack : String(e));
    app.exit(1);
  }
}

// ---------------------------------------------------------------- 生命周期
if (!DEV_MODE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (!DEV_MODE) app.on('second-instance', () => focusPanel());
  app.whenReady().then(() => {
    store = new Store(app.getPath('userData'));
    history = new History(app.getPath('userData'));
    try { app.setLoginItemSettings({ openAtLogin: !!store.get().ui.autoLaunch, path: process.execPath }); } catch (e) {}
    registerIpc();
    try { const n = history.sweepOrphans(); if (n) console.log('[history] 清理孤儿截图', n, '个'); } catch (e) {}
    if (SELFTEST) { runSelftest(); return; }
    if (UI_CHECK) { runUiCheck(); return; }
    if (DIAG) { runBallDiag(); return; }
    createBall();
    createTray();
    try {
      globalShortcut.register('CommandOrControl+Alt+S', () => startCaptureFlow({ region: false }));
      globalShortcut.register('CommandOrControl+Alt+A', () => startCaptureFlow({ region: true }));
    } catch (e) {}
  });
  // 托盘常驻：所有窗口关闭也不退出
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => { app.isQuitting = true; });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
