# 公開卡片跨平台 404 修復

日期：2026-09-21。基底：`78cf892`。

需求：已核准公開的卡片，不因訪客登入另一個平台而變成 404；直接連結應提供簡介與支援平台清單。

## 根因與改動

正式環境唯讀比較確認：同一張一般公開卡，預設請求回 200，帶 `X-Provider: harbor` 回 404。詳情 API 把訪客平台套進來源卡查詢；HTML 入口另有預設只查 LunaTalk 的限制。

- 新增供公開入口使用的跨平台解析，本站卡 ID／卡號不依訪客平台篩選；舊上游 ID 撞號時仍以請求平台消歧，本站 ID 優先於上游別名。
- 詳情 API、HTML 卡頁與支援平台清單使用此解析。平台清單以查到的卡片所屬平台及來源 ID 查副本，不把網址上的本站卡號／ID 當成上游 ID。
- 未核准卡片的作者預覽同時檢查平台與作者編號；兩家相同數字編號不構成所有權。審核、封鎖、成人門與既有核准版本限制保留。
- 身分綁定的登記／編輯仍使用原本的供應商限定查詢。未改 UI、翻譯、Provider 契約、資料結構或正式資料。

HTTP／MCP／Moonloom：這是 Hearthroom 既有公開讀取契約的缺陷修復，沒有新能力或新 Provider transport；不新增 MCP 或 Moonloom 介面。

Observability：沿用既有 `card_view` 成功事件及 HTTP 狀態觀察，無新交易／背景工作或需要新 Prometheus 計數器的狀態；不新增身分或內容日誌。部署後以同一卡片跨平台回應及 `/platforms` 的 durable API readback 驗證。

## 驗證

- Red：新增 API 案例 8 項全部如預期失敗（公開卡錯誤 404、跨平台作者編號碰撞、成人門）；另測 Harbor HTML 直接連結得到 404。
- Green：卡片／分發／平台隔離／hosting edit focused suites 24 項通過。
- 完整 Worker：44 suites、473 tests 通過。
- 完整 web：82 suites、440 tests 通過；1 個真實外部卡素材探針 suite 因未提供素材而跳過。i18n 檢查通過。
- `npm run typecheck`、`npm run build`、`git diff --check` 通過。建置使用專案釘選的 stage commit。
- 環境：Node 26 使用 `--no-experimental-webstorage`；Worker 測試初次遭 sandbox loopback／log 寫入限制，改在授權的本機測試環境執行後通過。此環境失敗不列為 Red。
- web 測試輸出 happy-dom iframe teardown／localhost fixture fetch 錯誤；runner 無失敗或未處理錯誤計數，不能把它當成瀏覽器通過證據。建置另有既有依賴棄用與大 chunk 警告。

## 尚未驗證

Chrome 已開啟正式卡頁，但後續狀態讀取遭工具自動審核以用量上限拒絕。因此未完成登入身分、簡介、平台選擇或桌面／手機視覺驗收，沒有 `ui-verified` 宣告。案例：[CARD-PUBLIC-01](case-library/cases/CARD-PUBLIC-01.md)。

尚未推送或部署。正式環境修復後讀回仍待發布授權及執行；本機成功不代表線上已修復，也不代表已驗證實際付費聊天。
