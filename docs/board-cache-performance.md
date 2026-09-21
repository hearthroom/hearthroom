# 榜單五分鐘快取

## 範圍與原因

需求：減少社群首頁每次切換榜單的等待；排名允許五分鐘延遲。
驗收：一般與成人卡片榜可重用結果，權限仍即時驗證，審核／分級變動立即使快取失效。
本次不變更前端、登入協定、隨機推薦規則、供應商 API 或使用者設定。

原本一般榜單使用 60 秒的單節點 Cache API；成人榜單完全略過快取。
成人內容檢查呼叫 `requireMember`，在上游驗證後另行解析會員、嘗試更新會員簡介，最後再讀觀看設定。
公開榜單即使命中也會讀 D1 審核版本，不能把既有快取稱為零 DB。

## 實作

- 卡片榜、作者榜與標籤：Cache API → 既有 `CACHE` KV → D1，快取結果最多 300 秒。
- 一般／成人、查詢條件與有效語言分開。成人結果只在每次完成上游驗證及本站即時設定檢查後回傳。
- 不快取令牌或授權結果，不將令牌／Cookie／觀看者身分存入鍵或資料。KV 鍵使用查詢摘要。
- 成人內容檢查改為單一唯讀查詢，保留跨供應商連結帳號的優先解析規則。
- 審核版本與觀看權限可平行讀取；暖成人榜單兩次 D1 SELECT、零榜單排序、零會員 UPDATE。
- KV 回填邊緣快取沿用絕對期限，不延長舊資料生命。快取故障回退 D1；不同節點冷讀與 KV 傳播期間仍可能未命中。
- 新增 `0031_board_cache_visibility.sql`：卡片 status、nsfw、approved_version_id 變動或刪除時遞增既有審核版本。
  既有下架、封鎖、標籤覆寫與時間補償沿用原本版本失效機制。
- 對外仍為 `no-store`／`private, no-store`，避免瀏覽器跳過權限和審核檢查。

KV 適合容許短暫延遲的查詢結果，但不適合拿來代替即時授權或下架狀態。
Cache API 只在處理請求的資料中心內有效，KV 補跨節點重用。
參考 [Cloudflare Cache](https://developers.cloudflare.com/workers/reference/how-the-cache-works/)、
[KV 一致性與效能](https://developers.cloudflare.com/kv/concepts/how-kv-works/)。

## 觀測與契約

回應提供 `X-Cache: hit|miss`、`X-Cache-Layer: edge|kv|origin`，以及 `Server-Timing` 的
`access`、`moderation`、`cache`、`query` 分段（命中時沒有 query，公開作者／標籤沒有 access）。
沿用 Analytics Engine 的 cache／durationMs；沒有增加逐請求 D1 計數寫入。
Prometheus 新指標不適用：這是分散式 Worker 請求延遲，既有 AE 已記錄每次請求；
為維持 `/metrics` 持久計數而增加資料庫往返會抵銷本次優化。
計時與新增診斷欄位不含身分、令牌、搜尋文字或內容。

HTTP／MCP／Moonloom：HTTP 回應結構與權限相同，只改執行及快取方式；沒有新增可供 MCP 暴露的操作，
因此不新增 MCP 工具或 Moonloom 指南。前端與五語文案未變更；語言快取另有契約測試。

## 2026-09-21 本機驗證

- Red：成人榜單回傳 bypass；觀看時嘗試會員寫入；追蹤參數切碎快取；暖快取分級變動不失效；
  未帶 lang 時 Accept-Language 不同卻取到同一語言。對應回歸均已 Green。
- 完整 `npm test`：Worker 45 檔／484 測試通過；web 82 檔／440 測試通過。
  web 的真實外部卡片探針因未提供 `REAL_CARDS_DIR`，1 檔依原定條件跳過。
- `npm run typecheck`、stage 建置、sandbox 建置與邊界檢查、web 建置、Worker deploy dry-run、diff whitespace 檢查通過。
- 測試確認 KV 回填不延長期限、一般／成人隔離、匿名與失效令牌拒絕成人內容、關閉設定立即生效、
  下架與狀態／分級／刪除立即失效、暖成人榜單僅兩次唯讀 D1 呼叫且仍驗證上游身分。
- 初次全量執行的兩個 HTML 測試失敗來自尚未建置資源，建置後通過。
  審核測試移除無關 query cache-buster，改以同一網址驗證狀態失效；期間遺漏的測試變數引用已修正。
- web 測試輸出 happy-dom 的 localhost iframe 連線拒絕訊息，套件仍回傳 0、440 項通過；
  此結果不代表真實播放器連線或瀏覽器驗收。建置另有套件棄用、字型執行期解析與大 chunk 警告。
- 測試環境以 Node 的 `--no-experimental-webstorage` 避開 Node 26 內建 localStorage 差異。

未部署、未套正式 D1 migration、未做登入使用者的正式延遲 A/B 或瀏覽器驗收。
上游身分驗證和即時 D1 檢查仍存在，不能承諾毫秒級回應。

部署需先套 `0031` 再發布相同來源的 Worker。上線後以相同帳號／篩選連續切榜，
確認第二次為 hit、Server-Timing 沒有 query，再比較 access 與整體耗時。
如 access 仍主導延遲，另行評估登入驗證路徑；不要為加速擅自延長授權撤銷窗口。
