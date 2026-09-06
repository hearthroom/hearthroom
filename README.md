# Hearthroom

一個開源的角色卡社群：榜單、搜尋、作者主頁，以及讓作者把自己的作品登記上榜。

前端與 API 跑在**同一個 Cloudflare Worker** 上：`/v1/*` 由 Hono 處理，其餘落到打包好的
Vue 3 SPA。同源，所以前端不必處理 CORS，部署也只有一個目標。

```
src/          Worker：社群 API（登記、榜單、搜尋、同步）
web/          Vue 3 + Vite 前端
migrations/   D1 schema
```

## 它是什麼、不是什麼

這是一個**第三方客戶端**。角色卡本身住在 [LunaTalk](https://lunatalk.ai) 上，
本專案透過它的開放 API 讀取公開資料，不隸屬於它，也沒有任何特殊權限——你能拿到的
API 存取範圍，跟這個服務拿到的一模一樣。

所以這裡**只擁有**三件事：誰把哪張卡登記到了這個社群、榜單怎麼排、搜尋索引。

作者可以在這裡建卡與編輯，但**卡片仍然存在上游、不存在這裡**：編輯器是一份表單，
按下儲存就是幾個帶著作者自己 token 的跨域請求。這個服務的 D1 裡沒有多出任何一個
卡片欄位，關掉這個站，作者的卡一個字都不會少。

卡片的內容、封面與對話都不在這裡。**登記時作者只送一個 roleId**，其餘欄位由本服務
自己去上游拉——作者塞不進任何內容，所以「登記完再偷換成別的東西」在結構上就不可能。
上游改了卡或換了圖，下一輪同步自動跟上，作者不必回來重新登記。

也因此這裡沒有內容審核：能不能真的用這張卡，是上游服務決定的事，本專案不做第二套
判斷，也做不了。卡片離開榜單只有一種方式——作者自己撤銷登記。

## 對上游的依賴

只有兩種呼叫，沒有第三種：

| 呼叫 | 憑證 | 何時 |
|---|---|---|
| `GET /open/v1/me` | 轉發作者自己的 token | 登記時確認這張卡真是他的 |
| `GET /open/v1/role/detail` | 無 | 每小時同步，那時沒有使用者在線 |

前兩者是**這個服務自己**發出的呼叫。建卡編輯器另外會用作者的 token 直接打上游
（跨域，不經過本站的 Worker）：`/open/v1/role`、`/role/:id/document`、`/role/:id/welcome`、
`/role/:id/publish`、`/role/validate`、`/image/upload`、`/worldbook*`。那些請求裡沒有本站的
任何憑證，權限範圍就是作者自己授予的那些。

**沒有服務帳號、沒有特殊金鑰、沒有私有介面。** 轉發的 token 只在那一個呼叫裡出現，
用完即棄：不落 D1、不進 KV、不寫日誌。改掉 `LUNATALK_API_BASE` 就能指向別的部署。

為什麼登記非得問上游一次：「這張卡是我寫的」這個事實只存在於上游的資料庫，本地
怎麼算都變不出來，任何在客戶端推導的方案都可偽造。但這不需要特權——轉發使用者
自己授權的 token 去問「你是誰」，權限範圍不超過他本來就給出去的那些。

登入走 OAuth（Authorization Code + PKCE）。這是瀏覽器應用，屬於 public client，
沒有 client secret 也不能有——`client_id` 用動態註冊（RFC 7591）取得並存在瀏覽器本機，
所以任何人 fork 這個站、換個網域部署都能直接跑，不必先來跟誰登記。

## 建卡與編輯

`/create` 與 `/cards/:roleId/edit` 是同一個元件（`pages/CardEditorPage.vue`），差別只有
有沒有 `roleId`。六個分區：基本、人設、對話、形象、世界書、發布。

**為什麼不是分步精靈**：作者手上多半已經有一張想搬過來的卡。分步會逼他按我們的順序
重走一遍，而匯入本來就該一次把每一區都填好。

**版面是三欄**：左邊分區導覽（紅點＝缺必填、勾＝已有內容）、中間表單、右邊是這張卡在
榜單上會長的樣子（就是 `CardTile`，套 `inert` 讓它只能看不能點）加儲存動作。表單刻意
只佔中間一欄——多行文字一行超過七十幾個字就難讀，空出來的寬度給預覽，作者邊填邊看。
1100px 以下右欄收掉、動作回到底部黏著的那條；760px 以下導覽變成頂部一排可橫滑的膠囊。

新卡的草稿存在 `localStorage`（`hearthroom.draft.create`）：關掉分頁再回來原樣還原，
畫面上說一聲並給「清空重來」。只給新卡——既有的卡有上游那份當底，而且兩張卡的草稿
混在同一個鍵底下會互相覆蓋。存成功就刪。Ctrl／⌘+S 直接儲存。

建立成功之後網址換成編輯頁用的是 `history.replaceState`，不是 `router.replace`：換路由會
把整個元件重掛（骨架閃一下、剛出現的「已儲存」消失、再向上游讀一次），而且離開守衛在
儲存中一律不放行，`router.replace` 在那個時間點會被它擋掉、什麼都不發生。

儲存是一次動作、多個請求，順序不能換（後面每一步都要前一步產生的 id）：

```
建卡 → 寫欄位（一次 11 個）→ 寫開場白那一組 → 建世界書並綁定 → 寫條目
```

任何一步失敗就停下並保留草稿，**不做局部回滾**——上游沒有跨資源的交易，硬回滾只會在
失敗之上再疊一次失敗。頭像與背景則相反：選檔當下就上傳，儲存時只是寫一個網址。
不然一次儲存會變成「傳兩張圖 + 寫一次卡」的複合操作，中間失敗就留下半成品。

欄位上限不寫死在前端，由 `GET /open/v1/role/validate` 回來：`jailbreak` 的上限隨卡片語區
不同，寫死會在某些語區給出錯的字數提示。拿不到就退回一份保守預設，只影響提示，不影響能不能存。

基本區另有**性別**（`roleSex`：man / women / other，站內既有的拼法）與**分類選擇器**：
`GET /open/v1/tag/canonical` 回的是站內榜單真的拿來分類的那份詞表，依維度分組，點一下就加進
標籤欄，跟手打的走同一條。詞表拿不到（舊上游、沒登入）就整塊不顯示，不擋建卡。
世界書條目旁的小數字是上游統計的「被帶進對話幾次」（`activationCount`），作者看哪些條目真的在用。

## 正則規則

「對話」區的**設定正則**：作者替 AI 回覆寫一組「找到 → 換成」，在看的人的瀏覽器裡跑——把 AI 吐出的標記
（『台詞』、`<status>…</status>`、`《美1》` 這類佔位）換成有樣式、有互動的 HTML。替換內容裡的 script / style
會執行，跟 AI 生成的 HTML 卡是同一個信任模型。`find` 寫成 `/pattern/flags` 是 JS 正則（替換裡 `$1` 可用），
其他一律字面字串、全部出現處都換。

編輯器（`components/editor/RegexRulesEditor.vue`）：左欄清單（搜尋、新建、上下移、啟用、刪除），右欄名字／匹配／
替換內容，底下狀態欄與「接在最近幾則」，還有一個測試台——貼一段回覆看套用結果。編的是本地副本，按「完成」
才回到表單；存檔跟卡片一起（`PUT /open/v1/role/:roleId/regex-rules`，帶版本樂觀鎖）。

匯入／匯出吃三種形狀：魅魔島匯出檔（`{pageDepth, statusbar, beginning, regex_scripts}`，`beginning` 只在開場白
空著時填進去）、酒館卡的 `extensions.regex_scripts`（匯入卡時直接落成規則，匯出卡寫回）、裸 `regex_scripts` 陣列。
轉換全在 `lib/regex-rules.ts`。設計：`docs/technical-design/RoleRegexRules_TechnicalDesign_20260906_V1.0.md`。

## 酒館角色卡

支援匯入與匯出 Character Card **V2 / V3**，兩種載體：

| 載體 | 讀 | 寫 |
|---|---|---|
| PNG（`tEXt` 的 `ccv3` 優先、其次 `chara`，內容是 base64 的 JSON） | ✓ | ✓ |
| JSON（含 V1 的平卡，沒有 `data` 那一層） | ✓ | ✓ |
| CHARX（`.charx`，V3 的 zip 封裝） | ✗ | ✗ |

CHARX 沒做：它要一整套 zip 讀取，而野生的卡絕大多數是前兩種。遇到就明確說讀不了，
不假裝是壞檔。PNG 的 chunk 讀寫是自己寫的（`lib/png-chunks.ts`）——那兩個 npm 套件
加起來做的就是那一百行。

匯出固定用 **V2**：那是所有客戶端都讀得懂的版本，而這裡沒有任何欄位需要 V3 才裝得下。
多帶一份 V3 只會讓兩份資料有機會不一致。

### 對不上的欄位

兩邊的模型不是一一對應，這是 `lib/tavern.ts` 的全部難處。**對不上的一律進匯入報告，
絕不靜默丟掉**：作者如果不知道次要關鍵詞沒了，他會以為卡壞了。

| 酒館 | 這裡 |
|---|---|
| `description` + `personality` + `scenario` | 合成角色設定，後兩段加小標題分開 |
| `creator_notes` | 簡介 |
| `first_mes` / `alternate_greetings` | 開場白 / 備選開場白 |
| `mes_example` | 對話示例（照 `<START>` 與 `{{user}}:` `{{char}}:` 拆；拆不出就整段進報告） |
| `system_prompt` / `post_history_instructions` | 輸出格式 / 額外指示 |
| `character_book` | 建成一本獨立世界書並綁定這張卡 |
| `secondary_keys` | 條目的**次要關鍵詞**（AND 門，上游 2026-09 起支援；匯出時同時寫 `selective: true`） |
| `position` / `scan_depth` / `case_sensitive` / `token_budget` | 沒有對應，進報告 |

`{{char}}` 與 `{{user}}` 兩邊都認，原樣帶過去就會動。

PNG 卡自帶的立繪會上傳成頭像（匯入面板先給看縮圖）。標籤超過 10 個只留前 10 個，多的
進報告。`extensions.regex_scripts`（狀態欄、美化面板那一類）單獨點名：本站不執行正則，
對話樣式由主題決定，這是刻意的取捨，不是漏做。

世界書那一區另外可以匯入酒館的**世界書檔**（World Info 匯出的 JSON，`entries` 是以 uid 為鍵
的物件、欄位叫 `key` / `keysecondary` / `disable`）或一張卡（只取它的 `character_book`），
條目接在現有的後面，沒綁書就順手建一本。轉換在 `worldInfoToBook`，統一成卡片規格那一種
形狀之後跟卡片匯入走同一套條目轉換與報告。

次要關鍵詞曾是唯一真正的語義損失（酒館是「主 AND 次」，這裡只有一組關鍵詞）。上游現在給條目加了
`secondaryKeywords` 這道 AND 門，匯入直接落位，匯出原樣寫回；召回引擎在候選定案前把「次要詞沒出現」
的條目拿掉。

## API

| Method | Path | 需要 | 說明 |
|---|---|---|---|
| GET | `/v1/cards` | — | 榜單與搜尋 |
| GET | `/v1/me/cards` | 作者 token | 自己的卡（含未登記的），分頁 |
| GET | `/v1/cards/:id` | — | 卡片詳情（吃 id 或 roleId） |
| GET | `/v1/authors/:accountNumId` | — | 作者在本站的彙總 |
| POST | `/v1/cards` | 作者 token | 登記，body 只收 `{roleId}` |
| DELETE | `/v1/cards/:id` | 作者 token | 作者自己撤銷登記 |

`GET /v1/cards` 參數：`zone=zh|en|ja|ko` `q` `tag` `author` `sort=hot|new|top` `lang` `limit`(≤100) `offset`。

### 語區

榜單按卡片的語言分開列（`zone=zh|en|ja|ko`，不帶就是 zh），沒有跨語言的總榜——
四種語言混在一起，對每個讀者來說都有四分之三是雜訊。簡繁體併成一區，同一批讀者兩種都
看得懂，拆開只會讓每區更空。來源標成「不分語言」（或沒標）的卡歸為 `all`，每一區都列。
作者主頁是唯一不分區的清單。

### 排名

```
hot  這個同步窗口的對話增量   hot_score = talk_num - talk_num_prev
top  歷來對話總量
new  登記時間
```

`hot_score` 是 SQLite 的 generated column（STORED），不是自己維護的欄位——資料庫保證它
跟來源永遠一致，不可能因為漏掉某條寫入路徑而漂移，而 STORED 才建得了索引。三種排序
各自對應一個索引，`EXPLAIN QUERY PLAN` 全部是 `SCAN ... USING INDEX`，沒有臨時 B-tree。

榜單不在熱路徑上數 `COUNT(*)`：多撈一筆就知道有沒有下一頁。精確總數只在**未篩選**時
給（那是掃一個小索引，便宜，也正是「共 N 張」最有意義的場合）；有篩選又還有下一頁時
回 `null`，因為 FTS MATCH 與 `json_each` 的 tag 過濾得把整組結果算出來才數得到，
常常比排序本身還貴，而使用者只需要知道還有沒有下一頁。翻到最後一頁時總數免費算得出來。

熱度取自上游的真實對話數，不是本站自己數的瀏覽量——後者誰都能刷。首次登記時把
`prev` 設成當前值，所以一張老熱卡剛登記不會用累積總量霸榜。

### 搜尋

FTS5 + **trigram** tokenizer。`unicode61` 不切中日韓詞，整句會變成一個 token，中文搜尋
等於全滅。trigram 的代價是查詢字串要 ≥ 3 字元，更短的（例如「修仙」）走 `LIKE` fallback
掃同一批資料。四個語言版本的名稱與簡介合併成一個 `search_text` 欄位，所以一個索引就
涵蓋中英日韓。

## 對話舞台（stage/）

卡片頁的「開始對話」走站內 `/play/:roleId`，畫布是 [Moonstage](https://github.com/lunatalkai/moonstage)——
LunaTalk 的開源對話舞台。它以子模組 `stage/` 直接掛上游，釘在一個 commit；本站沒有自己的 fork。

舞台當套件用的那一層（`src/stage/`、`vite.stage.config.ts`、`npm run build:stage`）由上游提供，任何站台都能拿去嵌。
程式碼改動一律往上游提；要跟上上游就更新指標：

```sh
git submodule update --init stage     # 第一次
npm run build:stage                   # 在 stage/ 裝依賴、打出 stage/dist-stage/
npm run sync:stage                    # 拉上游 main、跑測試、重新 build，之後提交子模組指標
```

本站不把它裝成 npm 依賴（它自己有六百多個依賴，沒必要進本站的 lock）：`web/vite.config.ts` 用 alias 把
`moonstage/stage` 指到 `stage/dist-stage/`，`npm run build` 會先 `build:stage`。套件把 vue／vue-i18n／pinia 留給本站
（`resolve.dedupe`），其餘都打在裡面；樣式全部 scope 在 `.ms-stage`，不會染到站台其他頁。

接線在 `web/src/lib/stage-host.ts`：token 從 session 拿、確認框走 ConfirmDialog、導頁走 vue-router、語系跟站台同步、
文案只補站台沒有的 key。`/play` 是 `meta.bare` 的頁：不套站台頁首頁尾，因為魅魔島那類卡靠全頁樣式換背景與輸入框。

## 本地開發

```bash
npm install                 # workspaces，一次裝完 Worker 與前端
npm run migrate:local
npm run dev                 # Worker，:8787
npm run dev:web             # 前端，:8850（會把 /v1 代理到 :8787）
npm test                    # 兩邊的測試
```

`.npmrc` 裡的 `legacy-peer-deps` 不要拿掉：npm 11 的 arborist 解析 vitest 4 的
optional peer 圖會崩（`TypeError: reading 'edgesOut'`）。

**建卡頁在 OAuth 後面，本機沒辦法真的登入。** 要在瀏覽器裡開編輯器，用 `scripts/mock-upstream.mjs`
把上游頂起來（記憶體存卡、任何 Bearer token 都算登入）：

```
node scripts/mock-upstream.mjs                              # :8899
VITE_LUNATALK_API_BASE=http://127.0.0.1:8899 npm run dev:web
```

再在瀏覽器 console 塞一組假 token：
`localStorage.setItem("hearthroom.oauth.access", JSON.stringify({ accessToken: "tok", expiresAt: Date.now() + 3600e3 }))`。
`/__log` 看收到的請求，`/fixtures/<檔名>` 提供 `scripts/fixtures/`（不入庫）裡的酒館卡，拿來在頁面上測匯入。

## 部署

push 到 `main` 就會部署：GitHub Actions（`.github/workflows/deploy.yml`）跑 typecheck、建置、
測試，通過後套資料庫遷移再 `wrangler deploy`。倉庫要有兩個 secrets：`CLOUDFLARE_API_TOKEN`
（Workers Scripts、D1、zone 的 DNS 與 Workers Routes 編輯）與 `CLOUDFLARE_ACCOUNT_ID`；
沒設的話部署步驟會跳過，CI 仍照常驗證。手動部署仍然可以：

```bash
npm run migrate:remote
npm run deploy              # predeploy 會先跑 typecheck + 測試 + 前端 build
```

自架時要改的只有 `wrangler.toml` 的 `routes`（換成你的網域）、`src/site.ts` 的 `HOST`、
`LUNATALK_API_BASE`，以及 `web/src/lib/site.ts` 的站台名稱。

### 一個正本，其餘都轉過去

`src/site.ts` 的 `HOST` 是正本網址，`ALIAS_HOSTS` 裡的一律 301 過去（路徑與查詢字串原樣帶著）。
兩個主機都服務同一份內容，等於把排名、分享數、快取全部切成兩半，所以 `www` 也是轉不是服務。

別名分兩類，機制一樣、壽命不同：`www` 永久留著；搬家前的舊網域留到沒人走為止。
轉址記一筆 `host_redirect`，`detail` 是來源主機：

```sql
SELECT blob14 AS from_host, SUM(_sample_interval) AS n FROM hearthroom_events
WHERE timestamp > NOW() - INTERVAL '7' DAY AND blob1 = 'host_redirect'
GROUP BY from_host FORMAT JSON
```

舊網域那一行降到零，才把它從 `ALIAS_HOSTS`、`wrangler.toml` 的 `routes` 與 DNS 一起拔掉。
別名主機轉過來的 referer 不算站外來源（`isSelfHost`），不然分享歸因會把自己記成外部流量。

### 換網域

前端全部從 `location.origin` 推導（OAuth 的 redirect_uri、hreflang、分享連結），所以搬家只動
兩個地方：`src/site.ts` 的 `HOST`、`wrangler.toml` 的 `routes`。

**順序不能顛倒**：先讓新網域跟舊網域**並存**，確認新家真的通了（憑證、頁面、API、分享預覽、
靜態資源、404），才把舊主機填進 `ALIAS_HOSTS` 開轉址。倒過來做的話，新家萬一沒掛上
（apex 上有註冊商的停放記錄、憑證還沒簽），舊家的 API 就轉向一個連不通的地方，等於把還在
服務的站台弄掛——2026-09-05 實際踩過。

**舊網域不要直接拔掉。** 這個站的成長迴圈就是分享，已經散在 Discord、X 上的卡片連結全部指著
舊主機，拔了就是一片 404，搜尋引擎累積的排名也一起歸零。

Workers 的自訂網域**掛不上已有 DNS 記錄的主機名**（註冊商的停放 A 記錄最常見），要先在面板刪掉；
`wrangler` 不會幫你刪。OAuth 用的是動態註冊，新網域第一次登入時會自己註冊一組 `client_id`
存進瀏覽器本機，不需要事先去哪裡登記。

## 快取

`/v1/me/cards` 要拼兩份資料，而它們的新鮮度要求完全相反，所以分開處理：

| 路徑 | 層 | 存什麼 | 存活 |
|---|---|---|---|
| `/v1/cards` | 邊緣 Cache API | 整個 JSON 回應（公開，人人相同） | 60s |
| `/v1/me/cards` | 瀏覽器 `sessionStorage` | 整頁結果，stale-while-revalidate | 60s |
| `/v1/me/cards` | 邊緣 Cache API | 上游回的角色清單 | 60s |
| `/v1/me/cards` | D1 | **登記狀態，永不快取** | — |

榜單對所有人完全一樣、底層資料每小時才同步一次，所以整個回應直接快取，命中就是
零 DB 查詢。代價是登記一張卡之後榜單最多晚 60 秒才看得到——可接受，因為作者在自己的
工作區立刻就看得到狀態變化（那條路不快取），不會覺得操作沒生效。

**沒有用 KV。** KV 是全域但最終一致的，寫入傳播最長要 ~60 秒且無法得知何時收斂；
Cache API 雖然只在單一節點，但寫入立即可見，而同一個使用者的連續請求本來就落在
同一個節點。對「使用者讀自己的私人資料」這個場景，後者的實際一致性更好。

真正保證一致性的不是層數，是把資料按變動頻率切開：慢而穩的（有哪些卡）快取，
快而使用者正在操作的（哪些已登記）永遠即時查。所以就算命中快取，按下登記之後
看到的狀態一定是對的。

快取鍵只用**驗證過的**數字 ID，絕不用 token 或任何請求帶進來的值——鍵裡混進可偽造
的輸入，就會把一個人的清單送給另一個人。前端在自己剛改過卡之後會帶 `?fresh=1`
繞過所有層：它知道自己寫過，比任何 TTL 都準。

回應帶 `X-Cache: hit|miss|bypass`，部署後用 curl 就驗得出快取有沒有生效。

## 分享預覽

這是個 SPA，但 Discord、LINE、X 的抓取器不跑 JS：它們看到的只有 `index.html` 裡那幾行
寫死的 meta，於是每張卡分享出去都長得一樣。所以 `/cards/:id` 與 `/authors/:id`（含語言
前綴）在 `wrangler.toml` 的 `run_worker_first` 裡，由 Worker 接手：拿靜態資源層的殼，用
`HTMLRewriter` 把標題、簡介、圖、canonical 與 `<html lang>` 換掉（`src/head.ts`），其餘一個
位元組都不動。沒有 SSR，前端接手之後照常渲染。

找不到的卡回 **404 狀態碼但內容仍是殼**——前端畫自己的 404 頁，抓取器與搜尋引擎拿到
正確的狀態。改寫後的回應會清掉殼的 `ETag`／`Last-Modified`：那是 `index.html` 的驗證器，
留著的話下游拿它去重驗會得到 304，卡改了名字也永遠看不到。

其他路徑不經 Worker，直接由資源層回應，不多付一次 Worker 調用。

## 外觀與主題

深淺色由 `<html data-mode>` 決定，不直接讀 `prefers-color-scheme`：使用者可以自己選，也可以
「跟著系統」。`index.html` 的 inline script 在第一次繪製前讀 `localStorage` 把屬性寫好，所以
不會先閃一下另一種顏色；`lib/appearance.ts` 掛載後接手系統切換與 `theme-color`。

主題（`styles/themes.css`）只覆寫 `tokens.css` 標了 `[theme]` 的變數：強調色三階、按鈕填色、
氛圍層三團色暈；「紙」連中性色一起換，「墨」是單色。每套主題深淺兩版都算過對比：
`--accent-text` 對 `--surface`、按鈕上的白字對漸層，全部 ≥ 4.5:1。新增一套主題 = `themes.css`
一段 + `lib/appearance.ts` 的 `THEMES` 一行 + 五個 locale 各一個名字。

偏好存本機而不是進網址：外觀是「我的螢幕」的事，分享連結不該把我的深色模式一起塞給
別人（語言則相反，見 `web/src/router.ts`）。

## 介面慣例

- **不用瀏覽器原生的 `confirm`／`prompt`／`alert`。** 它們不跟深淺色、不跟主題、不跟字體，一跳出來就是
  另一個世界。要問「確定嗎」一律走 `web/src/lib/confirm.ts` 的 `confirmDialog()`，畫面是
  `components/ConfirmDialog.vue`（掛在 App.vue，一次只有一個）。破壞性動作給 `danger: true`，焦點先落在
  取消鍵。唯一的例外是關分頁前的 `beforeunload`：那是瀏覽器強制的，換不掉。
- 圖示一律自繪 SVG（stroke 1.5～1.7），不用 emoji；箭頭類的 `→`／`↗` 是排版符號，可以用。
- 淡入一次、不做錯落；動效只有 `--dur`／`--dur-slow` 兩個時長。

## 統計與埋點

分工：**Cloudflare Web Analytics 管「有多少人來」**（頁面瀏覽、訪客、來源、Core Web Vitals，
面板一鍵開、免費、無 cookie），**Analytics Engine 管「他們做了什麼」**。兩邊不重複建設。

### 為什麼頁面瀏覽不由 Worker 記

前端是 SPA。榜單→卡片→作者的跳轉由 vue-router 接管，**連一次 HTTP 請求都不產生**；而
`run_worker_first` 只列了卡片頁與作者頁，首頁與搜尋頁的文件請求根本不進 Worker。所以「服務端
中間件記頁面瀏覽」在這個站上是結構性的零覆蓋。真正的行為信號是 API 呼叫本身——看榜單就會打
`/v1/cards`、看卡片就會打 `/v1/cards/:id`。

同源 fetch 帶的 `Referer` 是當前頁自己的網址，服務端問不出「從哪來」。所以每個站內 API 請求顯式
帶一個 `X-From` 頭（`web/src/lib/track.ts` 的 surface，由 router 在換頁時設）。分享連結的歸因則靠
HTML 首次載入那條路的 `Referer` 網域。快取不受影響：鍵是 URL，而存進去的回應沒有設 `Vary`。

### 事件

一個請求發**恰好一個**數據點：中間件先掛一份空的在 context 上，handler 往裡填只有它知道的東西
（結果數、排序鍵、卡片 id），回來之後補上路由、狀態、耗時、快取命中再發出去。

| 事件 | 來源 | 記什麼 |
|---|---|---|
| `list` / `search` | `/v1/cards` | 排序鍵、標籤、搜尋詞、結果數、翻頁深度、語言範圍 |
| `card_view` | `/v1/cards/:id` | roleId。**只有這一處**——HTML 殼多半是抓取器，卡片頁替作者發的「其他作品」副請求是 `/v1/cards?author=`，兩者都不算一次瀏覽，否則分母灌水三倍 |
| `author_view` | `/v1/authors/:id` | 作者 id、作品數 |
| `mine_view` | `/v1/me/cards` | 篩選、結果數 |
| `register` / `unregister` | `POST`/`DELETE /v1/cards` | roleId；失敗時 `outcome` 是 `forbidden`/`upstream_error` |
| `page_html` | `app.get("*")` | 站外來源網域、語言、卡片或作者 id |
| `sync` | cron | 成功數、失敗數、耗時 |
| `api` | 其餘請求 | 路由、狀態、耗時 |

服務端只看得到打本站 `/v1/*` 的那些。**評論、建立與編輯卡片、錢包全部是直接打上游的跨域請求，
外觀與語言切換更是連一次請求都不產生**——這些只能從前端回報：

| 事件 | 何時 | 記什麼 |
|---|---|---|
| `cta` | 點「開始對話」外連 | roleId、從哪一頁來 |
| `share` | 分享 | 走了 Web Share／剪貼簿／手動兜底／取消 |
| `login_start` `login_done` `login_fail` `logout` | 帳號流程 | 失敗時分得出是拒絕授權、狀態不符還是換 token 失敗 |
| `comment_tab` | 切到評論頁籤 | 面板一掛載就載入，所以真正的信號是切過去看 |
| `comment_post` | 發表或回覆 | 根評論還是回覆、成功或失敗 |
| `comment_like` / `comment_delete` | 按讚／刪除 | 讚是開還是關 |
| `card_create` / `card_edit` | 建立／編輯卡片 | 成功或失敗。作者供給側的漏斗斷在這裡，所以非記不可 |
| `wallet_view` / `topup_click` | 進錢包／點充值 | 變現信號 |
| `appearance` | 切外觀 | `detail` 是 `mode` 或 `theme`，實際選了哪一個放 `subject`——不然每加一套主題都要回來改白名單，忘了就靜默變空 |
| `locale_switch` | 切語言 | 目標語言 |
| `page_404` | 落到 404 | 斷鏈信號 |

blob 的順序（查詢時 `blob1..blob15`）：`event` `from` `route` `locale` `zoneScope` `country`
`refHost` `sortKey` `tag` `term` `subject` `outcome` `cache` `detail` `client`；
double 是 `durationMs` `resultCount` `offset` `status`。順序寫死在 `src/analytics.ts` 的 `BLOBS`，
改動要同步既有查詢。

### 採了什麼、沒採什麼

**不採**：原始 IP、完整 User-Agent、任何持久標識、cookie、accountNumId、token、電子信箱、
真實網址（搜尋詞在 query 裡，所以路由記模板）。`cf-connecting-ip` 只在記憶體裡用來判斷國家與
機器人，用完即棄、不落盤、不進任何欄位。

**搜尋詞採原詞**，但過三道形態過濾：截斷到 64 字元、含 `@` 或 `://` 丟棄、連續 9 位以上數字丟棄。
頻次門檻放在報表側（`HAVING n >= 5`）而不是採集側——零結果查詢的價值全部在長尾，只出現過一次的
詞才是內容缺口，在採集端按頻次砍等於把要找的東西先扔掉。加上 AE 90 天自動過期、沒有任何能把詞
關聯到人的鍵，殘留風險是「知道有人搜過什麼」而不是「知道某人搜了什麼」。

**卡片級瀏覽量採，但它永遠不可能進排序**——這不是靠註解約束，是物理上做不到：Worker 對
Analytics Engine **只有寫綁定，沒有讀介面**，`listCards()` 拿不到它。想接進排序得先申請一個
Cloudflare API token、寫一條跨服務的讀回路，那是要過 review 的重構。熱度仍然只吃上游的真實對話數。

**不做獨立訪客去重**。每日輪換鹽雜湊 IP 得到的是假名化資料，仍是個人資料，會推翻「無同意橫幅」
的前提。要看訪客數去 Cloudflare Web Analytics 的面板。

尊重 `DNT` 與 `globalPrivacyControl`：任一打開，前端一條事件都不發。

### 防濫用

`/v1/e` 是全站唯一不需要登入就能寫入的端點，四道門：同源 `Origin`、事件白名單（名單外**丟棄**
而不是記成 `unknown`）、`detail` 白名單、`subject` 收窄成 `[A-Za-z0-9_-]` 且截到 64 字元
（roleId 是 UUID、主題是小寫詞、語言像 `zh-Hant`，都落在這個字元集裡）。單次批量上限 20 條。任何一道沒過都靜默回 204，不給刷的人「我被擋了」的
回饋。**beacon 的數字天生可偽造，只能看趨勢，永遠不進排序、榜單或結算。**

### 查詢

計數一律 `SUM(_sample_interval)`，**絕不寫 `COUNT(*)`**。今天兩者相等，但 AE 在高流量下會自動
採樣，那一天所有歷史報表會同時說謊而且沒有任何報錯。採樣按 index 值分桶，而 index 是事件名，
所以 `register` 這種低頻事件有自己的預算，不會被 `list` 淹掉。哨兵查詢：

```sql
SELECT index1, MAX(_sample_interval) AS max_interval, SUM(_sample_interval) AS est
FROM hearthroom_events WHERE timestamp > NOW() - INTERVAL '1' DAY
GROUP BY index1 ORDER BY est DESC FORMAT JSON
```

任何一行 `max_interval > 1` 就是採樣開始了。發現路徑 → 卡片瀏覽 → 外連點擊：

```sql
SELECT blob2 AS surface,
       SUM(IF(blob1 = 'card_view', _sample_interval, 0)) AS views,
       SUM(IF(blob1 = 'cta', _sample_interval, 0)) AS cta
FROM hearthroom_events
WHERE timestamp > NOW() - INTERVAL '7' DAY AND blob1 IN ('card_view', 'cta') AND blob15 != 'bot'
GROUP BY surface ORDER BY views DESC FORMAT JSON
```

這是比值不是轉化率：分子來自不可信的 beacon，也無法確認哪次瀏覽產生了哪次點擊。用法是看趨勢與
橫向對比（搜尋來的人比榜單來的人更愛點嗎），不是看絕對值。同理，排序鍵分布因為
`Cache-Control: max-age=60` 會被瀏覽器快取截斷，它是「會話首次選擇分布」不是「點擊分布」。

### 啟用

Analytics Engine 要在 Cloudflare 面板上一次性啟用（Workers → Analytics Engine），**否則 wrangler 會
拒絕整個 deploy**——所以 `wrangler.toml` 裡的綁定目前是註解掉的，免得連帶擋住緊急修復。啟用之後
把那三行的註解拿掉再部署，事件就開始流了。

在那之前一切照常運作：`/v1/e` 收得下請求、`X-From` 照送、程式碼跑完整條路徑，只是 `emit()` 判空後
不寫任何資料點。這也是自架的預設狀態——沒配綁定不是錯誤。要連呼叫都省掉就把 `ANALYTICS_ENABLED`
設成 `"false"`。綁定是按帳號的，分叉寫進自己的資料集，結構上不會回傳給任何人。

## 可觀測性

Prometheus `/metrics` 不適用：Workers 沒有常駐進程可以被抓取。Cloudflare 原生的等價物是
Analytics Engine（見上一節）+ Workers Logs + 內建 request analytics。

延遲、狀態碼與快取命中率都在 `hearthroom_events` 裡（`durationMs`、`status`、`cache`），
不需要另一套指標系統。快取命中率也可以用回應的 `X-Cache` 標頭直接 curl 驗，不必等報表。

## 同步

每小時一輪，每輪最多 `SYNC_BATCH_SIZE`（50）張，抓取並發上限 `SYNC_CONCURRENCY`（6）。

兩個都不是隨手設的：串行抓取的總時間隨卡量線性成長，撞到 Worker 的執行時間上限之後，
那一批後面的卡整輪都不會同步——而且不會報錯，只是榜單悄悄停在舊值。並發上限壓在
個位數是因為目標是「明顯更快」，不是把上游打滿。

寫入是整批一次 `db.batch()` 而不是邊抓邊寫：D1 是單寫者，一筆一個往返的話寫入會蓋掉
並發抓取的收益。本地實測 30 張 × 20ms 延遲：串行下限 600ms、只並發抓取 381ms、
再把寫入批起來 124ms（4.8x）。代價是整批一起成功或一起失敗，對同步可以接受——
下一輪本來就會重跑。

## 已知天花板

- 分頁是 `LIMIT/OFFSET`，深分頁會變慢。
- 邊緣快取是**按節點**的，冷啟動時每個節點各要 miss 一次。要全球共享一份預熱好的
  榜單，在每輪同步後把前 N 名寫進 KV（榜單是公開資料，KV 的最終一致在這裡不構成缺點），
  讀取變成一次 KV get。
- 「登記完榜單立刻更新」需要一個全域強一致的代際計數器（Durable Object），
  把代際號拼進快取鍵。目前靠 60 秒 TTL 自癒。
- 每輪同步固定 50 張，卡量大到一小時輪不完一圈時要改成分片。
- 搜尋結果按熱度排，沒做 bm25 相關度——FTS 與 LIKE 兩條路徑的相關度語意不一致，
  統一用熱度比較好解釋。
- 榜單頁沒有 SSR，搜尋引擎收不到。要 SEO 的話，用 Worker 對爬蟲 user-agent 做 prerender。

## 技術選型：為什麼是 Vue 3 而不是 uni-app

- 這是網站，沒有小程式或原生 App 的目標，uni-app 最大的價值用不上
- `<view>`、rpx、中文文件對開源貢獻者是門檻
- **uni-app H5 裝得下普通 Vue 3 組件，反過來不行**——所以將來要接入 uni-app 味的
  聊天組件，加一層薄 shim 就能吃下；反向則要整包重寫。風險不對稱地偏向普通 Vue 3
