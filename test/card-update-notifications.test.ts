import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { approveFixtureResponse } from './hosted-fixture';
import { legacyPolicyFixture } from './work-policy-fixture';
import { bearer, identities, makeMember, ratingBody, resetDb, restoreUpstream, rolesOnMainSite } from './helpers';
import { assertUpdateCooldown, reserveUpdateNotification, sourceUpdateTimes } from '../src/card-update';
import { claim, stamp } from '../src/review';
import app from '../src/index';
import { createExecutionContext } from 'cloudflare:test';
import { sign } from '../src/community/crypto';
import { setPreferences } from '../src/community/service';
import { dispatchPush, saveSubscription } from '../src/community/push';
import type { Env } from '../src/types';

const log = '新增第二章劇情和兩條支線';
const day = 86400000;
let author: string, follower: string, collector: string, card: string;
const submit = (intent: Record<string, unknown> = {}, operationId = crypto.randomUUID()) => SELF.fetch('https://c.test/v1/cards', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...bearer('author') },
  body: JSON.stringify({ roleId: 'draft', ...ratingBody(false), operationId, ...intent }),
});
async function approve(response: Response) {
  expect(response.ok).toBe(true);
  const { versionId } = await response.json() as { versionId: string };
  const s = await env.DB.prepare('SELECT submission_id AS id FROM hosting_versions WHERE version_id=?').bind(versionId).first<{ id: string }>();
  for (const memberId of ['reviewer-a', 'reviewer-b']) {
    const current = await env.DB.prepare('SELECT status FROM review_submissions WHERE id=?').bind(s!.id).first<{ status: string }>();
    if (current?.status !== 'pending') break;
    await claim(env.DB, s!.id, memberId, Date.now());
    await stamp(env.DB, { submissionId: s!.id, memberId, verdict: 'approve', note: '', now: Date.now() }, env);
  }
  return versionId;
}
const notices = () => env.DB.prepare("SELECT * FROM community_notifications WHERE kind='followed_work'").all<{ member_id: string; extra: string }>();

beforeEach(async () => {
  await resetDb(); identities({ author: 10001, follower: 20001, collector: 20002 });
  rolesOnMainSite({ roleId: 'draft', authorNumId: 10001, name: '合成測試' });
  author = await makeMember(10001); follower = await makeMember(20001); collector = await makeMember(20002);
  const response = await approveFixtureResponse(await submit());
  expect(response.status).toBe(201); card = String((await response.json() as { id: string }).id);
  await env.DB.prepare('INSERT INTO member_follows VALUES(?,?,?)').bind(follower, author, Date.now()).run();
  for (const member of [author, follower, collector]) await env.DB.prepare('INSERT INTO member_favorites VALUES(?,?,?)').bind(member, Number(card), Date.now()).run();
});
afterEach(restoreUpstream);

