# 卡片統一使用直圖

## 需求與驗收

Hearthroom 編輯器只保留直式背景與選填橫式背景。直圖同時用於卡片圖片、PNG 匯出及聊天原本的頭像位置。原有頭像按鈕、事件與作者腳本的 DOM 不移除。圖片上傳保留原始位元組；GIF 在編輯器與播放器可播放，PNG/APNG 匯出保留原始圖片區塊，其餘格式匯出為 PNG 靜態畫面。JSON 匯出不依賴圖片取得成功。

LunaTalk 的資料庫與服務不改。Hearthroom 儲存直圖時同步送既有 `roleAvatar` 與 `roleBackground`（包含清空），供既有 LunaTalk 客戶端相容；不再有獨立頭像輸入。
HarperHarbor 移除 `role.avatar_asset_id`、不再保存 `externalMedia.avatar`；Hearthroom 移除 `cards.avatar_url`。會員／作者帳號頭像不在本次範圍。

## 相容與資料遷移

- 現有直圖優先。舊卡只有頭像時，搬為直圖。直圖為外部網址時，不讓舊的託管頭像蓋掉它。
- Harbor `roleAvatar`／資產 `avatar` 保留為通訊格式別名；讀取回傳直圖，舊客戶端單獨寫入它會更新直圖。同時送直圖與頭像時，以明確的直圖值為準，包括空值。
- 跨站同步以直圖計算圖片內容與讀回一致性；仍接受先前版本的雜湊作為衝突基準。封存複本只下載與複製實際使用的直圖／橫圖，保留原檔。
- Harbor 遷移在同一交易內將舊圖片接到直圖，保留封存收據與既有版本雜湊，恢復不可變保護；可編輯草稿重算目前內容雜湊。原圖媒體檔案不刪除。Hearthroom 的歷史審核快照不改寫，只在讀取時優先取直圖。
- 這是顯示／儲存模型變更，不建立新的審核同意或放寬公開權限。舊資料中的獨立頭像不再是展示來源。

## 上線順序與回復

採兩階段發布，避免先遷移再換程式時讓舊服務讀取失敗。第一階段 Harbor migration 59 與 Hearthroom migration 0038 搬移直圖並停用獨立頭像，但保留相容欄位；先部署新版 API、worker 與 Hearthroom。讀回版本、健康與圖片來源並等待舊請求排空後，第二階段另加遷移刪除欄位。LunaTalk schema 不變。

先推送被固定引用的 Moonstage commit，再發布 Hearthroom gitlink；所有部署來自已推送且驗證的來源，由 CI 執行。Harbor 部署保留遷移前備份，Hearthroom 使用 D1 Time Travel。第二階段的自動回退目標必須是已停用欄位的第一階段 binary／Worker。完整回退到舊的獨立頭像模型需備份，不能只換回早期程式。

## 契約與可觀測性

HTTP 保留欄位名稱與授權規則，公開 OpenAPI 註明 Harbor 的別名語意與 LunaTalk 的保留範圍。Harbor 目前未掛載 MCP transport，未修改 LunaTalk MCP，因此本次不改 Moonloom；未宣稱提供新的 MCP 能力。

不新增指標：此變更是既有圖片與文件路徑的投影，既有 HTTP 結果與匯出成功／失敗事件足以判斷錯誤。上線驗證需讀回 schema 欄位已移除、舊卡直圖、文件儲存／清空、聊天圖片、PNG 內嵌設定，以及 `/readyz` 和 `/metrics`；不得把卡片識別或 URL 放入指標標籤。

## 驗證

回歸測試涵蓋圖片網域代理、原樣上傳 GIF、直圖優先匯出、非 PNG 格式轉換、JSON 不取圖、舊卡回填、移除欄位、封存保護、別名清空／衝突優先序與跨站同步。瀏覽器使用合成卡片與本機服務驗證，未改動正式卡片。

### 本機驗證結果（2026-09-23）

- Hearthroom：Worker 597 項、web 512 項通過；保留一個既有 skipped 檔案。typecheck 與 web build 通過，維持既有大型 chunk 警告。
- Moonstage：1,943 項通過；Node 26 內建 webstorage 與測試環境衝突，改用 `NODE_OPTIONS=--no-experimental-webstorage` 後全綠。stage、sandbox 建置及 sandbox boundary 通過；`check:stage-boundary` 指向既有缺失腳本，不能宣稱該項通過。i18n 檢查通過，仍有既有翻譯／複數形式警告。
- Harbor Provider：真實 PostgreSQL 的 `go test -p 2 ./...` 全量通過；CI 分層、檔案大小、append-only migration、sqlc 機關與機關測試通過。工作樹布局使自動契約副本檢查略過，另以確切兩份 OpenAPI 位元組比對確認相同。
- parent server 離線集：前 25 項通過，第 26 項仍有既有的跨 module 路由基線落差；功能修改前後的 spec 得到完全相同的 10 條缺口。初輪計時 watchdog 失敗，單獨 20 次與完整集重跑該項均通過。未修改 gate 或 baseline 掩蓋失敗。
- 真實瀏覽器、本機合成資料：編輯器只見兩個圖片欄位；JPEG 直圖下載為同尺寸 PNG，讀回 `chara`／`ccv3` 均保留設定。先前驗證原檔 GIF 可顯示交替影格；新版 GIF 儲存路徑由回歸測試確認。
- 尚未完成：瀏覽器連線中斷，聊天實際畫面、頭像按鈕互動與手機尺寸的視覺驗收待補。播放器投影與既有互動測試通過不能替代這項人工畫面證據。尚未執行正式發布或資料遷移。
- 舊同步基準若仍可由供應商讀回，接受其歷史雜湊。若 Harbor 舊的獨立頭像已被遷移捨棄，且目標內容與來源不同，仍保留安全的 `sync_target_changed` 拒絕；不為重設基準而自動覆寫使用者的不同版本。
