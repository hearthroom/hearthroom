# 写卡指南

本指南说明角色卡的组成、两种聊天页的差异、规则与脚本的写法，以及从其他平台导入时的注意事项。

## 卡片的组成

| 字段 | 说明 |
|---|---|
| 名称、竖版背景、横版背景（选填） | 竖图也用于 PNG 导出和聊天头像。 |
| 简介 | 榜单卡片上的摘要。 |
| 人设 | 角色的身份、说话方式与世界观。 |
| 开场白 | 对话的第一条消息，可设置多个备选。 |
| 世界书 | 按关键词触发的补充设定。 |
| 规则 | 正则表达式规则，将回复中的特定文字转换为版面、状态栏或按钮。 |
| 聊天页 | 卡片使用的聊天页：沙箱或传统。新卡默认为沙箱。 |

卡片保存后，编辑页右侧的“对话测试”面板即可直接对话。在宽屏幕上，拖动面板左缘的把手可调整预览宽度。

## 聊天页

两种聊天页使用相同的界面（顶栏、消息、输入区、面板），差异在于卡片的规则与脚本在何处运行。

### 沙箱

卡片的画面与脚本在独立于站点的隔离页面中运行。

- 样式与脚本可修改整个聊天画面。
- 脚本无法访问玩家的登录状态。
- 发送、重新生成等会消耗点数的动作，只响应玩家本人的点击。

### 传统

规则直接应用在站点的聊天页上。仅在既有卡片于沙箱中运行异常时使用。

### 切换

在编辑页“基本”分区的“聊天页”选项切换。既有卡片切到沙箱后，打开“对话测试”确认功能栏、开场白内的面板、浮动按钮、菜单与各面板的显示是否与之前一致。多数卡片无需修改；若有效果缺失，参考“从传统页迁移”。

### 侧边栏

贴在画面左右的固定按钮栏如果压到消息，聊天页会自动把对话栏往内收，让消息不被遮住。沙箱与传统聊天页都适用。

自动判断只处理贴齐画面边缘、宽度约 48px 以内的栏；全屏弹窗、浮在中间的面板与较宽的栏不处理。在侧边栏的最外层元素设置 CSS 变量 `--lt-dock` 可覆盖判断，写在元素的 `style` 属性上在各种卡片格式都有效：

| 值 | 效果 |
|---|---|
| `left`／`right` | 视为停靠在该侧的侧边栏。不必贴齐边缘，宽度上限放宽到对话栏的 30%。 |
| `none` | 不为这个元素让出空间。写在 `:root` 上则整张卡都不自动调整（SillyTavern 格式的卡片样式只作用于消息内，`:root` 无效）。 |

```html
<div id="my-sidebar" style="position: fixed; left: 0; top: 30%; --lt-dock: left;">…</div>
```

让出空间后对话栏宽度如果少于原本的 75%，则不调整。实际让出的宽度写在 `<html>` 的 `--lt-canvas-dock-left`、`--lt-canvas-dock-right`（未调整时不存在），可用来对齐卡片自己的元素。

## 规则

每条规则由“查找”与“替换”组成。回复文字在显示前依次应用所有规则。

### 查找

固定字符串（如 `《状态栏》`）或正则表达式（如 `/<status>([\s\S]*?)<\/status>/g`）。使用正则表达式时，替换内容中的 `$1`、`$2` 对应捕获组。

### 替换

任意 HTML，可包含 `<style>` 与 `<script>`。所有规则的 `<style>` 合并为一份样式表应用；每段 `<script>` 每张卡执行一次。

### 功能栏

规则编辑器中的“功能栏”是固定显示在消息列表上方的内容，只对玩家显示，不会发送给模型。一般做法是在此放置触发词（如 `【状态栏】【美化】`），再由规则展开为实际的面板。

### 宏

| 宏 | 值 |
|---|---|
| `{{user}}` | 玩家的称呼 |
| `{{char}}` | 角色名称 |

### 限制

- 单条规则上限 128 KB。
- 整份规则超过上限时，编辑器会显示超出的量。

规则编辑器的“测试”栏可粘贴示例回复，即时查看应用结果。

## 沙箱作者 API

沙箱页提供固定的节点属性与 `sdk` 对象，与魅魔岛（MMD）新版沙箱相同，同一份脚本可在两个平台运行。

