<p align="center">
  <img src="web/public/icons/icon-192.png" width="96" alt="">
</p>

<h1 align="center">Hearthroom</h1>

<p align="center">
  由社群維護的開放式 AI 角色卡榜單。<br>
  榜單、搜尋、作者頁、建卡編輯器與社群審核，全部跑在一個 Cloudflare Worker 上。
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
  <b>繁體中文</b> ·
  <a href="README.zh-Hans.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <img src="docs/screenshots/board-dark.png" width="800" alt="Hearthroom 榜單（深色）">
</p>

## Hearthroom 是什麼

Hearthroom 是一個公開的榜單：作者把自己的 AI 角色卡登記上來，讀者在這裡找卡。有日榜、週榜、月榜，可以依名稱、簡介或標籤搜尋，有作者頁，也有附對話測試面板的建卡編輯器。

卡片本身不存在這裡。卡片住在**卡片供應商**那邊——一個提供開放 API 的聊天服務，登入、卡片內容與對話都在那裡。Hearthroom 只擁有三件事：哪些卡上了榜、榜怎麼排、搜尋索引。作者透過供應商登入，用卡片 ID 登記，站台每小時從供應商同步公開欄位。把這個站關掉，作者的卡一個字都不會少。

上榜要經過**社群審核**：審核人從共享佇列領單，初審要兩個人通過、重審一個人，任何一票駁回即駁回，審核頁不顯示作者。通過綁著卡片的內容版本；作者之後改了卡，就會離榜重新排隊。

## 功能

- **榜單**——日榜、週榜、月榜，最熱與最新排序，標籤篩選，作者榜，語區。
- **搜尋**名稱、簡介與標籤。
- **作者頁**，列出該作者上榜的所有卡。
- **建卡編輯器**——人設、開場白、世界書、附即時測試欄的正規表示式規則、圖片欄位、可拖曳調寬的對話測試面板。可匯入 SillyTavern 的 PNG／JSON 角色卡。
- **兩種聊天頁**——把卡片的樣式與腳本隔離執行的沙箱頁（預設），以及給舊卡的傳統頁。作者面的契約在[寫卡指南](docs/guide/card-authoring.zh-Hant.md)。
- **社群審核**——盲審、雙章、過審綁內容版本。
- **成人內容分級**——年齡確認與依標籤隱藏。
- **可安裝**成桌面與手機上的 Web App。
- **五種語言**——繁體中文、簡體中文、英文、日文、韓文。

<p align="center">
  <img src="docs/screenshots/board-light.png" width="49%" alt="榜單（淺色）">
  <img src="docs/screenshots/guide.png" width="49%" alt="寫卡指南">
</p>

## 使用

