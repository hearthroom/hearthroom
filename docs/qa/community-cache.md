# 社群快取驗證

日期：2026-09-21。基底 `35dfce7`，分支 `perf/community-cache`。本機資料皆為一次性合成內容，未讀取正式私人清單或變更正式資料。

## 完整自動化

- Worker：47 files、499 tests 通過。
- Web：83 files、447 tests 通過；`real-cards.probe.test.ts` 因未提供外部素材而跳過 1 file。
- Worker／web typecheck 通過；釘選的 stage 建置、sandbox boundary、web production build 及 Worker deploy dry-run 通過。
- 五語文案檢查通過；本次無新增 UI 文案。
- `git diff --check` 通過。

## 自然瀏覽器路徑

同一原生 Chrome 分頁，由本機合成 OAuth 正常登入；UI 操作配合同分頁 CDP 網路診斷。

| 檢查 | 結果 |
| --- | --- |
| 訪客榜單 → 卡片主頁 | 標題與摘要可見；沒有 comments 正文請求 |
| 首次開評論 → 主頁 → 評論 | 合成留言可見；正文請求累計仍為 1 |
| 私人收藏 → 關注 → 收藏 | 三十秒內兩種清單各 1 次 GET；無逐作者 following status GET |
| 取消關注後切頁回訪 | 立即顯示沒有關注作者 |
| 取消收藏後回訪 | 立即顯示沒有收藏卡片 |
| 作者主頁 | 名稱、統計、公開卡片正確；本機 API 讀回作者統計 `X-Cache: hit`, layer `edge` |
| 繁中桌面 | 清單、卡片與操作可讀可達；原生 Chrome 截圖檢查通過 |
| 英文 390×844 | 清單、卡片、評論可操作；截圖未見新增裁切或水平溢出 |
| 分頁幾何 | 三個分頁高約 48.4px，文字中線偏差不超過 2px、無裁切；已知壞幾何 positive control 同時回報偏心及溢出 |
| Console | 最後作者頁沒有 error／warn |
| Metrics durable readback | 本機 `/metrics` 有 favorites/following 的成功 GET／DELETE 計數；community 背景計數由執行 Context 測試驗證 |

案例：[COMMUNITY-CACHE-01](case-library/cases/COMMUNITY-CACHE-01.md)。狀態目的、操作、空態與取消後結果均可由頁面持續辨認；沒有新對話／計費動作。頁面沒有改視覺 token 或翻譯，桌面與手機使用同一份元件。

## 過程中的失敗與歸因

- 新增效能案例的 Red 均已修正，涵蓋提前載入、重複請求／驗證、阻塞 metrics、快取缺失及供應商鍵碰撞。
- 初次新增「空作者」斷言誤以為應回 404；既有產品允許零作品作者頁，改為檢查 `cardCount: 0`，保留原語義。
- `LibraryToggle` 可選 boolean 被 Vue 自動預設 false，導致跳過查詢；明確以 undefined 作預設後回歸通過。
- 測試 fixture 補上 `COMMUNITY_ENABLED`，才可斷言 supporter 外觀；不是放寬正式環境的權益檢查。
- 原有直接呼叫 community router 的測試未提供 execution context；補上 context 並等待背景寫入，匹配 Workers 執行方式。
- 播放器測試的 module mock 因 session 新增快取清理相依而提前載入；改用 hoisted mock 並補清理函式，完整 suite 通過。
- 原生 AX 將按鈕表示為 checkbox，造成一次 selector 逾時；改依 DOM 語義取得 button 後完成全部選定旅程。一次效能探針碰到非 URL resource name，收窄到目標路徑後確認留言請求數。
- Worker 本機監聽／回讀需要 sandbox elevation，授權後執行成功。
- Web 測試仍有既有 happy-dom iframe teardown／本機 3000 fixture 連線警告；runner 全數通過。建置保留既有 Sass／CJS／alias 棄用、字型與大 chunk 警告。

這是本機功能與請求數證據，不是正式站毫秒延遲量測。未執行付費聊天；外部素材探針、正式部署與部署後 readback 未執行。發布需由既有 CI 套用 0032 遷移並部署同一推送 commit。