### 节点

以 `data-chat` 属性选取节点，不要依赖 class 名称。

| 选择器 | 说明 |
|---|---|
| `[data-chat="root"]` | 聊天画面的根节点。`data-theme` 为 `dark`／`light`；`data-composer` 表示输入区是否显示。 |
| `[data-chat="message"]` | 一条消息。`data-from` 为 `ai`／`user`；`data-state` 为 `pending`／`streaming`／`done`；`data-msg-id` 为服务器端的消息 ID。 |
| `[data-chat="message-body"]` | 消息正文（应用规则后的 HTML）。 |
| `[data-slot="statusbar"]` | 功能栏。 |
| `[data-slot="left"]`／`[data-slot="right"]` | 左右侧边栏的位置。放在这里的内容视为停靠在该侧的侧边栏，对话栏会让出空间（见“侧边栏”）。 |
| `[data-chat="author-stage"]` | 作者舞台。`sdk.stage.open('content')` 覆盖消息区，`open('full')` 覆盖整页。 |
| `[data-chat="input"]` | 输入框。 |
| `[data-chat="composer"]` | 输入区。 |

### CSS 变量

颜色与尺寸由 `--chat-*` 变量定义（如 `--chat-bg`、`--chat-text`、`--chat-accent`、`--chat-bubble-ai-bg`）。在根节点覆盖即可整体换色。

### sdk

| 方法 | 说明 |
|---|---|
| `sdk.input.get()` / `set(text)` / `add(text)` / `insert(text)` / `clear()` / `focus()` / `blur()` / `getCursor()` / `setCursor(pos)` | 读写输入框。 |
| `sdk.composer.show()` / `hide()` / `visible()` | 显示或隐藏输入区。 |
| `sdk.message.send(text)` | 以玩家身份发送消息。若不是在玩家的点击事件中调用，会先向玩家确认。 |
| `sdk.message.edit(id, text)` | 改写指定消息并重发。同样需玩家确认。 |
| `sdk.save.get(key)` / `set(key, value)` / `remove(key)` / `keys()` | 存档。每张卡每位玩家最多 10 个 key；key 限字母数字、`_`、`-`；单值上限 64 KB；跨设备保留。 |
| `sdk.cache.get(key)` / `set(key, value)` / `remove(key)` | 暂存。仅在本次页面加载期间有效。 |
| `sdk.stage.open(mode)` / `close()` / `el()` / `visible()` | 作者舞台。 |
| `sdk.role.get()` | 角色名称与头像。 |
| `sdk.user.get()` | 玩家称呼、头像与界面语言（`locale`，例如 `zh-Hans`）。 |
| `sdk.text.convert(text)` / `sdk.text.ready()` | 把脚本自己画的字转成玩家的简繁，跟页面转换回复的方式相同；卡片语言跟玩家同一种字形时原样返回。字典载入之前 `convert` 原样返回；`ready()` 在载入完成时完成，不需要转换时立刻完成。 |
| `sdk.model.get()` | 玩家当前选择的模型：`{name, cost}`，`name` 是模型名（顶栏那个「模型名 · 线路名」），`cost` 是下一轮预估的点数（动态计价是区间，例如 `127–251`）。平台还没提供时两个都是空字符串。打开模型列表请点输入区的模型键。 |
| `sdk.generation.get()` | 这一轮在等什么：`{phase, since}`。`phase` 是 `idle`、`preparing`（刚发送、还没有任何响应）、`summarizing`（平台在整理剧情，挡在第一个字前，可能几十秒）、`thinking`（模型在思考、正文还没来；不思考的模型没有这段）或 `writing`（正文流式输出中）；`since` 是进入这个阶段的时间（毫秒）。只有阶段，不含思考内容。另有 `outcome`：上一轮没正常写完时，聊天页在那一条下面画的那张卡，`{kind, label, sub, actions}`；正常结束或生成中是 `null`。`kind` 是 `model-error`、`network-error`、`server-error`、`rate-limit`、`quota`（积分不足）、`filtered`、`length-cap`、`stopped`、`compact-retryable`、`outcome-unconfirmed`（结果还在路上，没有按键，好了会自己出现）或 `interrupted`（Agent 这一轮还没跑完）；`label`、`sub` 是那张卡上玩家语言的文字；`actions` 是 `[{action, label}]`，`action` 只会是 `retry`、`continue`、`switch-model`、`model-settings`、`capacity`、`refresh`、`retry-stream-off`、`edit-message`、`switch-lane`、`resend-traditional`。后四个只出现在 `filtered` 卡上：`retry-stream-off` 先关闭这段对话的流式输出再重试，`edit-message` 打开被拦下的那条消息来修改（发送后取代它），`switch-lane` 打开模型菜单并停在当前模型的其他线路，`resend-traditional` 把被拦下、含简体字的那条消息整句转成繁体后直接取代它发送（同一条只给一次）。 |
| `sdk.generation.act(action)` | 按那张卡上的一个按键（`outcome.actions` 里的 `action`），效果跟玩家点平台那张卡一样：重试沿用同一句，不会多发一条。只能在玩家点击的当下调用（否则 `UNAUTHORIZED`，不会询问）；卡上没有这个按键 `INVALID_ARGS`；生成中 `BUSY`；每分钟 3 次。返回 Promise。 |
| `sdk.archive.list()` / `save(title?)` / `fork(messageId)` / `open(id)` / `start(opening?)` / `rename(id, title)` / `remove(id)` | 平台的对话存档（每张卡最多 20 段，含当前这段，跨设备）。`open` 读档（原本的进度原样留在列表里）；`save` 把当前进度留一份并命名，返回 `{id, current}`；`fork` 从某一条（气泡的 `serverId`）另开一段；`start` 另开新档（0＝主开场、1..＝替代开场）；`list` 返回 `{items, count, limit}`，每行有 `id, title, isCurrent, messageCount, lastMessage, createTime, lastUpdateTime`。会改变存档的操作请在玩家点击当下调用，用卡片自己的确认画面；不在点击当下调用时，页面会先问玩家。 |
| `sdk.on(event, handler)` | 订阅事件。 |
| `sdk.debug.log(...args)` | 写入调试面板。在网址加上 `?sdkDebug=1` 可显示面板。 |

