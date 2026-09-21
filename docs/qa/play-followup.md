# 遊玩頁啟動第二輪優化

基準：Hearthroom `0faf510`、stage `21a7578`。本輪只修改 Hearthroom；播放器子模組固定原版本。尚未部署，沒有資料庫遷移。

## 行為

- 當前版 `/assets/` 的 Vite 八位雜湊檔套用一年 immutable；非雜湊檔、錯誤及 SPA fallback 不會被永久快取。舊版歸檔回退保留。
- 沙箱三個固定檔名仍每次驗證。先讀取並驗證真實殼，才比較 If-None-Match／ETag，符合時回無 body 的 304；保留 CSP、nosniff 與 referrer policy。沒有把固定檔名設成 immutable，沒有用 SPA fallback 的驗證器掩蓋缺檔。這省的是瀏覽器傳輸；Worker 仍讀 ASSETS 驗證殼。
- 成員解析以單次 SELECT 取得連結優先的身分、handle 和初始化狀態。已有名稱不再送無效 UPDATE；首次初始化保留 SQL 條件，避免蓋掉並行的個人設定更新。
- 個人資料／創始身分／目前綁定改成一個 D1 batch；審核人查詢與這個 batch 並行。私人資料沒有跨請求快取，NSFW 與綁定規則不變。
- 同平台 token 不依賴綁定清單，遊玩授權因此與社群 profile 並行；安裝仍等兩者完成。跨平台仍先等 profile 再選綁定憑證。離頁後不掛載播放器。

## 驗證

先新增並觀察五個 Worker 失敗（immutable、304、會員讀取次數、profile batch、耗時標頭）與一個前端並行失敗，再修正通過。會員次數測試使用真正 D1，只計算往返，不以假資料庫替代 SQL；既有 connections 全套回歸也通過。

- 完整 `npm test`：Worker 48 suites / 505 tests；web 84 suites / 459 tests 通過。真實卡片 probe 因未提供 REAL_CARDS_DIR 跳過一個 suite。
- `npm run typecheck`、`build:web`、stage 與 sandbox 建置通過。stage 程式未修改，沒有重跑其全套測試。
- 前端覆蓋拒絕授權、profile 等待中離頁、跨平台未綁定、既有跨服務憑證。
- 真正本機 Worker 的殼頁／JS／CSS：首次 200、相同 ETag 304 且 body 0 bytes、舊 ETag 200、HEAD 200 且 body 0 bytes；304 保留 no-cache 與 CSP。雜湊 stage JS 回一年 immutable。
- 原生 Chrome 使用既有合成本機登入，開卡 → 模型設定 → 取消；桌面及 390×844 可見原存檔 checkpoint、繁體開場白與輸入區，無 warn/error，未發出模型生成。

兩個本機 Vite lane 都用固定延遲：profile 2,000 ms、模型授權 800 ms、卡片 650 ms、存檔 1,500 ms。快取開啟、無 CPU／網路節流；使用沙箱 FCP 換算主文件時間，不使用工具等待時間。

| 沙箱 FCP | 基準版 | 修改版 |
| --- | --- | --- |
| 第一次開啟 | 5.662 s | 4.470 s |
| 重新整理 | 4.888 s | 4.138 s |

修改版 models 授權在 profile 未完成時已結束；saves 仍只在身分與授權完成後開始。這是小樣本合成比較，只證明等待重疊，不能推算正式站 p50／p95。D1 與正式快取改善須發布後再量測。

首次 Worker 測試受本機監聽權限限制，改在允許監聽的環境重跑；早期前端測試在 stage 尚未建好時無法解析套件，建好後全量通過。批次查詢的型別錯誤已修正；Wrangler 日誌改寫暫存目錄。既有 happy-dom teardown localhost:3000 連線警告、Vite/Sass 棄用及大 chunk 警告仍存在。首次本機快取探測走到主站路徑；設定 sandbox local-upstream 後重測，以上只採用含 CSP 的正確路徑結果。

## CPU 邊界與觀測

正式卡片的既有 profile 中，`vis → texts → scan → boot` 量測熱點可對應到沙箱內動態注入的腳本；共用 stage 原始碼沒有這條函式鏈。這輪保留卡片腳本行為，沒有把所有 layout CPU 歸咎共用播放器，也沒有修改正式卡片。診斷只整理函式與執行結構，不把卡片內容納入儲存庫。

可觀測性：`GET /v1/me` 成功回應增加 Server-Timing：`identity` 是供應商驗證等待、`member` 是社群成員解析／必要初始化、`profile` 是並行資料與審核查詢的整體等待。沒有 ID、token 或 provider label；仍 no-store。這是請求級瀏覽器瓶頸，使用固定欄位 Server-Timing 與 Resource Timing，不新增 Prometheus。發布驗證須檢查這三段及冷／暖卡片 FCP、靜態檔 cache-control、沙箱 304。

MCP／Moonloom：不適用新增能力同步，沒有新業務 API、權限或資料結構；只有既有查詢、HTTP cache 語義與瀏覽器排程優化。五語字串與 UI 樣式未變，i18n 全量檢查通過。
