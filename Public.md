# 镜译 · 接手说明（Public.md）

## 速查

| 项 | 内容 |
| --- | --- |
| 是什么 | SillyTavern 的浏览器端扩展。主模型照常用原文写正文；回复写完后，镜译把正文翻成目标语言，用不可见边界写回楼层；发给主模型前由生成拦截器去掉译文。另有朗读（有声小说）、实时通话、小助手 |
| 技术栈 | 原生 ES 模块 + CSS，没有依赖、没有打包、没有构建步骤；测试用 Node 自带的 `node --test` |
| 入口 | `manifest.json` → `index.js`（生命周期钩子 `onActivate` / `onDisable` / `onClean`，生成拦截器 `JingyiTranslator_interceptGeneration`）；宿主页面样式 `host.css`（引入 `reading.css`）；控制中心、悬浮窗和弹出的对话框用的 `style.css` 由脚本读进各自的 shadow root |
| 设置存放 | `SillyTavern.getContext().extensionSettings['jingyi-translator']`，`schemaVersion: 13`，读入时由 `core.js` 的 `mergeSettings` 补默认值并迁移旧字段 |
| 公开接口 | `window.__JINGYI__`：`tts`（`status` / `voices` / `speak` / `read` / `stream` / `stop`）、`stt`（`status` / `start`）、`llm`（`status` / `stream`）、`call.connect`、`scene`（`get` / `list` / `onChange`）、`floor.original`。能不能用看 `features` |
| 当前版本 | 0.49.0。版本号写在 `core.js` 的 `APP_VERSION`、`manifest.json`（`version` 和两个 `?v=`）、`package.json`，以及每个模块导入路径的 `?v=` |
| 当前未做 | 场景只记录、界面里还没有用它的功能（配乐、大纲、配图，配图字段关着）；豆包语音、MiniMax 只用于边写边读和通话；TauriTavern 真机和豆包、MiniMax 的真实接口没有实测；翻译连接的「推理强度」对非 OpenAI 官方的模型名不起作用；`使用手册.md`、`VALIDATION.md` 停在 v0.32.3 |

## 仓库结构

```text
MirrorTranslate/
├─ manifest.json            扩展清单：入口、样式、生成拦截器、生命周期钩子
├─ index.js                 运行时：宿主事件、翻译流程、写回、拦截器、全部界面、朗读与通话调度、公开接口
├─ core.js                  设置默认值与迁移、正文分段、双语 / 只留译文的拼装与读回、连接、生成门闸
├─ prompts.js               翻译规范与提示词条目
├─ workflow.js              组装翻译请求和参考资料
├─ processing.js            正文处理方案、内置美化、绑定正则
├─ palette.js               说话人、情绪、招式的配色计算
├─ theme-probe.js           读取聊天背后实际的背景色
├─ scene.js                 每楼场景的格式与合并
├─ helper.js                小助手的提示词与建议校验
├─ mini.js                  悬浮窗的行、剩余时间、日志筛选
├─ diagnostics.js           运行记录：本机存储、脱敏、导出
├─ console-autosave.js      控制中心改了就存
├─ tts.js                   朗读核心：切句、说话人与情绪、Fish 请求、音频拼接
├─ tts-deep.js              分析模式与声学标注规则（含通话的边说边标）
├─ tts-speakers.js          从文字本身认说话人
├─ tts-sanitizer.js         发给配音前去掉 HTML
├─ tts-store.js             音频缓存（IndexedDB）
├─ tts-stream.js            边写边读的切句
├─ tts-cloud.js             豆包语音、MiniMax 的请求与读流
├─ pcm-player.js            边收边放：PCM / WAV 流式播放
├─ call.js                  通话测试：通话流程、通话记录、已连接的应用
├─ host.css / reading.css / style.css   宿主页面样式 / 楼层朗读样式 / 控制中心与悬浮窗样式
├─ jailbreak-default.js     默认前置提示词（空）
├─ capability-contract.json 用到的宿主能力，以及缺了时的退路
├─ validation/              SillyTavern 1.18.0 源码审计快照
├─ scripts/                 本地预览服务
├─ preview.html / reading-preview.html  本地预览页
├─ design/                  界面设计稿
└─ test/                    自动测试
```

