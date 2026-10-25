# 開發者文件

Hearthroom API 可讓你瀏覽社群角色卡、尋找作者、讀寫留言，並管理自己的收藏、追蹤與通知。

本頁包含兩份 OpenAPI 3.1 參考文件：

- **Hearthroom 社群 API**（`docs/community-openapi.json`）：網站的 `/v1` 端點，提供社群瀏覽與會員社交功能。
- **服務整合 API**（`docs/integration-openapi.json`）：網站與內嵌聊天用戶端使用的身分、角色卡創作、媒體及對話介面。這些請求會送往所連接服務的 API 來源網址。

路徑、欄位名稱、權限範圍（scope） 與操作識別碼保持與既有整合契約相容。服務可逐步實作支援的功能群組；用戶端呼叫選用操作前，必須先檢查服務宣告的功能。本文件說明整合介面，不涵蓋特定服務的部署設定或商業條款。

## 快速開始

公開瀏覽不需要登入：

```sh
curl 'https://hearthroom.club/v1/cards?zone=en&sort=new&limit=12'
curl 'https://hearthroom.club/v1/tags?zone=en&limit=12'
```

角色卡清單回傳 `items`、`hasNext`、`limit`、`offset`。使用角色卡的 `id` 讀取詳情與留言。作者連結使用作者的公開 `handle`。

## 社群請求與身分驗證

| 主題 | 慣例 |
|---|---|
| 基底 URL | `https://hearthroom.club`；文件中的路徑以 `/v1` 開頭。自行架設的站點使用自己的來源網址。 |
| 公開讀取 | 標示為**無須驗證**的端點接受匿名請求。選擇性身分驗證可能影響可見內容與檢視者專屬欄位。 |
| 會員請求 | 使用經授權登入 Hearthroom 後取得的目前存取權杖，傳送 `Authorization: Bearer <access_token>`。僅有瀏覽器 Cookie 無法驗證這些端點。本 API 不核發獨立的開發者金鑰。 |
| 請求本文 | 端點定義本文時，請以 `Content-Type: application/json` 傳送 JSON。 |
| 顯示語言 | 角色卡與作者瀏覽接受 `lang`；角色卡文字未指定時，依序採用第一個 `Accept-Language` 值、中文。 |
| 內容語言 | `zone` 以 `zh`、`en`、`ja`、`ko` 或 `all` 篩選看板。預設為 `zh`；與顯示語言分開。 |
| 識別碼 | 角色卡 `id` 與會員 `handle` 為公開識別碼。請將識別碼視為不透明值，並使用 API 回傳的值。 |
| 時間戳記 | 數字時間戳記使用 Unix 毫秒。留言 `createTime` 為 ISO 8601 字串。 |

已驗證請求代表目前登入的會員操作。呼叫端不可透過在請求加入 ID 來選擇其他會員。私人結果不可存入共用快取。

## 瀏覽與分頁

角色卡搜尋與看板篩選使用 `GET /v1/cards`。重複 `tag` 要求符合所有所選標籤群組；`hide` 是以逗號分隔的分類鍵清單。明確選擇的標籤優先於隱藏分類。`author` 篩選使用公開 handle，並忽略 `zone`。

角色卡、標籤與作者清單使用 `offset` 與 `limit`；`hasNext` 表示是否還有下一頁。角色卡 `total` 可能為 `null`，不可只靠此值判斷分頁。收藏、追蹤與追蹤作者動態每頁回傳 24 筆。留言與回覆使用從 1 開始的 `page`，每頁 20 筆。

公開看板結果包含已上架角色卡。角色卡直接連結也可能回傳可用預覽；可存取連結不代表角色卡已通過社群審核。隱藏或無法使用的角色卡會被省略，或回傳 404。成人內容需要已驗證會員，並啟用網站的年齡與可見性設定；未取得存取權而直接請求時，回傳 403 與 `adult_content`。

## 留言與會員收藏

