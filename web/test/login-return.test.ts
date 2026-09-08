import { describe, expect, it } from "vitest";
import { loginPath, safeReturnTo } from "@/lib/login-return";

describe("登入後回哪裡（網址參數，要擋開放轉址）", () => {
  it("只收站內的絕對路徑", () => {
    expect(safeReturnTo("/cards/abc?x=1")).toBe("/cards/abc?x=1");
    expect(safeReturnTo("/en/mine")).toBe("/en/mine");
  });
  it("外站、協定相對、壞值一律回首頁", () => {
    expect(safeReturnTo("https://evil.example/")).toBe("/");
    expect(safeReturnTo("//evil.example/")).toBe("/");
    expect(safeReturnTo("/\\evil.example")).toBe("/");
    expect(safeReturnTo("/a\nb")).toBe("/");
    expect(safeReturnTo(undefined)).toBe("/");
    expect(safeReturnTo(["/a"])).toBe("/");
  });
  it("登入頁路由：回首頁就不帶參數", () => {
    expect(loginPath("/")).toBe("/login");
    expect(loginPath("/play/r1")).toBe("/login?returnTo=%2Fplay%2Fr1");
    expect(loginPath("https://evil.example/")).toBe("/login");
  });
});