<details>
<summary>完整文件列表</summary>

```text
.gitattributes  .gitignore
README.md  Public.md  VALIDATION.md  使用手册.md
manifest.json  package.json  capability-contract.json
index.js  core.js  prompts.js  workflow.js  processing.js  palette.js  theme-probe.js
scene.js  helper.js  mini.js  diagnostics.js  console-autosave.js  jailbreak-default.js
tts.js  tts-deep.js  tts-speakers.js  tts-sanitizer.js  tts-store.js  tts-stream.js  tts-cloud.js
pcm-player.js  call.js
host.css  reading.css  style.css
preview.html  reading-preview.html
scripts/preview-server.mjs  scripts/create-reading-preview.mjs
validation/sillytavern-1.18.0.snapshot.json
design/Baseline.dc.html  design/Connection.dc.html  design/Logs.dc.html  design/Main.dc.html
design/Mini.dc.html  design/MiniStates.dc.html  design/Motion.dc.html  design/Processing.dc.html
design/Rules.dc.html  design/canvas.json  design/jingyi-control-center.html
test/*.test.mjs（41 个文件）
```

</details>

## 加载与数据流

1. **加载**：酒馆按 `manifest.json` 载入 `index.js`。`onActivate` 读设置并迁移，装上入口（魔法棒菜单、扩展设置页的「打开控制中心」、悬浮按钮），注册宿主事件，装好 `window.__JINGYI__`。拦截器挂在 `globalThis.JingyiTranslator_interceptGeneration`。
2. **自动翻译**：
   1. 宿主自己的生成开始时（`GENERATION_STARTED` 之后的 `GENERATION_AFTER_COMMANDS`），打开生成门闸，记下这次的生成类型。
   2. 回复渲染（`CHARACTER_MESSAGE_RENDERED`）的类型对得上，就把这一楼排进翻译。
   3. 读楼层（`readFloor`，「只留译文」的楼层读收起来的双语稿），按提取规则分段。
   4. 组装请求（`workflow.js`）：翻译规范 + 参考资料（角色卡、世界书、近期对话）+ 待译段落 JSON。
   5. 发请求：
      - 跟随酒馆：`context.generateRaw`；
      - 独立连接：`ChatCompletionService.processRequest`；
      - 流式写回和通话：`POST /api/backends/chat-completions/generate`，带 `stream: true`。
   6. 解析回答（容错的 JSON 解析），缺的段落补译。
   7. 拼装写回：
      - 双语：原文段和译文段各用不可见边界包住；
      - 只留译文：`mes` 只留译文，双语稿存进楼层的 `extra`。
   8. 写回后重画楼层并保存聊天，发出 `MESSAGE_UPDATED`。
3. **发给主模型**：宿主调用生成拦截器时，镜译依次做四件事：
   1. 「让主模型给台词标上说话人和情绪」开着时，加上标记要求；
   2. 把「只留译文」的楼层换回原文；
   3. 按译文里的名字强制激活世界书条目；
   4. 去掉译文块。

   拦截器没被调用的旧宿主，由提示词事件（`CHAT_COMPLETION_PROMPT_READY` 等）兜底去掉译文块。
4. **朗读**：
   1. 楼层切句；
   2. 定说话人和情绪：翻译时的标注、分析模式、或者本地认人；
   3. 合成片段，向 Fish（`/v1/tts`、`/v1/tts/stream/with-timestamp`）或 GPT-SoVITS（`/tts`）要音频；
   4. 存进 IndexedDB 缓存，播放时逐句高亮。
5. **边写边读与通话**：
   1. `STREAM_TOKEN_RECEIVED` 把正在写的文字交给 `tts-stream.js` 切句；
   2. 每句向选定的声音（Fish / GPT-SoVITS / 豆包语音 / MiniMax）要音频，`pcm-player.js` 边收边放。
   3. 通话测试（`call.js`）拨号后，模型流式回答（和 `llm.stream` 同一条路），回答交给边写边读；通话记录存在浏览器里。
6. **其他插件**：经 `window.__JINGYI__` 调用，见下面的「公开接口」。

<details>
<summary>边界情况</summary>

**生成门闸**