留言屬於社群角色卡。API 支援頂層留言與各留言下的一層回覆討論串。留言去除首尾空白後須為 1–500 個 Unicode 字元；每位會員每分鐘最多發表六則留言。

留言作者、角色卡作者與獲授權的管理員可刪除留言。刪除頂層留言也會隱藏其回覆。按讚與取消按讚操作具等冪性。

收藏使用角色卡 `id`；追蹤使用作者 `handle`。`GET` 讀取目前狀態，`PUT` 新增，`DELETE` 移除。動態包含追蹤作者的作品。通知僅收件者可見；將通知標為已讀不會授予存取他人通知的權限。

## 社群錯誤

錯誤使用非 2xx HTTP 狀態與 JSON `error` 字串，有時另附 `detail` 物件。字串可能是代碼或簡短句子；用戶端處理時應保留 HTTP 狀態。

| 狀態 | 意義 |
|---|---|
| 400 | 缺少或無效輸入，例如空白留言或過多標籤。 |
| 401 | 缺少身分驗證，或驗證已失效。 |
| 403 | 會員無法執行此操作或存取所請求內容。 |
| 404 | 呼叫端無法使用所請求資源。 |
| 429 | 請求超過速率限制，例如 `comment_rate_limited`。 |
| 5xx | 服務無法完成請求。 |

本參考文件涵蓋瀏覽與會員社交功能。工作人員審核、帳號復原、發布流程與內部自動化不在此範圍。

## 服務整合

服務 API 使用另外設定的 `<API_BASE>`。主要資源位於 `/open/v1`；OAuth 與探索功能使用參考文件列出的路徑。社群 `/v1` 路由與服務 `/open/v1` 路由具有不同的來源網址、身分驗證情境與資料擁有權。

| 範圍 | 用戶端契約 |
|---|---|
| 身分 | OAuth 授權碼流程搭配 PKCE、權杖更新／撤銷，以及 `GET /open/v1/me`。 |
| 角色卡創作 | 角色卡詳情、作者自己的清單、文件更新、開場訊息、呈現素材、Lorebook 與媒體。 |
| 對話 | 開始／繼續、WebSocket 訊息、歷史紀錄、操作狀態、停止與重新連線。 |
| 玩家資料 | 人設、回覆設定、封存、記憶與手帳，受擁有權與宣告支援範圍限制。 |
| 託管與審核 | 使用文件規定的作者憑證與伺服器持有的核發者憑證，交換版本與決定。社群審核與上架仍由社群決定。 |

### 授權與私人資料

用戶端透過 `/oauth/register` 註冊允許的回呼網址，向 `/oauth/authorize` 傳送 PKCE `S256`、`state` 與目標資源，再於 `/oauth/token` 交換回傳的授權碼。服務 API 存取資源為 `<API_BASE>/open/v1`。更新與撤銷使用參考文件中的端點；權杖僅對已授權 scope 與資源有效。

使用者呼叫傳送 `Authorization: Bearer <access_token>`。`role.read` 可能包含作者私人的角色卡指示與 Lorebook；`role.write` 允許變更資源，包含適用的媒體操作。`chat.play` 允許可能消耗點數的對話操作。`referral` 允許讀取使用者的推薦碼，並替新註冊的使用者填入推薦碼；綁定是永久的，請先向使用者確認。整合端必須在授權時說明這些影響，並對每個私人操作強制檢查擁有權。

公開角色卡存取權不授予編輯或私人匯出權限。社群會員 handle、角色卡編號與服務資源 ID 分別識別不同事物；用戶端必須使用各端點要求的識別碼。需要 `X-Hosting-Key` 時，此值為伺服器持有的核發者憑證，絕不可傳給瀏覽器程式碼。個人 API 金鑰為選用功能；格式與核發方式不在此參考文件範圍。

### 對話生命週期

