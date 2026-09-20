# 對話、收藏與關注

需求：玩家能找回之前玩過的卡、保存想玩的作品、追蹤作者。首頁作者總榜改為關注作者的新作品。本次不新增通知推送、私訊或獎勵發放。

## 入口與資料

- 桌面導覽與手機導覽都有「對話與收藏」，包含最近對話、收藏卡片、關注作者；帳號選單和個人頁也能進入。
- 對話清單由社群成員擁有，儲存在本站 `member_conversations`。播放器成功開啟對話後，由 `updateConversationId` 事件登記服務、角色與續玩識別；同一成員／服務／角色更新同一筆最近對話。列表只讀本站 `/v1/me/conversations`，不抓取任一家服務的 `/conversation/list`，也不自動匯入外部歷史。
- 對話清單不顯示服務標籤。續玩連結內部保留服務資訊，播放器使用該服務的憑證及 API；社群登入身分不因遊玩或查看積分而改變。卡內其他存檔與聊天本文仍由遊玩服務託管，此次未搬移聊天本文或重寫對話引擎。
- 「我的卡片」保留跨服務合併的作品列表。積分頁同頁列出各服務的餘額、會員與流水，單一服務讀取失敗不隱藏另一家；金額不相加、不暗示可以跨服務抵用。只有開始玩卡時選擇可用服務。
- 收藏與關注由 Hearthroom 成員擁有。`member_favorites` 指向本站卡 ID，`member_follows` 指向本站作者成員 ID；複合主鍵使 PUT 可重放，DELETE 可重放且可以重新加入。
- 私有 `/v1/me/favorites`、`following`、`feed` 回應禁止快取。身分由現有 requireMember 驗證，不能從參數指定另一個成員。收藏／動態沿用 approved、NSFW 年齡開關、隱藏類型及分發副本去重。
- 帳號連接的空帳號判定包含收藏、主動關注與被關注，交易內重查，避免合併時 cascade 刪掉社群紀錄。
- 作者主頁關注、卡片主頁收藏，按下即顯示忙碌並防止重送；成功讀回狀態，失敗保留原值及重試入口。再次點擊可取消，沒有多餘確認框。
- 首頁關注動態依作品發布時間排序，跨內容語言，以介面語言選可用標題；未登入有登入引導，未關注有作者主頁引導。

## 契約與觀測

| 方法與路徑 | 回應與用途 |
| --- | --- |
| GET `/v1/me/conversations` | `conversations, hasNextPage`；`pageNum` 每頁 24 筆，跨已連接身分的社群清單 |
| PUT `/v1/me/conversations` | `roleId, conversationId`；只寫驗證成員自己的私有紀錄，重放更新同一筆 |
| GET `/v1/me/favorites`、`/v1/me/feed` | `items, hasNext, total, offset, limit`；`offset` 分頁，每頁 24 張，`lang` 選標題語言 |
| GET `/v1/me/following` | `items, hasNext, offset, limit`；公開作者 handle/name/avatar/bio，每頁 24 位 |
| GET/PUT/DELETE `/v1/me/favorites/:cardId` | `active, count`；讀取、收藏、取消；count 為本站收藏數 |
| GET/PUT/DELETE `/v1/me/following/:handle` | `active`；讀取、關注、取消 |

上述路徑都要求現有 Bearer token 與 X-Provider，未驗證為 401，不存在或不可見目標為 404；每次只操作登入中的社群成員。Provider OpenAPI 未改動，這些是社群自己的 HTTP 契約。

Hearthroom 是獨立社群客戶端，沒有 MCP transport。Provider 對話能力沿用其既有公開契約；社群的私有關注／收藏不屬於 Provider 帳號資料，不在本次向 Provider MCP 或 Moonloom 引入跨服務存取。未宣稱完成社群 MCP 支援。

`hearthroom_library_requests_total` 為儲存在 D1 的累積 counter，`operation` 只用 favorites/following/feed/conversations × get/put/delete，`outcome` 只用 success/denied/error；沒有身分、卡號、聊天或搜尋字詞。每次 API 完成後依 HTTP 結果加一，觀測寫入失敗不影響業務。`GET /metrics` 提供 Prometheus 格式，Worker 重啟不會重置數值。驗證：`sum by (operation,outcome) (increase(hearthroom_library_requests_total[15m]))`，或直接讀 `/metrics`。清單讀寫由上述 counter 觀測；實際生成仍由遊玩服務觀測。

## 賽事擴充邊界

依據主專案 `docs/product/sources/HarperHarbor_Ecosystem_Source_20260916.md` 與後續 `HarperHarbor_BusinessPlan_20260916_V1.1.md`：

- 社群管理規則、資格、投稿、投票／評審、爭議與結果；Harbor 管理已授權預算、帳本、發獎冪等、防超支及沖正。
- 後續賽事入口可在首頁「角色卡／關注動態」之後加入「活動」，活動頁再區分進行中與歷屆結果。沒有已上線賽事時不放空按鈕、虛構名次或可點但不可用的發獎入口。
- 規劃的社群資料：campaign（主辦、規則版本、時區與起迄）、entry（參賽作品及提交版本）、result_snapshot（結算時間、計分規則版本）、result_row（快照中的名次、分數、作品／作者當時名稱）。歷屆結果讀不可變快照，不以當前累積熱度重算；更正另建修訂並保留前版。
- settlement_request 引用 Provider campaign/budget、核准紀錄與冪等鍵；回存 receipt 與狀態。名次已公布、獎勵待發、已發、沖正是不同狀態。
- 發獎前要完成租戶授權、可用預算與真實資金批次、收款身分映射、核准、冪等重放與沖正驗證。早期文件的基金金額只是例子，不是現在已核准預算。
- 本次只預留資訊架構及資料責任，未建立尚無用途的資料表、改動帳本或部署發獎能力。

## 參考與設計取捨

SillyTavern 的 Recent Chats 與每卡 Manage Chat Files、Chub 的 All Chats 都把回訪對話與發現卡片分開；本站採用全站回訪入口及卡內存檔，不把所有操作塞到榜單工具列。

- https://docs.sillytavern.app/usage/welcome-assistants/
- https://docs.sillytavern.app/usage/core-concepts/chatfilemanagement/
- https://docs.chub.ai/docs/the-basics/just-chatting

Apple HIG 判準：位置可辨識、下一步可見、錯誤可重試、可逆操作無確認；44px 新操作目標、鍵盤焦點、文字標籤、深淺色與五語。此專案為 Vue Web，沿用本站 tokens 與 px/rem，不引入 uni-app rpx。

## 2026-09-20 資料歸屬修正

驗收：本站開啟對話後入列、兩家已連接身分讀同一份清單、他人與未登入者讀不到、收藏維持社群所有、積分無切換分頁、選擇遊玩服務不改社群登入。此裁決取代先前「最近對話直接讀登入中 Provider」的設計。

本次不做：從外部帳號批次匯入歷史、搬移訊息本文、合併不同服務的資金。既有卡片編輯器的資產路由仍沿用來源服務的 authoring 接線；此次拆離的是社群清單、積分與遊玩選擇。owner 已於 2026-09-20 授權驗證通過後由既有 CI 發布及套用必要遷移。

MCP 不適用：私有社群清單屬 Hearthroom，沒有社群 MCP transport，不把私有資料塞入 Provider MCP 或 Moonloom。HTTP 已共用現有 requireMember 身分映射與私有快取策略。正式啟用前必須套用遷移 `0024_member_conversations.sql`，並在授權發布後讀回 `hearthroom_library_requests_total{operation=~"conversations_.*"}` 及實際清單。