- 只有宿主自己的生成算主回复：`GENERATION_STARTED` 带选项，随后的 `GENERATION_AFTER_COMMANDS` 类型相同。
- 酒馆助手的 `generate()` / `generateRaw()` 只发一次 `GENERATION_AFTER_COMMANDS`（选项为空，前面没有宿主的 `GENERATION_STARTED`），认作脚本自己的模型调用（`runtime.scriptCall`）：不动门闸、不结束边写边读、不加朗读计数（0.49.0 起）。
- 斜杠命令接管的生成只有 `GENERATION_STARTED`，不开门闸。
- 渲染类型的对应：非流式保存时，宿主把继续以外的类型都报成 `normal`；继续渲染成 `appendFinal`；`first_message`、`command` 不算回复。
- 上一次生成已结束、它的回复还没渲染时又开始新生成：晚到的回复照样翻（`lateReply`），下一次开始时才判定它丢了。
- 流式出错留下的占位楼（空或 `...`）不翻，运行记录写明原因。
- 宿主的停止（不带 id）停下边写边读并清空门闸；酒馆助手的停止带 id，忽略。

**写回**

- 同一楼同一滑动页只允许一个翻译任务。写回前重读楼层，正文变了就不写旧结果；只在正文标签外多了内容时安全合并。
- 「只留译文」的记录按楼层内容认领，不按滑动页号：删除、新建滑动页都不会认错。只留译文之后又被手改的楼层（`diverged`）不再翻译。「恢复本聊天的原文」把它们放回双语。
- 同一聊天被重新通知只是重画：进行中的任务继续，楼层被挪位置时在新位置重翻；真换了聊天就取消任务、挂断通话。

**提示词兜底**

- 提示词事件里看到译文块时照样去掉。只有在宿主自己的提示词里、且拦截器从没被调用过时，才记「宿主没有调用生成拦截器」。
- dry run 和脚本自己的调用（比如小手机读楼层给自己的模型当上下文）里的译文块会被去掉，但不算进上面的判断；脚本请求里去掉过译文时，运行记录只记一条 `host.script-prompt`。

**朗读**

- 同时只响一路：开始新的读会停掉楼层朗读；`tts.stop({ all: true })` 让其他插件停下镜译的一切。
- Fish 经酒馆 CORS 代理时，Key 放在 `api-key` 头里，`Authorization` 留给酒馆登录；TauriTavern 没有代理，直连自己的转发地址。
- 浏览器不让自动出声时停在原位，点一下接着读。

</details>

## 设置与主题

设置在 `extensionSettings['jingyi-translator']`，下表是常用字段；完整默认值见 `core.js` 的 `DEFAULT_SETTINGS`、`DEFAULT_TTS`。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `uiMode` | `'normal'` | 控制中心界面：`normal` 正常模式 / `advanced` 高级模式 |
| `preset` | `''` | 正常模式里最后选的套餐 |
| `theme` | `'day'` | 外观：`day` / `night` / `fresh` / `vampire` / `glass` |
| `autoGeneration` | `true` | 自动接续翻译 |
| `autoSwipe` | `true` | 切换滑动页时补译（跟着 `autoGeneration`） |
| `autoEdit` | `false` | 编辑楼层后自动重译 |
| `streamingWriteback` | `false` | 流式写回（只在独立连接下生效） |
| `translationOnly` | `false` | 只留译文 |
| `apiMode` / `selectedChannelId` / `channels` | `'follow'` / 默认连接 / 一条 | 翻译用哪条连接、保存的连接 |
| `retries` | `1` | 失败后自动重试次数 |
| `bodyTags` | `['story_scene']` | 提取标签 |
| `bodyStartMarkers` | `[]` | 正文起点 |
| `replaceTags` / `excludedTags` | `[]` / `[]` | 替换标签 / 排除标签 |
| `preserveLineRules` / `lyricLineRules` | `''` / `''` | 原样保留白名单 / 歌词行规则 |
| `musicCardRules` | `false` | 音乐卡片规则组 |
| `lyricSing` | `true` | 歌词行朗读时唱出来 |
| `segmentPrefix` / `segmentSuffix` | `''` / `''` | 原文段前后缀 |
| `translationPrefix` / `translationSuffix` | `'{'` / `'}'` | 译文段前后缀 |
| `coloring.speakers` / `.emotions` / `.effects` | `false` | 说话人着色 / 情绪排版 / 特效字 |
| `segmentJump` | `true` | 点正文跳到悬浮窗 |
| `showFloatingButton` / `floatingStyle` | `true` / `'auto'` | 悬浮入口与样式 |
| `floorButtons` | `'line'` | 楼层里的朗读按钮：`line` 每段 / `sentence` 每段加每句 / `off` |
| `tts.enabled` | `false` | 朗读功能 |
| `tts.provider` | `'fish'` | 声音来源：`fish` / `gsv` |
| `tts.mode` | `'off'` | `off` 不分析 / `deep` 分析模式 |
| `tts.intimate` | `'off'` | 亲密场景：`off` / `auto` / `on` |
| `tts.side` | `'translation'` | 朗读语言：`translation` / `source` / `both` / `dialogue_source` |
| `tts.range` | `'all'` | 朗读范围：`all` / `dialogue` / `narration` |
| `tts.autoRead` / `tts.readWhileWriting` / `tts.liveAudio` | `false` / `false` / `true` | 新回复自动朗读 / 边写边读 / 边收边放 |
| `tts.streamVoice` | `'fish'` | 边写边读和通话用的声音：`fish` / `gsv` / `doubao` / `minimax` |
| `tts.callChannelId` | `''` | 通话用的连接，空则和分析模式同一条 |
| `tts.sttProvider` | `'cloud'` | 语音输入：`cloud` 云端转写 / `browser` 浏览器识别 |
| `helper.channelId` / `helper.prompt` | `'follow'` / `''` | 小助手用的连接和提示词 |

