# 开发者文档

Hearthroom API 可让你浏览社区角色卡、寻找作者、读写评论，并管理自己的收藏、关注与通知。

本页包含两份 OpenAPI 3.1 参考文档：

- **Hearthroom 社区 API**（`docs/community-openapi.json`）：网站的 `/v1` 端点，提供社区浏览与会员社交功能。
- **服务集成 API**（`docs/integration-openapi.json`）：网站与内嵌聊天客户端使用的身份、角色卡创作、媒体及对话接口。这些请求会送往所连接服务的 API 源站地址。

路径、字段名称、权限范围（scope） 与操作标识符保持与现有集成契约兼容。服务可逐步实现支持的功能分组；客户端调用可选操作前，必须先检查服务声明的功能。本文档说明集成接口，不涵盖特定服务的部署设置或商业条款。

## 快速开始

公开浏览不需要登录：

```sh
curl 'https://hearthroom.club/v1/cards?zone=en&sort=new&limit=12'
curl 'https://hearthroom.club/v1/tags?zone=en&limit=12'
```

角色卡列表返回 `items`、`hasNext`、`limit`、`offset`。使用角色卡的 `id` 读取详情与评论。作者链接使用作者的公开 `handle`。

## 社区请求与身份验证

| 主题 | 惯例 |
|---|---|
| 基础 URL | `https://hearthroom.club`；文档中的路径以 `/v1` 开头。自行架设的站点使用自己的源站地址。 |
| 公开读取 | 标记为**无需验证**的端点接受匿名请求。选择性身份验证可能影响可见内容与查看者专属字段。 |
| 会员请求 | 使用经授权登录 Hearthroom 后获取的当前访问令牌，发送 `Authorization: Bearer <access_token>`。仅有浏览器 Cookie 无法验证这些端点。本 API 不签发独立的开发者密钥。 |
| 请求体 | 端点定义请求体时，请以 `Content-Type: application/json` 发送 JSON。 |
| 显示语言 | 角色卡与作者浏览接受 `lang`；角色卡文本未指定时，依序采用第一个 `Accept-Language` 值、中文。 |
| 内容语言 | `zone` 以 `zh`、`en`、`ja`、`ko` 或 `all` 筛选看板。默认为 `zh`；与显示语言分开。 |
| 标识符 | 角色卡 `id` 与会员 `handle` 为公开标识符。请将标识符视为不透明值，并使用 API 返回的值。 |
| 时间戳 | 数字时间戳使用 Unix 毫秒。评论 `createTime` 为 ISO 8601 字符串。 |

已验证请求代表当前登录的会员操作。调用方不可通过在请求加入 ID 来选择其他会员。私有结果不可存入共享缓存。

## 浏览与分页

角色卡搜索与看板筛选使用 `GET /v1/cards`。重复 `tag` 要求符合所有所选标签分组；`hide` 是以逗号分隔的分类键列表。明确选择的标签优先于隐藏分类。`author` 筛选使用公开 handle，并忽略 `zone`。

角色卡、标签与作者列表使用 `offset` 与 `limit`；`hasNext` 表示是否还有下一页。角色卡 `total` 可能为 `null`，不可只靠此值判断分页。收藏、关注与关注作者动态每页返回 24 条。评论与回复使用从 1 开始的 `page`，每页 20 条。

公开看板结果包含已上架角色卡。角色卡直接链接也可能返回可用预览；可访问链接不代表角色卡已通过社区审核。隐藏或无法使用的角色卡会被省略，或返回 404。成人内容需要已验证会员，并启用网站的年龄与可见性设置；未获取访问权而直接请求时，返回 403 与 `adult_content`。

## 评论与会员收藏

评论属于社区角色卡。API 支持顶层评论与各评论下的一层回复讨论串。评论去除首尾空白后须为 1–500 个 Unicode 字符；每位会员每分钟最多发表六条评论。

评论作者、角色卡作者与获授权的管理员可删除评论。删除顶层评论也会隐藏其回复。点赞与取消点赞操作具幂等性。

收藏使用角色卡 `id`；关注使用作者 `handle`。`GET` 读取当前状态，`PUT` 添加，`DELETE` 移除。动态包含关注作者的作品。通知仅收件者可见；将通知标为已读不会授予访问他人通知的权限。

## 社区错误

错误使用非 2xx HTTP 状态与 JSON `error` 字符串，有时另附 `detail` 对象。字符串可能是错误码或简短句子；客户端处理时应保留 HTTP 状态。

| 状态 | 意义 |
|---|---|
| 400 | 缺少或无效输入，例如空白评论或过多标签。 |
| 401 | 缺少身份验证，或验证已失效。 |
| 403 | 会员无法运行此操作或访问所请求内容。 |
| 404 | 调用方无法使用所请求资源。 |
| 429 | 请求超过速率限制，例如 `comment_rate_limited`。 |
| 5xx | 服务无法完成请求。 |

