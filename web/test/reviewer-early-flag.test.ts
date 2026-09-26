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
    localStorage.clear();
    session.value = reactive({ me: null, profile: null, ready: false, accessToken: async () => "tok" });
    setActivePinia(createPinia());
    let answer!: (v: { reviewer: boolean }) => void;
    api.fetchReviewMe.mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    const store = useReviewer();
    expect(store.likely).toBe(false);
    session.value.profile = { reviewer: true };
    session.value.me = { accountNumId: 1, nickName: "", avatar: "" };
    session.value.ready = true;
    await nextTick();
    expect(store.reviewer).toBeNull();
    expect(store.likely).toBe(true);
    await vi.waitFor(() => expect(api.fetchReviewMe).toHaveBeenCalled());
    answer({ reviewer: false });
    await vi.waitFor(() => expect(store.reviewer).toBe(false));
    expect(store.likely).toBe(false);
  });

  it("沒登入：不留位置", () => {
    localStorage.clear();
    session.value = reactive({ me: null, profile: { reviewer: true }, ready: true, accessToken: async () => null });
    setActivePinia(createPinia());
    expect(useReviewer().likely).toBe(false);
  });

  it("登入狀態還沒到：照這個瀏覽器上次的樣子排版；確定沒登入就忘掉", async () => {
    localStorage.clear();
    // 上一次開頁：是管理員
    session.value = reactive({ me: { accountNumId: 1, nickName: "", avatar: "" }, profile: { reviewer: true }, ready: true, accessToken: async () => "tok" });
    api.fetchReviewMe.mockResolvedValueOnce({ reviewer: true });
    setActivePinia(createPinia());
    const first = useReviewer();
    await vi.waitFor(() => expect(first.reviewer).toBe(true));
    await nextTick();
    // 這一次開頁：身分還在路上
    session.value = reactive({ me: null, profile: null, ready: false, accessToken: async () => null });
    setActivePinia(createPinia());
    const next = useReviewer();
    expect(next.likely).toBe(true);
    // 身分回來，確定沒登入（例如已登出）：不再留位置，下次也不留
    session.value.ready = true;
    await nextTick();
    expect(next.likely).toBe(false);
    setActivePinia(createPinia());
    session.value = reactive({ me: null, profile: null, ready: false, accessToken: async () => null });
    expect(useReviewer().likely).toBe(false);
  });
});
