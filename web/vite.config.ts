import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // 舞台：stage/ 子模組（Moonstage 的 fork）用 npm run build:stage 打出來的套件。
      // 直接指到產物而不是裝成 npm 依賴：它自己有六百多個依賴，沒必要灌進本站的 lock。
      "moonstage/stage.css": fileURLToPath(new URL("../stage/dist-stage/moonstage-stage.css", import.meta.url)),
      "moonstage/stage": fileURLToPath(new URL("../stage/dist-stage/moonstage-stage.js", import.meta.url)),
    },
    // 套件把 vue／vue-i18n／pinia 留給宿主：一定要解析到本站那一份，否則兩個 Vue 實例互不相認
    dedupe: ["vue", "vue-i18n", "pinia"],
  },
  server: {
    port: 8850,
    // 本地開發時把 /v1 打到 wrangler dev；正式環境同一個 Worker 服務兩者，不需要代理。
    proxy: { "/v1": "http://127.0.0.1:8787" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
