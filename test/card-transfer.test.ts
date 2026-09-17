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
      new Request(String(url), init); // Exercise the real Workers Request contract before returning fixtures.
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
    "/worldbook/detail": () => ({name:"Lore",language:"en"}),
    "/worldbook/entry/list?worldbookId=tb": () => ({entries:[]}),
    "/worldbook/entry/list": () => ({ list: [{ entryId: "e1", name: " Town ", content: "A port", keywords: ["port", " "], isEnabled: true, category: "custom", triggerRegion: "both" }] }),
    "/role/author-asset?roleId=source": () => ({ rules: [{ find: "a", replace: "b" }], mountTrigger: "", mountLayer: "under", pageMode: "", version: 3 }),
    "/role/author-asset?roleId=target": () => json({ error: "not_found" }, 404),
    "/worldbook/tb/document": (init) => {
      const { entries } = JSON.parse(String(init?.body));
      // Harper validates explicit enums; a hash-normalized empty string is not an API default.
      if (entries.some((e: any) => !["rule", "character", "location", "item", "event", "custom"].includes(e.category)
        || !["both", "user_only", "ai_only"].includes(e.triggerRegion))) {
        return json({ error: "invalid_arguments" }, 400);
      }
      return { createdEntryIds: ["x1"] };
    },
    "/open/v1/worldbook": () => ({ worldbookId: "tb" }),
  });
  const source = await transfers.read(env, "lunatalk", "token", "source", 1);
  expect(source.card.worldbooks).toEqual([
    { sourceId: "book", name: "Lore", metadata:expect.objectContaining({name:"Lore",language:"en"}), entries: [{ name: "Town", content: "A port", keywords: ["port"], secondaryKeywords: [], isEnabled: true, isConstant: false, category: "", triggerRegion: "" }] },
  ]);
  expect(source.card.authorAsset).toEqual({ rules: [{ find: "a", replace: "b" }], mountTrigger: "", mountLayer: "under", pageMode: "" });

  const map = await transfers.update(env, "harbor", "t", "target", source.card);
  expect(map).toEqual({ book: "tb" });
  expect(body(requests.find((r) => r.url.endsWith("/open/v1/worldbook")))).toMatchObject({ name: "Lore", language: "en" });
  const doc = body(requests.find((r) => r.url.endsWith("/worldbook/tb/document")));
  expect(doc.binding).toEqual({ roleId: "target" });
  expect(doc.entries).toEqual([{ op: "create", name: "Town", content: "A port", keywords: ["port"], secondaryKeywords: [], isEnabled: true, isConstant: false, category: "custom", triggerRegion: "both", matchOptions: null }]);
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
  expect(body(document).fields).toMatchObject(extra);
  expect(body(document).fields).not.toHaveProperty('jailbreak');
  await transfers.publish(env,'harbor','target','copy');
  expect(requests.at(-1)?.url.endsWith('/role/copy/publish')).toBe(true);
  expect(body(requests.at(-1))).not.toHaveProperty('content_rating');
});

it('preserves Lorebook entries, alternate greetings and author rendering assets', async () => {
  const calls:{url:string,method:string,body:any}[]=[];
  const detail={...role,roleWelcomeAlternates:['Another opening'],rolePrologue:['Ask for help'],cardMeta:{version:1}};
  const entry={entryId:'source-entry',name:'Support hours',content:'Open weekdays',keywords:['hours'],secondaryKeywords:[],isEnabled:true,isConstant:false,category:'rule',triggerRegion:'both',matchOptions:{caseSensitive:false,matchWholeWords:true,selectiveLogic:0}};
  const asset={rules:[{id:'rule-1',name:'Title',find:'Hello',replace:'Welcome',enabled:true}],pageMode:'sandbox',mountTrigger:'{{app}}',mountLayer:'overlay',version:4};
  vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
    const u=String(url),body=init?.body?JSON.parse(String(init.body)):null;
    calls.push({url:u,method:init?.method||'GET',body});
    if(u.includes('/role/detail'))return json(detail);
    if(u.includes('/worldbook/bindings'))return json({bindings:[{worldbookId:'source-book'}]});
    if(u.includes('/worldbook/detail'))return json({worldbookId:'source-book',name:'Support',description:'Policy',language:'en',format:'tavern',tags:''});
    if(u.includes('/worldbook/entry/list'))return json({entries:u.includes('target-book')?[]:[entry]});
    if(u.includes('/role/author-asset?'))return json(u.includes('roleId=source')?asset:{version:0,rules:[],pageMode:'classic'});
    if(u.endsWith('/worldbook'))return json({worldbookId:'target-book'});
    return json({});
  }));
  const source=await transfers.read(env,'lunatalk','source-token','source',1);
  const progress:any={books:{}};
  const checkpoints:any[]=[];
  await transfers.update(env,'harbor','target-token','target',source.card,async()=>{},progress,async()=>{checkpoints.push(structuredClone(progress))});
  expect(calls.find(c=>c.url.endsWith('/role/target/welcome'))?.body).toMatchObject({roleWelcome:'Hello',alternates:['Another opening'],prologue:['Ask for help']});
  expect(calls.find(c=>c.method==='PUT'&&c.url.endsWith('/role/target/author-asset'))?.body).toMatchObject({...asset,version:0});
  const doc=calls.find(c=>c.url.endsWith('/worldbook/target-book/document'))?.body;
  expect(doc.binding).toEqual({roleId:'target'});
  const {entryId: sourceEntryId,...content}=entry;
  expect(doc.entries[0]).toMatchObject({...content,op:'create'});
  expect(doc.entries[0]).not.toHaveProperty('entryId');
  expect(progress.books['source-book'].id).toBe('target-book');
  expect(checkpoints[0].books['source-book'].status).toBe('creating');
  expect(checkpoints[1].books['source-book'].id).toBe('target-book');
  expect(JSON.stringify(calls)).not.toContain('contentRatingIntent');
});
it('preserves translated instructions in an author-owned Harper copy',async()=>{
 const writes:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  if(String(url).includes('/role/detail'))return json({...role,roleNameJa:'案内',roleDescJa:'紹介',roleDetailDescJa:'非公開の設定',roleWelcomeJa:'こんにちは'});
  if(String(url).includes('/bindings'))return json({bindings:[]});
  if(String(url).includes('/author-asset'))return json({rules:[]});
  if(init?.body)writes.push({url:String(url),body:JSON.parse(String(init.body))});
  return new Response(null,{status:204});
 }));
 const source=await transfers.read(env,'lunatalk','source-token','source',1);
 await transfers.update(env,'harbor','target-token','target',source.card);
 expect(writes).toContainEqual({url:expect.stringContaining('/roles/target/locales'),body:{locale:'ja',name:'案内',summary:'紹介',description:'非公開の設定',greeting:'こんにちは',source:'human',source_locale:'en'}});
});

