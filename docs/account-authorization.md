# 帳號授權保存與操作

Hearthroom 可將使用者授予的 OAuth 憑證加密保存在本站資料庫，讓使用者在新設備登入同一個社群帳號後，恢復其他已連結的供應商授權。此功能需要明確啟用，預設不改變未設定的自架站。

## 保存什麼、能做什麼

| 資料 | 保存位置與用途 |
|---|---|
| 供應商與公開帳號的連結 | D1 的既有身分表，用來判斷帳號歸屬；停止授權不刪除歷史連結 |
| access / refresh token | D1 密文；Worker 依使用者同意的權限取得短期存取能力與自動換發 |
| 金鑰 | Worker secret `AUTH_KEYRING`，與資料庫分開管理，不放在版本庫或前端 |
| 本站 session | 瀏覽器只有 Secure、HttpOnly、SameSite=Lax、host-only cookie；D1 保存隨機值的雜湊 |
| 前端 access token | 只留記憶體，供編輯器及內嵌聊天呼叫供應商；不寫 localStorage |
| 暫存 OAuth 流程 | D1 加密保存 PKCE verifier 與待確認授權，10 分鐘後可清理 |

這是 token-mediating backend。供應商密碼不會交給本站，但有 Worker 執行權限及金鑰的營運者有能力解密被託管的憑證。瀏覽器同源 JavaScript 仍能使用短期 access token；不應宣稱所有 token 對前端不可見、只有唯讀權限或零洩漏風險。

權限仍以供應商同意頁為準。HarperHarbor 沿用 `profile.read email.read role.read role.write chat.play`：包含身分／信箱、私有智慧體設定與 Lorebook 的讀取、設定寫入，以及會消耗 credits 的對話。這次不增加 scope，也不擴大既有 API 的 ownership、計費或審核權限。LunaTalk 沿用其既有預設 scope。

長期保留連結不等於永久有效 token。HarperHarbor 目前預設 access token 8 小時、refresh token 30 天滾動換發；由供應商配置決定，本站不覆寫期限。本站 session 有 30 天閒置及 180 天絕對上限。持續使用時由後端換發；被撤銷、長期未使用、或無法安全判斷 refresh 是否已消耗時，仍可能需要重新授權。

## 登出、停止授權與取消連結

- **登出本站**：刪除本設備的 site session；其他設備與已託管授權仍可使用。
- **停止某家授權**：本站先停止發出該份授權的 token，再通知供應商撤銷；連結與社群紀錄保留。撤銷尚未獲上游確認時，介面會說明正在重試，密文保留在撤銷工作中。
- **供應商 Console 撤銷應用**：由供應商阻止 API 存取；本站下次驗證／換發會要求重新授權。已在記憶體的 token 不會因此從瀏覽器遠端抹除，但供應商必須拒絕它。
- **身分解除連結**：既有永久連結規則不變；停止授權不是重置發布上限或刪除社群資料。

同源分頁以不含憑證的 storage event 同步登出／停止狀態，並重新載入以清除內嵌應用快取。禁用 localStorage 時沒有跨分頁通知，仍依靠伺服器 session/grant 檢查及供應商撤銷。各設備可能已持有 access token，因此上游撤銷失敗時，不能保證所有設備即刻失去直接 API 存取能力。

## 部署配置

先完成程式與 migration `0036_account_auth.sql`，再啟用：

| 名稱 | 值與用途 |
|---|---|
| `AUTH_ENABLED` | `true` 啟用；`paused` 安全暫停；未設定或 `false` 是原本的自架瀏覽器模式 |
| `AUTH_ALLOWED_ORIGINS` | 逗號分隔的完整 HTTPS origin；只列本站，不列卡片 sandbox／萬用網域 |
| `AUTH_KEYRING` | Secret，JSON 格式 `{"active":"key-id","keys":{"key-id":"<base64 encoded 32-byte random key>"}}`；此為格式，不是可用金鑰 |
| `AUTH_METRICS_SECRET` | 獨立 secret，供內部 metrics 驗證 |

缺配置／金鑰錯誤時 fail closed，不自動回到瀏覽器存放 refresh token。正式託管站的回滾使用 `paused`，保留 schema、keyring 與維護排程；不要改成 `false` 或移除設定。

HarperHarbor 需先有 token-family revoke 保留 application consent 的修正，再啟用本站：清理舊 grant 不得移除新 grant 在 Console 的管理入口。Console 的 application revoke 仍撤銷整個應用。

啟用後每個舊瀏覽器首次進站會清除原有 access/refresh/grant_client（含舊鏡像與各 provider 欄位），不把它們上傳。使用者需一次重新授權；授權前可閱讀五語保存說明。部署新程式本身不會自動啟用或搬移現有使用者 token。

## 金鑰輪替與維護

AES-256-GCM 的 AAD 綁定用途、供應商、帳號及不可重用的 generation。新授權、並行換發與撤銷工作皆受 generation 約束，舊工作不能刪除或覆蓋新授權。永久帳號合併與憑證保存使用同一個 D1 交易。

輪替先加入新 key、更新 `active`，保留所有仍被密文引用的舊 key。現階段沒有批次重加密工具；未確認所有舊密文已換代或清除前，不能刪舊 key。遺失 keyring 會使現存授權無法使用，也無法完成撤銷重試。

沿用每小時維護排程，每次最多清理 50 個過期流程並處理 50 個撤銷工作。撤銷失敗的密文保留至上游確認；過期本站 sessions 會刪除。監控工作積壓，若流量需要再增加專用排程。沒有供應商回應時，不承諾固定的上游撤銷完成時間。

`GET /internal/auth/metrics` 需 `Authorization: Bearer <AUTH_METRICS_SECRET>`；只輸出低基數 `hearthroom_auth_operations_total{operation,provider,outcome}`。查詢範例：

```promql
sum by (operation, outcome) (increase(hearthroom_auth_operations_total[15m]))
```

`operation` 為固定操作名稱；不得放帳號、email、token、IP 或內容。排查撤銷積壓可讀 D1 的工作筆數與最早 `retry_at`，不要列出 payload。此類瀏覽器 session 與憑證保存端點不透過 MCP 匯出。

## 驗收邊界

自動測試使用合成 OAuth 回應與本機 D1，涵蓋帳號隔離、跨設備、state/CSRF、加密綁定、交易回滾、並行換發、取消／登出晚到回應及撤銷重試。上線前仍需正式供應商、可見桌面／手機瀏覽器、兩設備恢復與 Console 撤銷的驗收；本機測試不代表已部署。
