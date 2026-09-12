'use strict';
// 语音分块与 Markdown 清洗的单元校验（不依赖 Electron）
const { splitForSpeech, cleanForSpeech } = require('../src/main/mimo');

const md = [
  '## 分析结果',
  '',
  '这张截图是一个 **在线英语课程** 页面，主要有以下问题：',
  '',
  '- 第 3 题选错了，正确答案是 B',
  '- 完形填空需要结合上下文',
  '',
  '```js',
  'console.log("这段代码不应该被朗读出来")',
  '```',
  '',
  '参考链接：https://example.com/some/very/long/url 以及 `inline code`。',
  '最后一句用来验证长文本会被切成多块并且顺序不乱。',
].join('\n');

const cleaned = cleanForSpeech(md);
const chunks = splitForSpeech(md, 60);
console.log('清洗后:', JSON.stringify(cleaned));
console.log('');
console.log('分块数:', chunks.length);
chunks.forEach((c, i) => console.log('  [' + i + '] (' + c.length + '字) ' + c));
console.log('');
console.log('校验:');
console.log('  代码围栏未进入朗读文本:', !cleaned.includes('console.log'));
console.log('  URL 已移除:', !cleaned.includes('http'));
console.log('  Markdown 标记已移除:', !/[#*\`]/.test(cleaned));
console.log('  所有块 <= 60 字:', chunks.every(c => c.length <= 60));
console.log('  顺序保持（第一块含“分析结果”）:', chunks[0].includes('分析结果'));
console.log('  长文本确实被切成多块:', chunks.length > 1);
