# DeepSeek 桌面助手

桌面贴边悬浮球：一键截图向 DeepSeek 提问，回答用小米 MiMo 语音朗读。

- 屏幕边缘的圆形悬浮球，鼠标移开自动贴边隐藏，悬停时显示 DeepSeek 图标
- 点击即截取当前屏幕（或框选局部区域），连同问题一起发给 DeepSeek 视觉模型
- 对话记录本地持久化，可翻阅、删除、清空
- 回答可自动 / 手动用小米 MiMo TTS 朗读（按句分块，边合成边播放），**支持暂停 / 继续 / 停止**
- 音色可用**文字描述设计**：用 `mimo-v2.5-tts-voicedesign` 生成一个贴合 DeepSeek 气质的专属音色，
  固化成本地参考音频后由 `voiceclone` 复用，保证整段朗读音色统一
- 设置界面可切换 DeepSeek 与小米 MiMo 的 API Key、音色来源、音色描述与界面行为

## 运行

```bash
npm install          # 已安装可跳过
npm run initconfig   # 首次运行：把 API Key 写入配置（只写一次，不覆盖已有的）
npm start
```

设置里如果还没填 Key，点托盘图标 → 设置… 或面板右上角 ⚙ 填写。

## 操作方式

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

## 已核实的两套接口

### DeepSeek（`https://api.deepseek.com`，OpenAI 兼容）

- 模型（`GET /models` 实测）：`deepseek-flash`、`deepseek-v4-pro`
- **只有 `deepseek-flash` 支持图像理解**，`deepseek-v4-pro` 是纯文本 —— 截图提问必须用 flash
- 图片以 `content` 块数组传递：`{type:"image_url", image_url:{url:"data:image/png;base64,...", detail}}`
- 支持 JPEG / PNG / GIF / WebP，格式按内容判断；单图 ≤ 32 MiB，请求体 ≤ 48 MiB
- `detail` 可取 `low`(缩放到 512×512) / `high` / `original`；每张图最多约 1024 token
- **思考模式默认开启且 effort=high**，会占用输出 token。本程序默认关闭
  （`thinking:{type:"disabled"}`），实测从 103 降到 27 completion tokens

### 小米 MiMo TTS（`https://api.xiaomimimo.com/v1`）

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

#### 文字设计音色（为什么不是每块都调 voicedesign）

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

## 结构

```
src/main/main.js        Electron 主进程：悬浮球窗口/贴边动画/悬停检测、截图与框选、面板、托盘、IPC
src/main/store.js       配置持久化；API Key 用 safeStorage(DPAPI) 加密
src/main/history.js     对话历史（JSON）+ 截图文件（PNG）+ 缩略图
src/main/deepseek.js    DeepSeek 客户端：/models、非流式、SSE 流式、图像消息构造
src/main/mimo.js        MiMo TTS 客户端：合成、Markdown 清洗、按句分块
src/preload/preload.js  contextBridge 暴露的 window.api
src/renderer/ball.*     悬浮球（悬停显示 DeepSeek 图标、拖动、贴边态）
src/renderer/panel.*    对话面板（截图附件、流式回答、历史抽屉、语音播放队列）
src/renderer/capture.*  框选遮罩层
src/renderer/settings.* 设置界面（两套 API Key、模型、音色、界面行为）
scripts/init-config.js  首次生成配置（不硬编码任何 Key）
scripts/check-chunking.js    语音分块与 Markdown 清洗的单元校验（不依赖 Electron）
scripts/probe-voicedesign.js 音色设计/克隆/ASR 的接口探针（用 Electron 跑，走真实解密路径）
```

## 自检

```bash
npm run selftest
```

会依次验证：屏幕捕获 → 截图发给 DeepSeek 图像理解 → MiMo 分块合成 → 流式对话 → 思考模式 token 对比。

自检与 `ui-check` 不参与单实例锁，所以应用正在运行时也能跑。

注意：配置里的 Key 是 DPAPI 密文，任何直接读 `config.json` 拿 `apiKey` 去请求的脚本都会 401
（密文被当成 Key 发送）。要用真实 Key 请走 `npm run selftest`，它经由应用自身的解密路径。

## 已验证的行为

`npm run selftest`（真实屏幕 + 真实接口）：

```
1) 屏幕捕获        1920x1080 PNG, 437 KB
2) 图像理解        1162ms 正确描述出屏幕实际内容（还认出了正在运行的悬浮球窗口）
3) 音色与合成     设计音色参考命中缓存 54 KB → voiceclone 合成 mp3 32 KB / 1722ms
4) 流式对话        正常
5) 思考模式对比    关闭: 28 completion tokens / 774ms
                   开启: 62 reasoning tokens + 91 completion tokens / 1091ms
                   —— 印证了默认关闭思考模式的取舍
```

`npm run ui-check`（渲染三个页面并把渲染结果存到 `ui-check/`，同时跑一遍真实 IPC 流程）：

```
悬浮球悬停    显示 DeepSeek 鲸鱼图标（白色）；常态只有蓝球 + 白点，无图标
面板          截图缩略图附件、用户气泡、Markdown 列表与代码块、输入区均正常
设置          两套 API Key / 模型 / 音色来源 / 音色描述 / 界面选项渲染正常
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

## 已知限制

- 全局快捷键默认 `Ctrl+Alt+S` / `Ctrl+Alt+A`，若被其他软件占用可在 `src/main/main.js` 的
  `globalShortcut.register` 处修改
- 面板与悬浮球使用透明无边框窗口，仅验证了 Windows 11
- 语音只有暂停 / 继续 / 停止，没有倍速与进度拖动；暂停后从块首继续
- 设计音色的参考音频只在本地缓存，换机器或改描述会重新生成（首次约 2–3 秒）
- 未提供打包安装程序，用 `npm start` 运行；如需 `electron-builder` 可自行添加

## 安全

- API Key 不写进源码，存在 `%APPDATA%\deepseek-desktop-assistant\config.json`，
  保存时用 Electron `safeStorage`（Windows 下为 DPAPI）加密
- 渲染进程开启 `contextIsolation` / 关闭 `nodeIntegration`，并设置了 CSP
- 截图只在提问时发送到 `api.deepseek.com`，语音文本只发送到 `api.xiaomimimo.com`
- 设置界面只回传 Key 的掩码，不回传明文
