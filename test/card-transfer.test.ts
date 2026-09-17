import { env } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { transfers } from "../src/card-transfer";
import { cardHash } from "../src/card-sync";
const role = {
  roleId: "source",
  accountNumId: 1,
  roleName: "Example",
  roleDesc: "Summary",
  roleDetailDesc: "Character",
  roleWelcome: "Hello",
  language: "en",
  roleVisibility: "private",
};
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "content-type": "application/json" },
  });
type Req = { url: string; init?: RequestInit };
const body = (r: Req | undefined) => JSON.parse(String(r?.init?.body));
/** 假上游：沒特別指定的路徑回 `fallback`；記下每個請求給斷言用。 */
function fakeUpstream(routes: Record<string, (init?: RequestInit) => unknown>, fallback: unknown = {}) {
  const requests: Req[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      const key = Object.keys(routes).find((k) => String(url).includes(k));
      const v = key ? routes[key](init) : fallback;
      return v instanceof Response ? v : json(v);
    })
  );
  return requests;
}
afterEach(() => vi.unstubAllGlobals());

it("keeps SaaS image URLs: registers a reference on Harbor and writes the original URL into the document", async () => {
  const original = "https://objects.lunatalk.ai/avatar.png";
  const requests = fakeUpstream({
    "/role/detail": () => ({ ...role, roleAvatar: original }),
    "/worldbook/bindings": () => ({ bindings: [] }),
    "/author-asset": () => json({ error: "not_found" }, 404),
    "/media/references": () => ({ assetId: "reference", url: original }),
  });
  const source = await transfers.read(env, "lunatalk", "luna-token", "source", 1);
  await transfers.update(env, "harbor", "harbor-token", "target", source.card);
  expect(requests.some((r) => r.init?.method === "PUT" || r.url.includes("/uploads") || r.url === original)).toBe(false);
  expect(body(requests.find((r) => r.url.endsWith("/media/references")))).toEqual({ url: original });
  const document = requests.find((r) => r.url.endsWith("/role/target/document"));
  expect(body(document).fields.roleAvatar).toBe(original);
  // 兩家走同一組契約路由：沒有 Harbor 專用的 /roles/… 路徑
  expect(requests.some((r) => r.url.includes("/open/v1/roles"))).toBe(false);
});

it("copies bound worldbooks and the author asset, then binds the new book to the copy", async () => {
  // 路徑照插入順序比對：泛的 /open/v1/worldbook（建書）放最後，才不會搶走 bindings／entry/list
  const requests = fakeUpstream({
    "/role/detail": () => role,
    "/worldbook/bindings": () => ({ bindings: [{ worldbookId: "book", name: "Lore", entryCount: 1 }] }),
    "/worldbook/entry/list": () => ({ list: [{ entryId: "e1", name: " Town ", content: "A port", keywords: ["port", " "], isEnabled: true, category: "custom", triggerRegion: "both" }] }),
    "/role/author-asset?roleId=source": () => ({ rules: [{ find: "a", replace: "b" }], mountTrigger: "", mountLayer: "under", pageMode: "", version: 3 }),
    "/role/author-asset?roleId=target": () => json({ error: "not_found" }, 404),
    "/worldbook/tb/document": () => ({ createdEntryIds: ["x1"] }),
    "/open/v1/worldbook": () => ({ worldbookId: "tb" }),
  });
  const source = await transfers.read(env, "lunatalk", "token", "source", 1);
  expect(source.card.worldbooks).toEqual([
    { sourceId: "book", name: "Lore", entries: [{ name: "Town", content: "A port", keywords: ["port"], secondaryKeywords: [], isEnabled: true, isConstant: false, category: "", triggerRegion: "" }] },
  ]);
  expect(source.card.authorAsset).toEqual({ rules: [{ find: "a", replace: "b" }], mountTrigger: "", mountLayer: "under", pageMode: "" });

  const map = await transfers.update(env, "harbor", "t", "target", source.card);
  expect(map).toEqual({ book: "tb" });
  expect(body(requests.find((r) => r.url.endsWith("/open/v1/worldbook")))).toMatchObject({ name: "Lore", language: "en" });
  const doc = body(requests.find((r) => r.url.endsWith("/worldbook/tb/document")));
  expect(doc.binding).toEqual({ roleId: "target" });
  expect(doc.entries).toEqual([{ op: "create", name: "Town", content: "A port", keywords: ["port"], secondaryKeywords: [], isEnabled: true, isConstant: false, category: "", triggerRegion: "" }]);
  expect(body(requests.find((r) => r.url.endsWith("/worldbook/tb/entries/reorder")))).toEqual({ entryIds: ["x1"] });
  const asset = requests.find((r) => r.url.endsWith("/role/target/author-asset"));
  expect(asset?.init?.method).toBe("PUT");
  expect(body(asset)).toEqual({ rules: [{ find: "a", replace: "b" }], mountTrigger: "", mountLayer: "under", pageMode: "", version: 0 });
});