本参考文档涵盖浏览与会员社交功能。工作人员审核、账号恢复、发布流程与内部自动化不在此范围。

## 服务集成

服务 API 使用另外设置的 `<API_BASE>`。主要资源位于 `/open/v1`；OAuth 与探索功能使用参考文档列出的路径。社区 `/v1` 路由与服务 `/open/v1` 路由具有不同的源站地址、身份验证情境与数据所有权。

| 范围 | 客户端契约 |
|---|---|
| 身份 | OAuth 授权码流程配合 PKCE、令牌刷新／撤销，以及 `GET /open/v1/me`。 |
| 角色卡创作 | 角色卡详情、作者自己的列表、文档更新、开场消息、呈现素材、Lorebook 与媒体。 |
| 对话 | 开始／继续、WebSocket 消息、历史记录、操作状态、停止与重新连接。 |
| 玩家数据 | 人设、回复设置、归档、记忆与手账，受所有权与声明支持范围限制。 |
| 托管与审核 | 使用文档规定的作者凭据与服务器持有的签发者凭据，交换版本与决定。社区审核与上架仍由社区决定。 |

### 授权与私有数据

客户端通过 `/oauth/register` 注册允许的回调网址，向 `/oauth/authorize` 发送 PKCE `S256`、`state` 与目标资源，再于 `/oauth/token` 交换返回的授权码。服务 API 访问资源为 `<API_BASE>/open/v1`。刷新与撤销使用参考文档中的端点；令牌仅对已授权 scope 与资源有效。

用户调用发送 `Authorization: Bearer <access_token>`。`role.read` 可能包含作者私有的角色卡指示与 Lorebook；`role.write` 允许变更资源，包含适用的媒体操作。`chat.play` 允许可能消耗点数的对话操作。`referral` 允许读取用户的推荐码，并替新注册的用户填写推荐码；绑定是永久的，请先向用户确认。集成端必须在授权时说明这些影响，并对每个私有操作强制检查所有权。

公开角色卡访问权不授予编辑或私有导出权限。社区会员 handle、角色卡编号与服务资源 ID 分别识别不同事物；客户端必须使用各端点要求的标识符。需要 `X-Hosting-Key` 时，此值为服务器持有的签发者凭据，绝不可传给浏览器代码。个人 API 密钥为可选功能；格式与签发方式不在此参考文档范围。

### 对话生命周期

1. `POST /open/v1/conversation/start` 打开或继续对话，不生成模型回复。 继续对话时带上 `firstPageSize`，同一个响应就会附上历史第一页（`firstPage`），不必再单独请求历史。
2. `POST /open/v1/conversation/ws-ticket` 使用用户 bearer 令牌获取短期有效、一次性票证。
3. 客户端打开 `/open/v1/conversation/ws`，发送认证帧，再发送回合帧。票证端点的 **WebSocket 协议** 区段说明帧、事件、完成与重放字段。
4. 历史记录与操作状态端点提供持久化结果。`POST /open/v1/conversation/stop` 要求取消；客户端依操作最终状态判断结果。

重新连接必须重复使用流标识与重放位置，不可再提交另一个付费回合。可选的 Agent 续接功能，只有在服务报告进度已保留时才使用 `resumeFromOperationId`。遭拒的续接不可默默改为新的付费请求。

### 可选功能与错误

回复偏好需要 `responseSettingsVersion=1`。媒体搜索、排序与作者相对路径需要响应提供对应功能。多条回复建议与 Agent 准备也依服务支持情况而定。仅有相符路径，不足以证明功能已启用。

价格、余额、模型可用性、存储上限与保留政策由所连接的服务决定。客户端必须使用返回的功能与费用信息，依需要获取付费操作确认，并区分完整回复、部分输出、取消与失败。

服务错误与身份验证失败，遵循各端点结构定义与集成参考文档的“补充说明”区段，与前述社区错误格式分开。未知的可选功能应维持不可用，不可从服务名称自行推断。

## 分享图片与文案

卡片脚本可以在玩家点击按钮后分享图片与文案。HTTPS 卡片框架由宿主委派 `web-share` 与 `clipboard-write`：`navigator.share` 可接收预先准备的图片 `File` 与文字；`navigator.clipboard.write` 搭配 `ClipboardItem` 可写入 PNG，`navigator.clipboard.writeText` 可写入文案。这些是浏览器能力，不是新增的 `sdk` 方法或 HTTP 端点。

请在点击前准备好文件，在点击处理函数内直接调用，保留用户激活状态。提供操作前先检查 `navigator.share`、`navigator.canShare({ files: [file] })`、`navigator.clipboard.write` 与 `ClipboardItem`。支持情况取决于浏览器、操作系统、权限与接收 App，分享后不保证图片和文字都保留。请捕获拒绝与取消；不支持或被拒绝时提供下载图片与可选取的文案，取消后不要自动重开分享面板。宿主不委派 `clipboard-read`。本地不透明来源的预览仍可能拒绝调用，请在目标设备的实际跨来源卡片上验证。

