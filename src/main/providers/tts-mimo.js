'use strict';
// 小米 MiMo 语音合成适配器。真正的线格式仍由 ../mimo.js 负责（已被真实接口验证过）。
// 特点：支持用文字设计专属音色，并把生成的音频固化为参考样本后复用。
const mimo = require('../mimo');

const id = 'mimo-tts';
const label = '小米 MiMo（支持文字设计音色）';

// 需要先固化参考音频的协议
const needsVoiceRef = true;
const supportsVoiceDesign = true;

async function synthesize(p, text, opts = {}) {
  return mimo.synthesize(p, text, opts);
}
async function designVoice(p, designPrompt, sampleText, opts = {}) {
  return mimo.designVoice(p, designPrompt, sampleText, opts);
}

const fields = ['baseUrl', 'apiKey', 'authHeader', 'authHeaderName', 'ttsModel', 'voice', 'format', 'chunkSize', 'style'];
const capabilities = ['supportsVoiceDesign', 'voiceMode', 'voiceDesign', 'voice'];

module.exports = { id, label, needsVoiceRef, supportsVoiceDesign, synthesize, designVoice, fields, capabilities };
