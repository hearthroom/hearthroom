import { describe, expect, it } from "vitest";
import { SANDBOX_CSP } from "../src/sandbox";

const directive = (name: string) => SANDBOX_CSP.split(";").map(s => s.trim()).find(s => s.startsWith(name + " ")) ?? "";

// 作者的正則規則在殼裡改到背景執行緒跑（寫得慢的規則不再卡住整頁）。舞台把執行緒程式內嵌成 blob 啟動，
// 殼只供應三個固定檔案，沒有同源的執行緒檔可用，所以要放行 blob:。
// blob 執行緒沿用殼頁的 CSP：連線只到自己與媒體素材庫，不因此多出對外能力。
// 卡片把自己的 JSON、WASM、JS 放在媒體素材庫：connect-src 只多放行那一個來源（不是 https:）。
// 這份標頭跟 stage 的 src/sandbox/index.html meta 必須逐字同一份（frame-ancestors 只在標頭裡）。
describe("sandbox shell CSP", () => {
  it("lets the shell start its inline author-rule worker", () => {
    expect(directive("worker-src").split(/\s+/)).toEqual(expect.arrayContaining(["'self'", "blob:"]));
  });
  it("lets cards fetch from the media library and nowhere else", () => {
    expect(directive("connect-src")).toBe("connect-src 'self' https://assets.harperharbor.com");
  });
  it("matches the stage shell meta policy, plus frame-ancestors", () => {
    expect(SANDBOX_CSP.replace(/; frame-ancestors [^;]*$/, "")).toBe(
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https://assets.harperharbor.com; worker-src 'self' blob:; frame-src 'self' about: blob:; form-action 'none'; base-uri 'none'; object-src 'none'",
    );
  });
});
