# 接 HarperHarbor Provider（`harperharbor` 分支）

這個分支讓本站可以改接 HarperHarbor 的 Provider。預設仍是 LunaTalk；建置帶 `VITE_PROVIDER=harbor` 才切換。

## 相容約束（owner 2026-09-14）

這裡的改動只能是「多接一家」：不得改變目前接 LunaTalk 的行為，不得影響線上服務。落實方式：

- 所有 Harbor 行為都在 `HARBOR` 旗標之後；旗標在建置時被替換成常數，預設建置裡整段 Harbor 程式碼被裁掉
  （`web/dist` 裡找不到任何 Harbor 端點字串，適配層只在 `--mode harbor` 建置時才成為獨立分包）。
- 本站伺服器（`src/`）、`wrangler.toml`、D1 遷移都沒有動；Harbor 本機設定放在 `.dev.vars` 與 `web/.env.harbor`，不進正式部署。
- `web/test/lunatalk-default.test.ts` 釘住預設模式送出的每一種請求形狀（OAuth 不帶 scope、寫入面仍打 LunaTalk 原端點與原 body、
  充值頁、供應商名稱）。Harbor 改動漏進預設模式時它會紅。
- 共用元件只加預設值不變的選用屬性（例如 `ImageField` 的 `hideLibrary`，預設 false）。

## 本機跑起來

1. 啟動 Provider：`server/provider/./dev.sh`（API 在 8890，登入與同意頁是控制台 8090，要先 `console/` 跑 `npm run dev`）。
2. 本站伺服器：`cp .dev.vars.harbor.example .dev.vars`，`npm run migrate:local`，`npm run dev`（8787）。
   有 `HTTP(S)_PROXY` 的機器要清掉再跑，否則 Worker 打本機 Provider 會繞進代理。
   `web/dist` 不存在時 wrangler 會拒絕啟動，先 `mkdir -p web/dist`。
3. 前端：`npm run dev:web:harbor`（8850）。

## 對接方式

| 本站需要 | Provider 端點 | 備註 |
|---|---|---|
| 登入 | `/oauth/register`、`/oauth/authorize`、`/oauth/token` | 要帶 `scope=profile.read role.read role.write`，否則只有唯讀 |
| 你是誰 | `GET /open/v1/me` | 綁定契約，形狀同 LunaTalk |
| 讀卡（同步、登記） | `GET /open/v1/role/detail` | 綁定契約；匿名讀開放租戶的非私有卡 |
| 我的卡片 | `GET /open/v1/role/mine?creationMethod=hearthroom` | 綁定契約 |
| 建卡 | `POST /open/v1/roles`（`origin: hearthroom`） | 新設計 |
| 存文字 | `POST /open/v1/roles/{id}/locales` | 整行覆寫，前端先讀再併 |
| 封面、背景 | `POST /open/v1/media/uploads` → PUT → `/complete`，再 `POST /roles/{id}/assets` | 圖要過平台審核，別人才看得到 |
| 公開 | `POST /roles/{id}/visibility` + `/submit` | 作者宣告分級 |
| 錢包 | `GET /open/v1/me/wallet` | 流水只含本站自己的條目 |

轉換都在 `web/src/lib/harbor.ts`，能力開關在 `web/src/lib/provider.ts`。

## 還不能用的

Provider 目前沒有：對話與試玩、世界書、正則規則、評論、圖庫、玩家人設、送審前檢查、刪卡、
審核機器人（`/open/v1/share/role/*`）。這些入口在 Harbor 模式下收起來。沒有審核機器人時提交走「登記即上榜」。
匯入酒館卡時，Provider 不支援的欄位（例如輸出契約、對話示例）不會被存下。