浏览器里另存的东西：

| 位置 | 键 | 内容 |
| --- | --- | --- |
| localStorage | `jingyi-translator.diagnostics.v1` | 运行记录（最多 100 条，超出总量时整条淘汰最旧的） |
| localStorage | `jingyi-translator.call-log.v1` | 通话测试的通话记录 |
| localStorage | `jingyi-translator.floating-position.v1`、`jingyi-translator-mini-position`、`jingyi-translator-mini-size` | 悬浮按钮和悬浮窗的位置、大小 |
| IndexedDB | `jingyi-tts` | 生成过的音频（按内容寻址，再听不再请求） |
| 楼层 `extra.jingyi_translation` | — | 每楼的翻译记录：分段规则版本、标注、场景；「只留译文」时还有双语稿 |

**主题**：`theme` 决定控制中心和悬浮窗的配色（CSS 变量 `--jy-*`，在 `style.css`）。说话人颜色不跟主题走：`theme-probe.js` 读取聊天背后实际的背景，`palette.js` 按对比度目标（默认 4.5）算出每个角色的颜色。

## 公开接口

镜译在页面上挂 `window.__JINGYI__`。下面的示例都在装着镜译 0.49.0 的测试酒馆里原样跑过，可以直接贴进酒馆页面的浏览器控制台运行（`stt.start` 要真麦克风，只验证到 `status`）。

| 字段 | 内容 |
| --- | --- |
| `name` / `version` | `'镜译 · 正文翻译器'` / 镜译版本 |
| `ready` | Promise，resolve 成接口本身 |
| `features` | `['tts.speak', 'tts.stream', 'stt', 'llm.stream', 'call.connect', 'floor.original']`，按名字判断能不能用，别按版本号判断 |
| `beta` | 一直是 `true`：按测试版时期写法判断的插件照常能用；新代码只看 `features` |

### 先判断能不能用

```js
const jy = await (window.__JINGYI__?.ready ?? Promise.resolve(null));
if (!jy) {
  console.log('没装镜译：插件照自己的路子走，别报错');
} else {
  console.log(jy.version, jy.features);
  console.log(jy.tts.status(), jy.stt.status(), jy.llm.status());
}
```

| 方法 | 返回 |
| --- | --- |
| `tts.status()` | `{ enabled, provider, hasKey, streamProvider, streamReady, reason, model, voices, busy }`。只用 `tts.stream` 时看 `streamReady`；为 `false` 时 `reason` 是一句可以直接给用户看的中文 |
| `tts.voices()` | `[{ name, aliases, hasOwnVoice }]`：角色表里登记的角色 |
| `stt.status()` | `{ provider, available, reason, secure }` |
| `llm.status()` | `{ connection, streams }`：`streams` 为 `false` 表示通话连接跟随酒馆，要等整段写完才回调一次 |

