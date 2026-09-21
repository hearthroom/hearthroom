# 社群讀取效能優化

需求：沿用五分鐘榜單快取，改善作者資訊、留言、作者統計、徽章及私人清單；移除同步統計寫入與同一請求的重複驗證。

驗收：減少請求／D1 往返，操作後資料立即更新；保留即時年齡、權限、審核與公開同意檢查。這批不改 Provider、付款、內容審核政策或播放器。

## 行為

| 範圍 | 做法 | 失效邊界 |
| --- | --- | --- |
| 公開作者資訊 | 前端合併同一批姓名／頭像／徽章需求；最多 50 個 handle。內部 Edge → KV → D1，最多 300 秒 | D1 成員版本、公開偏好、Discord 綁定／外觀、徽章撤銷、XP；時間到期另限縮有效期限 |
| 留言 | 第一次選取評論才掛載，切回保留；原有 count API 內部快取 30 秒 | count 由留言異動版本失效；每次仍先驗卡片可見性與成人門。正文與個人按讚／刪除權限不共用快取 |
| 作者統計 | 300 秒快取聚合結果 | 作者公開資料版本、審核版本、一般／已驗證成人分區 |
| 徽章定義 | 定義目錄 1800 秒 | D1 目錄版本；個人獲得、到期、撤銷、管理權限仍即時讀取 |
| 私人清單 | 分頁記憶體快取 30 秒、合併相同進行中請求；已關注列直接使用清單確認的狀態 | token／供應商隔離；登出、帳號／內容偏好改變、收藏／關注修改、對話活動寫入清除。最多 100 筆，不寫 KV 或持久儲存 |
| 請求統計 | library／community metrics 由 `waitUntil` 完成 | 保留原指標與 outcome；寫入故障不改操作結果 |
| 同次驗證 | 以請求 Context 為 WeakMap key 合併上游身分驗證 | 不跨請求，不快取餘額、年齡或管理權限 |

同時修正 `/v1/me/cards` 原有快取鍵：加入已驗證供應商，避免兩家相同數字帳號共用私人資料。

公開資訊暖快取每頁只讀一次 D1 版本；冷快取另用一次批次投影查詢。快取只保存公開投影，不含 Discord 原始識別、偏好原始資料、token 或私人清單。回應仍 `no-store`；成人及私人回應 `private, no-store`。KV 的舊版本不能繞過 D1 版本檢查，Edge 回填不延長絕對到期時間。

瀏覽器原有的公開外觀記憶體有效期仍為 30 秒；已顯示的其他分頁不會被伺服器主動推播刷新。本人設定頁仍清除其外觀快取。評論數字在首次打開評論後顯示，不再為首頁先載整份留言。

## API 與部署

新增 `GET /v1/community/members?handle=...&handle=...`，回傳 `{members: {handle: publicIdentity}}`。最多 50 個值，超限回 400，未知 handle 回空公開投影；既有單筆入口保留。此批次入口只組合既有公開讀取能力。HTTP／MCP／Moonloom 決策：不適用新增 Provider transport；這是 Hearthroom 自有社群 UI 的批次讀取，未新增私人資料或外部 AI 創作能力。

遷移 `0032_public_snapshot_revisions.sql` 新增成員公開版本、目錄版本、留言計數版本及相關 D1 triggers。正式發布須先由既有 CI 套遷移再部署。此報告只記錄本機驗證，尚未推送或部署。

多語言：沒有新增使用者文案，保留既有五語；實機檢查繁中桌面及英文 390px。

## 可觀測性

- 既有 `hearthroom_library_requests_total`、`hearthroom_community_requests_total` 都是 counter，沿用低基數 `operation`／`outcome`；成功、拒絕、錯誤在 handler 完成後排入背景。
- `/metrics` 可驗證各操作計數。自動測試以未完成的 D1 metrics Promise 驗證回應可先完成，再釋放 Promise 驗證 durable 計數。
- 作者與公開資訊回應提供 `X-Cache: hit|miss`、`X-Cache-Layer: edge|kv|origin`；留言計數提供 `X-Cache`。作者瀏覽沿用既有 Analytics Engine 的 cache、duration 欄位。
- 不新增每次快取命中的 D1 指標寫入，也不加入識別、token 或內容日誌／label。

## 驗證證據

Red 已觀察：公開資訊無快取／無批次回應、定義重查、成人留言驗證兩次、供應商撞鍵、作者聚合重查、metrics 阻塞、留言提前載入、私人讀取重複，以及 16 位作者冷讀取 49 次往返。

Green：16 位作者冷快取 2 次 D1、暖快取 1 次；隱私關閉、解除綁定、撤銷／到期、定義修改、審核變更均不能讀回過期投影。涵蓋 KV 故障回源、跨 Edge 到期、私人帳號／供應商隔離、失效中的進行中請求、重試與逾期。

完整結果與自然路徑見 [瀏覽器驗證](qa/community-cache.md)；可重跑案例見 [COMMUNITY-CACHE-01](qa/case-library/cases/COMMUNITY-CACHE-01.md)。
