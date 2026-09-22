# 審核通知與認領

Discord 通知保留盲審，每輪送審對應一則可更新訊息。投影只包含卡名、審核種類、
章數、目前審核員與下一步；成人作品不投影標題。作者身分、私有內容與駁回說明
不會傳給 Bot。認領及裁決仍在 `/review`，Discord 不提供直接裁決按鈕。

Migration 0034 新增 `review_deliveries` 和 claim generation。送審、認領、放回、
蓋章、下架及撤回會使通知待更新。Bot 透過 signed v2 bridge 取得獨占租約、送出前
檢查 revision，再回報 Discord message mapping；遲到 ack 不會吞掉較新的進度。
訊息刪除與重啟由 Bot 的持久 receipt／發送嘗試及歷史掃描配合恢復。

認領 30 分鐘尚未完成會產生一次提醒；45 分鐘到期放回。通知 opt-out 不生成提醒，
Discord DM 另需有效綁定與 DM opt-in。每輪 claim generation 和當時 link version
共同限制提醒投遞；完成、換綁、撤銷審核資格、作品失效或認領到期會使舊提醒失效。
站內仍保留已失效通知，但改指向待審清單。舊 HTTP client 缺少 generation 時回 409，
需重新整理取得新頁面；不會靜默操作新一輪認領。

每天臺北時間 10:00 後最多一則摘要，列出等待超過 24 小時的作品；已有第一位通過時，
從該次通過重新計算等待時間。超過 48 小時標記需協調，沒有自動裁決。

部署順序：先由此倉庫 CI 套用 migration／部署 Worker 與 web，再部署 Hearthkeeper 並
開啟 `COMMUNITY_REVIEW_V2`。保留舊 bridge 供 Bot 設定回退；不逆轉資料表遷移。
新 bridge 關閉社群時回 503。不相容時 fail closed，操作人員以 Bot 設定切回舊版。

MCP 不適用：這是內部通知投影，沒有新增面向外部 AI 客戶端的審核能力。
可觀測性由 Hearthkeeper 的低基數 delivery counter、lag histogram、pending／oldest
與 last-poll gauges 提供，詳見其 `docs/deployment.md`。Worker 的 lease/revision/mapping
是耐久讀回依據；不增加使用者或卡片識別碼的日誌與 metric labels。

## 回歸與驗證

- `test/review-notifications.test.ts`：D1 真實 schema、signed bridge、盲審、租約、遲到 ack、
  到期／換綁／完成取消提醒、超過 200 件佇列分批、每日摘要、並行認領與 generation。
- `web/test/review.test.ts`、`web/test/review-detail.test.ts`：認領 generation 傳遞、失效通知返回清單。
- 全量：`NODE_OPTIONS=--no-experimental-webstorage npm test`、`npm run typecheck`、
  固定 stage 版本建置後 `npm run build:web`。CI 用 Node 22 clean install，另跑 pinned stage suite。
- 2026-09-22 原生 Chrome 合成案例：真實 Vue 清單／詳細頁，桌面認領→查看→通過顯示
  2/2 及完成回饋；390×844 認領→放回後回復可領取；終態 410 顯示說明，連結可返回清單。
  本機 API stub 會拒絕不符的 generation。這是前端 runtime／視覺證據，不是正式資料 E2E。
  瀏覽器操作曾有一次 click 回應逾時；後續重新讀取已成功導航。完成批次無 console error。

詳細跨系統設計與案例索引保存在共享 docs 的 HearthkeeperReviewNotifications 設計與
`qa/case-library/cases/REVIEW-NOTICE-01-claim-generation.md`。
