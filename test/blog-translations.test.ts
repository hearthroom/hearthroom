import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, expect, it } from "vitest";
import worker from "../src/index";
import { saveColumn, savePost, setPostState, publicPosts, publicPost, restoreRevision, listRevisions } from "../src/blog";
import { makeReviewer, resetDb } from "./helpers";
let memberId: string, columnId: string;
const actor = () => ({ memberId, kind: "human" as const });
const op = () => crypto.randomUUID();
const NOW = Date.now();
const create = (slug: string, locale = "zh-Hant", translationOfPostId?: string) => savePost(env.DB, { columnId, slug, locale, title: slug, excerpt: "", bodyMd: `body-${slug}`, translationOfPostId } as Parameters<typeof savePost>[1], actor(), op(), NOW);
const publish = (id: string, at = NOW - 1000) => setPostState(env.DB, id, { status: "published", publishAt: at }, actor(), op(), NOW);
async function call(path: string) { const ctx = createExecutionContext(); const r = await worker.fetch(new Request(`https://c.test${path}`), env, ctx); await waitOnExecutionContext(ctx); return r; }
beforeEach(async () => { await resetDb(); memberId = await makeReviewer(51001); const group = await saveColumn(env.DB, { slug:"official",name:{"zh-Hant":"官方"},description:{},enabled:true,sort:0 },actor(),op(),NOW);columnId=(await saveColumn(env.DB,{slug:"news",parentId:group.id,name:{"zh-Hant":"消息"},description:{},enabled:true,sort:0},actor(),op(),NOW)).id; });
it("explicitly groups arbitrary slugs, deduplicates before limits and preserves independent content", async () => {
 const source = await create("original"); const en = await create("manual-title", "en", source.id); const hans = await create("different-slug", "zh-Hans", source.id);
 await publish(source.id);await publish(en.id);await publish(hans.id);
 const zh = await publicPosts(env.DB,{locale:"zh-Hant",page:1,now:NOW});expect(zh.items.map(p=>p.slug)).toEqual(["original"]);
 expect((await publicPosts(env.DB,{locale:"en",page:1,now:NOW})).items.map(p=>p.slug)).toEqual(["manual-title"]);
 expect((await publicPosts(env.DB,{locale:"ja",page:1,now:NOW})).items).toEqual([]);
 expect((await publicPost(env.DB,"news","manual-title",NOW))?.bodyMd).toBe("body-manual-title");
 const r = await call("/v1/blog/posts/news/original?locale=en&preferredLocale=en"); const data = await r.json() as any;
 expect(data.post.id).toBe(en.id);expect(data.translations.map((p:any)=>p.locale).sort()).toEqual(["en","zh-Hans","zh-Hant"]);
});
it("enforces one version per locale including drafts and replays a creation once", async () => {
 const source=await create("source");const key=op();const input={columnId,slug:"english",locale:"en",title:"English",excerpt:"",bodyMd:"Draft",translationOfPostId:source.id} as Parameters<typeof savePost>[1];
 const en=await savePost(env.DB,input,actor(),key,NOW);expect((await savePost(env.DB,input,actor(),key,NOW)).id).toBe(en.id);
 await expect(create("second","en",source.id)).rejects.toMatchObject({status:409,message:"blog_translation_locale_taken"});
});
it("resolves withdrawn long and short URLs to public versions without exposing unpublished content", async () => {
 const source=await create("source");const en=await create("english","en",source.id);await publish(source.id);await publish(en.id);await setPostState(env.DB,source.id,{status:"unpublished"},actor(),op(),NOW);
 const r=await call("/v1/blog/posts/news/source?locale=zh-Hant");expect(r.status).toBe(200);const body=await r.json()as any;expect(body.post.id).toBe(en.id);expect(JSON.stringify(body)).not.toContain("body-source");
 const short=await call(`/v1/blog/p/${source.id}`);expect(short.status).toBe(200);expect(await short.json()).toMatchObject({column:"news",slug:"english"});
 const draft=await create("secret","ko",en.id);expect((await call("/v1/blog/posts/news/secret?locale=en")).status).toBe(404);
 expect((await call(`/v1/blog/p/${draft.id}`)).status).toBe(404);
});
it("database guards synchronize old singleton locale writes and reject a mixed-language source rewrite", async () => {
 const source=await create("source");await env.DB.prepare("UPDATE blog_posts SET locale='en' WHERE id=?").bind(source.id).run();
 const row=await env.DB.prepare("SELECT g.source_locale FROM blog_translation_groups g JOIN blog_posts p ON p.translation_group_id=g.id WHERE p.id=?").bind(source.id).first<{source_locale:string}>();expect(row?.source_locale).toBe("en");
 await create("hant","zh-Hant",source.id);
 await expect(env.DB.prepare("UPDATE blog_posts SET locale='ko' WHERE id=?").bind(source.id).run()).rejects.toThrow();
});
it("locks a scheduled post URL after its public time even before any read or state mutation", async () => {
 const source=await create("scheduled");await publish(source.id,Date.now()+500);
 expect((await env.DB.prepare("SELECT was_public FROM blog_posts WHERE id=?").bind(source.id).first<{was_public:number}>())?.was_public).toBe(0);
 await new Promise(resolve=>setTimeout(resolve,550));
 await expect(env.DB.prepare("UPDATE blog_posts SET slug='changed' WHERE id=?").bind(source.id).run()).rejects.toThrow();
});
it("attaches and detaches with atomic group/post CAS, preserving independent content and replay", async () => {
 const { changeTranslation, adminPost }=await import("../src/blog");
 const source=await create("source");const en=await create("english","en");
 const input={expectedVersion:en.version,expectedGroupVersion:en.groupVersion,targetPostId:source.id,expectedTargetGroupVersion:source.groupVersion};const key=op();
 const linked=await changeTranslation(env.DB,en.id,input,actor(),key,NOW);
 expect(linked.translationGroupId).toBe(source.translationGroupId);expect(linked.bodyMd).toBe(en.bodyMd);
 expect((await changeTranslation(env.DB,en.id,input,actor(),key,NOW)).version).toBe(linked.version);
 const fresh=await adminPost(env.DB,en.id);
 await expect(changeTranslation(env.DB,en.id,{...input,expectedVersion:linked.version,expectedGroupVersion:fresh.groupVersion-1,targetPostId:null},actor(),op(),NOW)).rejects.toMatchObject({status:409});
 const detached=await changeTranslation(env.DB,en.id,{expectedVersion:linked.version,expectedGroupVersion:fresh.groupVersion,targetPostId:null},actor(),op(),NOW);
 expect(detached.translationGroupId).not.toBe(source.translationGroupId);expect([detached.slug,detached.bodyMd]).toEqual([en.slug,en.bodyMd]);
});
it("does not move a source with translations or leave partial CAS changes", async()=>{
 const {changeTranslation,adminPost}=await import("../src/blog");const source=await create("source");await create("english","en",source.id);const target=await create("target","ko");const before=await adminPost(env.DB,source.id);
 await expect(changeTranslation(env.DB,source.id,{expectedVersion:before.version,expectedGroupVersion:before.groupVersion,targetPostId:target.id,expectedTargetGroupVersion:target.groupVersion},actor(),op(),NOW)).rejects.toMatchObject({status:409});
 expect((await adminPost(env.DB,target.id)).groupVersion).toBe(target.groupVersion);
 expect((await adminPost(env.DB,source.id)).translationGroupId).toBe(source.translationGroupId);
});
it("SSR uses the same explicit language intent and only real public alternate URLs", async()=>{
 const {postMeta}=await import("../src/blog-head");const {renderHead}=await import("../src/head");
 const source=await create("original");const en=await create("english","en",source.id);await create("private-ko","ko",source.id);await publish(source.id);await publish(en.id);
 const meta=await postMeta(env.DB,"news","original",NOW,"en","en");expect(meta?.lang).toBe("en");
 const html=await renderHead(new Response('<html><head><title>Old</title><link rel="alternate" hreflang="ko" href="/fake"></head></html>'),meta!).text();
 expect(html).toContain('href="https://sukisuki.ai/en/blog/news/english"');expect(html).not.toContain('/fake');expect(html).not.toContain('private-ko');expect((html.match(/hreflang=/g)||[])).toHaveLength(3);
 const exact=await postMeta(env.DB,"news","original",NOW,"en");expect(exact?.lang).toBe("zh-Hant");
});
it("deduplicates before pin limits and pagination, aggregates public pins and retains group chronology",async()=>{
 const sources=[];
 for(let i=0;i<17;i++){
  const p=await create(`source-${i}`);sources.push(p);const en=await create(`english-${i}`,'en',p.id);await publish(p.id,NOW-10000+i);await publish(en.id,NOW-100+i);
  if(i<5)await setPostState(env.DB,en.id,{pinned:true},actor(),op(),NOW);
 }
 const page1=await publicPosts(env.DB,{locale:'zh-Hant',page:1,now:NOW});const page2=await publicPosts(env.DB,{locale:'zh-Hant',page:2,now:NOW});
 expect(page1.pinned).toHaveLength(3);expect(page1.pinned.every(p=>p.pinned&&p.locale==='zh-Hant')).toBe(true);
 expect(page1.total).toBe(14);expect(page1.items).toHaveLength(12);expect(page2.items).toHaveLength(2);
 expect(new Set([...page1.pinned,...page1.items,...page2.items].map(p=>p.translationGroupId)).size).toBe(17);
 expect(page1.items[0]!.slug).toBe('source-16');expect(page1.items[0]!.groupPublishedAt).toBe(NOW-10000+16);
});
it("losing a language-slot race rolls back group versions, revisions, audits and success metrics",async()=>{
 const source=await create('source');const before=await import('../src/blog').then(m=>m.adminPost(env.DB,source.id));
 const results=await Promise.allSettled([create('en-a','en',source.id),create('en-b','en',source.id)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const after=await import('../src/blog').then(m=>m.adminPost(env.DB,source.id));expect(after.groupVersion).toBe(before.groupVersion+1);
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM blog_posts').first<{n:number}>())?.n).toBe(2);
 expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM blog_post_revisions').first<{n:number}>())?.n).toBe(2);
 expect((await env.DB.prepare("SELECT value FROM ops_metrics WHERE metric='blog' AND operation='translation' AND outcome='success'").first<{value:number}>())?.value).toBe(1);
});
it("admin group search returns every status slot and filters candidates without leaking to readers",async()=>{
 const {adminTranslationGroups}=await import('../src/blog');const source=await create('source');const en=await create('english','en',source.id);
 const groups=await adminTranslationGroups(env.DB,{page:1,query:'english',column:columnId,missingLocale:'ko'});expect(groups.total).toBe(1);expect(groups.items[0]?.versions.map(v=>v.id).sort()).toEqual([source.id,en.id].sort());
 expect((await adminTranslationGroups(env.DB,{page:1,missingLocale:'en'})).total).toBe(0);
 expect((await call('/v1/blog/admin/translation-groups')).status).toBe(401);
 expect((await call(`/v1/blog/posts/news/source?locale=en`)).status).toBe(404);
});
