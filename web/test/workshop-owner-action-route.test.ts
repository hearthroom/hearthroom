/** 原作者隱藏／取消隱藏與作者開關都走本站（伺服器先寫好公開列表才回成功），不直接打 Provider。 */
import { afterEach, expect, it, vi } from "vitest";
import { COMMUNITY_API } from "../src/lib/config";
import { ownerAction, savePolicy } from "../src/lib/workshop";

afterEach(() => { vi.unstubAllGlobals(); });
function capture(body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}

it("ownerAction posts hide/restore to the site's workshop owner-action route with only the action", async () => {
  const calls = capture({ ownerState: "hidden", generation: 3 });
  await expect(ownerAction("w 1", "hide", "tok")).resolves.toMatchObject({ ownerState: "hidden" });
  expect(calls[0].url).toBe(`${COMMUNITY_API}/workshops/w%201/owner-action`);
  expect(calls[0].init.method).toBe("POST");
  expect(JSON.parse(String(calls[0].init.body))).toEqual({ action: "hide" });
  expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
});

it("savePolicy posts to the site's card workshop policy route by card number", async () => {
  const calls = capture({ allowNew: true, revision: 2, items: [] });
  await savePolicy("100001", true, 1, "tok");
  expect(calls[0].url).toBe(`${COMMUNITY_API}/cards/100001/workshop/policy`);
  expect(JSON.parse(String(calls[0].init.body))).toEqual({ allowNew: true, expectedRevision: 1 });
});