## 带情境的分享链接

卡片脚本可以生成一条带情境码的分享链接：朋友从这条链接打开卡片时，脚本读得到同一个码，卡片就能做出“你朋友选了这个，换你”。`sdk.share.link(code)`（普通卡为 `window.stage.share.link`）同步返回这张卡的分享链接：卡片页 `/cards/<number>`，带着已登录玩家的推荐码，给了情境码就再加上 `?share=<code>`。请在点击前生成链接，在点击处理函数内交给 `navigator.share`。

朋友那一端用 `sdk.share.context` 读回情境码；没有，或正在看自己过去的对话时是 `null`。情境码只收 1–64 个英文字母、数字与 `.`、`_`、`-`，开头须为字母或数字；不合规则时沙盒卡抛出 `SHARE_CONTEXT_INVALID`，普通卡得到 `null`。平台只负责送达：情境码不会送进模型、不含玩家数据，而且任何人都能手动输入，请只接受卡片自己定义的码。朋友是否已有存档由卡片判断（例如 `sdk.archive.list()`；游客没有存档）。

`sdk.share.audience` 表示谁能打开这条链接：`author`（仅自己可见的卡，新朋友打不开）、`link` 或 `public`。平台开关关闭时 `sdk.share.enabled` 为 false，`context` 为 `null`，`link()` 返回不带情境的普通链接。`sdk.share.qr(text)` 返回 `{ size, path }`（`size` × `size` 格的 SVG path），可画进分享图。推荐码较晚取得时会触发 `share:change`。作者可以用 `?mode=source&share=<code>` 在草稿上测试。

## 投票、共斗计数与分享回流

在 `rules.json` 的 `sharedState` 里声明的投票和计数器，由所有玩这张卡的人共用。`sdk.shared`（普通卡为 `window.stage.shared`）负责读写：

- `read(keys)` 接收一个 key 或最多 16 个，返回 `{ [key]: { kind: 'poll', counts, total, mine? } | { kind: 'counter', total, mine?, goal?, reachedAt?, previous? } }`。未声明的 key 不会出现在结果里；`mine` 是玩家自己投的选项或贡献，游客没有；`previous` 是上一期的总数。
- `vote(key, option)` 返回 `{ mine }`。同一题每人每天最多投或改 10 次，第一次投票也算；投回同一个选项不算。
- `add(key, delta)` 加上 1 到该计数器 `maxStep` 之间的整数，返回 `{ total, mine, reachedAt }`。
- `leaderboard(key, { limit })` 返回 `{ items: [{ rank, name, value }], mine? }`：本期贡献最多的玩家（默认 10 名，最多 50 名），显示公开昵称，不列出测试账号。计数器的 `total`、`mine` 和排行榜，每一期都重新开始。

所有人都能读；写入需要已登录并且玩过这张卡的玩家（开过一段对话即可）。数字不会主动推送给卡片，请自行重新读取，间隔至少 10 秒。作者可以在自己的任何一张卡上试，包括全新的私卡和 CLI 推送的试玩卡；作者的数字和玩家的分开。

分享回流基于分享链接。`sdk.share.tallyLink(code, pollKey)` 为声明了 `share: true` 的投票生成带平台短码（`?share=~XXXXXXXX`）的链接。这是异步调用，请在点击前准备好；同一组情境码和投票会拿到同一条链接，每位玩家每天最多 20 条，链接 90 天内有效。朋友打开后，`sdk.share.context` 是情境码，`sdk.share.poll` 是可以回答的题目 `{ key, options }`（没有时为 `null`），用 `sdk.share.respond(option)` 回答。这些回答每条链接各记一份，和这道题本身的投票分开。分享者用 `sdk.share.results()` 读取自己发出的链接，每条是 `{ context, pollKey, total, counts, updatedAt }`：`total` 实时更新，`counts` 要有 3 位朋友回答才会出现，每天更新一次。卡片不会知道是谁分享、谁回答。卡片可以根据这些数字解锁卡内内容，但不会因此发放平台积分。

两种页面使用同一组错误码：`SHARED_DISABLED`（平台或作者已暂停）、`NOT_DECLARED`、`OPTION_INVALID`、`NOT_ELIGIBLE`（还没玩过，或回答自己的链接）、`UNAUTHORIZED`（未登录）、`RATE_LIMITED`（稍后再试）、`LIMIT_REACHED`（`err.data.reason` 为 `goal` 或 `limit`）、`HOST_DENIED`（旧版游玩页；查看过去的对话或审核试玩时只能读；从未送审、也没设置过可见范围的卡，例如试玩卡，不能用 `tallyLink` 生成回流链接，因为别人打不开）。作者试玩（`?mode=source`）和测试账号各有自己的一份数字，不会混进玩家的；可以在编辑页的“玩家投票与计数”或用 `hearthroom card state` 查看、暂停和清零。
