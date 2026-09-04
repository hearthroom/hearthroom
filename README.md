# Taproom

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

**沒有服務帳號、沒有特殊金鑰、沒有私有介面。** 轉發的 token 只在那一個呼叫裡出現，
用完即棄：不落 D1、不進 KV、不寫日誌。改掉 `LUNATALK_API_BASE` 就能指向別的部署。

為什麼登記非得問上游一次：「這張卡是我寫的」這個事實只存在於上游的資料庫，本地
怎麼算都變不出來，任何在客戶端推導的方案都可偽造。但這不需要特權——轉發使用者
自己授權的 token 去問「你是誰」，權限範圍不超過他本來就給出去的那些。

登入走 OAuth（Authorization Code + PKCE）。這是瀏覽器應用，屬於 public client，
沒有 client secret 也不能有——`client_id` 用動態註冊（RFC 7591）取得並存在瀏覽器本機，
所以任何人 fork 這個站、換個網域部署都能直接跑，不必先來跟誰登記。

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

## 部署

```bash
npm run migrate:remote
npm run deploy              # predeploy 會先跑 typecheck + 測試 + 前端 build
```

自架時要改的只有 `wrangler.toml` 的 `routes`（換成你的網域）與 `LUNATALK_API_BASE`，
以及 `web/src/lib/site.ts` 的站台名稱。

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

## 可觀測性

Prometheus `/metrics` 不適用：Workers 沒有常駐進程可以被抓取。Cloudflare 原生的等價物是
Workers Analytics Engine + Workers Logs + 內建 request analytics。

目前先不接 Analytics Engine——沒有流量，加了也沒東西可看。快取命中率先用回應的
`X-Cache` 標頭觀察，那個不需要任何額外基礎設施就驗得出來。接 Analytics Engine 時
落點是 `src/index.ts` 的 `onError`、`syncBatch` 與 `/v1/me/cards`，低基數標籤只放
`result`（ok/not_found/upstream_error）、`route` 與 `cache`（hit/miss/bypass）；
**roleId、accountNumId、查詢字串一律不准進標籤或日誌**。

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
