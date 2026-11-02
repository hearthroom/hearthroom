import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { upstream } from '../src/upstream';
import { makeMember, resetDb } from './helpers';

let qa: string;
let normal: string;

beforeEach(async () => {
  await resetDb();
  qa = await makeMember(80001);
  normal = await makeMember(80002);
  await env.DB.prepare("UPDATE members SET account_class='test',test_generation=1 WHERE id=?").bind(qa).run();
  vi.spyOn(upstream, 'fetchMe').mockImplementation(async (_env, token) => {
    if (token === 'qa') return { accountNumId: 80001, accountClass: 'test', testState: 'active', testGeneration: 1 };
    if (token === 'normal') return { accountNumId: 80002 };
    throw new Error('Unexpected synthetic token');
  });
  // An attribution fixture verifies that test activity cannot update public effects,
  // even if a retained attribution already exists for this member.
  await env.DB.batch([
    env.DB.prepare("INSERT INTO campaigns(id,slug,title,created_by,created_at,updated_at) VALUES('campaign','synthetic','{}',?,1,1)").bind(normal),
    env.DB.prepare("INSERT INTO share_contents(id,campaign_id,member_id,recipient_account_no,title,share_code,created_at,updated_at) VALUES('content','campaign',?,80002,'Synthetic','synthetic-code',1,1)").bind(normal),
    ...[qa, normal].map(member => env.DB.prepare("INSERT INTO campaign_attributions(member_id,share_code,content_id,campaign_id,first_seen_at,registered_at,created_at) VALUES(?,'synthetic-code','content','campaign',1,1,1)").bind(member)),
  ]);
});
afterEach(() => vi.restoreAllMocks());

async function put(token: string, roleId = 'synthetic-role', conversationId = 'synthetic-conversation') {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request('https://c.test/v1/me/conversations', {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ roleId, conversationId }),
  }), env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: response.status, body: await response.json() };
}

async function publicEffects(member: string) {
  return {
    milestone: await env.DB.prepare('SELECT event FROM analytics_milestones WHERE member_id=?').bind(member).all(),
    attribution: await env.DB.prepare('SELECT first_play_at FROM campaign_attributions WHERE member_id=?').bind(member).first(),
    activeDays: await env.DB.prepare('SELECT day FROM campaign_active_days WHERE member_id=?').bind(member).all(),
  };
}

it('saves a new test member private conversation and retries without public activity', async () => {
  expect(await put('qa')).toEqual({ status: 200, body: { saved: true, first: false } });
  expect(await put('qa', 'synthetic-role', 'replacement-conversation')).toEqual({ status: 200, body: { saved: true, first: false } });
  expect(await put('qa', 'second-role', 'second-conversation')).toEqual({ status: 200, body: { saved: true, first: false } });
  const rows = await env.DB.prepare('SELECT role_id,conversation_id FROM member_conversations WHERE member_id=? ORDER BY role_id').bind(qa).all();
  expect(rows.results).toEqual([
    { role_id: 'second-role', conversation_id: 'second-conversation' },
    { role_id: 'synthetic-role', conversation_id: 'replacement-conversation' },
  ]);
  const effects = await publicEffects(qa);
  expect(effects.milestone.results).toEqual([]);
  expect(effects.attribution).toEqual({ first_play_at: null });
  expect(effects.activeDays.results).toEqual([]);
  const metric = await env.DB.prepare("SELECT value FROM library_metrics WHERE operation='conversations_put' AND outcome='success'").first();
  expect(metric).toEqual({ value: 3 });
});

it('keeps normal first-chat and campaign activity durable and idempotent', async () => {
  expect(await put('normal')).toEqual({ status: 200, body: { saved: true, first: true } });
  expect(await put('normal')).toEqual({ status: 200, body: { saved: true, first: false } });
  const effects = await publicEffects(normal);
  expect(effects.milestone.results).toEqual([{ event: 'first_chat' }]);
  expect(effects.attribution).toEqual({ first_play_at: expect.any(Number) });
  expect(effects.activeDays.results).toEqual([{ day: expect.any(Number) }]);
  expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM member_conversations WHERE member_id=?').bind(normal).first())?.n).toBe(1);
});

it('retains the database guard against direct test analytics writes', async () => {
  await expect(env.DB.prepare("INSERT INTO analytics_milestones(member_id,event,created_at) VALUES(?,'first_chat',1)").bind(qa).run())
    .rejects.toThrow('test_account_operation_not_allowed');
});

it('rolls back normal analytics and campaign effects when private persistence fails', async () => {
  await env.DB.exec("CREATE TRIGGER synthetic_recent_failure BEFORE INSERT ON member_conversations BEGIN SELECT RAISE(ABORT,'synthetic_persistence_failure'); END;");
  try {
    expect((await put('normal')).status).toBe(500);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM member_conversations WHERE member_id=?').bind(normal).first())?.n).toBe(0);
    const effects = await publicEffects(normal);
    expect(effects.milestone.results).toEqual([]);
    expect(effects.attribution).toEqual({ first_play_at: null });
    expect(effects.activeDays.results).toEqual([]);
  } finally {
    await env.DB.exec('DROP TRIGGER synthetic_recent_failure');
  }
});