公開站台在 **[hearthroom.club](https://hearthroom.club)**。

1. **瀏覽**不用帳號：榜單、搜尋、卡片頁、作者頁都是公開的。
2. **登入**：按「登入」，用你在卡片供應商的帳號授權。Hearthroom 不會看到你的密碼，供應商核發的是只對本站有效的 token。
3. **登記卡片**：到「我的卡片」，你在供應商那邊的卡會列在這裡，挑一張送審，或在編輯器新建一張。每位作者每週有登記上限。
4. **寫卡**看[寫卡指南](https://hearthroom.club/guide)：欄位、規則、沙箱作者 API、從其他平台匯入。
5. **串接**看[開發者文件](https://hearthroom.club/developers)與 [OpenAPI 描述](docs/openapi.json)。

## 運作方式

```
src/          Cloudflare Worker（Hono）：社群 API、審核、每小時同步、分享預覽
web/          Vue 3 + Vite 單頁應用，五種語系
migrations/   D1 schema
stage/        對話舞台（git 子模組，釘在一個 commit）：/play 用的對話介面
docs/         開發者文件、OpenAPI 描述、寫卡指南、架構筆記
scripts/      部署前檢查、資源封存、審核人授權、本機開發用的模擬上游
```

API 與前端跑在**同一個 Worker** 上：`/v1/*` 由 Hono 處理，其餘落到打包好的 SPA。儲存用 **D1**（登記、成員、審核）、**KV**（回應快取，以及前幾版資源的封存，讓部署後還開著的舊分頁不會壞），選配 **Analytics Engine** 記使用事件。排程每小時從供應商同步卡片名稱、封面與熱度信號。

對話舞台是另一個開源專案，以 `stage/` 子模組掛進來，建置時打進 SPA。它的改動一律往上游提，本倉庫只移動釘的 commit。

設計決策與背後的取捨收在 [docs/architecture.zh-Hant.md](docs/architecture.zh-Hant.md)。

## 開發

需要 Node 22 與 npm。前端測試在 Node 26 會因為內建的 `localStorage` 全域而失敗。

```bash
git clone --recurse-submodules https://github.com/hearthroom/hearthroom.git
cd hearthroom
npm install                 # workspaces，一次裝完 Worker 與前端
npm run migrate:local       # 套 D1 遷移到本機資料庫
npm run build:stage         # 建一次對話舞台（前端建置與測試都要）
npm run dev                 # Worker，:8787
npm run dev:web             # Vite，:8850，把 /v1 代理到 :8787
```

常用指令：

| 指令 | 做什麼 |
|---|---|
| `npm test` | Worker 測試（Vitest，Workers pool）與前端測試 |
| `npm run typecheck` | 產生 Worker 型別，然後兩邊型別檢查 |
| `npm run build` | 建舞台與前端，輸出到 `web/dist` |
| `npm run i18n -w web` | 報告每個語系的翻譯覆蓋率，並找出元件裡沒抽出來的字串 |
| `npm run sync:stage` | 拉舞台上游的 `main`、跑它的測試、重新建置，子模組指標留給你提交 |

### 在本機改編輯器

編輯器在供應商的 OAuth 後面，對著 `localhost` 走不完。用模擬供應商頂上：卡片存在記憶體，任何 bearer token 都算登入。

```bash
node scripts/mock-upstream.mjs                                  # :8899
VITE_LUNATALK_API_BASE=http://127.0.0.1:8899 npm run dev:web
```

再在瀏覽器主控台塞一組 token：

```js
localStorage.setItem("hearthroom.oauth.access", JSON.stringify({ accessToken: "tok", expiresAt: Date.now() + 3600e3 }));
```

模擬供應商的 `/__log` 顯示它收到的請求；放在 `scripts/fixtures/`（不入庫）的檔案會由 `/fixtures/<檔名>` 提供，拿來測匯入。

## 自架

全部跑在一個 Cloudflare 帳號上，小型社群用免費方案就夠。

1. 建好資源，把 ID 填進 `wrangler.toml`：一個 **D1** 資料庫（`DB`）、兩個 **KV** 命名空間（`CACHE`、`ASSET_ARCHIVE`），選配一個 **Analytics Engine** 資料集（`EVENTS`；不用的話設 `ANALYTICS_ENABLED = "false"`）。
2. 換成你的網域：`wrangler.toml` 的 `routes`、`src/site.ts` 的 `HOST`、`web/src/lib/site.ts` 的站名。自訂網域掛不上已有 DNS 記錄的主機名，先把停放記錄刪掉。
3. 設定供應商：`[vars]` 裡的 `LUNATALK_API_BASE`（與區域備援 `LUNATALK_API_BASE_CN`）。變數名沿用第一家接上的供應商；站台把它當一般供應商看待。
4. 選配審核機器人：`[vars]` 的 `REVIEW_BOT_ACCOUNT_NUM_ID` 加上 `wrangler secret put REVIEW_BOT_KEY`。兩者缺一，提交就直接上榜、不經審核。審核人用 `node scripts/grant-reviewer.mjs <供應商帳號 ID>` 授權。
5. 部署：

```bash
npm run migrate:remote
npm run deploy              # 會先跑部署前檢查、型別檢查、測試與建置
```

**持續部署。** 附的工作流程（`.github/workflows/deploy.yml`）對每次 push 與 PR 做型別檢查、建置與測試。在 `main` 上，若倉庫 secrets `CLOUDFLARE_API_TOKEN` 與 `CLOUDFLARE_ACCOUNT_ID` 已設定，就套遷移並部署；沒設定則標示略過部署，CI 仍是綠的。

## 貢獻

歡迎開 issue 與 PR。

- **問題與想法**——開一個 [issue](https://github.com/hearthroom/hearthroom/issues)。回報錯誤請附頁面、瀏覽器與你預期看到的結果。
- **Pull request**——每個 PR 都會跑型別檢查、建置與測試。一個 PR 只做一件事，測試放在改到的程式碼旁邊（Worker 在 `test/`，前端在 `web/test/`），推之前跑一次 `npm test`。
- **翻譯**——介面文案在 `web/src/locales/<語系>.json`，一個語言一個檔。`npm run i18n -w web` 列出每個語系缺什麼。新增字串要五個檔都補；元件裡留有沒翻的文字會讓建置失敗。寫卡指南在 `docs/guide/` 下每個語言一份。
- **對話舞台**——對話介面的改動屬於舞台專案，不在這裡。
- **授權**——貢獻以與專案相同的 AGPL-3.0 授權接受。

## 授權

[GNU Affero General Public License v3.0](LICENSE)。若你把修改過的版本當網路服務提供，必須向使用者提供原始碼。
