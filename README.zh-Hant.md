<p align="center">
  <img src="web/public/icons/icon-192.png" width="96" alt="">
</p>

<h1 align="center">Hearthroom</h1>

<p align="center">
  AI 角色卡的開放平台：社群榜單、瀏覽器內直接遊玩的對話，以及經社群審核的分發。<br>
  以單一 Cloudflare Worker 部署。
</p>

<p align="center">
  <a href="https://hearthroom.club"><img src="https://img.shields.io/website?url=https%3A%2F%2Fhearthroom.club&label=hearthroom.club" alt="Website"></a>
  <a href="https://discord.gg/C7m85YPHmK"><img src="https://img.shields.io/badge/Discord-join%20the%20community-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
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

## 概述

Hearthroom 是 AI 角色卡的開源平台，由三個部分組成：

- **榜單**——作者登記卡片；讀者瀏覽日榜、週榜、月榜，依名稱、簡介或標籤搜尋，查看作者頁。
- **對話**——每張上榜的卡都能在瀏覽器裡直接遊玩。對話舞台（另一個開源專案，以 `stage/` 子模組納入）負責繪製對話、卡片的狀態欄與面板，並在沙箱中執行卡片的腳本。
- **分發**——卡片上榜前經社群審核，開啟時連同規則、世界書與圖片一併載入。可匯入 SillyTavern 的 PNG／JSON 角色卡。

Hearthroom 與 SillyTavern 的差別在於執行位置。使用者不需要在本機安裝任何東西，也不需要設定 API 金鑰。登入、卡片儲存與文字生成由**卡片供應商**負責，也就是一個提供開放 API 的聊天服務。Hearthroom 儲存的是登記資料（哪些卡上榜）、審核狀態、搜尋索引與站台設定。作者透過供應商登入，以卡片 ID 登記；站台每小時從供應商複製一次卡片的公開欄位。卡片內容不儲存在站台。

審核流程：審核人從共享佇列領取提交；初審需要兩位通過，重審需要一位；任一駁回即駁回；審核頁不顯示作者。通過與卡片的內容版本綁定，作者修改卡片後會離榜並重新排隊。

## 功能

- 日榜、週榜、月榜；最熱與最新排序；標籤篩選；作者榜；語區。
- 依名稱、簡介與標籤搜尋。
- 作者頁，列出該作者的卡片。
- 建卡編輯器：人設、開場白、世界書、附測試欄的正規表示式規則、圖片欄位、可調寬的對話測試面板。可匯入 SillyTavern 的 PNG／JSON 角色卡。
- 兩種聊天頁：隔離卡片樣式與腳本的沙箱頁（預設），以及供舊卡使用的傳統頁。作者面的規格見[寫卡指南](docs/guide/card-authoring.zh-Hant.md)。
- 社群審核：盲審、兩位通過、與內容版本綁定。
- 成人內容的年齡確認與依標籤隱藏。
- 可安裝為桌面與手機上的 Web App。
- 五種介面語言：繁體中文、簡體中文、英文、日文、韓文。

<p align="center">
  <img src="docs/screenshots/board-light.png" width="49%" alt="榜單（淺色）">
  <img src="docs/screenshots/guide.png" width="49%" alt="寫卡指南">
</p>
<p align="center"><sub>截圖使用示範卡片。</sub></p>

## 使用