1. `POST /open/v1/conversation/start` 開啟或繼續對話，不生成模型回覆。繼續對話時帶上 `firstPageSize`，同一個回應就會附上歷史第一頁（`firstPage`），不必再另外請求歷史。
2. `POST /open/v1/conversation/ws-ticket` 使用使用者 bearer 權杖取得短效、一次性票證。
3. 用戶端開啟 `/open/v1/conversation/ws`，傳送驗證訊框，再傳送回合訊框。票證端點的 **WebSocket 協定** 區段說明訊框、事件、完成與重播欄位。
4. 歷史紀錄與操作狀態端點提供持久化結果。`POST /open/v1/conversation/stop` 要求取消；用戶端依操作最終狀態判斷結果。

重新連線必須重複使用串流身分與重播位置，不可再提交另一個付費回合。選用的 Agent 接續功能，只有在服務回報進度已保留時才使用 `resumeFromOperationId`。遭拒的接續不可默默改為新的付費請求。

### 選用功能與錯誤

回覆偏好需要 `responseSettingsVersion=1`。媒體搜尋、排序與作者相對路徑需要回應提供對應功能。多則回覆建議與 Agent 準備也依服務支援情況而定。僅有相符路徑，不足以證明功能已啟用。

價格、餘額、模型可用性、儲存上限與保留政策由所連接的服務決定。用戶端必須使用回傳的功能與費用資訊，依需要取得付費操作確認，並區分完整回覆、部分輸出、取消與失敗。

服務錯誤與身分驗證失敗，遵循各端點結構定義與整合參考文件的「補充說明」區段，與前述社群錯誤格式分開。未知的選用功能應維持不可用，不可從服務名稱自行推斷。

## 分享圖片與文案

卡片腳本可以在玩家點擊按鈕後分享圖片與文案。HTTPS 卡片框架由宿主委派 `web-share` 與 `clipboard-write`：`navigator.share` 可接收預先準備的圖片 `File` 與文字；`navigator.clipboard.write` 搭配 `ClipboardItem` 可寫入 PNG，`navigator.clipboard.writeText` 可寫入文案。這些是瀏覽器能力，不是新增的 `sdk` 方法或 HTTP 端點。

請在點擊前準備好檔案，在點擊處理函式內直接呼叫，保留使用者啟動狀態。提供操作前先檢查 `navigator.share`、`navigator.canShare({ files: [file] })`、`navigator.clipboard.write` 與 `ClipboardItem`。支援情況取決於瀏覽器、作業系統、權限與接收 App，分享後不保證圖片和文字都保留。請捕捉拒絕與取消；不支援或被拒絕時提供下載圖片與可選取的文案，取消後不要自動重開分享面板。宿主不委派 `clipboard-read`。本機不透明來源的預覽仍可能拒絕呼叫，請在目標裝置的實際跨來源卡片上驗證。

## 帶情境的分享連結

卡片腳本可以產生一條帶情境碼的分享連結：朋友從這條連結開卡時，腳本讀得到同一個碼，卡片就能做出「你朋友選了這個，換你」。`sdk.share.link(code)`（一般卡為 `window.stage.share.link`）同步回傳這張卡的分享連結：卡片頁 `/cards/<number>`，帶著已登入玩家的推薦碼，給了情境碼就再加上 `?share=<code>`。請在點擊前產生連結，在點擊處理函式內交給 `navigator.share`。

朋友那一端以 `sdk.share.context` 讀回情境碼；沒有，或正在看自己過去的對話時是 `null`。情境碼只收 1–64 個英數字與 `.`、`_`、`-`，開頭須為英數字；不合規則時沙盒卡丟出 `SHARE_CONTEXT_INVALID`，一般卡得到 `null`。平台只負責送到：情境碼不會送進模型、不含玩家資料，而且任何人都能手打，請只接受卡片自己定義的碼。朋友是否已有存檔由卡片判斷（例如 `sdk.archive.list()`；遊客沒有存檔）。

