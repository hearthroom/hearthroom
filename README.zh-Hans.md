<p align="center">
  <img src="web/public/icons/icon-192.png" width="96" alt="">
</p>

<h1 align="center">Hearthroom</h1>

<p align="center">
  由社区维护的开放式 AI 角色卡榜单。<br>
  榜单、搜索、作者页、建卡编辑器与社区审核，全部运行在一个 Cloudflare Worker 上。
</p>

<p align="center">
  <a href="https://hearthroom.club"><img src="https://img.shields.io/website?url=https%3A%2F%2Fhearthroom.club&label=hearthroom.club" alt="Website"></a>
  <a href="https://github.com/hearthroom/hearthroom/actions/workflows/deploy.yml"><img src="https://github.com/hearthroom/hearthroom/actions/workflows/deploy.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/hearthroom/hearthroom" alt="License: AGPL-3.0"></a>
  <a href="https://github.com/hearthroom/hearthroom/commits/main"><img src="https://img.shields.io/github/last-commit/hearthroom/hearthroom" alt="Last commit"></a>
  <a href="https://github.com/hearthroom/hearthroom/stargazers"><img src="https://img.shields.io/github/stars/hearthroom/hearthroom?style=social" alt="GitHub stars"></a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-Hant.md">繁體中文</a> ·
  <b>简体中文</b> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <img src="docs/screenshots/board-dark.png" width="800" alt="Hearthroom 榜单（深色）">
</p>

## Hearthroom 是什么

Hearthroom 是一个公开的榜单：作者把自己的 AI 角色卡登记上来，读者在这里找卡。有日榜、周榜、月榜，可以按名称、简介或标签搜索，有作者页，也有带对话测试面板的建卡编辑器。

卡片本身不存在这里。卡片住在**卡片提供方**那边——一个提供开放 API 的聊天服务，登录、卡片内容与对话都在那里。Hearthroom 只拥有三件事：哪些卡上了榜、榜怎么排、搜索索引。作者通过提供方登录，用卡片 ID 登记，站点每小时从提供方同步公开字段。把这个站关掉，作者的卡一个字都不会少。

上榜要经过**社区审核**：审核人从共享队列领单，初审要两个人通过、复审一个人，任何一票驳回即驳回，审核页不显示作者。通过绑定卡片的内容版本；作者之后改了卡，就会离榜重新排队。

## 功能

- **榜单**——日榜、周榜、月榜，最热与最新排序，标签筛选，作者榜，语区。
- **搜索**名称、简介与标签。
- **作者页**，列出该作者上榜的所有卡。
- **建卡编辑器**——人设、开场白、世界书、带即时测试栏的正则表达式规则、图片字段、可拖动调宽的对话测试面板。可导入 SillyTavern 的 PNG／JSON 角色卡。
- **两种聊天页**——把卡片的样式与脚本隔离运行的沙箱页（默认），以及给旧卡的传统页。面向作者的约定见[写卡指南](docs/guide/card-authoring.zh-Hans.md)。
- **社区审核**——盲审、双章、过审绑定内容版本。
- **成人内容分级**——年龄确认与按标签隐藏。
- **可安装**为桌面与手机上的 Web App。
- **五种语言**——繁体中文、简体中文、英文、日文、韩文。

<p align="center">
  <img src="docs/screenshots/board-light.png" width="49%" alt="榜单（浅色）">
  <img src="docs/screenshots/guide.png" width="49%" alt="写卡指南">
</p>

## 使用

