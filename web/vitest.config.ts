import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const STAGE_SRC = fileURLToPath(new URL("../stage/src/", import.meta.url));
const WEB_SRC = fileURLToPath(new URL("./src/", import.meta.url));

export default defineConfig({
  plugins: [vue()],
  resolve: {
    // 陣列形式：順序即優先序。舞台原始碼（../stage/src）裡的 @/ 要解析回舞台自己的 src，本站的 @/ 才是本站 src；
    // 這樣舞台的面板元件（模型選單、人設、長期指令、存檔列表、彈層）能原樣在本站編譯，遊戲頁直接複用，不另寫一套。
    alias: [
      { find: "@/utils/display-rule-engine.js", replacement: fileURLToPath(new URL("../stage/src/utils/display-rule-engine.js", import.meta.url)) },
      { find: "@/common/card-format", replacement: fileURLToPath(new URL("../stage/src/common/card-format.ts", import.meta.url)) },
      { find: "stage-canvas/rule-engine", replacement: fileURLToPath(new URL("../stage/src/pages/canvas/canvas-rule-engine.ts", import.meta.url)) },
      { find: "stage-canvas/style-scope", replacement: fileURLToPath(new URL("../stage/src/pages/canvas/canvas-style-scope.ts", import.meta.url)) },
      { find: "stage-canvas/platform-defaults", replacement: fileURLToPath(new URL("../stage/src/pages/canvas/canvas-platform-defaults.ts", import.meta.url)) },
      { find: "stage-canvas/memory", replacement: fileURLToPath(new URL("../stage/src/pages/canvas/canvas-memory.ts", import.meta.url)) },
      { find: "stage-canvas/components", replacement: fileURLToPath(new URL("../stage/src/pages/canvas/components", import.meta.url)) },
      {
        find: /^@\/(.*)$/,
        replacement: "$1",
        customResolver(source, importer) {
          const base = importer && importer.includes("/stage/src/") ? STAGE_SRC : WEB_SRC;
          return this.resolve(base + source, importer, { skipSelf: true });
        },
      },
      { find: "moonstage/stage.css", replacement: fileURLToPath(new URL("../stage/dist-stage/moonstage-stage.css", import.meta.url)) },
      { find: "moonstage/stage", replacement: fileURLToPath(new URL("../stage/dist-stage/moonstage-stage.js", import.meta.url)) },
    ],
  },
  test: { environment: "happy-dom", include: ["test/**/*.test.ts"] },
});
