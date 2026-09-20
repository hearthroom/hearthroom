# 只登記已玩過的對話 — 2026-09-20

## 規則

本文件取代前一批「播放器取得對話 ID 就登記」的驗收口徑。只開卡看開場白、新建空白對話均不登記；讀回已保存的 USER 訊息或有生成來源的非空 AI／thinking 內容才通知社群。另開空白對話不刪除或覆蓋原有社群紀錄。實際聊天與存檔仍由播放器既有操作處理，未改寫或刪除聊天本文。

## 修改與驗證

- Moonstage 新增 `conversationActivity` 宿主事件，從既有歷史讀回及回合結束後讀回發出；不從 `updateConversationId`、開場白或暫存氣泡判定。事件只帶角色與對話識別，沒有訊息本文。
- Hearthroom 只接收此事件；拒絕與當前卡片不符的晚到事件。五語清單說明改為「聊過的卡片」。
- Red：空白對話 ID 變動仍呼叫社群寫入，測試明確失敗。修正後通過。測試涵蓋空白、新段、重複讀回、保存訊息、繼續、thinking、失敗空殼、摘要及晚到卡片事件。
- 本機完整 Worker 366 項、Web 374 項、Moonstage 1861 項通過；typecheck、stage build、web build 通過。Web 外部 real-card probe 一個檔案維持 skipped。
- Chrome 自然 OAuth 登入本機合成帳號：新卡 → 開始對話 → 只看開場 → 返回清單，沒有新列；準備已保存的合成 USER 訊息後，播放器讀回顯示且社群入列；對話存檔 → 開新對話 → 確認 → 只看新開場 → 返回，歷史卡片仍在。獨立唯讀清單驗證仍指向原已玩對話，而非新空白 ID。
- 該 USER 訊息由本機 fixture 預置；未送付費生成，不把此段當成真實模型或計費驗收。沒有自動清除舊版本已寫入的社群項目。
- 額外根目錄 harness 檢查失敗：803 項中 793 通過、10 失敗，包含缺少舊子倉作者資產／Moonloom 檔案、sandbox 不允許 socket／process 測試；另有既有 case index 與 mirror drift 檢查。未修改 harness 或相關舊子倉，與本次兩個實際工作樹的通過證據分列，不宣稱全 workspace 通過。

## 邊界與發布

沒有新增 HTTP／MCP 端點、schema 或計費行為；MCP 不適用於此宿主 UI 事件。沿用 `hearthroom_library_requests_total` 觀測社群寫入；沒有新增私有／高基數標籤。此修正沿用該功能的發布授權，由確切推送來源經既有 CI 部署。案例沉澱於 `docs/qa/case-library/cases/LIBRARY-01.md`。本文件為本機證據，正式發布結果以 CI 與線上資產讀回為準。
