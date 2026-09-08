/**
 * Vue 的 scoped 樣式會作用到子元件的根節點。App.vue 為手機隱藏頁首搜尋框的 `.search { display: none }`
 * 曾把整個搜尋頁（根節點 class 也叫 search）一起藏掉——手機上點搜尋進去是一片空白。
 * 這裡守著：App.vue 樣式裡用到的 class，不能出現在任何頁面元件的根節點 class 上。
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const at = (p: string) => new URL(p, import.meta.url).pathname;
const appStyle = readFileSync(at("../src/App.vue"), "utf8").split(/<style[^>]*>/)[1] ?? "";
const appClasses = new Set([...appStyle.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

describe("App.vue 的 scoped class 不得漏到頁面根節點", () => {
  const pages = readdirSync(at("../src/pages")).filter((f) => f.endsWith(".vue"));
  for (const file of pages) {
    it(file, () => {
      const src = readFileSync(at(`../src/pages/${file}`), "utf8");
      const root = src.match(/<template>\s*<[a-z]+[^>]*class="([^"]*)"/)?.[1] ?? "";
      const leaked = root.split(/\s+/).filter((c) => c && c !== "page" && appClasses.has(c));
      expect(leaked, `根節點 class ${JSON.stringify(root)} 撞到 App.vue 的樣式`).toEqual([]);
    });
  }
});
