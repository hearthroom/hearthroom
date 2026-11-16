import { SELF, env } from 'cloudflare:test';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { bearer, resetDb, identities, restoreUpstream } from './helpers';
import { ownedHistory } from '../src/owned-history';
const originalRead = ownedHistory.read;
const payload = { conversationRoleId: 'latest-role', conversationId: 'latest-chat' };
const request = (action: string, body: unknown = payload, token = 'fan') => SELF.fetch(`https://c.test/v1/me/conversations/${action}`, {
  method: 'POST', headers: { ...bearer(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const put = (roleId: string, conversationId: string) => SELF.fetch('https://c.test/v1/me/conversations', {
  method: 'PUT', headers: { ...bearer('fan'), 'Content-Type': 'application/json' }, body: JSON.stringify({ roleId, conversationId }),
});
const list = async () => (await (await SELF.fetch('https://c.test/v1/me/conversations', { headers: bearer('fan') })).json() as any).conversations;
beforeEach(async () => {
  await resetDb(); identities({ fan: 20001, other: 20002 });
  ownedHistory.read = async (_env, _token, conversationId) => ({ conversationId, roleId: conversationId === 'old-chat' ? 'old-role' : 'latest-role', canGenerate: false, reason: 'author_private' });
  await put('latest-role', 'latest-chat');
  await env.DB.prepare('UPDATE member_conversations SET updated_at=3000').run();
});
afterEach(() => { ownedHistory.read = originalRead; restoreUpstream(); });

it('hides only the member recent row, preserves resume and original ordering, and restores it', async () => {
  const before = await env.DB.prepare('SELECT * FROM member_conversations').all();
  const hidden = await request('hide'); expect(hidden.status).toBe(200);
  expect(hidden.headers.get('Cache-Control')).toContain('no-store');
  expect(await hidden.json()).toEqual({ hidden: true });
  expect(await list()).toEqual([]);
  expect((await env.DB.prepare('SELECT * FROM member_conversations').all()).results).toEqual(before.results);
  expect((await SELF.fetch('https://c.test/v1/me/conversations/latest-chat?provider=harbor', { headers: bearer('fan') })).status).toBe(200);
  expect((await request('restore')).status).toBe(200);
  expect((await list()).map((row: any) => row.conversationId)).toEqual(['latest-chat']);
  expect((await env.DB.prepare('SELECT * FROM member_conversations').all()).results).toEqual(before.results);
});

it('filters after card ranking so hiding a card never exposes its older version pointer', async () => {
  await put('old-role', 'old-chat');
  // Both the source and approved revision map to the same community card.
  await env.DB.prepare("INSERT INTO cards(id,provider,source_role_id,approved_hosted_role_id,author_num_id,registered_at,last_synced_at,status,rating) VALUES(100001,'harbor','old-role','latest-role',10001,1,1,'approved','S')").run();
  await env.DB.prepare("INSERT INTO card_numbers(provider,source_role_id) VALUES('harbor','old-role')").run();
  await env.DB.prepare("UPDATE member_conversations SET updated_at=CASE role_id WHEN 'old-role' THEN 1000 ELSE 3000 END").run();
  expect((await list()).map((row: any) => row.conversationId)).toEqual(['latest-chat']);
  expect((await request('hide')).status).toBe(200);
  expect(await list()).toEqual([]);
  expect((await request('restore')).status).toBe(200);
  expect((await list()).map((row: any) => row.conversationId)).toEqual(['latest-chat']);
});

it('reentering naturally shows the conversation and undo cannot revive a replaced or deleted pointer', async () => {
  expect((await request('hide')).status).toBe(200);
  expect((await put('latest-role', 'latest-chat')).status).toBe(200);
  expect(await list()).toHaveLength(1);
  expect((await request('hide')).status).toBe(200);
  await put('latest-role', 'replacement-chat');
  expect((await request('restore')).status).toBe(404);
  expect((await list()).map((row: any) => row.conversationId)).toEqual(['replacement-chat']);
  await env.DB.prepare('DELETE FROM member_conversations').run();
  expect((await request('restore')).status).toBe(404);
  expect(await list()).toEqual([]);
});

it('allows the projected migrated role using only an exact own conversation pointer', async () => {
  expect((await request('hide', { ...payload, conversationRoleId: 'migrated-role' })).status).toBe(200);
  expect(await list()).toEqual([]);
  expect((await request('restore', { ...payload, conversationRoleId: 'migrated-role' })).status).toBe(200);
  expect(await list()).toHaveLength(1);
});

it('rejects cross-member, invalid, unauthenticated and oversized requests without changing own pointers', async () => {
  expect((await request('hide', payload, 'other')).status).toBe(404);
  expect((await request('restore', payload, 'other')).status).toBe(404);
  expect((await request('hide', payload, '')).status).toBe(401);
  expect((await request('hide', { ...payload, conversationId: '../bad' })).status).toBe(400);
  expect((await request('hide', { ...payload, extra: 'x'.repeat(3000) })).status).toBe(413);
  expect(await list()).toHaveLength(1);
});

it('exports fixed successful and denied operation counters without private identities', async () => {
  await request('hide'); await request('restore'); await request('hide', payload, 'other');
  const metrics = await (await SELF.fetch('https://c.test/metrics')).text();
  expect(metrics).toContain('hearthroom_library_requests_total{operation="conversations_hide",outcome="success"} 1');
  expect(metrics).toContain('hearthroom_library_requests_total{operation="conversations_restore",outcome="success"} 1');
  expect(metrics).toContain('hearthroom_library_requests_total{operation="conversations_hide",outcome="denied"} 1');
  expect(metrics).not.toContain('latest-chat'); expect(metrics).not.toContain('latest-role');
});

it('records storage failure without dropping or hiding the conversation pointer', async () => {
  await env.DB.exec("CREATE TRIGGER synthetic_recent_hide_failure BEFORE INSERT ON member_conversation_hides BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END;");
  try {
    expect((await request('hide')).status).toBe(500);
    expect(await list()).toHaveLength(1);
    const metrics = await (await SELF.fetch('https://c.test/metrics')).text();
    expect(metrics).toContain('hearthroom_library_requests_total{operation="conversations_hide",outcome="error"} 1');
  } finally { await env.DB.exec('DROP TRIGGER synthetic_recent_hide_failure'); }
});