### 事件

| 事件 | 时机 |
|---|---|
| `ready` | 既有消息全部挂载完成后触发一次。 |
| `message:new` | 新消息创建。 |
| `message:mount` | 消息节点挂载到画面。 |
| `message:stream` | 流式输出更新。 |
| `message:done` | 消息完成。 |
| `message:unmount` | 消息节点移除。 |
| `input:change` | 输入框内容变更。 |
| `conversation:switch` | 切换对话（读档、存档、分叉、另开新档之后）。载荷 `{ conversationId }`。 |
| `theme:change` | 深浅色切换。 |
| `back` | 玩家按下返回。 |
| `stage:close` | 作者舞台关闭。 |
| `dispose` | 页面即将卸载。 |
| `model:change` | 玩家换了模型，或下一轮的点数变了（上下文长度、思考深度）。载荷同 `sdk.model.get()`。 |
| `generation:phase` | 这一轮等待的阶段变了。载荷是 `{phase, since}`；不补发，晚到的脚本请调用 `get()`。 |
| `generation:outcome` | 上一轮的结局变了（失败卡出现、玩家重试后收起）。载荷同 `sdk.generation.get().outcome`，可能是 `null`；不补发。 |

### 运行规则

- 打开页面时，每条既有消息依次触发 `message:new`、`message:mount`、`message:done`，最后触发 `ready`。
- 在消息挂载后才订阅 `message:mount` 或 `message:done` 的处理函数，会收到已挂载消息的补发。
- 事件处理函数内的 `document.querySelector` 只搜索该条消息；处理函数外为一般的 `document`。
- 脚本无法对外部网址发出请求。外部 `<script src="https://…">`、图片与字体可正常加载。

### 错误码

| 错误码 | 说明 |
|---|---|
| `UNAUTHORIZED` | 玩家拒绝了需要确认的操作。 |
| `RATE_LIMITED` | 调用过于频繁。 |
| `INVALID_ARGS` | 参数不合法。 |
| `HOST_DENIED` | 宿主页拒绝此操作。 |
| `BUSY` | 正在生成中。 |
| `LIMIT_REACHED` | 对话存档已满；`err.data` 是 `{ count, limit }`，请玩家先删一段。 |
| `NOT_SUPPORTED` | 当前环境不支持此功能。 |