it.each([undefined, '', ' \n\t ', '九'.repeat(9), 'a '.repeat(9), '字'.repeat(201), 12])('rejects major with invalid log %j before sealing', async updateNote => {
  const response = await submit({ updateKind: 'major', updateNote });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: 'update_note_invalid' });
  expect((await env.DB.prepare('SELECT count(*) n FROM hosting_versions').first<{ n: number }>())?.n).toBe(1);
});
it('defaults to silent updates and leaves old trigger changes silent', async () => {
  await approve(await submit());
  await env.DB.prepare("UPDATE cards SET names='{" + '"zh":"改名"' + "}' WHERE id=?").bind(Number(card)).run();
  expect((await notices()).results).toHaveLength(0);
});
it('requires explicit major consent for a log and rejects unknown kinds', async () => {
  expect((await submit({ updateNote: log })).status).toBe(400);
  expect((await submit({ updateKind: 'typo' })).status).toBe(400);
});
it('notifies the recipient union once only after approval and preserves its version log', async () => {
  const operation = crypto.randomUUID();
  const response = await submit({ updateKind: 'major', updateNote: ` \r\n${log}\r\n新結局 ` }, operation);
  expect(response.status).toBe(200);
  expect((await notices()).results).toHaveLength(0);
  await approve(response);
  const rows = (await notices()).results;
  expect(rows.map(r => r.member_id).sort()).toEqual([follower, collector].sort());
  expect(rows.map(r => JSON.parse(r.extra))).toEqual([
    expect.objectContaining({ event: 'update', note: `${log}\n新結局` }),
    expect.objectContaining({ event: 'update', note: `${log}\n新結局` }),
  ]);
  expect((await submit({ updateKind: 'major', updateNote: ` \r\n${log}\r\n新結局 ` }, operation)).status).toBe(200);
  expect((await notices()).results).toHaveLength(2);
  const changed = await submit({ updateKind: 'major', updateNote: log }, operation);
  expect(changed.status).toBe(409);
  const detail = await SELF.fetch('https://c.test/v1/cards/' + card);
  expect(await detail.json()).toMatchObject({ updateKind: 'major', updateNote: `${log}\n新結局` });
  const metrics = await SELF.fetch('https://c.test/metrics');
  expect(await metrics.text()).toContain('hearthroom_card_update_notifications_total{operation="publish",outcome="queued"} 1');
});
it('enforces three days but keeps silent updates available and clears only the public log', async () => {
  await approve(await submit({ updateKind: 'major', updateNote: log }));
  const published = await env.DB.prepare("SELECT published_at FROM card_update_events WHERE state='published'").first<{published_at:number}>();
  const next = published!.published_at + 3 * day;
  legacyPolicyFixture();
  const availability = await SELF.fetch('https://c.test/v1/me/cards/draft/visibility', { headers: bearer('author') });
  expect(await availability.json()).toMatchObject({ workVisibility: { nextMajorUpdateAt: next } });
  const blocked = await submit({ updateKind: 'major', updateNote: log });
  expect(blocked.status).toBe(409);
  expect(await blocked.json()).toMatchObject({ error: 'update_notification_cooldown', nextMajorUpdateAt: next });
  const metrics = await SELF.fetch('https://c.test/metrics');
  expect(await metrics.text()).toContain('hearthroom_card_update_notifications_total{operation="admission",outcome="cooldown"} 1');
  await approve(await submit());
  const detail = await SELF.fetch('https://c.test/v1/cards/' + card);
  expect(await detail.json()).toMatchObject({ updateKind: 'minor', updateNote: '' });
  expect((await notices()).results.map(r => JSON.parse(r.extra).note)).toEqual([log, log]);
  await env.DB.prepare("UPDATE card_update_events SET published_at=? WHERE state='published'").bind(Date.now() - 3 * day).run();
  expect((await submit({ updateKind: 'major', updateNote: '字'.repeat(200) })).status).toBe(200);
});
it('carries a collector-only update through website, Web Push and Discord without exposing R logs on Discord', async () => {
  await approve(await submit({ updateKind: 'major', updateNote: log }));
  const website = await SELF.fetch('https://c.test/v1/me/community/notifications?lang=en', { headers: bearer('collector') });
  expect(await website.json()).toMatchObject({ items: [expect.objectContaining({ extra: expect.objectContaining({ note: log }) })] });
  const pushEnv = { ...env, PUSH_VAPID_PUBLIC_KEY: 'configured', PUSH_VAPID_PRIVATE_KEY: 'configured', PUSH_VAPID_SUBJECT: 'mailto:test@example.com' } as Env;
  await saveSubscription(pushEnv, collector, { endpoint: 'https://push.example/collector', keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) }, locale: 'en' });
  const sent: string[] = [];
  await dispatchPush(pushEnv, async (_sub, payload) => { sent.push(payload.body); return 201; });
  expect(sent).toHaveLength(1); expect(sent[0]).toContain(log);
  await setPreferences(env, collector, { discordDm: true });
  await env.DB.prepare("UPDATE members SET locale='en' WHERE id=?").bind(collector).run();
  await env.DB.prepare('INSERT INTO community_subjects(discord_id) VALUES(?)').bind('323456789012345678').run();
  await env.DB.prepare("INSERT INTO discord_links(member_id,discord_id,name,state,version,created_at) VALUES(?,?,?,'active','v1',?)").bind(collector,'323456789012345678','Collector',Date.now()).run();
  const settings = { ...env, COMMUNITY_ENABLED: 'true', COMMUNITY_GUILD_ID: '123456789012345678', COMMUNITY_BRIDGE_KEY: 'a'.repeat(64) } as Env;
  async function bridge(op: string, extra: Record<string, unknown> = {}) {
    const path = '/internal/community/' + op, time = String(Date.now()), nonce = crypto.randomUUID();
    const body = JSON.stringify({ guild: settings.COMMUNITY_GUILD_ID, ...extra });
    return app.fetch(new Request('https://sukisuki.ai' + path, { method: 'POST', body, headers: { 'X-Community-Time': time, 'X-Community-Nonce': nonce, 'X-Community-Signature': await sign(settings.COMMUNITY_BRIDGE_KEY!, 'POST', path, time, nonce, body) } }), settings, createExecutionContext());
  }
  const n = await env.DB.prepare("SELECT id FROM community_notifications WHERE member_id=? AND kind='followed_work'").bind(collector).first<{ id: string }>();
  const pending = await bridge('pending'); expect(JSON.stringify(await pending.json())).toContain(n!.id);
  const dm = await bridge('notification', { id: n!.id }); expect(dm.status).toBe(200); expect(JSON.stringify(await dm.json())).toContain(log);
  await env.DB.prepare("UPDATE cards SET rating='R' WHERE id=?").bind(Number(card)).run();
  const hidden = await bridge('notification', { id: n!.id });
  expect(hidden.status).toBe(200); expect(JSON.stringify(await hidden.json())).not.toContain(log);
  // A denied old update must not occupy every limited Discord batch forever.
  await env.DB.prepare("UPDATE cards SET status='unshared' WHERE id=?").bind(Number(card)).run();
  for(let i=0;i<10;i++)await env.DB.prepare(`INSERT INTO community_notifications(id,event_key,member_id,kind,card_id,actor_id,extra,path,created_at)
    SELECT ?,?,member_id,kind,card_id,actor_id,extra,path,created_at-1000-? FROM community_notifications WHERE id=?`)
    .bind(crypto.randomUUID(),crypto.randomUUID(),i,n!.id).run();
  await bridge('pending');
  expect((await env.DB.prepare("SELECT count(*) n FROM community_notifications WHERE member_id=? AND delivered=0 AND kind='followed_work'").bind(collector).first<{n:number}>())!.n).toBe(1);
  await env.DB.prepare("INSERT INTO community_notifications(id,event_key,member_id,kind,extra,path,created_at) VALUES('later-notice','later-event',?,'pack_grant','{}','/mine',?)").bind(collector,Date.now()).run();
  const next=await bridge('pending');
  expect((await next.json() as any).notifications).toContainEqual({id:'later-notice'});

});
it('does not reserve or notify a rejected update', async () => {
  const response = await submit({ updateKind: 'major', updateNote: '😀'.repeat(10) });
  expect(response.status).toBe(200);
  const s = await env.DB.prepare("SELECT id FROM review_submissions WHERE status='pending'").first<{ id: string }>();
  await claim(env.DB, s!.id, 'rejector', Date.now());
  await stamp(env.DB, { submissionId: s!.id, memberId: 'rejector', verdict: 'reject', note: 'revise', now: Date.now() }, env);
  expect((await notices()).results).toHaveLength(0);
  expect((await submit({ updateKind: 'major', updateNote: log })).status).toBe(200);
});
it('lists only published version metadata, retaining old logs after a silent revision', async () => {
  const major = await approve(await submit({ updateKind: 'major', updateNote: log }));
  const silent = await approve(await submit());
  await submit(); // A pending revision must not enter the public history
  const response = await SELF.fetch(`https://c.test/v1/cards/${card}/versions?page=1`);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('no-store');
  const result = await response.json() as { items: Record<string, unknown>[]; hasMore: boolean };
  expect(result.items).toHaveLength(3);
  expect(result.items.slice(0, 2)).toEqual([
    expect.objectContaining({ versionId: silent, updateKind: 'minor', updateNote: '', publishedAt: expect.any(Number) }),
    expect.objectContaining({ versionId: major, updateKind: 'major', updateNote: log, publishedAt: expect.any(Number) }),
  ]);
  expect(result.hasMore).toBe(false);
  expect(JSON.stringify(result)).not.toMatch(/hostedRevisionId|public_role|roleDetailDesc|member_id/);
  await env.DB.prepare("UPDATE cards SET rating='R' WHERE id=?").bind(Number(card)).run();
  const gated = await SELF.fetch(`https://c.test/v1/cards/${card}/versions`);
  expect(gated.status).toBe(403);
  expect(JSON.stringify(await gated.json())).not.toContain(log);
});
it('locates a notification revision beyond the first page without returning another card version',async()=>{
 const version=await approve(await submit({updateKind:'major',updateNote:log}));
 for(let i=0;i<23;i++)await env.DB.prepare(`INSERT INTO hosting_versions(version_id,work_id,member_id,operation_id,source_role_id,provider,hosted_revision_id,card_id,public_role,state,created_at,published_at)
   SELECT ?,work_id,member_id,?,source_role_id,provider,?,card_id,public_role,'approved',?,? FROM hosting_versions WHERE version_id=?`)
   .bind(crypto.randomUUID(),crypto.randomUUID(),crypto.randomUUID(),Date.now()+i*1000,Date.now()+i*1000,version).run();
 const result=await(await SELF.fetch(`https://c.test/v1/cards/${card}/versions?target=${version}`)).json() as any;
 expect(result.items).toHaveLength(20);expect(result.hasMore).toBe(true);
 expect(result.items.some((v:any)=>v.versionId===version)).toBe(false);
 expect(result.target).toMatchObject({versionId:version,updateKind:'major',updateNote:log});
 const missing=await(await SELF.fetch(`https://c.test/v1/cards/${card}/versions?target=${crypto.randomUUID()}`)).json() as any;
 expect(missing.target).toBeNull();
});
it('does not expose the frozen changelog through notifications after access is withdrawn',async()=>{
 await approve(await submit({updateKind:'major',updateNote:log}));
 await env.DB.prepare("UPDATE cards SET status='unshared' WHERE id=?").bind(Number(card)).run();
 const response=await SELF.fetch('https://c.test/v1/me/community/notifications?lang=en',{headers:bearer('collector')});
 expect(response.status).toBe(200);
 expect(JSON.stringify(await response.json())).not.toContain(log);
});