公開站台：[hearthroom.club](https://hearthroom.club)。

1. 榜單、搜尋、卡片頁與作者頁為公開內容。
2. 以卡片供應商的帳號**登入**。供應商核發僅對本站有效的 token，本站不會收到密碼。
3. **我的卡片**列出該帳號在供應商的卡片。選擇一張送審，或在編輯器建立新卡。每位作者每週有登記上限。
4. [寫卡指南](https://hearthroom.club/guide)說明欄位、規則、沙箱作者 API 與從其他平台匯入。
5. [開發者文件](https://hearthroom.club/developers)與 [OpenAPI 描述](docs/openapi.json)說明 HTTP API。

## 架構

```
src/          Cloudflare Worker（Hono）：社群 API、審核、每小時同步、分享預覽
web/          Vue 3 + Vite 單頁應用，五種語系
migrations/   D1 schema
stage/        對話舞台（git 子模組，釘在特定 commit）：/play 使用的對話介面
docs/         開發者文件、OpenAPI 描述、寫卡指南、架構筆記
scripts/      部署前檢查、資源封存、審核人授權、本機開發用的模擬供應商
```

API 與前端由同一個 Worker 提供：`/v1/*` 由 Hono 處理，其餘路徑交給打包後的 SPA。儲存：D1 存登記、成員與審核；KV 存回應快取與前幾版的靜態資源，讓部署前開啟的分頁仍能載入自己那一版的檔案；Analytics Engine（選用）存使用事件。排程每小時從供應商同步卡片名稱、封面與熱度計數。

對話舞台在建置時打包進 SPA。舞台的修改提交到它自己的倉庫，本倉庫只更新釘住的 commit。

各項設計決策與理由記錄在 [docs/architecture.zh-Hant.md](docs/architecture.zh-Hant.md)。

## 開發

需要 Node 22 與 npm。前端測試無法在 Node 26 執行，因為它內建了 `localStorage` 全域物件。

```bash
git clone --recurse-submodules https://github.com/hearthroom/hearthroom.git
cd hearthroom
npm install                 # 安裝 Worker 與前端 workspace
npm run migrate:local       # 對本機資料庫套用 D1 遷移
npm run build:stage         # 建置對話舞台；前端建置與測試需要
npm run dev                 # Worker，:8787
npm run dev:web             # Vite，:8850，/v1 代理到 :8787
```

| 指令 | 說明 |
|---|---|
| `npm test` | Worker 測試（Vitest，Workers pool）與前端測試 |
| `npm run typecheck` | 產生 Worker 型別並對兩個套件做型別檢查 |
| `npm run build` | 建置舞台與前端，輸出至 `web/dist` |
| `npm run i18n -w web` | 報告各語系的翻譯覆蓋率，列出元件中未翻譯的字串 |
| `npm run sync:stage` | 拉取舞台上游的 `main`、執行其測試、重新建置，並更新子模組指標（不提交） |

### 沒有供應商帳號時開發編輯器

編輯器需要與供應商完成 OAuth，在 `localhost` 上無法完成。`scripts/mock-upstream.mjs` 是供應商的記憶體替身，接受任何 bearer token：

```bash
node scripts/mock-upstream.mjs                                  # :8899
VITE_PROVIDER_API_BASE=http://127.0.0.1:8899 npm run dev:web
```

在瀏覽器主控台設定 token：

```js
localStorage.setItem("hearthroom.oauth.access", JSON.stringify({ accessToken: "tok", expiresAt: Date.now() + 3600e3 }));
```

替身的 `/__log` 列出收到的請求。`scripts/fixtures/` 下的檔案（git 忽略）會由 `/fixtures/<檔名>` 提供，用於測試匯入。

## 自架

跨設備授權保存為選用功能。啟用前請閱讀[授權保存與操作](docs/account-authorization.md)，了解本站保存的憑證、隱私邊界及撤銷方式。

站台在單一 Cloudflare 帳號上執行，小型社群使用免費方案即可。

1. 建立資源並將 ID 填入 `wrangler.toml`：一個 D1 資料庫（`DB`）、兩個 KV 命名空間（`CACHE`、`ASSET_ARCHIVE`），以及選用的 Analytics Engine 資料集（`EVENTS`；設定 `ANALYTICS_ENABLED = "false"` 可停用）。
2. 設定網域：`wrangler.toml` 的 `routes`、`src/site.ts` 的 `HOST`、`web/src/lib/site.ts` 的站名。已有 DNS 記錄的主機名無法綁定自訂網域，須先刪除停放記錄。 卡片 App 在 `play.<網域>`、沙箱殼在 `c<id>.<網域>`，都由同一條萬用路由服務，zone 要有一筆代理的萬用 DNS 記錄。
3. 設定供應商：`[vars]` 中的 `PROVIDER_API_BASE`。若部分國家無法連上供應商的主網域，在 `PROVIDER_API_GATEWAYS` 列出各國閘道（`CC=網址,…`）；`/v1/region` 會把對應的閘道回給該國的瀏覽器。
4. 決定要不要審核：`[vars]` 中的 `REVIEW_ENABLED = "true"` 表示提交要經社群審核；其他值則不經審核直接上榜。審核不需要在供應商那邊持有任何金鑰或帳號。以 `node scripts/grant-reviewer.mjs <供應商帳號 ID>` 授權審核人。
5. 選用的 `wrangler secret put SHORTCUT_SECRET`（任意隨機字串）：用來簽發短效鑰匙，讓開了成人內容的成員也能把成人卡加到主畫面；不設的話成人卡就沒有這個按鈕。
6. 部署：

```bash
npm run migrate:remote
npm run deploy              # 先執行部署前檢查、型別檢查、測試與建置
```

`.github/workflows/deploy.yml` 對每次 push 與 PR 執行型別檢查、建置與測試。在 `main` 上，若倉庫 secrets `CLOUDFLARE_API_TOKEN` 與 `CLOUDFLARE_ACCOUNT_ID` 已設定，會接著套用遷移並部署；未設定時略過部署步驟，執行結果仍為通過。

## 社群

討論、分享卡片與協調開發在 [Discord](https://discord.gg/C7m85YPHmK) 進行。錯誤回報與功能建議請開 [GitHub issue](https://github.com/hearthroom/hearthroom/issues)。

## 貢獻

- **Issue**——回報錯誤時附上頁面、瀏覽器與預期行為。
- **Pull request**——CI 對每個 PR 執行型別檢查、建置與測試。一個 PR 只做一項修改，測試放在對應程式碼旁（Worker 在 `test/`，前端在 `web/test/`），推送前執行 `npm test`。
- **翻譯**——介面字串在 `web/src/locales/<語系>.json`，每種語言一個檔案。`npm run i18n -w web` 報告各語系缺少的 key。新增字串須同時加入五個檔案；元件中若有未翻譯的文字，測試步驟會失敗。寫卡指南在 `docs/guide/` 下每種語言一份。
- **對話舞台**——對話介面的修改提交到舞台的倉庫，不在本倉庫。
- **授權**——貢獻以與專案相同的 AGPL-3.0 授權接受。

## 授權

[GNU Affero General Public License v3.0](LICENSE)。以修改後的版本提供網路服務者，須向其使用者提供修改後的原始碼。
