# 相容供應商協議（Provider Protocol）

Hearthroom 是一個社群維護的開源角色卡站。它自己**不存卡片、不跑模型、不管登入**：
帳號、卡片內容、對話全部住在「供應商」那邊，本站只擁有「誰登記了哪張卡、審到哪一步、
誰蓋了章」。目前唯一的供應商是 LunaTalk 開放 API（`/open/v1`）。

這份文件列出**一個供應商必須實作哪些介面，本站才能對它運作**。它不是供應商的完整
API 參考，而是本站實際依賴的那個子集，按能力分級：實作到哪一級，站台就能開到哪一級的功能。

文件與程式碼放在同一個倉庫，並有測試守著：本站程式碼裡打的每一條上游路徑都必須出現在
這份文件裡，改了程式碼沒改文件會讓測試變紅。

## 0. 通用約定

| 項目 | 約定 |
|---|---|
| 基底路徑 | 所有資源都在 `<API_BASE>/open/v1/...` 之下；`<API_BASE>` 由站台設定（見 §7） |
| 認證 | `Authorization: Bearer <token>`。token 來自 OAuth（使用者）或服務帳號金鑰（審核機器人） |
| 語言 | 請求可帶 `language` 標頭（`zh-Hant`、`zh-Hans`、`en`、`ja`、`ko`），供應商據此回傳人看的文字 |
| 游客可讀 | 這幾條不需要 Bearer：`GET /open/v1/role/detail`、`GET /open/v1/role/preview-page`、`GET /open/v1/comment/list`、`GET /open/v1/comment/replies`、`GET /open/v1/comment/count` |
| 錯誤封包 | 非 2xx 一律回 JSON `{ "error": "<snake_case_code>", "message": "<給人看的句子>", "retryable": <bool> }`；HTTP 狀態碼照語意（400／401／403／404／409／429／5xx） |
| 錯誤碼 | 本站會辨認並翻譯這些：`invalid_arguments`、`role_in_review`、`visibility_requires_review`、`public_role_requires_clone`、`permission_denied`、`not_found`、`conversation_limit_reached`、`service_account_forbidden`、`unauthorized`。其餘 `message` 若不是錯誤碼格式，會原樣呈現給使用者（例如內容審核的原因） |
| 服務自報 | 本站的排程與伺服器端請求帶固定的 `User-Agent`，供應商不應把它當成瀏覽器流量擋掉 |

`{{user}}`／`{{char}}`：卡片文本裡的這兩個標記由供應商在送進模型前替換，並且**不分大小寫**
（`{{User}}`、`{{CHAR}}` 同義）。`{{char}}` 換成角色名；`{{user}}` 的取值規則見 §6。

## 1. 第 0 級：身分（OAuth）

沒有這一級，站台只能當純瀏覽的榜單。

### 1.1 授權伺服器

| 端點 | 用途 |
|---|---|
| `POST /oauth/register` | 動態註冊（RFC 7591）。本站是公開客戶端：`token_endpoint_auth_method: "none"`，`grant_types: ["authorization_code", "refresh_token"]`，`redirect_uris` 是站台的回呼頁。回 `client_id`，站台會記住重用 |
| `GET /oauth/authorize` | 授權碼流程，必須支援 PKCE `S256`（`code_challenge`／`code_challenge_method`）與 `state`；本站另外帶 `resource`（RFC 8707）指定 token 的目標資源 `<API_BASE>/open/v1` |
| `POST /oauth/token` | `grant_type=authorization_code`（帶 `code_verifier`）與 `grant_type=refresh_token`。回 `access_token`、`expires_in`，可回 `refresh_token`；refresh token 可以是一次性的（本站每次都存新的那顆，且同一時間只發一個換發請求） |
| `POST /oauth/revoke` | 登出時撤銷 refresh token。失敗不影響本地登出 |
| `GET /.well-known/oauth-protected-resource/open/v1` | 受保護資源中繼資料（RFC 9728）；非必要，但供應商若提供，客戶端可從中發現授權伺服器 |

token 的作用範圍就是使用者自己授權給站台的那些；本站不需要、也不應拿到任何超出使用者
權限的東西。使用者的 token 只在單一請求裡被轉發，不落資料庫、不進快取、不寫日誌。

### 1.2 「你是誰」

| 端點 | 憑證 | 回應 |
|---|---|---|
| `GET /open/v1/me` | 使用者 token 或服務帳號金鑰 | `{ accountNumId: number, nickName: string, avatar: string, accountType?: string }` |

