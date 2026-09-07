import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

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
      // 測試用 vi.mock 取代舞台套件，但 import 路徑仍要解析得到；指到產物位置（不存在也沒關係，mock 會先攔）
      "moonstage/stage.css": fileURLToPath(new URL("../stage/dist-stage/moonstage-stage.css", import.meta.url)),
      "moonstage/stage": fileURLToPath(new URL("../stage/dist-stage/moonstage-stage.js", import.meta.url)),
    },
  },
  test: { environment: "happy-dom", include: ["test/**/*.test.ts"] },
});
