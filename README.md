# DeepSeek 桌面助手 · DeepSeek Desktop Assistant

桌面贴边悬浮球：一键截图提问，回答可以用语音朗读。聊天与语音都支持多个服务随时切换。

**语言 / Language：** [中文](#zh) · [English](#en)

---

<a id="zh"></a>

## 中文

- 屏幕边缘的圆形悬浮球，鼠标移开自动贴边隐藏，悬停时显示 DeepSeek 图标
- 点击即截取当前屏幕（或框选局部区域），连同问题一起发给**任意**支持视觉的模型
- **聊天与语音都是多服务**：可以同时配置多个，随时切换当前使用的那一个
- 内置 **15 个聊天预设**：DeepSeek / OpenAI / Claude / Gemini / OpenRouter / 硅基流动 / Grok /
  Kimi / 智谱 GLM / 通义千问 / 豆包 / MiniMax / Ollama / LM Studio + 完全自定义
- **三套协议适配器**：OpenAI 兼容、Anthropic Messages、Google Gemini
- **自定义 API**：只填 Base URL / 认证方式 / 模型即可，还能覆盖请求路径、额外请求头、输出参数名
- 对话记录本地持久化，可翻阅、删除、清空
- 回答可自动 / 手动朗读（按句分块，边合成边播放），**支持暂停 / 继续 / 停止**
- 音色可用**文字描述设计**（MiMo）：voicedesign 生成一次后固化为参考音频，
  之后用 voiceclone 复用，保证整段朗读音色统一
- 没勾「支持图片」的模型会明确降级提示，不会偷偷把截图发出去

### 运行

```bash
npm install          # 已安装可跳过
npm run initconfig   # 首次运行：把 API Key 写入配置（只写一次，不覆盖已有的）
npm start
```

设置里如果还没填 Key，点托盘图标 → 设置… 或面板右上角 ⚙ 填写。

### 操作方式

| 操作 | 说明 |
| --- | --- |
| 单击悬浮球 | 截取当前屏幕并打开面板提问 |
| Shift + 单击悬浮球 | 框选区域截图 |
| 右键悬浮球 | 菜单（整屏 / 框选 / 设置 / 退出） |
| 拖动悬浮球 | 移动位置，松手自动吸附左/右边缘并记住 |
| `Ctrl+Alt+S` | 全局快捷键：整屏截图提问 |
| `Ctrl+Alt+A` | 全局快捷键：框选截图提问 |
| 面板 `Enter` / `Shift+Enter` | 发送 / 换行 |
| 面板 `Esc` | 关闭历史抽屉 / 隐藏面板 |
| 托盘图标单击 | 显示 / 隐藏面板 |
| 播报控制条 ⏸ / ▶ | 暂停 / 继续语音（暂停时播放与后台合成一起停，不会继续烧接口） |
| 播报控制条 ⏹ | 停止播报并清空尚未播放的音频 |
| 消息上的 ▶ 朗读 / ⏹ 停止 | 单独朗读或停止某一条回答 |

悬浮球被隐藏后，从托盘菜单「显示/隐藏悬浮球」可以找回来。

### 支持的聊天服务与自定义 API

#### 三套协议适配器

| 协议 | 请求形式 | 覆盖 |
| --- | --- | --- |
| `openai` | `POST {baseUrl}/chat/completions`，`Authorization: Bearer`，图片走 `image_url` 块 | DeepSeek / OpenAI / Kimi / 智谱 / 通义千问 / 豆包 / MiniMax / Grok / OpenRouter / 硅基流动 / Ollama / LM Studio / vLLM / one-api 等 |
| `anthropic` | `POST {baseUrl}/v1/messages`，`x-api-key` + `anthropic-version`，图片走 `image` 块 | Claude |
| `gemini` | `POST {baseUrl}/v1beta/models/{model}:generateContent`，`x-goog-api-key`，图片走 `inline_data` | Gemini |

协议之间的差异全部由适配器吃掉：system 的位置（OpenAI 放在 messages 里、Anthropic 是顶层参数、
Gemini 是 systemInstruction）、角色命名（Gemini 用 `model` 而不是 `assistant`）、
连续同角色合并与「首条必须是 user」、思考模式的开关形式、以及各家不同的 SSE 事件结构。

#### 自定义 API

选「自定义（OpenAI 兼容）」预设，或者直接在任意服务上改这几个字段：

- **Base URL** —— 例如 `http://localhost:8000/v1`
- **认证方式** —— `Bearer` / `api-key` / `x-api-key` / `x-goog-api-key` / 自定义头名 / 无需认证。
  这一项就是为 Azure OpenAI（`api-key` 头）和本地免鉴权服务准备的
- **自定义请求路径** —— 默认 `/chat/completions`，可带查询串，例如
  `/chat/completions?api-version=2024-10-21`
- **额外请求头** —— JSON 对象，例如 OpenRouter 要求的 `HTTP-Referer`
- **输出上限参数名** —— `max_tokens` 或 `max_completion_tokens`（OpenAI o / GPT-5 系要后者）

设置里的「测试连接」「拉取模型」用的是**当前表单里还没保存的内容**，可以先试再存。

#### 能力位驱动的界面

每个服务都带能力位，设置界面按能力位决定显示哪些字段，面板按能力位给出提示：

- **支持图片** —— 不勾选时截图不会被发送，面板会明确提示「当前模型不支持图片」
- **支持思考模式** —— 只有 DeepSeek 这类接受 `thinking` 参数的服务才该勾，勾错会被服务端拒绝
- **supportsVoiceDesign** —— 目前只有 MiMo 支持；切到别的语音服务时，音色设计那一整块会自动隐藏

### 已核实的两套接口

#### DeepSeek（`https://api.deepseek.com`，OpenAI 兼容）

- 模型（`GET /models` 实测）：`deepseek-flash`、`deepseek-v4-pro`
- **只有 `deepseek-flash` 支持图像理解**，`deepseek-v4-pro` 是纯文本 —— 截图提问必须用 flash
- 图片以 `content` 块数组传递：`{type:"image_url", image_url:{url:"data:image/png;base64,...", detail}}`
- 支持 JPEG / PNG / GIF / WebP，格式按内容判断；单图 ≤ 32 MiB，请求体 ≤ 48 MiB
- `detail` 可取 `low`(缩放到 512×512) / `high` / `original`；每张图最多约 1024 token
- **思考模式默认开启且 effort=high**，会占用输出 token。本程序默认关闭
  （`thinking:{type:"disabled"}`），实测从 103 降到 27 completion tokens

#### 小米 MiMo TTS（`https://api.xiaomimimo.com/v1`）

- `POST /chat/completions`，鉴权头 `api-key: $KEY`
- **待朗读文本必须放在 `role: "assistant"` 的 message 里**，放错角色不会朗读
- `role: "user"` 是可选指令，用来控制语气、语速、情绪（不进入朗读内容）
- 内置音色：`mimo_default`、`冰糖`、`茉莉`、`苏打`、`白桦`、`Mia`、`Chloe`、`Milo`、`Dean`
- 音频从 `choices[0].message.audio.data` 返回（base64）
- 实测耗时与字数近似线性（约 55 ms/字），且 wav 体积是 mp3 的 6.4 倍：

  | 文本 | 格式 | 音频大小 | 耗时 |
  | --- | --- | --- | --- |
  | 14 字 | wav | 130 KB | 1450 ms |
  | 14 字 | mp3 | 20 KB | 1090 ms |
  | 92 字 | mp3 | 150 KB | 5067 ms |
  | 540 字 | wav | **15.2 MB** | **69 s** |

  所以本程序默认 mp3 + 按句切块（默认 60 字/块），主进程边合成、渲染进程边播，
  第一段音频约 1–2 秒就能出声，不会等整段合成完。

##### 文字设计音色（为什么不是每块都调 voicedesign）

三个 TTS 模型各管一件事：

| 模型 | 作用 | 限制 |
| --- | --- | --- |
| `mimo-v2.5-tts` | 9 个内置音色 | 不支持设计 / 克隆 |
| `mimo-v2.5-tts-voicedesign` | **按文字描述生成音色** | `user` 消息是**必填**的音色描述，且**不接受 `audio.voice`** |
| `mimo-v2.5-tts-voiceclone` | 用音频样本复刻音色 | 必须传 `audio.voice` = 样本的 base64 data URL |

关键实测：**用同一段描述连续调两次 voicedesign，返回的音频并不相同**（两次样本字节差 0.4–3.8 KB），
逐块调用会让音色在分块之间漂移。所以本程序的做法是：

```
第一次朗读  → voicedesign 按描述生成参考音频 → 存到 %APPDATA%\...\voices\ref-<hash>.mp3
之后每一块  → voiceclone + 这份参考音频      → 音色完全一致
```

参考音频固定用 mp3（wav 是它的 6.4 倍），因为每个分块请求都要带上它；
hash 由「描述 + 模型」算出，改了描述会自动生成新音色，旧文件保留可回退。

另外用 `mimo-v2.5-asr` 把合成结果转回文字做了交叉校验，确认生成的确实是可辨识的普通话语音。

### 结构

```
src/main/main.js        Electron 主进程：悬浮球窗口/贴边动画/悬停检测、截图与框选、面板、托盘、IPC
src/main/store.js       配置持久化（多服务结构）；API Key 用 safeStorage(DPAPI) 加密；老配置自动迁移
src/main/history.js     对话历史（JSON）+ 截图文件（PNG）+ 缩略图
src/main/providers/     多服务抽象层
  index.js               注册表与分发；把对话历史转成协议无关的 turns（图片在这里读成 base64）
  presets.js             15 个聊天预设 + 3 个语音预设 + 音色描述预设
  http.js                鉴权头、URL 拼接、SSE 读取、连续同角色合并
  openai.js              OpenAI 兼容协议（覆盖绝大多数厂商）
  anthropic.js           Anthropic Messages 协议
  gemini.js              Google Gemini 协议
  tts-mimo.js            MiMo 语音适配器（线格式仍由 mimo.js 负责）
  tts-openai.js          OpenAI 兼容 TTS（/audio/speech 返回二进制音频）
src/main/mimo.js        MiMo TTS 客户端：合成、Markdown 清洗、按句分块
src/preload/preload.js  contextBridge 暴露的 window.api
src/renderer/ball.*     悬浮球（悬停显示 DeepSeek 图标、拖动、贴边态）
src/renderer/panel.*    对话面板（截图附件、流式回答、历史抽屉、语音播放队列）
src/renderer/capture.*  框选遮罩层
src/renderer/settings.* 设置界面（多服务管理、自定义 API、音色、界面行为）
scripts/init-config.js  首次生成配置（不硬编码任何 Key）
scripts/check-chunking.js    语音分块与 Markdown 清洗的单元校验（不依赖 Electron）
scripts/probe-voicedesign.js 音色设计/克隆/ASR 的接口探针（用 Electron 跑，走真实解密路径）
scripts/probe-providers.js   多协议抽象层验证：本地模拟服务跑通自定义 API + 真实端点结构探测
```

### 自检

```bash
npm run selftest
```

会依次验证：屏幕捕获 → 截图发给**当前聊天服务**做图像理解 → **当前语音服务**分块合成 →
流式对话 → 思考模式 token 对比。换服务后自检会自动跟着换，不需要改代码。

自检与 `ui-check` 不参与单实例锁，所以应用正在运行时也能跑。

注意：配置里的 Key 是 DPAPI 密文，任何直接读 `config.json` 拿 `apiKey` 去请求的脚本都会 401
（密文被当成 Key 发送）。要用真实 Key 请走 `npm run selftest`，它经由应用自身的解密路径。

### 已验证的行为

`npm run selftest`（真实屏幕 + 真实接口）：

```
1) 屏幕捕获        1920x1080 PNG, 437 KB
2) 图像理解        1162ms 正确描述出屏幕实际内容（还认出了正在运行的悬浮球窗口）
3) 音色与合成     设计音色参考命中缓存 54 KB → voiceclone 合成 mp3 32 KB / 1722ms
4) 流式对话        正常
5) 思考模式对比    关闭: 28 completion tokens / 785ms
                   开启: 94 reasoning tokens + 126 completion tokens / 971ms
                   —— 印证了默认关闭思考模式的取舍
```

`electron scripts/probe-providers.js`（多协议抽象层；起一个本地模拟的 OpenAI 兼容服务）：

```
自定义 API 15/15 通过：
  listModels 走自定义 Base URL、chatOnce、chatStream 逐块拼接、请求体 system 位置
  带截图时发送 image_url 块；不勾「支持图片」时降级为纯文本并附「截图已省略」
  错 Key 给可读鉴权错误；错误路径给 404 提示；15 个聊天预设与 3 个语音预设都能构造成完整 provider

真实端点结构探测：
  Anthropic  收到 403（结构被接受，仅 Key 无效）
  OpenAI     SKIP —— 本机网络不可达
  Gemini     SKIP —— 本机网络不可达
  OpenAI TTS SKIP —— 本机网络不可达
```

另外单独确认过可达性：`api.anthropic.com` 403、`api.deepseek.com` 401 可达；
`api.openai.com` 与 `generativelanguage.googleapis.com` 从这台机器直接超时。

`npm run ui-check`（渲染三个页面并把渲染结果存到 `ui-check/`，同时跑一遍真实 IPC 流程）：

```
悬浮球悬停    显示 DeepSeek 鲸鱼图标（白色）；常态只有蓝球 + 白点，无图标
面板          截图缩略图附件、用户气泡、Markdown 列表与代码块、输入区均正常
设置          服务下拉/预设添加/复制/删除、协议与认证方式、能力位复选框、音色来源与设计描述渲染正常
截图交付      api.capture.full() 与点击悬浮球两条路径面板都能拿到附件
配置保存      悬浮球宽度 72 -> 80（size 56 -> 64 实时生效）
Key 安全      设置界面只拿到掩码（形如 sk-abc...wxyz）；磁盘上是 enc:v1: DPAPI 密文
贴边几何      隐藏 x=1904 / 展开 x=1836，滑动 68px，贴边只露出 8px
音色设计      自动生成参考音频（tts:voice-ref 事件 1 次），3 个分块全部复用同一份参考
语音播放      playing=true，currentTime 真实推进（确实在出声，不是只入队）
暂停 / 继续   暂停中 t=4.85 → 3 秒后仍是 4.85（播放真的冻结）
              同一窗口内 chunks 3 → 3（后台合成也被门控，没有继续发请求）
              继续后 t 回到 7.09 并继续播完；最后 done=1 / err=0
控制条        播放结束后自动隐藏=true；点停止后立即隐藏=true
分块清洗      代码围栏/URL/Markdown 标记不朗读，每块 <= 60 字，顺序不乱
```

### 已知限制

- **默认关闭 Electron 硬件加速**（`app.disableHardwareAcceleration()`）。开发机上出现过
  「窗口存在、isVisible/isAlwaysOnTop 都为真、capturePage 也能拿到完整内容，但屏幕上什么都没有」，
  而同一时刻普通 WinForms 窗口显示正常 —— 属于 GPU 呈现失效。悬浮球只是 2D 小窗口，软件渲染足够。
  需要强制开硬件加速时设环境变量 `DSA_FORCE_GPU=1`
- 另外关闭了 Chromium 的窗口遮挡检测与后台化（`CalculateNativeWinOcclusion` /
  `disable-backgrounding-occluded-windows` / `disable-renderer-backgrounding`）：
  又小又贴边、大部分在屏幕外的置顶窗口容易被判定为「被遮挡」而停止绘制。这三项是防御性的，
  本次问题的实际修复项是上面的软件渲染
- 全局快捷键默认 `Ctrl+Alt+S` / `Ctrl+Alt+A`，若被其他软件占用可在 `src/main/main.js` 的
  `globalShortcut.register` 处修改
- 面板与悬浮球使用透明无边框窗口，仅验证了 Windows 11
- 语音只有暂停 / 继续 / 停止，没有倍速与进度拖动；暂停后从块首继续
- 设计音色的参考音频只在本地缓存，换机器或改描述会重新生成（首次约 2–3 秒）
- **OpenAI / Gemini 的端点在开发机上网络不可达**，这两个协议只做了结构级验证（请求 URL、
  鉴权头、请求体形状）和本地模拟服务验证，没有用真实 Key 跑通；Anthropic 与 DeepSeek 是真实跑通的
- 内置预设里的**模型名会随厂商更新而过期**，请以设置里「拉取模型」的结果为准
- 各家对图片的支持程度不同（能否多图、单图大小上限、是否支持 detail 参数），程序只统一处理了
  「支持 / 不支持」这一档
- 未提供打包安装程序，用 `npm start` 运行；如需 `electron-builder` 可自行添加

### 安全

- API Key 不写进源码，存在 `%APPDATA%\deepseek-desktop-assistant\config.json`，
  保存时用 Electron `safeStorage`（Windows 下为 DPAPI）加密
- 渲染进程开启 `contextIsolation` / 关闭 `nodeIntegration`，并设置了 CSP
- 截图只在提问时发送到**你当前选中的那个聊天服务**，语音文本只发送到**你当前选中的那个语音服务**；
  程序不内置任何中转，也不会把内容发往别处
- 每个服务的 Key 独立保存（同一个 Key 配两个服务就是两份），都走同一套 DPAPI 加密
- 设置界面只回传 Key 的掩码，不回传明文

---

<a id="en"></a>

## English

### What it is

A floating orb docked to the edge of your screen. One click captures the screen and asks
your question about it; the answer can be read out loud. Both chat and speech support
**multiple providers you can switch between at any time**.

### Features

- Circular orb at the screen edge: hides by docking when the mouse leaves, shows the DeepSeek icon on hover
- One click captures the current screen (or drag to select a region) and sends it with your question
  to **any** vision-capable model
- **Multiple chat providers and multiple TTS providers** — configure several, switch the active one anytime
- **15 built-in chat presets**: DeepSeek / OpenAI / Claude / Gemini / OpenRouter / SiliconFlow / Grok /
  Kimi / Zhipu GLM / Qwen / Doubao / MiniMax / Ollama / LM Studio, plus fully custom
- **Three protocol adapters**: OpenAI-compatible, Anthropic Messages, Google Gemini
- **Custom API**: just fill in Base URL / auth style / model — you can also override the request path,
  extra headers, and the max-output parameter name
- Conversation history is stored locally; browse, delete, or clear it
- Answers can be spoken automatically or on demand, split into sentence chunks and played while still
  synthesising — **with pause / resume / stop**
- Voice can be **designed from a text description** (MiMo): voicedesign generates it once and freezes it
  into a reference clip, which voiceclone then reuses so the whole reply keeps one consistent timbre
- Models without the "supports images" flag get an explicit downgrade notice — screenshots are never sent silently

### Getting started

```bash
npm install          # skip if already installed
npm run initconfig   # first run: generate config (no API key is ever hard-coded)
npm start
```

If no key is configured yet, open it via the tray icon → Settings… or the ⚙ button at the top-right of the panel.

### Controls

| Action | Effect |
| --- | --- |
| Click the orb | Capture the screen and open the panel |
| Shift + click the orb | Capture a selected region |
| Right-click the orb | Menu (full screen / region / settings / quit) |
| Drag the orb | Move it; on release it snaps to the nearest left/right edge and remembers |
| `Ctrl+Alt+S` | Global hotkey: full-screen capture and ask |
| `Ctrl+Alt+A` | Global hotkey: region capture and ask |
| Panel `Enter` / `Shift+Enter` | Send / newline |
| Panel `Esc` | Close the history drawer / hide the panel |
| Click the tray icon | Show / hide the panel |
| Playback bar ⏸ / ▶ | Pause / resume speech (pausing also gates background synthesis, so it stops burning API calls) |
| Playback bar ⏹ | Stop playback and drop any queued audio |
| ▶ Speak / ⏹ Stop on a message | Speak or stop one individual answer |

If the orb was hidden, bring it back from the tray menu → "Show/hide floating orb".

### Chat providers and custom APIs

#### The three protocol adapters

| Protocol | Request shape | Covers |
| --- | --- | --- |
| `openai` | `POST {baseUrl}/chat/completions`, `Authorization: Bearer`, images as `image_url` blocks | DeepSeek / OpenAI / Kimi / Zhipu / Qwen / Doubao / MiniMax / Grok / OpenRouter / SiliconFlow / Ollama / LM Studio / vLLM / one-api, … |
| `anthropic` | `POST {baseUrl}/v1/messages`, `x-api-key` + `anthropic-version`, images as `image` blocks | Claude |
| `gemini` | `POST {baseUrl}/v1beta/models/{model}:generateContent`, `x-goog-api-key`, images as `inline_data` | Gemini |

The adapters absorb every difference: where the system prompt goes (a system message for OpenAI,
a top-level parameter for Anthropic, systemInstruction for Gemini), role naming (Gemini uses `model`
instead of `assistant`), merging consecutive same-role turns and forcing a leading user turn,
how the thinking switch is expressed, and each vendor's own SSE event shapes.

#### Custom APIs

Pick the "Custom (OpenAI-compatible)" preset, or edit these fields on any provider:

- **Base URL** — e.g. `http://localhost:8000/v1`
- **Auth style** — `Bearer` / `api-key` / `x-api-key` / `x-goog-api-key` / a custom header name / none.
  This exists for Azure OpenAI (the `api-key` header) and for local services that need no auth
- **Custom request path** — defaults to `/chat/completions`; may include a query string, e.g.
  `/chat/completions?api-version=2024-10-21`
- **Extra headers** — a JSON object, e.g. the `HTTP-Referer` OpenRouter asks for
- **Max-output parameter name** — `max_tokens` or `max_completion_tokens` (the latter for OpenAI o / GPT-5 family)

"Test connection" and "Fetch models" in Settings operate on **the unsaved form contents**, so you can try before saving.

#### Capability-driven UI

Every provider carries capability flags; Settings decides which fields to show, and the panel uses them for hints:

- **Supports images** — when unchecked, screenshots are not sent and the panel says so explicitly
- **Supports thinking mode** — only tick this for services that accept a `thinking` parameter (e.g. DeepSeek);
  ticking it wrongly gets rejected by the server
- **supportsVoiceDesign** — currently only MiMo; switching to another TTS provider hides the whole voice-design block

### The two APIs verified against the real service

#### DeepSeek (`https://api.deepseek.com`, OpenAI-compatible)

- Models (measured via `GET /models`): `deepseek-flash`, `deepseek-v4-pro`
- **Only `deepseek-flash` understands images**; `deepseek-v4-pro` is text-only — screenshot Q&A must use flash
- Images are passed as a `content` block array: `{type:"image_url", image_url:{url:"data:image/png;base64,...", detail}}`
- Supports JPEG / PNG / GIF / WebP, detected by content; single image ≤ 32 MiB, request body ≤ 48 MiB
- `detail` may be `low` (scaled to 512×512) / `high` / `original`; roughly ≤ 1024 tokens per image
- **Thinking mode defaults to on with effort=high** and consumes output tokens. This app disables it by default
  (`thinking:{type:"disabled"}`); measured drop from 103 to 27 completion tokens

#### Xiaomi MiMo TTS (`https://api.xiaomimimo.com/v1`)

- `POST /chat/completions` with the `api-key` header
- **The text to speak must go in the `role: "assistant"` message**; putting it in the wrong role produces no speech
- `role: "user"` is an optional instruction used to steer tone, pace, and emotion (it is not spoken)
- Built-in voices: `mimo_default`, `冰糖`, `茉莉`, `苏打`, `白桦`, `Mia`, `Chloe`, `Milo`, `Dean`
- Audio comes back as base64 at `choices[0].message.audio.data`
- Measured latency is close to linear in character count (~55 ms/char) and wav is 6.4× the size of mp3:

  | Text | Format | Audio size | Latency |
  | --- | --- | --- | --- |
  | 14 chars | wav | 130 KB | 1450 ms |
  | 14 chars | mp3 | 20 KB | 1090 ms |
  | 92 chars | mp3 | 150 KB | 5067 ms |
  | 540 chars | wav | **15.2 MB** | **69 s** |

  So this app defaults to mp3 plus sentence chunking (60 chars per chunk by default): the main process
  synthesises while the renderer plays, so the first chunk is audible in roughly 1–2 seconds instead of
  waiting for the whole reply.

##### Designed voices (why not call voicedesign per chunk)

The three TTS models each do one job:

| Model | Purpose | Limitation |
| --- | --- | --- |
| `mimo-v2.5-tts` | 9 built-in voices | no design / cloning |
| `mimo-v2.5-tts-voicedesign` | **generate a voice from a text description** | the `user` message is a **required** voice description and `audio.voice` is **not accepted** |
| `mimo-v2.5-tts-voiceclone` | clone a voice from an audio sample | must pass `audio.voice` = the sample's base64 data URL |

Key measurement: **calling voicedesign twice with the same description does not return the same audio**
(the two samples differed by 0.4–3.8 KB), so calling it per chunk makes the timbre drift between chunks.
This app therefore does:

```
first playback  → voicedesign generates a reference clip from the description → saved to %APPDATA%\...\voices\ref-<hash>.mp3
every chunk after → voiceclone + that reference clip                          → identical timbre throughout
```

The reference is always mp3 (wav would be 6.4× larger) because it is attached to every chunk request.
The hash is derived from description + model, so editing the description generates a new voice while old
files are kept for easy rollback.

Synthesis output was also round-tripped through `mimo-v2.5-asr` as a cross-check, confirming the generated
audio really is intelligible Mandarin speech.

### Layout

```
src/main/main.js        Electron main: orb window / edge animation / hover detection, capture and region
                        select, panel, tray, IPC
src/main/store.js       Config persistence (multi-provider); API keys encrypted with safeStorage (DPAPI);
                        legacy configs are migrated automatically
src/main/history.js     Conversation history (JSON) + screenshot files (PNG) + thumbnails
src/main/providers/     Provider abstraction layer
  index.js                Registry and dispatch; converts history into protocol-agnostic turns
                          (images are read into base64 here)
  presets.js              15 chat presets + 3 TTS presets + voice-description presets
  http.js                 Auth headers, URL joining, SSE reading, consecutive same-role merging
  openai.js               OpenAI-compatible protocol (covers most vendors)
  anthropic.js            Anthropic Messages protocol
  gemini.js               Google Gemini protocol
  tts-mimo.js             MiMo TTS adapter (the wire format still lives in mimo.js)
  tts-openai.js           OpenAI-compatible TTS (/audio/speech returns binary audio)
src/main/mimo.js        MiMo TTS client: synthesis, Markdown cleanup, sentence chunking
src/preload/preload.js  The window.api surface exposed via contextBridge
src/renderer/ball.*     The floating orb (hover icon, dragging, docked state)
src/renderer/panel.*    Chat panel (screenshot attachment, streaming answers, history drawer, audio queue)
src/renderer/capture.*  Region-selection overlay
src/renderer/settings.* Settings UI (provider management, custom API, voice, UI behaviour)
scripts/init-config.js  Generate the initial config (no API key is hard-coded)
scripts/check-chunking.js    Unit check for speech chunking and Markdown cleanup (no Electron needed)
scripts/probe-voicedesign.js Voice design/clone/ASR probe (run under Electron to use the real decrypt path)
scripts/probe-providers.js   Provider-layer verification: custom API against a local mock + real endpoint probe
```

### Building

```bash
npm run build        # package a single-file Windows portable exe into dist/
npm run build:dir    # only produce the unpacked app dir dist/win-unpacked/ (faster, easier to debug)
```

Build output goes to `dist/`, which is git-ignored and never committed.

### Self-check

```bash
npm run selftest
```

It runs, in order: screen capture → send the screenshot to the **active chat provider** for image
understanding → chunked synthesis with the **active TTS provider** → streaming chat → thinking-mode
token comparison. Switch providers and the self-check follows automatically, with no code changes.

Neither the self-check nor `ui-check` takes the single-instance lock, so they can run while the app is running.

Note: keys in the config are DPAPI ciphertext. Any script that reads `config.json` directly and sends
`apiKey` will get a 401 (the ciphertext is sent as the key). To use the real key, go through
`npm run selftest`, which uses the app's own decrypt path.

### Verified behaviour

`npm run selftest` (real screen + real APIs):

```
1) Screen capture   1920x1080 PNG, 437 KB
2) Image understanding  1162 ms, correctly described what was actually on screen
                        (it even recognised the running orb window)
3) Voice and synthesis  designed-voice reference hit cache 54 KB → voiceclone mp3 32 KB / 1722 ms
4) Streaming chat   OK
5) Thinking-mode comparison  off: 28 completion tokens / 785 ms
                             on:  94 reasoning tokens + 126 completion tokens / 971 ms
                             — confirming the decision to disable thinking by default
```

`electron scripts/probe-providers.js` (provider layer; spins up a local OpenAI-compatible mock):

```
Custom API 15/15 passed:
  listModels via a custom Base URL, chatOnce, chatStream chunk reassembly, system-message placement
  image_url blocks sent when images are supported; falls back to plain text plus a "screenshot omitted"
  note when they are not; readable auth error on a wrong key; 404 hint on a wrong path;
  all 15 chat presets and 3 TTS presets construct into complete providers

Real endpoint structure probe:
  Anthropic  403 (structure accepted, key merely invalid)
  OpenAI     SKIP — host unreachable from this machine
  Gemini     SKIP — host unreachable from this machine
  OpenAI TTS SKIP — host unreachable from this machine
```

Reachability was also checked separately: `api.anthropic.com` returns 403 and `api.deepseek.com` returns 401,
while `api.openai.com` and `generativelanguage.googleapis.com` simply time out from this machine.

`npm run ui-check` (renders the three pages into `ui-check/` and runs a real IPC pass):

```
Orb hover       shows the white DeepSeek whale icon; idle is just a blue ball plus a white dot, no icon
Panel           screenshot thumbnail attachment, user bubble, Markdown list and code block, composer all fine
Settings        provider dropdown / add-from-preset / duplicate / delete, protocol and auth style,
                capability checkboxes, voice source and design description all render correctly
Capture delivery  both api.capture.full() and clicking the orb deliver the attachment to the panel
Config save     orb width 72 -> 80 (size 56 -> 64 applied live)
Key safety      Settings only ever receives a mask (like sk-abc...wxyz); on disk it is enc:v1: DPAPI ciphertext
Edge geometry   hidden x=1904 / expanded x=1836, 68 px travel, exactly 8 px peeking at the edge
Voice design    reference clip generated automatically (one tts:voice-ref event); all 3 chunks reuse it
Speech playback playing=true with currentTime actually advancing (it really plays, not just queues)
Pause / resume  paused at t=4.85 -> still 4.85 three seconds later (playback truly frozen)
                chunks stayed 3 -> 3 in the same window (background synthesis was gated too)
                after resuming, t went back to 7.09 and played to the end; done=1 / err=0
Control bar     auto-hides after playback=true; hides immediately on stop=true
Chunk cleanup   code fences / URLs / Markdown markers are not spoken; every chunk <= 60 chars, order preserved
```

### Known limitations

- **Electron hardware acceleration is disabled by default** (`app.disableHardwareAcceleration()`). On the
  development machine we hit "the window exists, isVisible/isAlwaysOnTop are both true, capturePage returns
  complete content, but nothing shows on screen", while an ordinary WinForms window displayed fine at the
  same moment — a GPU presentation failure. The orb is a tiny 2D window, so software rendering is plenty.
  Set `DSA_FORCE_GPU=1` to force hardware acceleration
- Chromium's window occlusion detection and backgrounding are also disabled
  (`CalculateNativeWinOcclusion` / `disable-backgrounding-occluded-windows` / `disable-renderer-backgrounding`):
  a small, edge-docked, mostly-offscren always-on-top window is easily judged "occluded" and stops painting.
  These three are defensive; the actual fix for the issue above was software rendering
- Global hotkeys default to `Ctrl+Alt+S` / `Ctrl+Alt+A`; if another app owns them, change them at
  `globalShortcut.register` in `src/main/main.js`
- The panel and orb use transparent frameless windows; only Windows 11 has been verified
- Speech only supports pause / resume / stop — no speed control or seeking, and resuming restarts the current chunk
- The designed-voice reference clip is cached locally only; changing machine or description regenerates it (~2–3 s)
- **The OpenAI and Gemini endpoints are unreachable from the development machine**, so those two protocols
  have only structural verification (request URL, auth header, body shape) plus the local mock service —
  they were never exercised with a real key. Anthropic and DeepSeek were exercised for real
- **Model names in the built-in presets go stale** as vendors update them; trust "Fetch models" in Settings
- Vendors differ in image support (multiple images, per-image size caps, whether `detail` is honoured);
  this app only models a single "supported / not supported" bit

### Security

- API keys are never written into the source. They live in `%APPDATA%\deepseek-desktop-assistant\config.json`,
  encrypted on save with Electron `safeStorage` (DPAPI on Windows)
- Renderers run with `contextIsolation` on, `nodeIntegration` off, and a strict CSP
- Screenshots are only sent to **the chat provider you currently selected**, and speech text only to
  **the TTS provider you currently selected**. There is no relay of any kind, and nothing goes anywhere else
- Each provider's key is stored independently (the same key configured on two providers means two copies),
  all under the same DPAPI encryption
- Settings only ever returns a masked key, never the plaintext