### 读一段文字：`tts.speak` / `tts.read`

```js
const jy = await window.__JINGYI__.ready;
const reading = await jy.tts.speak({ text: '「今天也来了啊。」\n等你很久了，坐吧。', speaker: '美咲' });
const stopWatching = reading.onProgress(state => console.log(`读到第 ${state.index + 1} 段，共 ${state.total} 段`));
await reading.done;
stopWatching();
```

只要音频、不播放：

```js
const jy = await window.__JINGYI__.ready;
const audio = await jy.tts.speak({ text: '晚安。', speaker: '美咲', play: false });
const blob = await audio.blob();
console.log(audio.format, blob.type, blob.size);
```

| 参数 / 字段 | 说明 |
| --- | --- |
| `text` | 必填，`\n` 分段，一段一次请求；最多 20000 字 |
| `speaker` / `lang` / `emotion` | 可选：按角色名找音色、语言、整段情绪 |
| `analyze` | 默认 `false`；`true` 时先让分析模式的连接标一次说话人和情绪 |
| `play` | 默认 `true`：第一段响起时 resolve；`false` 时全部生成完才 resolve，不打断正在读的楼层 |
| `signal` | 可选，`AbortSignal` |
| 返回的对象 | `playing`、`index`、`total`、`cached`（全是缓存则为 `true`）、`format`、`done`、`blob()`、`download(name)`、`onProgress(fn)`（返回取消订阅的函数）、`pause()`、`resume()`、`stop()` |

### 一边写一边读：`tts.stream` + `llm.stream`

```js
const jy = await window.__JINGYI__.ready;
const controller = new AbortController();
const voice = jy.tts.stream({ speaker: '美咲', signal: controller.signal });
voice.on('state', ({ state }) => console.log('镜译朗读：', state));
const answer = await jy.llm.stream({
  messages: [
    { role: 'system', content: '你正在和用户打电话，只说台词。' },
    { role: 'user', content: '在吗？' },
  ],
  signal: controller.signal,
  onText: soFar => voice.push(soFar),
});
voice.end();
console.log(answer, await voice.done);
```

| `tts.stream({ speaker, lang, emotion, signal })` | 说明 |
| --- | --- |
| `push(text)` | 推「到目前为止的全文」或只推新写出的一截；推全文时新全文要以旧全文开头 |
| `end()` | 写完了：剩下不成句的尾巴也读出来 |
| `cancel()` | 立刻停，在途请求一起中断 |
| `pause()` / `resume()` | 暂停、继续 |
| `on('state', fn)` | `fn({ state, pieces, played, at })`，`state` 是 `buffering` / `speaking` / `paused` / `idle` |
| `state` / `done` | 当前状态；`done` 给 `{ cancelled, pieces, played, requests, skipped, reason, times, failure }` |

`llm.stream({ messages, signal, onText })`：`messages` 是 OpenAI 格式、不能为空；走「朗读 → 更多 → 实时通话 → 通话用的连接」（留空时和分析模式同一条）；选的是存好的连接时真流式，跟随酒馆时写完才回调一次；返回整段回答，出错时 reject，`error.message` 是中文。

### 停下镜译的一切：`tts.stop`

```js
const jy = await window.__JINGYI__.ready;
const wasSounding = jy.tts.stop({ all: true });
console.log('刚才在响吗：', wasSounding);
```

- `stop({ all: true })`：楼层朗读、边写边读、接口读的内容都停，镜译自己的通话测试也挂断；返回刚才有没有在响。
- 不带参数的 `stop()` 只停接口自己读的内容，楼层正在读时不去动它。

### 语音输入：`stt`

```js
const jy = await window.__JINGYI__.ready;
const st = jy.stt.status();
if (!st.available) {
  console.log('语音输入用不了：', st.reason);
} else {
  const mic = await jy.stt.start({ onPartial: text => console.log('正在听：', text) });
  // 用户松手时：
  const said = await mic.stop();
  console.log('听到：', said);
}
```

