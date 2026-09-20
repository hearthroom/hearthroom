# 社群對話清單與服務選擇隔離驗證

> 後續入列規則已修正：只開卡不算遊玩，見 [library-played-only.md](library-played-only.md)。以下保留首批實作的驗證紀錄。

2026-09-20；分支 `fix/community-owned-library`，來源 `4266312`。

## 需求及交付

對話清單、收藏由社群成員持有；不匯入 SaaS 的帳號對話清單。我的卡片維持合併作品列表，積分頁同頁呈現服務帳務；遊玩服務只在卡片開啟時決定，不改社群登入。

新增 `member_conversations` 與私有 GET/PUT API；成功開啟對話後才建立最近紀錄。UI 不顯示服務標籤或訊息原文，續玩路徑保留所需服務。收藏沿用社群 D1。此版本沒有遷移上游聊天本文或外部帳號歷史。

## 自動化證據

- Red：原前端仍請求上游 `/conversation/list`；新社群端點原本 404；原積分頁無法同時呈現兩家資料。
- Worker：36 個測試檔、366 項通過。包含未登入拒絕、成員隔離、兩家身分解析同一成員、重放不重複、有效路由識別、私有快取、durable counter。
- Web：66 個測試檔、374 項通過；外部 real-card probe 的一個測試檔 skipped。涵蓋兩家餘額／流水同頁、篩選不改登入、Harbor 遊玩憑證與社群身分分離、開啟事件後才登記。
- Worker TypeScript、Web vue-tsc、五語 key 檢查、stage build、web build、git diff whitespace 通過。
- 首次完整 Worker 測試在 web 建置前執行，canonical fixture 尚無靜態 HTML，1 項失敗；建置後該檔 9 項與完整 366 項均通過，歸因為本機建置前置條件。
- 前端 Happy DOM 仍有既存 localhost:3000 iframe 連線雜訊；建置仍有 stage 字型路徑、Sass 舊 API 和大 chunk 警告。未把這些警告或 skipped probe 宣稱為實機通過。

## 瀏覽器證據與限制

以隔離的本機 Worker、合成卡片及 OAuth/PKCE fixture，使用 Chrome 自然操作：

1. 登入返回 library，清單為空；上游 conversation/list fixture 刻意回 500，頁面仍正常。
2. 探索 → 卡片 → 收藏 → 重新載入，收藏仍有效；收藏頁讀回同一卡片。
3. 卡片 → 開始對話 → 顯示開場 → 返回 → 對話與收藏，社群清單出現剛開啟的卡片，無服務標籤。
4. 積分頁單服務餘額與流水可讀，無 provider 切換連結。
5. 390px 繁中積分頁及英文對話頁皆無橫向溢出；英文清單內容寬 358px、三個分頁高度約 48px、無文字溢出。積分既有收支篩選仍為 30px 點擊高度，非全站 HIG 通過聲明。瀏覽器尺寸已還原。

播放器最初因 fixture 漏放行 X-Api-Version 而失敗；補齊本機 CORS 後開場與對話索引讀回成功。未送出付費生成，未宣稱完整對話引擎驗收。

雙服務瀏覽器讀回已補完：owner 明確允許本機合成帳號連接後，透過確認頁完成連接；帳號頁顯示同一社群成員及兩家服務授權有效。積分頁同時顯示 LunaTalk 100、HarperHarbor 250 及各自流水，重新載入後仍可讀取，沒有平台切換分頁。選取 HarperHarbor「支出」只改變該區記錄，LunaTalk 區保持不變；返回社群清單後，原對話與收藏仍保留，對話列無服務標籤。此步僅涉及隔離的本機合成資料，未操作正式帳號。

**未完成的 UI 證據：**完整共用幾何探針、深色矩陣未執行，因此此批不標 `ui-verified`。

五語文案為 LLM-approximation；en/zh 信心相對高、ja/ko 較低，未宣稱真人母語審校。

## 契約及發布

MCP 不適用：Hearthroom 無社群 MCP transport，資料不移入 Provider/Moonloom。既有 `hearthroom_library_requests_total` 增加低基數 `conversations_get` / `conversations_put`，包含 success/denied/error；不記錄身分或內容。

owner 已於 2026-09-20 授權驗證通過後發布。本機 D1 已套用 `0024_member_conversations.sql`；正式發布由既有 CI 從確切已推送來源套用遷移並部署，完成後另以 CI 紀錄、線上資產及 metrics 讀回作為發布憑據。本文件的上述瀏覽器與測試數字屬本機證據。既有編輯器的資產服務接線沒有在本次重寫。