公开站点在 **[hearthroom.club](https://hearthroom.club)**。

1. **浏览**不用账号：榜单、搜索、卡片页、作者页都是公开的。
2. **登录**：点“登录”，用你在卡片提供方的账号授权。Hearthroom 不会看到你的密码，提供方签发的是只对本站有效的 token。
3. **登记卡片**：到“我的卡片”，你在提供方那边的卡会列在这里，挑一张送审，或在编辑器新建一张。每位作者每周有登记上限。
4. **写卡**看[写卡指南](https://hearthroom.club/guide)：字段、规则、沙箱作者 API、从其他平台导入。
5. **对接**看[开发者文档](https://hearthroom.club/developers)与 [OpenAPI 描述](docs/openapi.json)。

## 运行方式

```
src/          Cloudflare Worker（Hono）：社区 API、审核、每小时同步、分享预览
web/          Vue 3 + Vite 单页应用，五种语言
migrations/   D1 schema
stage/        对话舞台（git 子模块，固定在一个 commit）：/play 用的对话界面
docs/         开发者文档、OpenAPI 描述、写卡指南、架构笔记
scripts/      部署前检查、资源归档、审核人授权、本地开发用的模拟上游
```

API 与前端运行在**同一个 Worker** 上：`/v1/*` 由 Hono 处理，其余落到打包好的 SPA。存储用 **D1**（登记、成员、审核）、**KV**（响应缓存，以及前几版资源的归档，让部署后还开着的旧标签页不会坏），可选 **Analytics Engine** 记录使用事件。定时任务每小时从提供方同步卡片名称、封面与热度信号。

对话舞台是另一个开源项目，以 `stage/` 子模块挂进来，构建时打进 SPA。它的改动一律往上游提，本仓库只移动固定的 commit。

设计决策与背后的取舍收在 [docs/architecture.zh-Hant.md](docs/architecture.zh-Hant.md)（繁体中文）。

## 开发

需要 Node 22 与 npm。前端测试在 Node 26 会因为内置的 `localStorage` 全局而失败。

```bash
git clone --recurse-submodules https://github.com/hearthroom/hearthroom.git
cd hearthroom
npm install                 # workspaces，一次装完 Worker 与前端
npm run migrate:local       # 把 D1 迁移应用到本地数据库
npm run build:stage         # 构建一次对话舞台（前端构建与测试都需要）
npm run dev                 # Worker，:8787
npm run dev:web             # Vite，:8850，把 /v1 代理到 :8787
```

常用命令：

| 命令 | 做什么 |
|---|---|
| `npm test` | Worker 测试（Vitest，Workers pool）与前端测试 |
| `npm run typecheck` | 生成 Worker 类型，然后两边类型检查 |
| `npm run build` | 构建舞台与前端，输出到 `web/dist` |
| `npm run i18n -w web` | 报告每个语言的翻译覆盖率，并找出组件里没抽出来的字符串 |
| `npm run sync:stage` | 拉舞台上游的 `main`、跑它的测试、重新构建，子模块指针留给你提交 |

### 在本地改编辑器

编辑器在提供方的 OAuth 后面，对着 `localhost` 走不完。用模拟提供方顶上：卡片存在内存，任何 bearer token 都算登录。

```bash
node scripts/mock-upstream.mjs                                  # :8899
VITE_LUNATALK_API_BASE=http://127.0.0.1:8899 npm run dev:web
```

再在浏览器控制台放一组 token：

```js
localStorage.setItem("hearthroom.oauth.access", JSON.stringify({ accessToken: "tok", expiresAt: Date.now() + 3600e3 }));
```

模拟提供方的 `/__log` 显示它收到的请求；放在 `scripts/fixtures/`（不入库）的文件会由 `/fixtures/<文件名>` 提供，用来测导入。

## 自建

全部运行在一个 Cloudflare 账号上，小型社区用免费方案就够。

1. 建好资源，把 ID 填进 `wrangler.toml`：一个 **D1** 数据库（`DB`）、两个 **KV** 命名空间（`CACHE`、`ASSET_ARCHIVE`），可选一个 **Analytics Engine** 数据集（`EVENTS`；不用的话设 `ANALYTICS_ENABLED = "false"`）。
2. 换成你的域名：`wrangler.toml` 的 `routes`、`src/site.ts` 的 `HOST`、`web/src/lib/site.ts` 的站名。自定义域名挂不上已有 DNS 记录的主机名，先把停放记录删掉。
3. 配置提供方：`[vars]` 里的 `LUNATALK_API_BASE`（与区域备用 `LUNATALK_API_BASE_CN`）。变量名沿用第一家接入的提供方；站点把它当一般提供方看待。
4. 可选审核机器人：`[vars]` 的 `REVIEW_BOT_ACCOUNT_NUM_ID` 加上 `wrangler secret put REVIEW_BOT_KEY`。两者缺一，提交就直接上榜、不经审核。审核人用 `node scripts/grant-reviewer.mjs <提供方账号 ID>` 授权。
5. 部署：

```bash
npm run migrate:remote
npm run deploy              # 会先跑部署前检查、类型检查、测试与构建
```

**持续部署。** 附带的工作流（`.github/workflows/deploy.yml`）对每次 push 与 PR 做类型检查、构建与测试。在 `main` 上，若仓库 secrets `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID` 已设置，就应用迁移并部署；没设置则标注跳过部署，CI 仍是绿的。

## 贡献

欢迎提 issue 与 PR。

- **问题与想法**——开一个 [issue](https://github.com/hearthroom/hearthroom/issues)。报告错误请附页面、浏览器与你预期看到的结果。
- **Pull request**——每个 PR 都会跑类型检查、构建与测试。一个 PR 只做一件事，测试放在改到的代码旁边（Worker 在 `test/`，前端在 `web/test/`），推之前跑一次 `npm test`。
- **翻译**——界面文案在 `web/src/locales/<语言>.json`，一个语言一个文件。`npm run i18n -w web` 列出每个语言缺什么。新增字符串要五个文件都补；组件里留有没翻的文字会让构建失败。写卡指南在 `docs/guide/` 下每个语言一份。
- **对话舞台**——对话界面的改动属于舞台项目，不在这里。
- **许可**——贡献以与项目相同的 AGPL-3.0 许可接受。

## 许可

[GNU Affero General Public License v3.0](LICENSE)。若你把修改过的版本作为网络服务提供，必须向用户提供源代码。
