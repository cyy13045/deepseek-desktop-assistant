'use strict';
const { contextBridge, ipcRenderer } = require('electron');

function on(channel, cb) {
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

contextBridge.exposeInMainWorld('api', {
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    save: (patch) => ipcRenderer.invoke('config:save', patch),
  },
  // 聊天服务（任意协议）
  provider: {
    models: (payload) => ipcRenderer.invoke('provider:models', payload || {}),
    test: (payload) => ipcRenderer.invoke('provider:test', payload || {}),
    fromPreset: (payload) => ipcRenderer.invoke('provider:from-preset', payload || {}),
  },
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    get: (id) => ipcRenderer.invoke('history:get', id),
    create: () => ipcRenderer.invoke('history:create'),
    remove: (id) => ipcRenderer.invoke('history:remove', id),
    clear: () => ipcRenderer.invoke('history:clear'),
  },
  capture: {
    full: () => ipcRenderer.invoke('capture:full'),
    region: () => ipcRenderer.invoke('capture:region'),
  },
  chat: {
    send: (payload) => ipcRenderer.invoke('chat:send', payload),
    abort: () => ipcRenderer.invoke('chat:abort'),
  },
  // 语音服务
  tts: {
    speak: (payload) => ipcRenderer.invoke('tts:speak', payload),
    pause: () => ipcRenderer.invoke('tts:pause'),
    resume: () => ipcRenderer.invoke('tts:resume'),
    stop: () => ipcRenderer.invoke('tts:stop'),
    test: (payload) => ipcRenderer.invoke('tts:test', payload || {}),
    designVoice: (payload) => ipcRenderer.invoke('tts:design-voice', payload || {}),
    voiceRefInfo: (payload) => ipcRenderer.invoke('tts:voice-ref-info', payload || {}),
    setAutoSpeak: (on) => ipcRenderer.invoke('tts:set-autospeak', on),
  },
  panel: {
    hide: () => ipcRenderer.invoke('panel:hide'),
    openSettings: () => ipcRenderer.invoke('panel:open-settings'),
  },
  app: {
    quit: () => ipcRenderer.invoke('app:quit'),
    openUserData: () => ipcRenderer.invoke('shell:open-userdata'),
    openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  },
  ball: {
    click: () => ipcRenderer.send('ball:click'),
    region: () => ipcRenderer.send('ball:region'),
    context: () => ipcRenderer.invoke('ball:context'),
    dragStart: () => ipcRenderer.send('ball:drag-start'),
    dragMove: (p) => ipcRenderer.send('ball:drag-move', p),
    dragEnd: () => ipcRenderer.send('ball:drag-end'),
  },
  win: {
    drag: (delta) => ipcRenderer.send('window:drag', delta),
    close: () => ipcRenderer.send('window:close'),
    hide: () => ipcRenderer.send('window:hide'),
    minimize: () => ipcRenderer.send('window:minimize'),
  },
  captureOverlay: {
    done: (rect) => ipcRenderer.send('capture:rect', rect),
    cancel: () => ipcRenderer.send('capture:cancel'),
  },
  on,
});