it('reports the provider, failed step and safe upstream code for rejected document writes', async()=>{
 fakeUpstream({'/role/target/document':()=>json({error:'invalid_arguments',message:'sensitive upstream text'},400)});
 await expect(transfers.update(env,'harbor','fixture','target',{name:'A',summary:'S',description:'D',greeting:'G',language:'en'})).rejects.toMatchObject({
  message:'sync_upstream_rejected',detail:{provider:'harbor',step:'document',upstreamStatus:400,upstreamCode:'invalid_arguments'}
 });
});
it('preserves the welcomeAlternates field returned by the current shared API',async()=>{
 fakeUpstream({'/role/detail':()=>({...role,welcomeAlternates:['Another greeting']}),'/worldbook/bindings':()=>({bindings:[]}),'/author-asset':()=>json({},404)});
 expect((await transfers.read(env,'lunatalk','fixture','source',1)).card.welcome?.alternates).toEqual(['Another greeting']);
});
it('hashes equal metadata independently of object key order',async()=>{
 const a={name:'A',summary:'',description:'D',greeting:'G',language:'en',fields:{cardMeta:{creator:'Synthetic',version:'1'}}};
 const b={...a,fields:{cardMeta:{version:'1',creator:'Synthetic'}}};
 expect(await cardHash(a)).toBe(await cardHash(b));
});
it('turns malformed successful upstream responses into a safe step-specific error',async()=>{
 fakeUpstream({'/role/detail':()=>new Response('<html>upstream page</html>')});
 await expect(transfers.read(env,'lunatalk','fixture','source',1)).rejects.toMatchObject({message:'sync_invalid_response',detail:{provider:'lunatalk',step:'read',upstreamStatus:200}});
});
it('rejects redirects instead of forwarding a card token to another location',async()=>{
 const requests=fakeUpstream({'/role/detail':()=>new Response(null,{status:302,headers:{Location:'https://example.com/other'}})});
 await expect(transfers.read(env,'lunatalk','synthetic-token','source',1)).rejects.toMatchObject({message:'sync_upstream_rejected',detail:{provider:'lunatalk',step:'read',upstreamStatus:302}});
 expect(requests).toHaveLength(1);
 expect(requests[0].init?.redirect).toBe('manual');
});
it('preserves names from the structured tags returned by the source API',async()=>{
 fakeUpstream({'/role/detail':()=>({...role,roleTag:[{tagName:'example'},{text:'support',type:'custom'},'plain']}),'/worldbook/bindings':()=>({bindings:[]}),'/author-asset':()=>json({},404)});
 expect((await transfers.read(env,'lunatalk','fixture','source',1)).card.fields?.roleTag).toEqual(['example','support','plain']);
});
it.each([['lunatalk','assets.lunatalk.ai'],['harbor','assets.harperharbor.com']] as const)('accepts the current %s SaaS asset host without copying bytes',async(provider,host)=>{
 fakeUpstream({'/role/detail':()=>({...role,roleAvatar:`https://${host}/synthetic.png`}),'/worldbook/bindings':()=>({bindings:[]}),'/author-asset':()=>json({},404)});
 expect((await transfers.read(env,provider,'fixture','source',1)).card.media?.avatar).toBe(`https://${host}/synthetic.png`);
});
