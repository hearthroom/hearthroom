# 更新說明

這個目錄裡的每一份 JSON，就是使用者會看到的一則更新：更新頁（`/updates`）、首頁的一行提示、功能入口旁的「新」、
Discord 每天晚上的彙整，全部讀這裡。設計見 monorepo 的 `docs/technical-design/HearthroomUpdates_TechnicalDesign_20261005_V1.0.md`。

說明跟程式碼一起部署：功能還沒上線，說明就不會出現；回滾時說明也跟著消失。

## 什麼時候寫

**一則說明＝使用者能用一句話說出的一件事**：「現在可以⋯⋯了」或「⋯⋯不會再⋯⋯了」。不是一個 commit 一則。

| 情況 | 做法 |
|---|---|
| 同一個功能拆成好幾個 commit | 第一個 commit 建說明（還沒做完就加 `"draft": true`），後面的 commit 用 `Update: <id>` 指向它 |
| 上線後的修正、微調、改字 | `Update: <原本那則的 id>`，不會再公告一次 |
| 上線後又多了使用者會注意到的新能力 | 另開一則（例如通知鈴鐺和瀏覽器推播是兩則） |
| 真的需要再公告一次同一則 | 把 `announce` 加一 |
| 回退一個已上線的功能 | 同一個 commit 刪掉那則說明或改成草稿 |
| 效能 | 使用者感覺得到才寫（首頁明顯變快），不然 `Update: none` |
| 樣式微調、重構、測試、文件、內部工具 | `Update: none` |
| 播放器（stage）的變化 | pin 的 commit 指向說明或 `none`，說明寫在這裡 |
| 伺服器那邊的變化在這個站感覺得到 | 伺服器上線後，在這裡補一則；只含說明的 commit 一樣會觸發部署 |

提交時的檢查（`.githooks/commit-msg`，CI 的 `update-notes`）會擋下沒有交代的 `feat`／`fix`／`perf`／`copy`／`revert`、沒有前綴的 commit，
以及改到 stage 指標的 commit。交代的方式三選一：這個 commit 改了 `updates/` 底下的檔、訊息尾端寫 `Update: <id>`、或寫 `Update: none`。

```
feat(community): notifications get their own page

Update: 2026-10-04-notifications
```

本機要先跑過一次 `npm install`（會設定 `core.hooksPath`），hook 才會生效。

## 格式

檔名 `YYYY-MM-DD-<slug>.json`（日期是寫的那天，只拿來排序；上線時間以伺服器第一次服務到它為準）。去掉 `.json` 就是 id，之後不要改。

```json
{
  "tier": "feature",
  "audience": "everyone",
  "try": "/me/notifications",
  "spotlight": ["header.bell"],
  "reports": ["hk:0123456789abcdef01234567"],
  "title": {
    "zh-Hant": "通知鈴鐺會告訴你誰回覆了你、誰讚了你的留言，以及關注的作者發了新卡。",
    "zh-Hans": "…", "en": "…", "ja": "…", "ko": "…"
  },
  "body": { "zh-Hant": "…", "zh-Hans": "…", "en": "…", "ja": "…", "ko": "…" }
}
```

| 欄位 | 說明 |
|---|---|
| `tier` | `highlight`（會改變使用方式的新能力，每週不超過兩則）、`feature`（看得到的新功能或明顯改進）、`fix`（以前會壞、現在不會） |
| `audience` | 預設 `everyone`；寫卡相關的用 `authors`（首頁提示只給登入的人） |
| `try` | 「去試試」的站內路徑，不帶語言前綴。`highlight`、`feature` 必填，而且要對得上 `web/src/router.ts` 的頁面 |
| `spotlight` | 要掛「新」的入口，鍵登記在 `shared/update-spotlights.ts`；要在新的入口掛，先在那裡加鍵，再放 `<NewMark k="…" />` |
| `reports` | Discord 回報案件（Hearthkeeper）的編號，`hk:` 加 24 位十六進位。上線時回報的人會收到「你回報的事已經處理好了」 |
| `announce` | 預設 1；加一就再公告一次 |
| `draft` | `true` 時跟著部署但不顯示 |
| `live` | 只有回填用：程式碼比說明早上線時，寫上線那天（台北日期） |
| `title` | 五種語言各一句 |
| `body` | 選填，五種語言各最多一句 |

`npm run updates:build`（建置、測試、部署都會跑）檢查：五種語言齊全、一句話、長度（中文 40 字、日文 50、韓文 60、英文 120，`body` 加倍）、
沒有破折號與驚嘆號、沒有 cache、commit、後端、部署這類內部字眼、`try` 與 `spotlight` 存在。不合格就建置失敗。

## 怎麼寫

照 monorepo 的 `.claude/skills/product-copy/SKILL.md` 與 `.claude/rules/user-facing-message.md`：

- 功能當主語，一句話說完，先講對他有什麼用。
- 修正寫成「以前會怎樣，現在會怎樣」，一句。
- 只講使用者看得到的東西；用介面上的字（榜單、我的卡片、對話與收藏、寫卡指南），不用工程名詞。
- 五種語言各自寫，不逐字翻；簡體不是換字，日韓的敬體跟介面一致。

| ❌ | ✅ |
|---|---|
| 「新增 community_notifications 的 actor 欄位」 | 「通知鈴鐺會告訴你誰回覆了你、誰讚了你的留言。」 |
| 「修正 Wikidata 查詢未轉簡體」 | 「打繁體簡稱也找得到原作，例如打星鐵會出現崩壞：星穹鐵道。」 |
| 「模型面板密度調整、兩欄、上下文檔位報價」 | 「模型設定改版了，每個上下文容量都標出大約的積分。」 |
