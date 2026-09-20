---
id: LIBRARY-01
priority: P1
platforms: [web-desktop, web-mobile]
page: /library
mutating: true
preconditions: Disposable local member, two authors, approved cards, and a local player fixture that supports opening a conversation; complete ordinary OAuth sign-in.
states: [guest, empty, populated, saved, following, failure, retry, mobile, desktop]
---

# 對話、收藏與關注

## 路徑與斷言

1. 未登入開啟導覽「對話與收藏」：進入登入，登入完成回到原目的地。
2. 開啟最近對話：無服務標籤；只讀社群清單，外部帳號有對話也不自動匯入。只開卡看開場白後返回，此卡不入列；送出並保存訊息後返回，新紀錄出現。已玩過的卡另開空白對話且不送出，原紀錄仍保留；新段保存訊息後才更新。
3. 點一個對話：進入同一角色的既有 `/play/:roleId` 舞台；使用該筆紀錄的服務與憑證；社群登入身分不變，未複製訊息本文。
4. 開啟收藏分頁：空態有探索入口；讀取失敗顯示錯誤與重試，不得冒充空態。
5. 從探索進卡片頁點收藏：按鈕呈已收藏，本站收藏數加一；再次點擊取消，數字恢復。重複操作與讀取中不可重送。
6. 再收藏並重新登入：收藏分頁仍能找到該卡。
7. 從卡片作者進作者頁關注：首頁「關注動態」呈現其核准卡片，依發布時間排序；不再顯示作者總榜。
8. 從管理關注進入關注分頁：作者主頁可達，取消／重新關注都成功；重新載入後與伺服器一致。
9. 暫時阻斷本機收藏列表請求：錯誤有重試；解除阻斷後重試回復卡片。
10. 檢查繁中／英文、390px／桌面、深／淺色：沒有新增區塊重疊或控制項裁切；新增控制項至少 44px；鍵盤可聚焦並操作，切換狀態有可存取名稱。

## Reachability assertions

critical_payloads: 對話目的地、卡片目的地、作者目的地、隱藏的續玩服務路由、收藏／關注狀態、取消動作、讀取錯誤與重試。

## 自動化契約

`test/library.test.ts` 驗未登入、帳號隔離、重放、資料可見性及 durable metrics；`test/connections.test.ts` 驗關注紀錄阻止空帳號合併；`web/test/library-api.test.ts` 與 `library-toggle.test.ts` 驗社群分頁／錯誤、失敗保留原狀及防重送。

## 本次驗收紀錄

最新入列證據見 `docs/qa/library-played-only.md`，前批證據見 `docs/qa/community-owned-library.md`；舊版 Provider 清單驗收不適用於社群資料歸屬修正。

11. 帳號連接第二個本機服務，積分頁同時顯示兩家餘額與流水，不提供平台切換分頁；點收支篩選與分頁不改變社群登入。
12. 查看「我的卡片」：作品合併顯示，沒有平台分頁。
