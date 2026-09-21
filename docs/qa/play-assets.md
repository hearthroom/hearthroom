# 播放器靜態資源與冷載入

基準：Hearthroom `22e6871`、Moonstage `21a7578`。本輪尚未部署，沒有資料庫或正式卡片修改。

## 變更與相容性

- OpenCC 1.4.2 改為只引用播放器使用的 `cn ↔ tw`。保留原版 s2tw／tw2s 的 normalization、segmentation、conversion chain；沒有改為較簡化的 from/to 字典組合。同步轉換介面、每方向一次的 converter 快取及 HTML 保護規則不變。
- 字典與五語各自輸出有內容雜湊的獨立 JS，Hearthroom 再打包時保留邊界，沿用既有 `/assets/` immutable 策略。五語仍同步可用，並非只下載目前語言；避免改變作者腳本與既有語言切換契約。
- 19 個模型圖示從 library 內嵌 data URL 改為獨立圖片。瀏覽器只在圖示使用時讀取，圖片不再佔首次解析的 JS；套件發佈必須包含完整 `dist-stage/`，包含新增 chunks 與 assets（既有 package files 已涵蓋）。
- 遊玩路由在等待 locale／session 前開始靜態預載。私人 host 安裝、授權及綁定憑證仍走原有流程；榜單不啟動這次預載。
- 作者正則、HTML、腳本、DOM 契約、掛載順序與沙箱初始化未修改，沒有卡片特例。

## 體積

使用同一份鎖檔安裝的 web Vite 6.4.3，比較正式建置。單位 bytes；gzip 為本機 gzip 壓縮長度，非 Cloudflare 實際傳輸量。

| 範圍 | 修改前 | 修改後 |
| --- | ---: | ---: |
| 播放器主要 JS 原始大小 | 4,126,889 | 907,382 |
| 主要 JS gzip | 1,677,236 | 307,697 |
| 獨立字典 gzip | 包在主程式 | 468,545 |
| 五語合計 gzip | 包在主程式 | 354,210 |
| 上述必要 JS 合計 gzip | 1,677,236 | 1,130,452 |

必要 JS gzip 減少約 32.6%。不是整頁總下載量或正式 FCP 改善比例；CSS、宿主、沙箱及日後打開選單的圖片另計。字典本身的縮減有限，主要收益是移出內嵌圖片，以及字典／語言檔不隨播放器程式改版失效。

## 驗證

Red：新增的實際 bundle 測試先發現沒有獨立字典；路由測試先發現 session 等待期間沒有預載。Green：實作後通過。

- OpenCC 測試逐一比對保留字典的所有來源／目標詞條，以及混合文字、HTML、相容字；兩方向和原版完整 preset 相同，另直接比對完整轉換鏈。升級 OpenCC 時必須維持此測試。
- 實際 Vite library 建置測試確認不存在完整 preset、HK／JP／台灣用語轉換表，字典與五語 chunks 不反向依賴播放器、19 個圖片獨立輸出。模擬只修改播放器入口，六個資料 chunk 雜湊不變，播放器雜湊改變。
- Moonstage 全量：178 suites／1,898 tests 通過；i18n、stage、sandbox、H5 production build 及 H5 output check 通過。
- Hearthroom 全量：Worker 48 suites／505 tests、web 85 suites／461 tests 通過；1 個真實卡片 probe suite 因未提供 REAL_CARDS_DIR 跳過。typecheck、web production build 通過。
- Chrome 使用正式建置與本機合成 API，正常 OAuth 返回沙箱卡；作者腳本讀到原存檔 checkpoint。一般卡片、沉浸模式、繁體與英文路由另驗證；未發出模型生成。桌面及 390×844 驗證卡片、輸入區、模型選單。
- 模型選單的 Gemini 圖示實際從 `/assets/gemini-<hash>.png` 載入，naturalWidth 1024，沒有破圖。重新整理後字典及五語 Resource Timing transferSize 都為 0。
- 關閉瀏覽器快取的合成測試：靜態播放器／字典／五語約 55 ms 開始，最晚約 174 ms 完成；profile 約 525–2,531 ms，確實重疊。沙箱 FCP 約 4.107 s。API 延遲刻意固定，無 CPU／網路節流；這些不是正式站 p50／p95。

環境與既有問題：初次 typecheck 的 Wrangler log 寫入受 sandbox 限制，指定暫存 log 後重跑通過。完整測試保留既有 happy-dom teardown localhost:3000 連線警告；Vite／Sass 棄用及大 chunk 警告仍存在。額外執行 `check:stage-boundary` 失敗：基準版 package.json 已指向不存在的 `scripts/check-stage-boundary.mjs`，登記為既有檢查缺口，不宣稱該項通過；實際 sandbox boundary 檢查通過。

## 發布觀測與 API 決策

發布後檢查字典／語言／圖片的 Cache-Control、冷暖 transferSize、靜態 JS 是否與 profile 重疊、沙箱 FCP 與 console errors。既有 Resource Timing／Server-Timing 足以量測本次瀏覽器與靜態資源變更，不新增 Prometheus 或高基數標籤。

MCP／Moonloom 能力同步不適用：沒有新增 API、權限、使用者資料或工作流程。沒有新增可見字串。正式站速度仍須發布後再量測；本機結果不能替代正式驗收。
