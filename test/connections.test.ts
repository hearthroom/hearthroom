import { SELF, env } from "cloudflare:test";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { resetDb, identities, restoreUpstream, bearer, myRolesOnUpstream } from "./helpers";
import { upstream } from "../src/upstream";

beforeEach(async () => {
  await resetDb();
  identities({ owner: 11, other: 22 });
  myRolesOnUpstream({new:[],other:[],owner:[]});
  vi.spyOn(upstream, "fetchMe").mockImplementation(async (_e, t, p) => {
    if (t === "owner" && p === "lunatalk") return { accountNumId: 11 };
    if (t === "new" && p === "harbor") return { accountNumId: 22 };
    if (t === "other" && p === "harbor") return { accountNumId: 33 };
    throw new Error("invalid token");
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  restoreUpstream();
});
const profile = async (token = "owner", provider = "lunatalk") =>
  (await (
    await SELF.fetch("https://c.test/v1/me", {
      headers: { ...bearer(token), "X-Provider": provider },
    })
  ).json()) as any;
const linkWithoutChoice = (token = "new") =>
  SELF.fetch("https://c.test/v1/me/connections", {
    method: "POST",
    headers: { ...bearer("owner"), "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "harbor", token }),
  });
const link = async (token = 'new') => {
  const current = await profile();
  const preview = await SELF.fetch('https://c.test/v1/me/connections/preview', {method:'POST',headers:{...bearer('owner'),'Content-Type':'application/json'},body:JSON.stringify({provider:'harbor',token})});
  const p = await preview.json() as any;
  return SELF.fetch('https://c.test/v1/me/connections',{method:'POST',headers:{...bearer('owner'),'Content-Type':'application/json'},body:JSON.stringify({provider:'harbor',token,keepHandle:current.handle,sourceHandle:current.handle,targetHandle:p.target?.handle ?? null})});
};
it("links two verified accounts to one stable member, including an existing identity", async () => {
  const a = await profile();
  await profile("new", "harbor");
  expect((await link()).status).toBe(200);
  const b = await profile("new", "harbor");
  expect(b.handle).toBe(a.handle);
  expect(b.identities).toHaveLength(2);
  expect((await link()).status).toBe(200);
});
it("rejects a second account from the same provider without replacing the first", async () => {
  await profile();
  await link();
  expect((await link("other")).status).toBe(409);
  expect((await profile()).identities.map((i: any) => i.externalId)).toEqual([
    11, 22,
  ]);
});
it("requires proof of both accounts and does not accept a caller-supplied account ID", async () => {
  await profile();
  const r = await SELF.fetch("https://c.test/v1/me/connections", {
    method: "POST",
    headers: { ...bearer("owner"), "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "harbor", externalId: 22 }),
  });
  expect(r.status).toBe(400);
  expect((await profile()).identities).toHaveLength(1);
});
it("never disconnects either service", async () => {
 await profile();await link();
 for(const provider of ['lunatalk','harbor']) {
  const r=await SELF.fetch(`https://c.test/v1/me/connections/${provider}`,{method:'DELETE',headers:bearer('owner')});
  expect(r.status).toBe(409);
 }
 expect((await profile()).identities).toHaveLength(2);
});
it("enforces one identity per provider at the database boundary", async () => {
  await profile();
  const row = await env.DB.prepare("SELECT id FROM members").first<any>();
  await expect(
    env.DB.prepare(
      "INSERT INTO member_identities(provider,external_id,member_id,linked_at) VALUES ('lunatalk','999',?,0)"
    )
      .bind(row.id)
      .run()
  ).rejects.toThrow();
});
it("keeps the founding account attached when signed in through another provider", async () => {
  await profile();
  await link();
  const r = await SELF.fetch("https://c.test/v1/me/connections/lunatalk", {
    method: "DELETE",
    headers: { ...bearer("new"), "X-Provider": "harbor" },
  });
  expect(r.status).toBe(409);
  expect((await profile("new", "harbor")).identities).toHaveLength(2);
});
it("retains the chosen community and removes only the empty duplicate", async () => {
 const a=await profile();const b=await profile('new','harbor');await link();
 expect((await env.DB.prepare('SELECT id FROM members').all()).results).toHaveLength(1);
 expect((await env.DB.prepare('SELECT member_id FROM member_identities').all()).results).toHaveLength(2);
 expect((await profile('new','harbor')).handle).toBe(a.handle);
 expect(await env.DB.prepare('SELECT id FROM members WHERE handle=?').bind(b.handle).first()).toBeNull();
});

it('previews both existing communities without connecting them', async () => {
  const old = await profile();
  const accidental = await profile('new', 'harbor');
  const r = await SELF.fetch('https://c.test/v1/me/connections/preview', {
    method: 'POST', headers: { ...bearer('new'), 'X-Provider': 'harbor', 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'lunatalk', token: 'owner' }),
  });
  expect(r.status).toBe(200);
  const body = await r.json() as any;
  expect(body.source.handle).toBe(accidental.handle);
  expect(body.target.handle).toBe(old.handle);
  expect((await profile()).identities).toHaveLength(1);
});
it('requires a primary community choice when both accounts already exist', async () => {
  await profile(); await profile('new', 'harbor');
  const r = await linkWithoutChoice();
  expect(r.status).toBe(409);
  expect((await r.json() as any).error).toBe('connection_choice_required');
  expect((await profile()).identities).toHaveLength(1);
});
it('rejects attempts to replace the current community through the obsolete keep-account choice', async () => {
  const old = await profile(); const accidental = await profile('new', 'harbor');
  const r = await SELF.fetch('https://c.test/v1/me/connections', {
    method: 'POST', headers: { ...bearer('new'), 'X-Provider': 'harbor', 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'lunatalk', token: 'owner', keepHandle: old.handle, sourceHandle: accidental.handle, targetHandle: old.handle }),
  });
  expect(r.status).toBe(400);
  expect((await profile('new', 'harbor')).handle).toBe(accidental.handle);
  expect((await profile()).identities).toHaveLength(1);
  expect((await env.DB.prepare('SELECT id FROM members').all()).results).toHaveLength(2);
});
it('rejects arbitrary retained handles and stale previews without linking',async()=>{
 const old=await profile();const other=await profile('new','harbor');
 for(const change of [{keepHandle:'attacker',sourceHandle:old.handle,targetHandle:other.handle},{keepHandle:old.handle,sourceHandle:'changed',targetHandle:other.handle}]){
  const r=await SELF.fetch('https://c.test/v1/me/connections',{method:'POST',headers:{...bearer('owner'),'Content-Type':'application/json'},body:JSON.stringify({provider:'harbor',token:'new',...change})});
  expect([400,409]).toContain(r.status);
 }
 expect((await profile()).identities).toHaveLength(1);
});
it('does not create a new target community during preview',async()=>{
 await profile();
 const r=await SELF.fetch('https://c.test/v1/me/connections/preview',{method:'POST',headers:{...bearer('owner'),'Content-Type':'application/json'},body:JSON.stringify({provider:'harbor',token:'new'})});
 expect(r.status).toBe(200);expect((await r.json() as any).target.handle).toBeUndefined();
 expect((await env.DB.prepare('SELECT id FROM members').all()).results).toHaveLength(1);
});

it('rejects an owner that was linked elsewhere after request authentication', async () => {
  const {linkIdentity} = await import('../src/connections');
  const {resolveMember} = await import('../src/members');
  await profile();
  const accidental = await profile('new', 'harbor');
  const staleOwner = await env.DB.prepare('SELECT id FROM members WHERE handle=?').bind(accidental.handle).first<{id:string}>();
  await link();
  await resolveMember(env.DB, 'lunatalk', 44, Date.now());
  await expect(linkIdentity(env.DB, {id:staleOwner!.id,provider:'harbor',externalId:22}, 'lunatalk',44,Date.now())).rejects.toThrow('connection_conflict');
  expect(await env.DB.prepare('SELECT owner_member_id FROM member_connections WHERE provider=? AND external_id=?').bind('lunatalk','44').first()).toBeNull();
  expect((await profile('new','harbor')).identities).toHaveLength(2);
});