it('uses the exact three-day boundary in admission, reservation and source eligibility', async () => {
  await approve(await submit({ updateKind: 'major', updateNote: log }));
  const event = await env.DB.prepare("SELECT work_id,published_at FROM card_update_events WHERE state='published'").first<{work_id:string;published_at:number}>();
  // Prepare a pending major version while eligible, then restore the real last publication.
  await env.DB.prepare("UPDATE card_update_events SET published_at=? WHERE state='published'").bind(Date.now()-8*day).run();
  const pending = await submit({updateKind:'major',updateNote:log});
  expect(pending.status).toBe(200);
  const {versionId} = await pending.json() as {versionId:string};
  const version = await env.DB.prepare('SELECT submission_id FROM hosting_versions WHERE version_id=?').bind(versionId).first<{submission_id:string}>();
  await env.DB.prepare("UPDATE card_update_events SET published_at=? WHERE state='published'").bind(event!.published_at).run();
  const next = event!.published_at+3*day;
  expect((await sourceUpdateTimes(env.DB,['draft'])).get('draft')).toBe(next);
  await expect(assertUpdateCooldown(env.DB,event!.work_id,next-1)).rejects.toMatchObject({status:409,extra:{nextMajorUpdateAt:next}});
  await expect(reserveUpdateNotification(env.DB,version!.submission_id,next-1)).rejects.toMatchObject({status:409});
  await expect(env.DB.prepare("INSERT INTO card_update_events(version_id,work_id,state,reserved_at) VALUES(?,?,'reserved',?)").bind(versionId,event!.work_id,next-1).run()).rejects.toThrow('update_notification_cooldown');
  await expect(assertUpdateCooldown(env.DB,event!.work_id,next)).resolves.toBeUndefined();
  await expect(reserveUpdateNotification(env.DB,version!.submission_id,next)).resolves.toBeUndefined();
  expect(await env.DB.prepare('SELECT state,reserved_at FROM card_update_events WHERE version_id=?').bind(versionId).first()).toEqual({state:'reserved',reserved_at:next});
});