| 方法 | 说明 |
| --- | --- |
| `stt.start({ lang, onPartial, signal })` | 麦克风打开后才 resolve；打不开时 reject，`message` 是原因 |
| `mic.stop()` | 停止录音并转写，给回文字；没听到东西给空字符串 |
| `mic.cancel()` | 丢掉这段，不转写 |

- `onPartial` 只有「浏览器自带识别」会实时给字。
- 麦克风只能在 https 或本机地址下打开。

### 连上镜译：`call.connect`

```js
const jy = await window.__JINGYI__.ready;
const { app, needs, missing } = jy.call.connect({ app: '示例插件', characters: ['美咲', '老周'], needs: ['tts.stream', 'stt', 'llm.stream'] });
console.log(app, needs);
for (const item of missing) console.log(`${item.title}：${item.reason}（${item.where}）`);
```

- 传 `app`（必填，最长 40 字）、`characters`（最多 60 个）、`needs`（`'tts.stream'` / `'stt'` / `'llm.stream'` 里的几个，不传就都查）。
- 拿回 `{ app, needs, missing }`。`missing` 每项有 `id`（`tts` / `key` / `voices` / `stt` / `llm`）、`need`、`title`、`reason`、`where`，`voices` 项还有 `names`。
- 它只检查，不花钱、不开麦。再调一次就是按当时的设置重新检查。镜译还没启动完时会抛错。

### 场景：`scene`

```js
const jy = await window.__JINGYI__.ready;
const stop = jy.scene.onChange(scene => console.log(`第 ${scene.messageId} 楼：${scene.tone}｜${scene.summary}`));
const last = SillyTavern.getContext().chat.length - 1;
console.log(await jy.scene.get(last));
console.log(await jy.scene.list());
// 不再需要时：stop();
```

- `get(楼层号)`：`{ messageId, tone, place, time, cast, summary }`；没有场景、或者楼层文字在翻译后改过，给 `null`。
- `list({ from, to })`：按顺序给出范围内（默认整个聊天）所有有场景的楼。
- `onChange(fn)`：之后每写下一楼的场景就告诉你，返回取消订阅的函数。
- `tones`：基调的取值（日常、轻松、温馨、浪漫、亲密、悲伤、紧张、悬疑、恐怖、战斗、壮阔）；`apiVersion` 现在是 `1`。

### 楼层原文：`floor.original`

```js
const jy = await window.__JINGYI__.ready;
const chat = SillyTavern.getContext().chat;
const last = chat.length - 1;
console.log(jy.floor.original(last));
console.log(jy.floor.original(chat[last]));
```

| 情况 | 返回 |
| --- | --- |
| 参数 | 楼层号（数字或数字字符串），或楼层的消息对象 |
| 镜译翻译过的双语楼层 | 去掉译文后的原文 |
| 「只留译文」的楼层 | 收在镜译楼层数据里的原文 |
| 「只留译文」之后又被手改的楼层 | 楼层现在的文字（镜译认不出原文） |
| 镜译没写过的楼层 | 原样返回 |
| 没有这层 | `''` |

适合自己读楼层、给楼层算指纹的插件：同一楼在翻译前后读到的是同一段文字。

### 约定

1. 出错一律 reject（或抛错），`error.message` 是中文，可以直接给用户看。
2. Key、连接、音色都是用户在镜译里填的，插件拿不到，也不用管。
3. 镜译不读插件的存档、不写聊天记录；通话测试的记录只在用户自己的浏览器里。
4. 接口只加不改；判断能不能用看 `features`。

## 当前接入情况

**宿主（SillyTavern）**：在 1.18.0 上实测，并按 1.18.0 源码核对过下面用到的接口和事件；更早的版本没测。清单里不写最低版本。

