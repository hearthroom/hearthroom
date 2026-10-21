import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("./migrations");

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          SHORTCUT_SECRET: "test-shortcut-secret",
          SHARE_VISITOR_SECRET: "test-share-visitor-secret",
          // 本機 .dev.vars 可能放了接真 Harbor 用的應用憑證與託管金鑰；測試一律當沒設，要的測試自己帶
          HARBOR_REWARDS_CLIENT_ID: "",
          HARBOR_REWARDS_CLIENT_SECRET: "",
          HOSTING_SERVICE_KEY: "",
          // 第二家供應商只在測試裡設定：wrangler.toml 是正式部署的設定檔，
          // 在那裡加上位址就等於直接對線上開放這一家。
          PROVIDER_API_BASE_HARBOR: "https://api.harperharbor.com",
          // 測試預設不審核（大多數測試走登記即上榜）；審核測試自己打開。
          REVIEW_ENABLED: "false",
          // 正式發布可開啟 GA；測試明確預設停用，需要時由個案開啟。
          GA4_ENABLED: "false",
        },
      },
    }),
  ],
  test: {
    // 只跑 Worker 自己的測試。前端在 web/ 有自己的 vitest（環境與別名都不同），
    // 不限定範圍的話這裡會把它掃進來，然後在 workerd 裡解不開 @/ 別名而爆掉。
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
