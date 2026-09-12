'use strict';
// 对话历史与截图存储。截图以 PNG 落盘，历史里只存路径 + 缩略图 dataURL，避免 JSON 膨胀。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { nativeImage } = require('electron');

const MAX_CONVERSATIONS = 60;
const MAX_MESSAGES_PER_CONV = 120;
const THUMB_WIDTH = 240;

class History {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'history.json');
    this.shotsDir = path.join(dir, 'shots');
    this._data = null;
  }

  _read() {
    if (this._data) return this._data;
    let data = { conversations: [] };
    try {
      if (fs.existsSync(this.file)) {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (parsed && Array.isArray(parsed.conversations)) data = parsed;
      }
    } catch (e) { data = { conversations: [] }; }
    this._data = data;
    return data;
  }

  _write() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this._data), 'utf8');
    } catch (e) {
      console.error('[history] 写入失败:', e.message);
    }
  }

  _find(id) {
    return this._read().conversations.find(c => c.id === id) || null;
  }

  list() {
    return this._read().conversations
      .map(c => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        count: c.messages.length,
        preview: lastText(c.messages),
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id) {
    const c = this._find(id);
    return c ? JSON.parse(JSON.stringify(c)) : null;
  }

  create(title) {
    const now = Date.now();
    const conv = {
      id: crypto.randomUUID(),
      title: (title || '新对话').slice(0, 40),
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    this._read().conversations.unshift(conv);
    this._prune();
    this._write();
    return JSON.parse(JSON.stringify(conv));
  }

  append(convId, msg) {
    let conv = this._find(convId);
    if (!conv) conv = this._find(this.create().id);
    const m = Object.assign({ id: crypto.randomUUID(), ts: Date.now() }, msg);
    conv.messages.push(m);
    conv.updatedAt = Date.now();
    if ((!conv.title || conv.title === '新对话') && m.role === 'user' && m.text) {
      conv.title = m.text.replace(/\s+/g, ' ').trim().slice(0, 24) || '新对话';
    }
    if (conv.messages.length > MAX_MESSAGES_PER_CONV) {
      conv.messages = conv.messages.slice(-MAX_MESSAGES_PER_CONV);
    }
    this._prune();
    this._write();
    return JSON.parse(JSON.stringify(m));
  }

  updateMessage(convId, msgId, patch) {
    const conv = this._find(convId);
    if (!conv) return null;
    const m = conv.messages.find(x => x.id === msgId);
    if (!m) return null;
    Object.assign(m, patch);
    conv.updatedAt = Date.now();
    this._write();
    return JSON.parse(JSON.stringify(m));
  }

  remove(id) {
    const data = this._read();
    const conv = this._find(id);
    if (conv) (conv.messages || []).forEach(m => this._deleteShot(m.image));
    data.conversations = data.conversations.filter(c => c.id !== id);
    this._write();
    return true;
  }

  clear() {
    const data = this._read();
    data.conversations.forEach(c => (c.messages || []).forEach(m => this._deleteShot(m.image)));
    data.conversations = [];
    this._write();
    return true;
  }

  /** 把 PNG buffer 存成文件，返回 {file, thumb, width, height} */
  saveShot(pngBuffer, meta) {
    fs.mkdirSync(this.shotsDir, { recursive: true });
    const id = crypto.randomUUID();
    const file = path.join(this.shotsDir, id + '.png');
    fs.writeFileSync(file, pngBuffer);
    let width = meta && meta.width, height = meta && meta.height, thumb = '';
    try {
      const img = nativeImage.createFromBuffer(pngBuffer);
      const sz = img.getSize();
      width = sz.width; height = sz.height;
      const tw = Math.min(THUMB_WIDTH, sz.width);
      const resized = img.resize({ width: tw, quality: 'good' });
      thumb = 'data:image/jpeg;base64,' + resized.toJPEG(62).toString('base64');
    } catch (e) { /* 缩略图失败不影响主流程 */ }
    return { file, thumb, width, height };
  }

  readShotDataUrl(file) {
    try {
      const buf = fs.readFileSync(file);
      return 'data:image/png;base64,' + buf.toString('base64');
    } catch (e) { return null; }
  }

  /** 清理没有被任何消息引用的截图文件（只删超过 maxAgeMs 的） */
  sweepOrphans(maxAgeMs) {
    const age = maxAgeMs == null ? 24 * 3600 * 1000 : maxAgeMs;
    let removed = 0;
    try {
      if (!fs.existsSync(this.shotsDir)) return 0;
      const referenced = new Set();
      this._read().conversations.forEach(c => (c.messages || []).forEach(m => {
        if (m.image && m.image.file) referenced.add(path.basename(m.image.file));
      }));
      const now = Date.now();
      for (const name of fs.readdirSync(this.shotsDir)) {
        if (referenced.has(name)) continue;
        const full = path.join(this.shotsDir, name);
        try {
          if (now - fs.statSync(full).mtimeMs < age) continue;
          fs.unlinkSync(full);
          removed++;
        } catch (e) { /* 跳过 */ }
      }
    } catch (e) { /* 忽略 */ }
    return removed;
  }

  _deleteShot(image) {
    if (!image || !image.file) return;
    try { if (fs.existsSync(image.file)) fs.unlinkSync(image.file); } catch (e) {}
  }

  _prune() {
    const data = this._read();
    if (data.conversations.length > MAX_CONVERSATIONS) {
      data.conversations
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(MAX_CONVERSATIONS)
        .forEach(c => (c.messages || []).forEach(m => this._deleteShot(m.image)));
      data.conversations = data.conversations
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_CONVERSATIONS);
    }
  }
}

function lastText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = (messages[i].text || '').replace(/\s+/g, ' ').trim();
    if (t) return t.slice(0, 60);
  }
  return '';
}

module.exports = { History };