| 用到的 | 必需 | 缺了时 |
| --- | --- | --- |
| `SillyTavern.getContext()` | 是 | 不能用 |
| `getContext().generateRaw` | 是 | 不能用（跟随酒馆的翻译、分析都走它） |
| `getContext().updateMessageBlock` | 是 | 不能用 |
| `getContext().ChatCompletionService` | 否 | 独立连接不可用，只能跟随酒馆 |
| `getContext().getWorldInfoPrompt` | 否 | 翻译不带世界书 |
| `getContext().getRequestHeaders` | 否 | 拉不了模型列表，手填模型名 |
| `extensionSettings.regex` | 否 | 方案照存，但不装渲染用的美化正则 |
| 清单的 `generate_interceptor` | 否 | 用提示词事件兜底，并提醒用户 |
| `getContext().reloadCurrentChat` | 否 | 改用 `updateMessageBlock` 逐楼重画 |
| `/proxy/:url`（`config.yaml` 的 `enableCorsProxy`） | 否 | Fish、豆包、GPT-SoVITS 改为直连允许跨域的转发地址 |
| `/api/extensions/discover`、`version`、`update` | 否 | 用酒馆的扩展管理页更新 |
| `/version`、`mainApi`、流式开关 | 否 | 小助手看不到这几项，按「不知道」报告 |

**外部服务**（Key 都由用户在镜译里填）：

| 服务 | 用在 | 怎么连 |
| --- | --- | --- |
| Fish Audio | 楼层朗读、边写边读、通话 | 默认经酒馆 CORS 代理（Key 放 `api-key` 头）；也可以填转发地址直连 |
| GPT-SoVITS（`api_v2.py`） | 楼层朗读、边写边读、通话 | 默认经酒馆 CORS 代理；每句一个请求，排队逐个执行 |
| 豆包语音（火山引擎） | 边写边读、通话 | Key 过不了浏览器跨域检查，只能经酒馆代理；TauriTavern 要填转发地址 |
| MiniMax | 边写边读、通话 | 浏览器直连，不用代理 |
| 转写（SiliconFlow / Groq / OpenAI / 自定义） | 语音输入 | 浏览器直连上传录音；录音不能经酒馆代理（代理会把 multipart 表单重新序列化成 `{}`） |
| 浏览器自带识别 | 语音输入 | Chrome 的识别走谷歌服务，国内网络常连不上 |

**宿主变体与其他插件**：

| 对象 | 情况 |
| --- | --- |
| TauriTavern | 识别 TauriTavern 页面后不走 `/proxy/`，提示填转发地址；只有单元测试和无头预览，真机没跑过。安卓正式版不允许页面访问 `http://`，本机 GPT-SoVITS 和局域网转发连不上 |
| 酒馆助手 | 不依赖。它的 `generate()` / `generateRaw()` 被认作脚本自己的模型调用，不影响自动翻译和边写边读 |
| 通用通讯终端 V4（小手机） | 能同时用。它的「自动主动消息」按楼层文字记指纹，要打配套补丁（改用 `floor.original` 读楼层）才不会因为镜译翻译而丢消息 |
| 开着登录保护（`basicAuthMode`）的酒馆 | 经代理时 Key 不放 `Authorization`，不会弹出登录框 |

## 开发与验证

| 命令 | 做什么 |
| --- | --- |
| `npm run check` | 用 `node --check` 检查各模块语法 |
| `npm test` | 跑全部自动测试（`node --test`，目前 998 项） |
| `npm run validate` | 上面两步一起跑 |
| `npm run preview` | 起本地预览服务（`scripts/preview-server.mjs`）：模拟酒馆、翻译模型、Fish、豆包、MiniMax，打开 `preview.html` 看控制中心、悬浮窗和楼层 |

**改代码时**

1. 先读工作日志 `AGENT_LOG.md` 末尾几条了解背景。它和界面规约 `DESIGN.md` 都由作者保管，不在仓库里。
2. 界面和动效按 `DESIGN.md` 的规约做，规约要改先提方案。
3. 纯逻辑放进对应模块并写测试；`index.js` 只做调度和界面。
4. 发版时把版本号改全：`core.js` 的 `APP_VERSION`、`manifest.json`、`package.json`、所有导入路径的 `?v=`。

**验证方式**

1. Claude 自测：
   - `npm run validate` 全过；
   - 改界面的，在本地预览里用桌面和手机宽度各看一遍；
   - 和宿主事件、其他插件有关的，搭一个隔离的测试酒馆实测。做法：数据目录放在临时目录，把镜译副本放进用户扩展目录、换个文件夹名，并停用全局的镜译；同名时酒馆仍从全局目录取文件。模型和声音接本机模拟服务。
2. 常夜灯在自己的酒馆里验收。
3. 验收通过后更新 README.md 和本文件。
