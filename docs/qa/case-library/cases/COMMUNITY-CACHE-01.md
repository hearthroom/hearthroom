---
id: COMMUNITY-CACHE-01
priority: P1
platforms: [web-desktop, web-mobile]
page: /library
mutating: true
preconditions: Disposable local OAuth member, approved SFW card, author, saved/followed records and one synthetic comment. No production credentials or data.
states: [guest, first-load, cached, comments, saved, following, empty, desktop, mobile]
---

# 社群讀取快取

1. 訪客從榜單開卡片，確認標題、簡介可讀，尚未點評論前沒有 comments 正文請求。
2. 點評論，留言可見；切回主頁再回評論，正文請求仍只有一次。
3. 由「對話與收藏」進正常登入，使用本機合成 OAuth 身分，回到清單。
4. 三十秒內依序開收藏、關注、收藏，收藏與關注清單各只請求一次；已關注列不另發每位作者的狀態 GET。
5. 取消本機合成作者的關注，切分頁後再回關注，出現空態。
6. 從收藏卡片進詳情取消收藏，返回收藏，該卡消失；不得重用異動前的清單。
7. 作者頁顯示公開名稱、統計與已核准卡，重新讀取 API 可辨認 cache hit。
8. 以繁中桌面、英文 390px 檢查清單及卡片／評論；分頁文字不裁切、無水平溢出。對分頁控制項量測文字垂直中線與容器，包含已知壞幾何的 positive control。
9. 登出／帳號或供應商變更、資料讀取失敗重試、撤銷、到期、成人門與後端快取故障由對應自動化案例驗證。

critical_payloads: 作者公開名稱、卡片摘要、留言、收藏／關注狀態及空態。

自動化：`test/community-cache.test.ts`、`test/snapshot-cache.test.ts`、既有 community／comments／mine／library suites；`web/test/public-identity-cache.test.ts`、`library-api.test.ts`、`library-toggle.test.ts`、`card-instant-render.test.ts`。
