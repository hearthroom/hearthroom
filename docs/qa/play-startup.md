# 遊玩頁啟動效能

需求：縮短進入遊玩頁到沙箱卡片出現的等待，保留社群身分、遊玩帳號、授權與原存檔。

驗收：播放器靜態程式與社群 profile 並行載入；字典只在需要轉換時建立且依方向共用；沙箱存檔在安裝播放器前開始讀，握手仍等待真實結果；關閉的模型選單不發偏好請求。

本次不做：資料庫／API／scope／NSFW 規則變更、模型生成、計費、作者腳本修改。沒有把私人資料放進 KV。

## 修改

- 拆出 `preloadStage`，只下載靜態程式及樣式。`ensureStage` 仍在完整身分及遊玩授權通過後安裝宿主；等待 profile 或授權時離開頁面不繼續掛載。
- 共用延遲建立的 OpenCC 字典，保留原本繁簡判定、多義單字保護、HTML 文字節點及每個顯示實例的文字 memo。
- 在已授權的播放器安裝入口預取初始卡片存檔。只保留一份、30 秒內、同 token／provider／role 的結果，握手消耗後不再快取；修改／刪除先失效。失敗交由正常讀取重試，不捏造空存檔。
- 模型選單關閉時不讀 agent-mode 偏好；移除第二個重複 watcher，開啟選單與選模型仍更新支援度。

## Red / Green 與可信集

- 字典測試先重現：不需轉換仍初始化、兩個欄位加兩個顯示實例建立四次字典；修正後零次／一次，同方向共用、反方向獨立。
- 真實模型面板元件先重現：關閉時同步選擇也發 agent-mode；修正後零次，開啟一次、選模型一次。
- PlayPage 測試先重現：profile pending 時沒有預載。修正後已預載，但沒有初始化私人播放器 API；跨服務憑證回歸通過。
- 存檔測試覆蓋提前開始、握手重用且只消耗一次、token／卡片隔離、寫入失效、失敗重試。
- Moonstage：176 suites、1,894 tests 通過；i18n、stage、sandbox、正式 H5 build 及 build-output 檢查通過。
- Hearthroom：Worker 47 suites／500 tests、web 84 suites／455 tests 通過；web 真實卡片探測因未提供 `REAL_CARDS_DIR` 跳過一個 suite。型別檢查及 web 正式 build 通過。
- 第一次 Worker suite 受本機 listen EPERM 限制，允許 workerd 本機監聽後全量重跑通過。測試環境既有 happy-dom 關閉時 localhost:3000 連線警告及 jsdom pseudo-element getComputedStyle 訊息仍存在；不是通過的執行期證據。

## 瀏覽器證據（2026-09-21）

原生 Chrome、合成帳號／合成沙箱卡、相同固定 API 延遲：profile 2,000 ms、models 授權 800 ms、卡片 650 ms、saves 1,500 ms。使用實際 PlayPage 與已編譯 stage，Vite 提供 web；不是正式部署、不是正式卡片或弱網測試。

對照來源為 Hearthroom `736197d` / stage `c3c5382`。兩版使用相同沙箱及首繪探針，瀏覽器快取開啟。首繪以沙箱自己的 PerformanceObserver 回報，換算到主文件 navigation start；不使用工具呼叫等待時間。

| 指標 | 修改前 | 修改後 |
| --- | --- | --- |
| 沙箱 FCP，兩次完整樣本 | 11.485 s、8.956 s | 4.901 s、4.935 s |
| 播放器 JS 開始 | 約 3.36 s | 約 0.52–0.56 s |
| saves 開始 | 約 7.33–9.80 s | 約 3.32–3.34 s |
| 初始 agent-mode 請求 | 2 | 1 |

樣本很少，CPU／瀏覽器排程有明顯波動，不推算正式站 p50/p95 或保證改善百分比。正式卡片仍須部署後以相同登入條件重測。profile 與模型授權的串行時間仍存在，這次不宣稱解決上游或 D1 耗時。

自然路徑：本機 OAuth 登入 → 遊玩頁 → 合成卡片顯示 → 模型設定開啟／關閉。卡片初始腳本讀到 `Checkpoint: 7`，繁體名稱與開場白正常；初始 agent-mode 一次，打開選單後總共兩次。桌面與 390 × 844 視窗都能看見卡片、存檔與輸入區。未送出聊天、未生成模型回覆。

測試站先遇到合成 API CORS 預檢及 Vite `/sandbox/` 的 SPA fallback，修正測試站後重新量測；失敗樣本不計入上表。最後兩次量測無新增 warn/error。CSS、文案與 UI 版面未修改。

## 契約與發布

- 五語：沒有新增文案；保留依語系轉換方向與既有 i18n 檢查。
- MCP / Moonloom：不適用新增能力同步，只有既有瀏覽器客戶端排程與計算重用，HTTP／權限／資料契約不變。
- 可觀測性：無後端變更，不新增 Prometheus 指標。驗證使用 Resource Timing、long-task observer、沙箱 FCP／ready 事件與 HTTP 請求數；探針僅存在本機合成測試站，未加入產品，也未記錄身分或憑證。
- 正確播放器來源以 `.gitmodules` 的 `hearthroom/moonstage` 為準；本機共用 origin 仍是舊組織，未修改它。正確遠端 main 已確認為固定版本。
- 本次尚未推送或部署，沒有資料庫遷移。發布後才補正式卡片相同條件的 profile。