## 从传统页迁移

传统页的规则直接应用在站点的聊天页上，作者常用的选择器为 `.mes`（消息）、`.mes_text`（正文）、`.mes.Ai`／`.mes.User`（发言者）、`#msglistview`（列表）、`.chat-scope-box`（对话区）。这些选择器在沙箱页中同样存在。

- 只使用样式与文字替换的卡片无需修改。
- 以 `<img onerror="…">` 启动脚本的做法在沙箱中可用；放在功能栏或开场白中的引擎片段都会被执行。
- 直接读写站点页面其他区域的脚本，改用 `sdk`。
- `localStorage` 在沙箱中可用，但数据只存在卡片自己的源下；需要跨设备保留时改用 `sdk.save.*`。

## 导入

| 来源 | 方式 |
|---|---|
| SillyTavern | 将 PNG 或 JSON 角色卡拖入“基本”分区。人设、开场白、世界书与正则脚本自动填入；PNG 内的立绘用作竖版背景；另附主背景时优先采用主背景。 |
| 魅魔岛（MMD）三件套 | 分别导入规则文件（含 `chatVersion`）、开场白与人设。标记为新版沙箱的规则文件会自动选取沙箱聊天页。 |

导入后在“对话测试”确认显示无误，再保存并发布。

## 常见问题

| 现象 | 处理 |
|---|---|
| 打开卡片后画面空白十余秒 | 首次加载沙箱页的资源较慢，之后由缓存加速。超过 20 秒仍空白时会出现提示，刷新即可。 |
| 卡片的导览或遮罩覆盖画面、无法滚动 | 这是卡片自带的教学层，点它的“跳过”。 |
| 脚本没有反应 | 在网址加上 `?sdkDebug=1` 打开调试面板，查看脚本错误与 `sdk.debug.log` 的输出。 |
| 存档失败 | 确认 key 只含字母数字、`_`、`-`，单值未超过 64 KB，且该卡的 key 数未达 10 个。 |
| 消息两侧比预期窄 | 卡片中贴齐边缘的元素被判定为侧边栏。在该元素加上 `--lt-dock: none`。 |

## 分享图片与文案

卡片脚本可以在玩家点击按钮后分享图片与文案。HTTPS 卡片框架由宿主委派 `web-share` 与 `clipboard-write`：`navigator.share` 可接收预先准备的图片 `File` 与文字；`navigator.clipboard.write` 搭配 `ClipboardItem` 可写入 PNG，`navigator.clipboard.writeText` 可写入文案。这些是浏览器能力，不是新增的 `sdk` 方法或 HTTP 端点。

请在点击前准备好文件，在点击处理函数内直接调用，保留用户激活状态。提供操作前先检查 `navigator.share`、`navigator.canShare({ files: [file] })`、`navigator.clipboard.write` 与 `ClipboardItem`。支持情况取决于浏览器、操作系统、权限与接收 App，分享后不保证图片和文字都保留。请捕获拒绝与取消；不支持或被拒绝时提供下载图片与可选取的文案，取消后不要自动重开分享面板。宿主不委派 `clipboard-read`。本地不透明来源的预览仍可能拒绝调用，请在目标设备的实际跨来源卡片上验证。

## 带情境的分享链接

卡片脚本可以生成一条带情境码的分享链接：朋友从这条链接打开卡片时，脚本读得到同一个码，卡片就能做出“你朋友选了这个，换你”。`sdk.share.link(code)`（普通卡为 `window.stage.share.link`）同步返回这张卡的分享链接：卡片页 `/cards/<number>`，带着已登录玩家的推荐码，给了情境码就再加上 `?share=<code>`。请在点击前生成链接，在点击处理函数内交给 `navigator.share`。

朋友那一端用 `sdk.share.context` 读回情境码；没有，或正在看自己过去的对话时是 `null`。情境码只收 1–64 个英文字母、数字与 `.`、`_`、`-`，开头须为字母或数字；不合规则时沙盒卡抛出 `SHARE_CONTEXT_INVALID`，普通卡得到 `null`。平台只负责送达：情境码不会送进模型、不含玩家数据，而且任何人都能手动输入，请只接受卡片自己定义的码。朋友是否已有存档由卡片判断（例如 `sdk.archive.list()`；游客没有存档）。