it("re-sync overwrites the mapped target book instead of creating another", async () => {
  const requests = fakeUpstream({
    "/worldbook/entry/list?worldbookId=tb": () => ({ list: [{ entryId: "old1" }, { entryId: "old2" }] }),
    "/worldbook/tb/document": () => ({ createdEntryIds: ["n1"] }),
    "/author-asset": () => json({ error: "not_found" }, 404),
  });
  const card = {
    name: "A", summary: "S", description: "D", greeting: "G", language: "en",
    worldbooks: [{ sourceId: "book", name: "Lore", entries: [{ name: "Town", content: "A port", keywords: [], secondaryKeywords: [], isEnabled: true, isConstant: false, category: "", triggerRegion: "" }] }],
    authorAsset: null,
  };
  const map = await transfers.update(env, "harbor", "t", "target", card, undefined, { book: "tb" });
  expect(map).toEqual({ book: "tb" });
  expect(requests.some((r) => r.url.endsWith("/open/v1/worldbook"))).toBe(false);
  const doc = body(requests.find((r) => r.url.endsWith("/worldbook/tb/document")));
  expect(doc.entries.map((e: any) => e.op)).toEqual(["delete", "delete", "create"]);
  expect(doc.entries.slice(0, 2).map((e: any) => e.entryId)).toEqual(["old1", "old2"]);
});

it("welcome alternates and prologue go through the welcome route", async () => {
  const requests = fakeUpstream({
    "/role/detail": () => ({ ...role, roleWelcomeAlternates: JSON.stringify(["Hi", " "]), rolePrologue: ["Once"] }),
    "/worldbook/bindings": () => ({ bindings: [] }),
    "/author-asset": () => json({ error: "not_found" }, 404),
  });
  const source = await transfers.read(env, "harbor", "token", "source", 1);
  expect(source.card.welcome).toEqual({ alternates: ["Hi"], prologue: ["Once"] });
  await transfers.update(env, "lunatalk", "t", "copy", source.card);
  const welcome = requests.find((r) => r.url.endsWith("/role/copy/welcome"));
  expect(welcome?.init?.method).toBe("PATCH");
  expect(body(welcome)).toEqual({ roleWelcome: "Hello", alternates: ["Hi"], prologue: ["Once"] });
});

it("never downloads an arbitrary image URL or follows a storage redirect", async () => {
  const fetch = vi.fn(async () =>
    json({ ...role, roleAvatar: "http://127.0.0.1/private" })
  );
  vi.stubGlobal("fetch", fetch);
  await expect(
    transfers.read(env, "harbor", "token", "source", 1)
  ).rejects.toThrow();
  expect(fetch.mock.calls.every(([url]:any[]) => String(url).startsWith("https://"))).toBe(true);
});

it("includes the original image reference and the worldbook entries in the version identity", async () => {
  const base = { name: "A", summary: "S", description: "D", greeting: "G", language: "en" };
  expect(await cardHash({ ...base, media: { avatar: "https://objects.lunatalk.ai/a.png" } } as any))
    .not.toBe(await cardHash({ ...base, media: { avatar: "https://objects.lunatalk.ai/b.png" } } as any));
  const entry = { name: "T", content: "c", keywords: [], secondaryKeywords: [], isEnabled: true, isConstant: false, category: "", triggerRegion: "" };
  const a = await cardHash({ ...base, worldbooks: [{ sourceId: "s1", name: "L", entries: [entry] }] } as any);
  // 同一本書在兩家的 id 不同，雜湊不能看 id；條目變了才算變
  expect(a).toBe(await cardHash({ ...base, worldbooks: [{ sourceId: "other", name: "L", entries: [entry] }] } as any));
  expect(a).not.toBe(await cardHash({ ...base, worldbooks: [{ sourceId: "s1", name: "L", entries: [{ ...entry, content: "changed" }] }] } as any));
});

it('preserves instructions, examples and tags through the shared document API', async () => {
  const extra = {customInstructions:'Stay in scope',talkExample:[{roleType:'ai',content:'Example'}],roleOutputContract:'JSON',userName:'Visitor',roleTag:['help']};
  let target:any = {...role,...extra};
  const requests = fakeUpstream({
    '/role/detail': () => target,
    '/worldbook/bindings': () => ({bindings:[]}),
    '/author-asset': () => json({error:'not_found'},404),
    '/document': (init) => { target={...target,...JSON.parse(String(init?.body)).fields}; return {}; },
  });
  const read=await transfers.read(env,'lunatalk','token','source',1);
  await transfers.update(env,'harbor','target','copy',read.card);
  const document=requests.find(r=>r.url.endsWith('/document'));
  const {customInstructions,...rest}=extra;
  // 寫入時用契約兩家都認的 jailbreak，不用只有一家認的 customInstructions
  expect(body(document).fields).toMatchObject({...rest,jailbreak:customInstructions});
  await transfers.publish(env,'harbor','target','copy');
  expect(requests.at(-1)?.url.endsWith('/role/copy/publish')).toBe(true);
  expect(body(requests.at(-1))).not.toHaveProperty('content_rating');
});
