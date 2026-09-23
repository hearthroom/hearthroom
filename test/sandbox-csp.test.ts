import { describe, expect, it } from "vitest";
import { SANDBOX_CSP } from "../src/sandbox";

const directive = (name: string) => SANDBOX_CSP.split(";").map(s => s.trim()).find(s => s.startsWith(name + " ")) ?? "";

// 作者的正則規則在殼裡改到背景執行緒跑（寫得慢的規則不再卡住整頁）。舞台把執行緒程式內嵌成 blob 啟動，
// 殼只供應三個固定檔案，沒有同源的執行緒檔可用，所以要放行 blob:。
// blob 執行緒沿用殼頁的 CSP：連線仍只到自己，不因此多出對外能力。
describe("sandbox shell CSP", () => {
  it("lets the shell start its inline author-rule worker", () => {
    expect(directive("worker-src").split(/\s+/)).toEqual(expect.arrayContaining(["'self'", "blob:"]));
  });
  it("keeps the shell from connecting anywhere but itself", () => {
    expect(directive("connect-src")).toBe("connect-src 'self'");
  });
});