`accountNumId` 是使用者的**公開數字 ID**，本站以它識別成員；供應商內部的 UUID 不應出現在任何回應裡。

## 2. 第 1 級：讀卡與登記

有了這一級，作者能把卡片登記到本站，站台能同步、上榜、搜尋。

| 端點 | 憑證 | 何時 |
|---|---|---|
| `GET /open/v1/role/detail?roleId=` | 無 | 登記時、每小時同步時讀公開欄位 |
| `GET /open/v1/role/preview-page?roleId=` | 無 | 卡片頁顯示作者設計的預覽頁 |
| `GET /open/v1/role/mine?pageNum=&pageSize=&creationMethod=` | 使用者 token | 「我的卡片」：列出作者自己的卡；`creationMethod` 篩出本站建的 |
| `GET /open/v1/role/author-asset/serve?roleId=` | 無或使用者 token | 玩家面的作者資產（正則規則、美化）；卡片頁畫開場白時用 |
| `GET /open/v1/comment/list`、`/comment/replies`、`/comment/count` | 無 | 卡片頁的留言 |
| `POST /open/v1/comment`、`/comment/like`、`/comment/delete` | 使用者 token | 留言、按讚、刪自己的留言 |
| `GET /open/v1/me/wallet`、`GET /open/v1/me/score/records?pageNum=&pageSize=` | 使用者 token | 錢包頁：餘額、方案、點數紀錄（供應商沒有計費概念時可回空） |

### 2.1 `role/detail` 本站讀的欄位

只列本站會讀的；多回的欄位會被忽略。

| 欄位 | 型別 | 說明 |
|---|---|---|
| `characterRoleId` | string | 卡片 ID |
| `accountNumId`／`authorName`／`authorAvatar` | number／string／string | 作者公開 ID 與顯示資訊 |
| `roleName`、`roleNameEn`、`roleNameJa`、`roleNameKo` | string | 名稱，主語言加三個翻譯（缺的留空） |
| `roleDesc`、`roleDescEn`、`roleDescJa`、`roleDescKo` | string | 簡介，同上 |
| `roleAvatar`、`roleBackground` | string | 圖片 URL |
| `slug` | string | 可選的短網址 |
| `roleTag` | 陣列：字串或 `{ text }`／`{ tagName }` 物件 | 標籤；站台前端另外也收 JSON 字串與逗號字串 |
| `roleWelcome` | string | 開場白，進搜尋索引 |
| `language` | string | 語言標記；`zh*` 併成中文區，`en`／`ja`／`ko` 各自一區，其他當「不分區」 |
| `talkNum`、`followNum` | number | 熱度：對話數與追蹤數，榜單用 |
| `creationMethod` | string | 建卡來源；本站建的卡自報固定字串，供應商原樣存回 |

`role/mine` 每筆另外帶 `roleVisibility`（可見性），「我的卡片」據此顯示狀態；不是公開的卡登記不了。

## 3. 第 2 級：審核

有了這一級，社群審核人員能在站內讀到作者提交那一版的完整設定，並確認上榜的內容沒被偷換。
沒有這一級，站台退回「登記即上榜」，仍然可用。

### 3.1 服務帳號

供應商需要讓人類帳號建立**服務帳號**並發金鑰。本站在供應商那邊持有一個服務帳號當
「審核機器人」；金鑰是站台的 secret，公開數字 ID 是一般設定（見 §7）。

服務帳號金鑰只能打**白名單**裡的路徑：`GET /open/v1/me`、`GET /open/v1/share/role/detail`、
`GET /open/v1/share/role/content-hash`。其餘（聊天、消費、建卡、留言）一律拒絕並回
`service_account_forbidden`。這是供應商端必須守的邊界，不是站台的善意。

| 端點 | 憑證 | 用途 |
|---|---|---|
| `POST /open/v1/service-accounts` | 使用者 token | 建立服務帳號並發金鑰 |
| `GET /open/v1/service-accounts` | 使用者 token | 列出自己的服務帳號 |
| `POST /open/v1/service-accounts/keys/revoke` | 使用者 token | 撤銷金鑰 |

### 3.2 逐卡授權

授權綁在**內容版本**上：作者提交時把卡授權給審核機器人，站台記下當時的內容雜湊；
每小時同步比對，內容變了就退回待審。

