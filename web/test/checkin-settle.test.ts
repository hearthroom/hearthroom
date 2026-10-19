// 領完之後（開箱舞台關掉、任務領好），頁首的餘額要跟著更新，不能等重新整理
//（接本機 Harbor 實測：簽到拿了 150，頁首還是 5）。領的當下不讀，餘額才不會比滾輪先揭曉。
import { beforeEach, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const refreshWallet = vi.fn(async () => {});
vi.mock("../src/lib/session", () => ({ useSession: () => ({ accessToken: async () => "tok", refreshWallet }) }));
import { useCheckin } from "../src/lib/checkin-store";

beforeEach(() => {
  setActivePinia(createPinia()); refreshWallet.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 500 })));
});

it("settle reloads the header balance with the panel", async () => {
  await useCheckin().settle();
  expect(refreshWallet).toHaveBeenCalledTimes(1);
});

it("a plain panel load leaves the balance alone", async () => {
  await useCheckin().load();
  expect(refreshWallet).not.toHaveBeenCalled();
});
