import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      // 卡片頁直接吃舞台的規則引擎原始檔（stage/src/pages/canvas/*）；它們內部用 @ 指舞台自己的 src。
      // 這兩個確切的模組名要排在 "@" 前面（物件形式的 alias 逐一比對，先命中先贏），其餘 @ 仍是本站的 src。
      "@/utils/display-rule-engine.js": fileURLToPath(new URL("../stage/src/utils/display-rule-engine.js", import.meta.url)),
      "@/common/card-format": fileURLToPath(new URL("../stage/src/common/card-format.ts", import.meta.url)),
      // 三個規則引擎模組用別名進來、型別在 env.d.ts 自己宣告：舞台的 tsconfig 沒開嚴格模式，
      // 讓 vue-tsc 直接讀它的原始檔會報一堆不是本站的錯。
      "stage-canvas/rule-engine": fileURLToPath(new URL("../stage/src/pages/canvas/canvas-rule-engine.ts", import.meta.url)),
      "stage-canvas/style-scope": fileURLToPath(new URL("../stage/src/pages/canvas/canvas-style-scope.ts", import.meta.url)),
      "stage-canvas/platform-defaults": fileURLToPath(new URL("../stage/src/pages/canvas/canvas-platform-defaults.ts", import.meta.url)),
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
