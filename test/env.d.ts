/// <reference types="@cloudflare/vitest-pool-workers/types" />
import type { D1Migration } from "@cloudflare/vitest-pool-workers";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      /**
       * 埋點的資料集。正式環境是 wrangler.toml 的綁定（要先在面板啟用 Analytics Engine），
       * 測試裡換成一個記錄呼叫的假物件——AE 的查詢介面是遠端 HTTP API，本地讀不回來，
       * 所以只測呼叫契約。可選：綁定沒配時程式碼要照常跑。
       */
      EVENTS?: AnalyticsEngineDataset;
    }
  }
}