`sdk.share.audience` 表示誰打得開這條連結：`author`（僅自己可見的卡，新朋友打不開）、`link` 或 `public`。平台開關關閉時 `sdk.share.enabled` 為 false，`context` 為 `null`，`link()` 回傳不帶情境的一般連結。`sdk.share.qr(text)` 回傳 `{ size, path }`（`size` × `size` 格的 SVG path），可畫進分享圖。推薦碼較晚取得時會觸發 `share:change`。作者可以用 `?mode=source&share=<code>` 在草稿上測試。

## 投票、共鬥計數與分享回流

在 `rules.json` 的 `sharedState` 宣告的投票與計數器，由所有玩這張卡的人共用。`sdk.shared`（一般卡為 `window.stage.shared`）提供讀寫：

- `read(keys)` 收一個 key 或最多 16 個，回傳 `{ [key]: { kind: 'poll', counts, total, mine? } | { kind: 'counter', total, mine?, goal?, reachedAt?, previous? } }`。沒宣告的 key 不在結果裡；`mine` 是玩家自己投的選項或貢獻，遊客沒有；`previous` 是上一期的總數。
- `vote(key, option)` 回傳 `{ mine }`。同一題每人每天最多投或改 10 次，第一次投票也算；投回同一個選項不算。
- `add(key, delta)` 加上 1 到該計數器 `maxStep` 之間的整數，回傳 `{ total, mine, reachedAt }`。
- `leaderboard(key, { limit })` 回傳 `{ items: [{ rank, name, value }], mine? }`：這一期貢獻最多的玩家（預設 10 名，最多 50 名），以公開暱稱顯示，不列出測試帳號。計數器的 `total`、`mine` 和排行榜，每一期都重新開始。

所有人都能讀；寫入需要已登入、而且玩過這張卡的玩家（開過一段對話即可）。數字不會主動推給卡片，請自行重讀，間隔至少 10 秒。作者可以在自己任何一張卡上試，包括全新的私卡和 CLI 推的試玩卡；作者的數字跟玩家的分開。

分享回流建立在分享連結上。`sdk.share.tallyLink(code, pollKey)` 為宣告了 `share: true` 的投票產生帶平台短碼（`?share=~XXXXXXXX`）的連結。這是非同步呼叫，請在點擊前準備好；同一組情境碼與投票會拿回同一條連結，每位玩家每天最多 20 條，連結 90 天內有效。朋友開啟後，`sdk.share.context` 是情境碼，`sdk.share.poll` 是可以回答的題目 `{ key, options }`（沒有時為 `null`），以 `sdk.share.respond(option)` 回答。這些回答每條連結各記一份，跟這題本身的投票分開。分享者用 `sdk.share.results()` 讀自己發出的連結，每筆是 `{ context, pollKey, total, counts, updatedAt }`：`total` 即時更新，`counts` 要有 3 位朋友回答才出現，每天更新一次。卡片不會知道誰分享、誰回答。卡片可以依這些數字解鎖卡內內容，但不會因此發放平台積分。

兩種頁面使用同一組錯誤碼：`SHARED_DISABLED`（平台或作者已暫停）、`NOT_DECLARED`、`OPTION_INVALID`、`NOT_ELIGIBLE`（還沒玩過，或回答自己的連結）、`UNAUTHORIZED`（未登入）、`RATE_LIMITED`（稍後再試）、`LIMIT_REACHED`（`err.data.reason` 為 `goal` 或 `limit`）、`HOST_DENIED`（舊版遊玩頁；看過去的對話或審核試玩時只能讀；從沒送審、也沒設過能見度的卡，例如試玩卡，不能用 `tallyLink` 產生回流連結，因為別人打不開）。作者試玩（`?mode=source`）與測試帳號各有自己的一份數字，不混進玩家的；可以在編輯頁的「玩家投票與計數」或用 `hearthroom card state` 查看、暫停與歸零。
