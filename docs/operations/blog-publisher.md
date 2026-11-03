# 官方部落格營運工具

適用：經任務書指定的工作室團隊負責人／營運角色。這是內部工具，請勿把憑證、文章草稿、稽核身分或操作回應貼到公開文件或對話。

## 權限與設定

一般審核代理與一般會員沒有部落格寫入權限。真人仍以 Harbor 應用 owner/admin 驗證；營運工具使用獨立金鑰，只在 `/v1/blog/admin/*` 的 writer gate 生效，不取得發點數、審核、設定或其他帳號權限。瀏覽器帶 `Origin` 的金鑰請求一律拒絕。

私有 `infra-access/services/blog-publisher/credential.json` 保存 `{ "origin": "https://sukisuki.ai", "key": "<64 lowercase hex>" }`，權限 600。不要把 key 放在命令列參數、shell history、環境範例、程式碼或公開倉庫。CLI 讀檔，不跟隨重新導向；只有本機 localhost/loopback 夾具可用 HTTP。

Worker secret `BLOG_PUBLISHER_CONFIG` 是 `{ "memberId": "<固定工作室 AI 成員>", "keySha256": "<SHA-256(key UTF-8) hex>" }`。使用 migration `0107_blog_publisher_identity.sql` 建立的專用 `system-blog-publisher`；其顯示名為蘇綺，不建立登入連結、reviewer 或代理角色。migration 留 system audit，重跑不重建，也拒絕採用有登入／審核連結的既有帳號。只配置這個由工作室持有的專用成員；每個操作都重新確認設定與成員存在，不吃快取。稽核 actor_kind 固定為 `ai`，actor_member_id 固定取設定，不接受請求指定身分。設定為空字串或移除 secret 就停用；換金鑰時在 infra-access 產生新 key，更新 Worker secret 再做正負控，舊 key 應為 403。

`memberId` 是伺服器端私有識別，不能放進公開文章或共享任務附件。金鑰授權與一般審核角色獨立：撤銷營運權限須移除／輪替本設定，不能只撤銷審核角色。

## 操作

使用 Node 22+。以下 `CREDENTIAL` 僅代表憑證檔案路徑；實際檔案留在 infra-access。寫入都帶一個穩定、16–80 字元的 operation ID（英數與連字號）；同一動作斷線重試沿用原 ID，新動作用新 ID。CLI 的回應可能含未公開文章，僅存本機私人證據。

```bash
node scripts/blog-publisher.mjs GET /v1/blog/admin/columns --credential "$CREDENTIAL"
node scripts/blog-publisher.mjs GET '/v1/blog/admin/translation-groups?query=card-rewards' --credential "$CREDENTIAL"
node scripts/blog-publisher.mjs POST /v1/blog/admin/images --credential "$CREDENTIAL" --image cover.webp --operation-id <穩定操作編號>
node scripts/blog-publisher.mjs POST /v1/blog/admin/posts --credential "$CREDENTIAL" --json original.json --operation-id <穩定操作編號>
node scripts/blog-publisher.mjs PUT /v1/blog/admin/posts/<文章ID> --credential "$CREDENTIAL" --json edit.json --operation-id <穩定操作編號>
node scripts/blog-publisher.mjs POST /v1/blog/admin/posts/<文章ID>/state --credential "$CREDENTIAL" --json publish.json --operation-id <穩定操作編號>
```

- 欄目：先讀現有樹，以既有 leaf `id` 寫文章。必要時 POST/PUT `columns`，JSON 為 `slug, name, description, sort, enabled, parentId`。`parentId:null` 建分組，分組下建欄目；不要重建或改名既有欄目。
- 原文 JSON：`columnId, slug, locale, title, excerpt, bodyMd, coverKey`。五語 locale 為 `zh-Hant, zh-Hans, en, ja, ko`。封面使用上傳回傳的 `blog/...webp` key。內容只使用文案已簽定稿，不自動翻譯。
- 翻譯 JSON：原文的上述欄位加 `translationOfPostId` 與最新的 `expectedTranslationGroupVersion`。每建一語後重新 GET 原文取得 `groupVersion`，再建下一語；每個版本有獨立且唯一的 slug。翻譯不是另建無關文章組。
- 編輯：PUT 帶回完整內容與 `expectedVersion`；409 先讀最新版本，不直接強制覆蓋。已公開的網址受既有服務規則鎖定。
- 發布 `publish.json`：`{"change":{"status":"published","publishAt":<毫秒時間>}}`。下架：`{"change":{"status":"unpublished"}}`。置頂要另有任務授權，預設不置頂；留言開關、修訂還原與預覽同樣走既有 API。
- 封面：上傳回傳與稽核都使用資產 key；文章存檔稽核再把資產連到該篇。重送同一上傳 operation ID 回已稽核資產，不重新計成功數。未引用的失敗／並發輸家資產由既有 24 小時清理機制回收。

## 收環與故障

每次寫入都應有 `audit_log`：文章／欄目／圖片主體、固定 AI 身分、動作、operation_id、前後內容與時間。JSON 寫入、翻譯、發布與下架沿用 blog service 的版本控制及 atomic batch 稽核；圖片存入後必須稽核成功才回成功。發布後分別 GET 五語公開文章，核對 locale、標題、內文、封面與 `pinned:false`，並由發布角色走正式頁面。API 200 不等於使用者路徑驗收。

- 401：未提供營運金鑰，也沒有登入。
- 403：金鑰錯誤、停用、身分不存在、瀏覽器 Origin，或一般登入沒有寫作權限；不要改用 owner 私人登入。
- 409：版本／slug／翻譯組衝突，先讀回再決定下一個動作。
- 503／網路中斷：先以同一 operation ID 讀回稽核與文章，再重試；不要換 ID 盲目重送。

指標：`hearthroom_blog_publisher_admissions_total{operation="admission",outcome="allow|denied|error"}` 與既有 `hearthroom_blog_operations_total{operation,outcome}`。兩者都是 durable counter，labels 不含身分或文章資料。部署後以 `/metrics` 查 HELP/TYPE 與 allow/denied 增量，寫入成功再核對 audit。HTTP GET 管理讀取也會計 admission allow，不能把 admission 次數當發布數。

MCP 決定：不適用。這是指定工作室身分的私有營運寫入工具，沒有對一般使用者或外部 AI 客戶端新增能力；直接使用與真人後台相同的 Hearthroom service。不得把這把 key 掛到公開 MCP 或卡片創作工具。