| 端點 | 憑證 | 何時 |
|---|---|---|
| `POST /open/v1/share/role/grant` `{ roleId, granteeAccountNumId }` | 作者 token | 提交審核時，由站台轉發 |
| `POST /open/v1/share/role/revoke` | 作者 token | 作者撤回授權（站台目前不呼叫，但供應商應提供） |
| `GET /open/v1/share/role/list` | 作者 token | 作者查看自己授權了誰 |
| `GET /open/v1/share/role/detail?roleId=` | 服務帳號金鑰 | 審核人打開審核頁：回完整設定（人設、對話範例、開場白、世界書、正則規則、標籤） |
| `GET /open/v1/share/role/content-hash?roleId=` | 服務帳號金鑰 | 提交時記版本、每小時同步比對 |

供應商在 grant 成功時應通知作者（授權給了誰、哪張卡），撤銷同理。

## 4. 第 3 級：作者寫入

有了這一級，作者能在站內建卡、編輯、發布，不必回供應商的介面。每一條都用**作者自己的
token 直接打供應商**（跨域，不經過站台伺服器），權限就是作者對自己卡片的權限。

### 4.1 卡片

| 端點 | 用途 |
|---|---|
| `POST /open/v1/role` | 建一張私有卡（建卡不填卡片層級的玩家稱呼，見 §6） |
| `PATCH /open/v1/role/:roleId` | 改基本資料（名稱、簡介、頭像、背景、標籤、語言） |
| `DELETE /open/v1/role/:roleId` | 刪卡（站台目前不呼叫） |
| `POST /open/v1/role/:roleId/document` | 寫人設與對話範例等長文本 |
| `PATCH /open/v1/role/:roleId/welcome` | 改開場白 |
| `GET /open/v1/role/validate?roleId=` | 發布前檢查：回缺了什麼 |
| `POST /open/v1/role/:roleId/publish` | 送交供應商審核／發布 |
| `POST /open/v1/role/:roleId/visibility` | 改可見性；供應商可用 `visibility_requires_review` 要求先過審 |
| `GET /open/v1/role/author-asset?roleId=` | 讀作者自己的資產（正則規則、美化） |
| `PUT /open/v1/role/:roleId/author-asset` | 整份覆寫作者資產 |
| `DELETE /open/v1/role/:roleId/author-asset` | 清空作者資產（站台目前不呼叫） |
| `GET /open/v1/tag/canonical?language=` | 標籤詞表；拿不到就不擋建卡 |

### 4.2 世界書

| 端點 | 用途 |
|---|---|
| `POST /open/v1/worldbook` | 建世界書 |
| `GET /open/v1/worldbook/mine` | 作者自己的世界書 |
| `GET /open/v1/worldbook/bindings?roleId=` | 這張卡綁了哪些世界書 |
| `GET /open/v1/worldbook/detail`、`GET /open/v1/worldbook/entry/list?worldbookId=` | 讀世界書與條目（舞台與審核頁也用） |
| `POST /open/v1/worldbook/:worldbookId/document` | 以操作清單改條目（新增／更新／刪除／綁定） |
| `POST /open/v1/worldbook/:worldbookId/entries/reorder` | 條目排序 |

### 4.3 素材庫

| 端點 | 用途 |
|---|---|
| `POST /open/v1/image/upload` | 上傳（圖片／影片／音訊／字型），multipart |
| `GET /open/v1/image/list`、`GET /open/v1/image/folder/list` | 列檔案、列資料夾 |
| `POST /open/v1/image/delete` | 刪檔案 |
| `POST /open/v1/image/folder/create`、`/image/folder/rename`、`/image/folder/delete` | 資料夾管理 |
| `POST /open/v1/image/folder/addItems`、`/image/folder/removeItems` | 檔案進出資料夾（資料夾是標籤，一檔可在多夾） |

## 5. 第 4 級：遊玩

站內試玩用的是開源對話舞台（本倉庫的 `stage/` 子模組）。舞台是這一級的**正典消費者**：
它打的每一條路徑都在它的端點表裡（`stage/src/config/request-url.js`），這裡按功能分組列出。
舞台以 `api.base` 設定主機，路徑一律相對於 `/open/v1`。

只實作部分的行為目前**未定義**：舞台假設整組都在。哪些可省略、省略時介面怎麼退化，是待決事項（§8）。

