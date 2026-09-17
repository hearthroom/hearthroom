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
afterEach(() => vi.unstubAllGlobals());
it("keeps SaaS image URLs and creates only a reference on the target", async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const original = "https://objects.lunatalk.ai/avatar.png";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      if (String(url).includes("/role/detail"))
        return json({ ...role, roleAvatar: original });
      if (String(url).includes("/worldbook/bindings"))
        return json({ bindings: [] });
      if (String(url).includes("/author-asset")) return json({ rules: [] });
      if (String(url).endsWith("/media/references"))
        return json({
          assetId: "reference",
          url: original,
          storage: "reference",
        });
      return new Response(null, { status: 204 });
    })
  );
  const source = await transfers.read(
    env,
    "lunatalk",
    "luna-token",
    "source",
    1
  );
  await transfers.update(env, "harbor", "harbor-token", "target", source.card);
  expect(
    requests.some(
      (r) =>
        r.init?.method === "PUT" ||
        r.url.includes("/uploads") ||
        r.url === original
    )
  ).toBe(false);
  const reference = requests.find((r) => r.url.endsWith("/media/references"));
  expect(JSON.parse(String(reference?.init?.body))).toEqual({ url: original });
  const assets = requests.find((r) => r.url.endsWith("/roles/target/assets"));
  expect(JSON.parse(String(assets?.init?.body)).avatar).toBe("reference");
});
it("rejects unsupported content before creating a truncated copy", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      json(
        String(url).includes("/role/detail")
          ? role
          : String(url).includes("/bindings")
          ? { bindings: [{ worldbookId: "book" }] }
          : { rules: [] }
      )
    )
  );
  await expect(
    transfers.read(env, "lunatalk", "token", "source", 1)
  ).rejects.toThrow("unsupported_content");
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
it("includes the original image reference in the version identity", async () => {
  const base = {
    name: "A",
    summary: "S",
    description: "D",
    greeting: "G",
    language: "en",
  };
  expect(
    await cardHash({
      ...base,
      media: { avatar: "https://objects.lunatalk.ai/a.png" },
    } as any)
  ).not.toBe(
    await cardHash({
      ...base,
      media: { avatar: "https://objects.lunatalk.ai/b.png" },
    } as any)
  );
});
it('preserves instructions, examples and tags through the shared document API', async () => {
  const extra = {customInstructions:'Stay in scope',talkExample:[{roleType:'ai',content:'Example'}],roleOutputContract:'JSON',userName:'Visitor',roleTag:['help']};
  let target:any = {...role,...extra};
  const requests:any[]=[];
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    requests.push({url:String(url),init});
    if(String(url).includes('/role/detail')) return json(target);
    if(String(url).includes('/bindings')) return json({bindings:[]});
    if(String(url).includes('/author-asset')) return json({rules:[]});
    if(String(url).endsWith('/document')) target={...target,...JSON.parse(String(init?.body)).fields};
    return json({});
  }));
  const read=await transfers.read(env,'lunatalk','token','source',1);
  await transfers.update(env,'harbor','target','copy',read.card);
  const document=requests.find(r=>r.url.endsWith('/document'));
  expect(JSON.parse(document.init.body).fields).toMatchObject(extra);
  await transfers.publish(env,'harbor','target','copy');
  expect(JSON.parse(requests.at(-1).init.body)).not.toHaveProperty('content_rating');
});
