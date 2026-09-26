/**
 * 頁首的社群管理入口不等審核查詢：登入狀態裡已經帶了同一個旗標。
 * 管理員每次開頁，頁首原本會在畫面出來將近一秒後才折成兩行，把整頁往下推（實測版面位移 0.19）。
 */
import { describe, expect, it, vi } from "vitest";
import { nextTick, reactive } from "vue";
import { createPinia, setActivePinia } from "pinia";

const api = vi.hoisted(() => ({ fetchReviewMe: vi.fn() }));
vi.mock("../src/lib/api", () => api);
const session = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock("../src/lib/session", () => ({ useSession: () => session.value }));

import { useReviewer } from "../src/lib/review";

describe("社群管理入口", () => {
  it("審核查詢還沒回來時照登入狀態排版；回來之後以查詢為準", async () => {
    session.value = reactive({ me: null, profile: null, accessToken: async () => "tok" });
    setActivePinia(createPinia());
    let answer!: (v: { reviewer: boolean }) => void;
    api.fetchReviewMe.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    const store = useReviewer();
    expect(store.likely).toBe(false);
    session.value.profile = { reviewer: true };
    session.value.me = { accountNumId: 1, nickName: "", avatar: "" };
    await nextTick();
    expect(store.reviewer).toBeNull();
    expect(store.likely).toBe(true);
    await vi.waitFor(() => expect(api.fetchReviewMe).toHaveBeenCalled());
    answer({ reviewer: false });
    await vi.waitFor(() => expect(store.reviewer).toBe(false));
    expect(store.likely).toBe(false);
  });

  it("沒登入：不留位置", () => {
    session.value = reactive({ me: null, profile: { reviewer: true }, accessToken: async () => null });
    setActivePinia(createPinia());
    expect(useReviewer().likely).toBe(false);
  });
});