| 分組 | 端點 |
|---|---|
| 對話主迴圈 | `POST /open/v1/conversation/start`、`/conversation/stop`、`/conversation/rewrite`、`/conversation/rewrite-by-id`、`/conversation/suggest-reply`、`/conversation/ws-ticket`；`GET /open/v1/conversation/operations`、`/conversation/replay`、`/conversation/messages`、`/conversation/list`、`/conversation/prompt-diagnostics` |
| 對話管理 | `POST /open/v1/conversation/delete`、`/conversation/delete-message`、`/conversation/save-and-start-new`、`/conversation/title`、`/conversation/switch`、`/conversation/fork`、`/conversation/backward`；`GET /open/v1/conversation/archives` |
| 長期指令 | `GET /open/v1/conversation/directives`；`POST /open/v1/conversation/directive/add`、`/conversation/directive/update`、`/conversation/directive/delete` |
| 記憶 | `GET /open/v1/conversation/memory/:conversationId/atoms`；`DELETE /open/v1/conversation/memory/:conversationId/atoms/:atomId` |
| 手帳 | `GET /open/v1/conversation/notepad`、`POST /open/v1/conversation/notepad/save`；範本：`GET /open/v1/notepad/templates`、`GET /open/v1/notepad/template`、`POST /open/v1/notepad/template/save`、`/notepad/template/delete`、`/notepad/template/share`、`/notepad/template/share/revoke` |
| 玩家設定 | `GET /open/v1/player/preference`、`POST /open/v1/player/preference/save`（外觀）；`GET /open/v1/player/role-settings`、`POST /open/v1/player/role-settings/save`（這張卡的稱呼、自我介紹、模型、上下文檔位、`personaMode`）；`GET /open/v1/player/persona`、`POST /open/v1/player/persona/save`（全局人設，見 §6）；`GET /open/v1/player/agent-mode`、`POST /open/v1/player/compact-preference` |
| 模型 | `GET /open/v1/models`、`GET /open/v1/models/uptime-history` |
| 試玩卡 | `PUT`／`GET`／`DELETE /open/v1/trial-cards/:clientKey`（把本機的酒館卡建成會自動到期的私有卡） |
| 分享碼 | `GET /open/v1/share/preview`、`POST /open/v1/share/import` |
| 讀路徑 | `GET /open/v1/role/detail`、`GET /open/v1/role/author-asset/serve`、`GET /open/v1/worldbook/detail`、`GET /open/v1/worldbook/entry/list` |

## 6. 玩家人設與 `{{user}}`

供應商必須照這個優先序決定 `{{user}}` 與「角色怎麼叫玩家」：

1. 這張卡的**單獨設置**（`player/role-settings` 裡 `personaMode = custom` 時的稱呼、性別、自我介紹）；
2. 帳號層級的**全局人設**（`player/persona`；`personaMode = global`，或卡片沒設過）；
3. 只用暱稱（`personaMode = name_only`），或以上都留空時：使用者的 `nickName`；
4. 連暱稱都沒有：依語言的通用稱呼（「你」、"you" 等）。

`personaMode` 三個值：`name_only`（僅使用稱呼）、`global`（全局人設）、`custom`（單獨設置）。
沒帶時：這張卡有任何單獨欄位就當 `custom`，否則 `global`。

卡片本身**不再帶玩家稱呼**：本站建卡時卡片層級的稱呼欄位一律留空，供應商也不該把它當成
`{{user}}` 的來源。像「你」「玩家」「user」這類佔位詞若出現在舊卡的該欄位，應視為未設定。

長度：稱呼 ≤ 20 字、自我介紹 ≤ 1000 字；稱呼與自我介紹要過供應商的內容審核，被擋時
`message` 說原因。

## 7. 站台怎麼接一家供應商

現況：**一家供應商是設定加一小段程式碼**，不是執行期外掛。

| 位置 | 設定 |
|---|---|
| 前端建置 | `VITE_LUNATALK_API_BASE`：使用者瀏覽器直接打的 `<API_BASE>`；OAuth 的 `resource` 是 `<API_BASE>/open/v1` |
| 站台伺服器（Worker） | `LUNATALK_API_BASE`：同步、身分確認、審核呼叫用的 `<API_BASE>`；可另設一個地區備援位址 |
| 審核機器人 | `REVIEW_BOT_KEY`（secret）與 `REVIEW_BOT_ACCOUNT_NUM_ID`；兩個都缺就退回「登記即上榜」 |
| 程式碼 | `src/providers.ts`：供應商代號的聯集型別與 `reviewBotOf()`；成員、身分、卡片、審核單都帶供應商欄位，接第二家時資料表不用改 |

## 8. 待決事項

- 第 4 級只實作一部分時，舞台該怎麼退化（哪些功能可以不在、缺了顯示什麼）。
- 供應商的欄位級完整規格（每個請求與回應的全部欄位）目前不對外發布；本文只寫本站讀寫的那些。
- 這份文件只有正體中文版。
- 除 LunaTalk 之外還沒有第二家供應商真正接過；§7 描述的是程式碼現在的樣子，不是驗證過的移植經驗。
