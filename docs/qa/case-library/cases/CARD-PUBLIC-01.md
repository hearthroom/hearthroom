---
id: CARD-PUBLIC-01
priority: P1
platforms: [web-desktop, web-mobile]
page: /cards/:id
mutating: false
preconditions: Local approved SFW source card with a published copy on the other platform; guest and linked test member sessions. Private, blocked, adult and provider-ID collision fixtures are API-only.
states: [guest, linked, cross-provider, direct-link, not-found, adult-gate]
---

# 公開卡片跨平台瀏覽

1. 訪客直接開啟已核准卡的連結，確認標題與簡介出現，沒有找不到卡片畫面。
2. 以另一平台的本機測試身分登入並連接來源平台，重新開啟同一連結，確認仍顯示同一張卡與簡介。
3. 檢查「用哪家玩」列出來源與可用副本；切換選項，確認有對應可用的遊玩動作。此案例不送出聊天或觸發付費推論。
4. 以本站卡 ID／卡號開啟同一卡片，確認簡介與平台清單一致。
5. 分別測試 LunaTalk 與 Harbor 卡，並在桌面與窄版 viewport 確認簡介、平台名稱及按鈕可讀可操作。

critical_payloads: 卡片標題、簡介、支援平台、可用的遊玩動作。

自動化：`test/public-card.test.ts` 使用真實 D1 及 HTTP handler，涵蓋公開詳情／HTML／平台清單、卡號、本站 ID、平台 ID 碰撞、同號不同作者的拒絕、審核／封鎖／成人門。既有 `provider-isolation`、`distribution-api`、`hosting-edit` suites 保護登記、分發及 A/B 核准版本。

目前狀態：API suites 通過；瀏覽器案例因工具用量限制未執行完成。見 [驗證紀錄](../../card-public-detail.md)。

## Sidebar spacing regression

On desktop and at 390 px viewport width, inspect the cover, identity section, platform selector, primary play action, report/share row and favorite control. Every control must stay within the sidebar's left and right padding. Platform selection must have a full row rather than being compressed between report and share actions. Repeat after choosing English through the language menu. Include a long card title to confirm wrapping. Do not start a paid conversation or submit a report.

The original failing layout has a 300 px sidebar, 16 px padding, and a 288 px implicit grid track: the probe must detect its 20 px overflow past the content boundary. The corrected desktop track is 268 px. See [spacing verification](../../card-sidebar-spacing.md).
