/**
 * 登入頁：兩家各一顆按鈕，選了才決定這個會話用哪一家。
 *
 * 最容易被誤解的是「換一家」：它不是換個登入方式，是換一個帳號——換過去之後，
 * 我的卡片、榜單、錢包都是那一家的。所以已經登入的人要換，必須先講清楚再做。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentProvider, PROVIDERS, setProvider } from "@/lib/provider";
import { chooseProvider, needsSwitchConfirm } from "@/lib/provider-switch";

beforeEach(() => {
  localStorage.clear();
  setProvider("lunatalk");
});
afterEach(() => vi.unstubAllGlobals());

describe("登入頁列出的供應商", () => {
  it("兩家都在，順序固定：預設那家在前", () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(["lunatalk", "harbor"]);
  });
});

describe("選一家", () => {
  it("沒登入的時候直接選，不必確認", () => {
    expect(needsSwitchConfirm("harbor", { signedIn: false })).toBe(false);
    expect(needsSwitchConfirm("harbor", { signedIn: true })).toBe(true);
  });

  it("已登入但點的是目前這家：不算換，不必確認，也不會把人登出", () => {
    expect(needsSwitchConfirm("lunatalk", { signedIn: true })).toBe(false);
  });

  it("選了就換過去，並且開始那一家的登入", async () => {
    const login = vi.fn(async () => {});
    await chooseProvider("harbor", { login });
    expect(currentProvider()).toBe("harbor");
    expect(login).toHaveBeenCalledOnce();
  });

  it("換家會先登出目前的帳號，順序不能反：反了的話登出會把新的憑證也清掉", async () => {
    const order: string[] = [];
    await chooseProvider("harbor", {
      login: async () => { order.push("login"); },
      logout: async () => { order.push("logout"); },
      signedIn: true,
    });
    expect(order).toEqual(["logout", "login"]);
  });

  it("選同一家時不登出：只是重新登入一次", async () => {
    const logout = vi.fn(async () => {});
    await chooseProvider("lunatalk", { login: async () => {}, logout, signedIn: true });
    expect(logout).not.toHaveBeenCalled();
  });
});