`sdk.share.audience` 表示谁能打开这条链接：`author`（仅自己可见的卡，新朋友打不开）、`link` 或 `public`。平台开关关闭时 `sdk.share.enabled` 为 false，`context` 为 `null`，`link()` 返回不带情境的普通链接。`sdk.share.qr(text)` 返回 `{ size, path }`（`size` × `size` 格的 SVG path），可画进分享图。推荐码较晚取得时会触发 `share:change`。作者可以用 `?mode=source&share=<code>` 在草稿上测试。


## 可靠的消息历史

页面作者 API 提供沙盒卡的 `sdk.history` 与普通卡的 `stage.history`。先检查 `capabilities().available`；旧宿主和预览可能不支持。`list({cursor,revision,content:true})` 只读取当前玩家、当前卡片、当前会话；所有分页必须沿用第一页的 revision；累积每一页，直到收到 `complete:true` 的最后一页，才能使用完整列表。

`onChange(callback)` 返回取消订阅函数，从未 mount 或已 hollow 的消息被真正删除时仍有事件，viewport unmount 不表示删除。收到第一部分事件时，先将派生状态标为待确认，重新获取完整列表后再计算。失效游标、reset 或 unavailable 表示未知，不是空历史。

可选正文只含已终止消息的可见原文，不含 thinking、生成中的正文或被 moderation 隐藏的内容；`item.complete` 不把部分或失败回复当成功。revision 和不透明 ID 不是玩家身份。

其他设备在前台每 15 秒以及回到前台时检查；离开卡片时取消订阅。

## 投票、共斗计数与分享回流

在 `rules.json` 的 `sharedState` 里声明的投票和计数器，由所有玩这张卡的人共用。`sdk.shared`（普通卡为 `window.stage.shared`）负责读写：

- `read(keys)` 接收一个 key 或最多 16 个，返回 `{ [key]: { kind: 'poll', counts, total, mine? } | { kind: 'counter', total, mine?, goal?, reachedAt?, previous? } }`。未声明的 key 不会出现在结果里；`mine` 是玩家自己投的选项或贡献，游客没有；`previous` 是上一期的总数。
- `vote(key, option)` 返回 `{ mine }`。玩家可以改票，每天最多 10 次。
- `add(key, delta)` 加上 1 到该计数器 `maxStep` 之间的整数，返回 `{ total, mine, reachedAt }`。
- `leaderboard(key, { limit })` 返回 `{ items: [{ rank, name, value }], mine? }`：本期贡献最多的玩家（默认 10 名，最多 50 名），显示公开昵称，不列出测试账号。

所有人都能读；写入需要已登录并且玩过这张卡的玩家。数字不会主动推送给卡片，请自行重新读取，间隔至少 10 秒。

分享回流基于分享链接。`sdk.share.tallyLink(code, pollKey)` 为声明了 `share: true` 的投票生成带平台短码（`?share=~XXXXXXXX`）的链接。这是异步调用，请在点击前准备好；同一组情境码和投票会拿到同一条链接，每位玩家每天最多 20 条，链接 90 天内有效。朋友打开后，`sdk.share.context` 是情境码，`sdk.share.poll` 是可以回答的题目 `{ key, options }`（没有时为 `null`），用 `sdk.share.respond(option)` 回答。分享者用 `sdk.share.results()` 读取自己发出的链接，每条是 `{ context, pollKey, total, counts, updatedAt }`：`total` 实时更新，`counts` 要有 3 位朋友回答才会出现，每天更新一次。卡片不会知道是谁分享、谁回答。卡片可以根据这些数字解锁卡内内容，但不会因此发放平台积分。

两种页面使用同一组错误码：`SHARED_DISABLED`（平台或作者已暂停）、`NOT_DECLARED`、`OPTION_INVALID`、`NOT_ELIGIBLE`（还没玩过，或回答自己的链接）、`UNAUTHORIZED`（未登录）、`RATE_LIMITED`（稍后再试）、`LIMIT_REACHED`（`err.data.reason` 为 `goal` 或 `limit`）、`HOST_DENIED`（旧版游玩页；查看过去的对话或审核试玩时只能读）。作者试玩（`?mode=source`）和测试账号各有自己的一份数字，不会混进玩家的；可以在编辑页的“玩家投票与计数”或用 `hearthroom card state` 查看、暂停和清零。
