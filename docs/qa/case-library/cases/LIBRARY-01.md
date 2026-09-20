---
id: LIBRARY-01
priority: P1
platforms: [web-desktop, web-mobile]
page: /library
mutating: true
preconditions: Disposable local member, two authors, approved cards, and a provider conversation-list fixture; complete ordinary OAuth sign-in.
states: [guest, empty, populated, saved, following, failure, retry, mobile, desktop]
---

# 對話、收藏與關注

## 路徑與斷言

1. 未登入開啟導覽「對話與收藏」：進入登入，登入完成回到原目的地。
2. 開啟最近對話：目前 Provider 標籤可見；最新對話在前，標題、角色名、時間和純文字摘要可讀。
3. 點一個對話：進入同一角色的既有 `/play/:roleId` 舞台；不建立另一個社群聊天資料庫。
4. 開啟收藏分頁：空態有探索入口；讀取失敗顯示錯誤與重試，不得冒充空態。
5. 從探索進卡片頁點收藏：按鈕呈已收藏，本站收藏數加一；再次點擊取消，數字恢復。重複操作與讀取中不可重送。
6. 再收藏並重新登入：收藏分頁仍能找到該卡。
7. 從卡片作者進作者頁關注：首頁「關注動態」呈現其核准卡片，依發布時間排序；不再顯示作者總榜。
8. 從管理關注進入關注分頁：作者主頁可達，取消／重新關注都成功；重新載入後與伺服器一致。
9. 暫時阻斷本機收藏列表請求：錯誤有重試；解除阻斷後重試回復卡片。
10. 檢查繁中／英文、390px／桌面、深／淺色：沒有新增區塊重疊或控制項裁切；新增控制項至少 44px；鍵盤可聚焦並操作，切換狀態有可存取名稱。

## Reachability assertions

critical_payloads: 對話目的地、卡片目的地、作者目的地、Provider 身分、收藏／關注狀態、取消動作、讀取錯誤與重試。

## 自動化契約

`test/library.test.ts` 驗未登入、帳號隔離、重放、資料可見性及 durable metrics；`test/connections.test.ts` 驗關注紀錄阻止空帳號合併；`web/test/library-api.test.ts` 與 `library-toggle.test.ts` 驗 Provider 分頁／錯誤、失敗保留原狀及防重送。

## 本次驗收範圍（2026-09-20）

- Chrome 自然登入與以上收藏／關注旅程通過；手機關注列裁切已修正並複驗。
- 幾何探針在新增區域無重疊、裁切、對比、置中及未翻譯鍵問題。既有頁首頁尾的小點擊區另列於驗收報告，不冒稱整站 HIG 全數符合。
- 本機 Provider 僅模擬對話列表，已驗點擊抵達舞台；舞台其他 API 回報未提供的 fixture，未用此環境宣稱生成或送訊息成功。
- 五語鍵契約有自動檢查；語言判斷為 LLM-approximation，en/zh 相對較高，ja/ko 較低，沒有宣稱真人母語審校。
