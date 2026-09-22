---
id: FEATURED-01
priority: P0
platforms: [desktop-web, mobile-web]
page: /review/cases
preconditions:
  - Isolated synthetic app-admin and ordinary-reviewer sessions
  - Approved synthetic card from the same provider and a different-provider control
states: [allowed, denied, confirmation, cancelled, featured, unfeatured, expired, failed, quota-full]
mutating: true
critical_payloads: [card-name, provider, featured-status, quota, confirmation-effect, retry]
---

# 工作台精選操作

1. 管理員從處置複核進入「精選卡管理」，可見名額；選擇作品。
2. 確認標為精選時顯示作品名稱和返點效果；先取消，再確認。
3. 重新讀回可見精選徽章、取消按鈕與更新名額；重新整理後結果保留。
4. 取消精選需要確認；完成後徽章消失、名額回復。
5. 切成一般審核員：工作台捷徑與選卡後的精選控制都不存在，原有審核仍可用。
6. 不同平台的卡片不顯示目前平台的精選操作。確認途中換帳號／離開頁面，不送出舊操作。
7. 403、額度耗盡、上游錯誤與登入刷新失敗均不復活舊權限或假報成功；可以重新整理確認現況。
8. 桌面、390px 手機，繁中與英文實際操作；五語的名額、按鈕及確認框沒有裁切或水平溢出。

UI 使用合成 API fixture；持久狀態與拒絕路徑另外由 Worker 真實 D1 測試覆蓋。正式站只讀入口與資格，不標記真實作品。公開卡片頁只留精選徽章，不承載操作。
