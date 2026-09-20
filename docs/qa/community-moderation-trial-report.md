# 社群審核試作驗證紀錄

2026-09-20；來源 `feat/community-moderation`，基底 `82cea34`。未提交、未推送、未部署，沒有操作正式站資料。

## 執行結果

| 檢查 | 結果 |
| --- | --- |
| Worker 全量 `npx vitest run` | 37 files / 378 tests PASS |
| Web 全量 `npm run test -w web` | 68 files / 380 tests PASS；另 1 個 optional 真實卡片 probe suite 因沒有私有 fixture 目錄跳過 |
| Worker TypeScript + Web vue-tsc | PASS |
| Web production build | PASS；保留既有大型 chunk 與 customResolver deprecation 警告 |
| `git diff --check` | PASS |
| 幾何 probe positive controls | 26 tests PASS，probeVersion 3 |

新增 regression 先觀察 Red，再實作 Green：案件 API／兩人投票、立案內容、舊版恢復、恢復中版本更新、原子版本檢查、公開遊戲設定、帳號切換及新卡領取恢復路徑。並行確認只能產生一個決定；重試補償不重複計入。

第一輪既有測試的快取 assertion 因改成 no-store 失敗，已按新傳播契約更新。private header 被覆寫屬實作 regression，已修正。未先 build 的 HTML asset 測試失敗，在 build 後消失。後續一次 provider isolation 案例超過既有 5 秒 timeout；未修改 timeout，單獨 6 案重跑與最終完整集都通過。測試環境曾需要允許本機 loopback socket；未使用正式憑證。

## Chrome 實際路徑

以本機 Vite 的合成 reviewer／manager 與合成案件進行，使用實際 App、router、工作台、確認框與語系元件。fixture API 僅模擬回應；後端授權與 D1 交易由上列 integration tests 驗證，不能把 UI fixture 當成真實 OAuth／正式 provider 的證據。

- 桌面繁中：待辦 1、選案、卡號／版本、查看原公開內容、理由必填、確認框取消焦點、取消保留理由、第二票送出、待辦歸零、處理紀錄回訪兩票理由，均已觀察。
- 390×844 手機繁中：首頁頭像紅點 → 帳號選單審核 1 → 新卡佇列 → 社群管理的自然路徑已走過；案例列表、詳情與兩票理由完整可讀。
- 390×844 手機英文：作品管理、管理員工具、日榜補償 12 小時、確認框具體時數、回訪補償紀錄，均已觀察。確認鍵中心 elementFromPoint 位於按鈕子樹。
- 手機工作台 controls 加到至少 44px。既有共用頁首與頁尾仍有低於 44px 的點擊目標，這次沒有擴改全站布局。
- 幾何 probe：桌面 modal／手機英文表單及 modal，無 raw i18n keys、clipped text、clipped controls 或垂直偏心。首次深色 danger button 對比 2.78，新增 on-danger token 後 contrast issue 清空。作品列表是靠左多行內容，水平偏心屬預期。頁面捲到固定頁首下方曾報 overlap，回到頁首重驗清空。手機 modal 43.9px 是瀏覽器縮放取樣值，文字未裁切。
- 瀏覽器 console error/warn 檢查為空。工具曾逾時並重接分頁；第一次 probe 呼叫多套了一層函式造成工具例外，修正調用後取得有效結果。

回寫案例：[MODERATION-01](case-library/cases/MODERATION-01-community-case-review.md)。尚未跑日／韓／簡中逐頁 Chrome 視覺回歸，五語翻譯鍵已有覆蓋。新卡領取錯誤修復由 mounted test 驗證，未在真實登入的瀏覽器環境重跑。

## 獨立核對

Persona 與獨立 verifier 核對帳號變更、非同步覆寫、案件查證入口與舊版本恢復。已修復並由 verifier 以真實 migration 的記憶體 SQLite 重現驗證：只恢復審到的最新版，先前版本維持 revoked；更新使舊案失效，仍可重提新案。

## 本機試看與剩餘界線

本機頁面使用合成資料，不代表已部署。開發用 session/API fixture 位於被忽略的 `scripts/fixtures/moderation-preview.config.ts`，僅供本機本次試看；正常 production build 不含它。前端使用現有 stage 的建置產物，沒有修改或重新發布 stage。

權限任命／撤銷 UI、取得已刪除的私有審核快照、正式 migration、正式 provider callback 與端對端遊玩驗證不在本次完成範圍。現有發布審核的其他既有 UI 沒有全面重寫；這版新增獨立站務工作台並修復未領取卡片時的恢復入口。
