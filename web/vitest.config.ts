import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // 測試用 vi.mock 取代舞台套件，但 import 路徑仍要解析得到；指到產物位置（不存在也沒關係，mock 會先攔）
      "moonstage/stage.css": fileURLToPath(new URL("../stage/dist-stage/moonstage-stage.css", import.meta.url)),
      "moonstage/stage": fileURLToPath(new URL("../stage/dist-stage/moonstage-stage.js", import.meta.url)),
    },
  },
  test: { environment: "happy-dom", include: ["test/**/*.test.ts"] },
});
