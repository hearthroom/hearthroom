import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { legacyPolicyFixture, restoreLegacyPolicyFixture } from './work-policy-fixture';
import { bearer, identities, makeReviewer, ratingBody, resetDb, restoreUpstream, reviewOff, reviewOn, reviewUpstream, rolesOnMainSite } from './helpers';
import { opsMetrics } from '../src/ops-metrics';
import { FAST_TRACK_ACTOR } from '../src/review-fast-track';
import { STAMPS_REQUIRED } from '../src/review';

// AI 審卡快速通道（任務 2026-11-25-ai-review-fast-track）：已上架卡的更新，分級不變、AI 用目前判準判通過且沒有審核標記，就自動核准。
const KEY = 'b'.repeat(64);
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
let managerId = '';

async function seedReviewAgentIdentity() {
  const migration = (env as unknown as { TEST_MIGRATIONS: { name: string; queries: string[] }[] }).TEST_MIGRATIONS.find((m) => m.name.endsWith('_review_ai.sql') || m.name.endsWith('_review_ai'))!;
  for (const q of migration.queries.filter((q) => /_review_agent_identity_guard|system-review-agent/.test(q))) await env.DB.prepare(q).run();
}

beforeEach(async () => {
  await resetDb(); legacyPolicyFixture();
  identities({ author: 10001, reviewer: 20001, mgr: 20002 });
  rolesOnMainSite({ roleId: 'role-1', authorNumId: 10001 });
  reviewUpstream(); reviewOn();
  await makeReviewer(20001);
  managerId = await makeReviewer(20002);
  await env.DB.prepare("UPDATE reviewers SET role='manager' WHERE member_id=?").bind(managerId).run();
  await seedReviewAgentIdentity();
  (env as { REVIEW_AGENT_CONFIG?: string }).REVIEW_AGENT_CONFIG = JSON.stringify({ memberId: 'system-review-agent', keySha256: await sha(KEY) });
});
afterEach(() => { restoreUpstream(); reviewOff(); restoreLegacyPolicyFixture(); delete (env as { REVIEW_AGENT_CONFIG?: string }).REVIEW_AGENT_CONFIG; });

const json = async (res: Response) => (await res.json()) as any;
const post = (path: string, token: string, body: unknown = {}) => SELF.fetch(`https://c.test${path}`, { method: 'POST', headers: { ...bearer(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** 作者送審（首次或更新），回這張單的編號 */
async function submit(adult = false): Promise<string> {
  const res = await post('/v1/cards', 'author', { roleId: 'role-1', ...ratingBody(adult), operationId: crypto.randomUUID() });
  expect([200, 201]).toContain(res.status);
  return (await env.DB.prepare('SELECT id FROM review_submissions ORDER BY rowid DESC LIMIT 1').first<{ id: string }>())!.id;
}
async function humanDecide(id: string, verdict: 'approve' | 'reject') {
  const claim = await post(`/v1/review/${id}/claim`, 'reviewer');
  const { generation } = await json(claim);
  const res = await post(`/v1/review/${id}/stamp`, 'reviewer', { verdict, note: verdict === 'reject' ? '開場需要讓角色提出一件事。' : '', generation, ...(verdict === 'reject' ? { reasons: ['opening.no_reply_hook'] } : {}) });
  expect(res.status, await res.clone().text()).toBe(200);
}
/** 已上架的卡，作者送了一次更新：回 { first, update } */
async function liveCardWithUpdate(opts: { adultUpdate?: boolean } = {}) {
  const first = await submit();
  await humanDecide(first, 'approve');
  expect((await post('/v1/cards/role-1/edit', 'author')).status).toBe(200);
  rolesOnMainSite({ roleId: 'role-1', authorNumId: 10001, name: 'New name' });
  const update = await submit(opts.adultUpdate);
  return { first, update };
}
const suggest = (id: string, body: Record<string, unknown> = {}, path = 'suggestion') =>
  SELF.fetch(`https://c.test/v1/review-ai/submissions/${id}/${path}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Review-Agent-Key': KEY },
    body: JSON.stringify({ criteriaVersion: 'v1', model: 'deepseek/deepseek-v4.1-flash', verdict: 'pass', ...(body.verdict === 'reject' ? { reasons: ['opening.no_reply_hook'], authorNote: '開場停在描寫，請讓角色提出一件需要玩家回應的事。' } : {}), ...body }),
  });
const statusOf = async (id: string) => (await env.DB.prepare('SELECT status FROM review_submissions WHERE id=?').bind(id).first<{ status: string }>())!.status;
const metric = async (outcome: string) => {
  const m = (await opsMetrics(env.DB)).match(new RegExp(`hearthroom_review_fast_track_total\\{operation="evaluate",outcome="${outcome}"\\} (\\d+)`));
  return m ? Number(m[1]) : 0;
};

describe('自動核准', () => {
  it('已上架卡的更新、分級不變、AI 通過無標記：系統蓋章核准、上架新版、通知作者、留稽核', async () => {
    const { first, update } = await liveCardWithUpdate();
    const before = await env.DB.prepare('SELECT approved_version_id FROM cards').first<{ approved_version_id: string }>();
    const res = await suggest(update);
    expect(res.status).toBe(200);
    // 審卡員收到的回應不變（不告訴它自動核准了）
    expect(Object.keys(await json(res)).sort()).toEqual(['criteriaVersion', 'id', 'phase', 'verdict']);
    expect(await statusOf(update)).toBe('approved');
    expect(await statusOf(first)).toBe('approved');
    const card = await env.DB.prepare('SELECT status, approved_version_id FROM cards').first<{ status: string; approved_version_id: string }>();
    expect(card!.status).toBe('approved');
    expect(card!.approved_version_id).not.toBe(before!.approved_version_id);
    // 系統身分蓋的章：一章就足額（不論 STAMPS_REQUIRED 之後調成幾章）
    const stamps = await env.DB.prepare('SELECT member_id, verdict, claim_generation FROM review_stamps WHERE submission_id=?').bind(update).all<{ member_id: string; verdict: string }>();
    expect(stamps.results).toHaveLength(1);
    expect(stamps.results[0]).toMatchObject({ member_id: FAST_TRACK_ACTOR, verdict: 'approve' });
    const event = await env.DB.prepare("SELECT actor_kind, final_source, ai_suggestion_id FROM review_events WHERE submission_id=? AND action='approve'").bind(update).first<{ actor_kind: string; final_source: string; ai_suggestion_id: string }>();
    expect(event).toMatchObject({ actor_kind: 'system', final_source: 'ai_fast_track' });
    const suggestionId = (await env.DB.prepare('SELECT id FROM review_ai_suggestions WHERE submission_id=?').bind(update).first<{ id: string }>())!.id;
    expect(event!.ai_suggestion_id).toBe(suggestionId);
    const audit = await env.DB.prepare("SELECT actor_kind, action, after_json FROM audit_log WHERE subject_kind='review_submission' AND subject_id=?").bind(update).first<{ actor_kind: string; action: string; after_json: string }>();
    expect(audit).toMatchObject({ actor_kind: 'ai', action: 'review_fast_track_approve' });
    expect(JSON.parse(audit!.after_json)).toMatchObject({ criteriaVersion: 'v1', suggestionId, reasons: [], flags: [] });
    const notice = await env.DB.prepare("SELECT extra FROM community_notifications WHERE event_key=?").bind('review:' + update).first<{ extra: string }>();
    expect(JSON.parse(notice!.extra)).toMatchObject({ status: 'approved' });
    // 系統的領取在蓋章時就放回了
    expect(await env.DB.prepare('SELECT claimed_by FROM review_submissions WHERE id=?').bind(update).first()).toEqual({ claimed_by: null });
    expect(await metric('approved')).toBe(1);
    // 同一筆結論重送不會再處理
    expect((await suggest(update)).status).toBe(200);
    expect(await metric('approved')).toBe(1);
  });

  it('需要的章數調高時，快速通道一章仍然足額', async () => {
    const saved = { ...STAMPS_REQUIRED };
    STAMPS_REQUIRED.re = 2; STAMPS_REQUIRED.first = 2;
    try {
      const first = await submit();
      // 首次送審要兩章：人工蓋兩章
      for (const token of ['reviewer', 'mgr']) {
        const { generation } = await json(await post(`/v1/review/${first}/claim`, token));
        expect((await post(`/v1/review/${first}/stamp`, token, { verdict: 'approve', note: '', generation })).status).toBe(200);
      }
      expect(await statusOf(first)).toBe('approved');
      expect((await post('/v1/cards/role-1/edit', 'author')).status).toBe(200);
      const update = await submit();
      await suggest(update);
      expect(await statusOf(update)).toBe('approved');
    } finally { Object.assign(STAMPS_REQUIRED, saved); }
  });

  it('人類審核員不能把定案來源寫成快速通道', async () => {
    const { update } = await liveCardWithUpdate();
    const { generation } = await json(await post(`/v1/review/${update}/claim`, 'reviewer'));
    const res = await post(`/v1/review/${update}/stamp`, 'reviewer', { verdict: 'approve', note: '', generation, finalSource: 'ai_fast_track' });
    expect(res.status).toBe(400);
    expect(await statusOf(update)).toBe('pending');
  });
});

describe('不走快速通道（留在人工佇列）', () => {
  it('從未上架的新卡', async () => {
    const id = await submit();
    await suggest(id);
    expect(await statusOf(id)).toBe('pending');
    expect(await metric('ineligible_status')).toBe(1);
  });

  it('分級等級或內容標示不同', async () => {
    const { update } = await liveCardWithUpdate();
    await env.DB.prepare(`UPDATE review_submissions SET rating_descriptors='["violence.mild"]' WHERE id=?`).bind(update).run();
    await suggest(update);
    expect(await statusOf(update)).toBe('pending');
    expect(await metric('ineligible_rating')).toBe(1);
    // 內容標示一樣、等級不同（上架版本的等級被更正過）
    await env.DB.prepare("UPDATE review_submissions SET rating_descriptors=(SELECT rating_descriptors FROM cards) WHERE id=?").bind(update).run();
    await env.DB.prepare("UPDATE cards SET rating='PG15'").run();
    await suggest(update, { model: 'deepseek/deepseek-v4.1-flash-2' });
    expect(await statusOf(update)).toBe('pending');
    expect(await metric('ineligible_rating')).toBe(2);
  });

  it('AI 判不通過、交人工、有審核標記、不是目前判準版本', async () => {
    const { update } = await liveCardWithUpdate();
    await suggest(update, { verdict: 'reject' });
    await suggest(update, { verdict: 'handoff', handoffCause: 'unsure' });
    expect(await metric('ineligible_verdict')).toBe(2);
    await suggest(update, { flags: ['ai_unedited'] });
    expect(await metric('ineligible_flags')).toBe(1);
    expect(await statusOf(update)).toBe('pending');
    // 目前判準是 v2：v1 的通過不算
    await env.DB.prepare("INSERT INTO community_settings (key, value, updated_by, updated_at) VALUES ('review_ai_criteria', '\"v2\"', 'test', 0)").run();
    await suggest(update, { flags: [] });
    expect(await statusOf(update)).toBe('pending');
    expect(await metric('ineligible_verdict')).toBe(3);
  });

  it('只打標記、或試跑已定案的單，不觸發', async () => {
    const { update } = await liveCardWithUpdate();
    await suggest(update, { verdict: undefined, flags: [] }, 'tags');
    expect(await statusOf(update)).toBe('pending');
    expect((await opsMetrics(env.DB)).match(/hearthroom_review_fast_track_total\{/g)).toBeNull();
  });

  it('人工已經領著或定案', async () => {
    const { update } = await liveCardWithUpdate();
    await post(`/v1/review/${update}/claim`, 'reviewer');
    await suggest(update);
    expect(await statusOf(update)).toBe('pending');
    expect(await metric('skipped_decided')).toBe(1);
    // 審核員照常定案
    const { generation } = await json(await post(`/v1/review/${update}/claim`, 'reviewer'));
    expect((await post(`/v1/review/${update}/stamp`, 'reviewer', { verdict: 'approve', note: '', generation })).status).toBe(200);
    await suggest(update, { model: 'deepseek/deepseek-v4.1-flash-2' });
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM review_stamps WHERE submission_id=?').bind(update).first()).toEqual({ n: 1 });
  });

  it('冷凍中、被處置中、已下架、有不受理案件、上一次更新被駁回', async () => {
    const { update } = await liveCardWithUpdate();
    await env.DB.prepare('INSERT INTO review_holds (card_id, member_id, submission_id, created_at) SELECT card_id, ?, id, ? FROM review_submissions WHERE id=?').bind(managerId, Date.now(), update).run();
    await suggest(update);
    expect(await statusOf(update)).toBe('pending');
    await env.DB.prepare('DELETE FROM review_holds').run();
    await env.DB.prepare('UPDATE cards SET public_blocked=1').run();
    await suggest(update, { model: 'deepseek/deepseek-v4.1-flash-2' });
    expect(await statusOf(update)).toBe('pending');
    await env.DB.prepare('UPDATE cards SET public_blocked=0').run();
    // 已下架（作者收回公開）
    await env.DB.prepare("UPDATE cards SET status='unshared'").run();
    await suggest(update, { model: 'deepseek/deepseek-v4.1-flash-3' });
    expect(await statusOf(update)).toBe('pending');
    await env.DB.prepare("UPDATE cards SET status='approved'").run();
    // 這張卡有還開著的不受理案件
    await env.DB.prepare("INSERT INTO review_drop_cases (id, card_id, source, opened_by, opened_at) SELECT 'case-1', card_id, 'single', ?, ? FROM review_submissions WHERE id=?").bind(managerId, Date.now(), update).run();
    await suggest(update, { model: 'deepseek/deepseek-v4.1-flash-4' });
    expect(await statusOf(update)).toBe('pending');
    await env.DB.prepare('DELETE FROM review_drop_cases').run();
    expect(await metric('ineligible_status')).toBe(4);
    // 更新被駁回後作者改稿重送：走人工
    await humanDecide(update, 'reject');
    const again = await submit();
    await suggest(again);
    expect(await statusOf(again)).toBe('pending');
    expect(await metric('ineligible_status')).toBe(5);
  });
});

describe('撤回、紀錄與報表', () => {
  it('管理員撤回：這次更新改為駁回、上架版本退回前一版、作者收到通知；一般審核員不能撤', async () => {
    const { first, update } = await liveCardWithUpdate();
    const previous = await env.DB.prepare('SELECT approved_version_id FROM cards').first<{ approved_version_id: string }>();
    await suggest(update);
    expect(await statusOf(update)).toBe('approved');
    const correct = (token: string, operationId = crypto.randomUUID()) => post(`/v1/review/${update}/correction`, token, { operationId, note: '這次更新的開場還需要調整。' });
    expect((await correct('reviewer')).status).toBe(403);
    const operationId = crypto.randomUUID();
    const res = await correct('mgr', operationId);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(await json(res)).toMatchObject({ status: 'rejected', publicState: 'previous_version', publicVersionId: previous!.approved_version_id });
    expect(await statusOf(update)).toBe('rejected');
    expect(await statusOf(first)).toBe('approved');
    expect(await env.DB.prepare('SELECT status, approved_version_id FROM cards').first()).toEqual({ status: 'approved', approved_version_id: previous!.approved_version_id });
    const notice = await env.DB.prepare('SELECT extra FROM community_notifications WHERE event_key=?').bind('review-correction:' + operationId).first<{ extra: string }>();
    expect(JSON.parse(notice!.extra)).toMatchObject({ status: 'rejected', note: '這次更新的開場還需要調整。' });
    expect(await opsMetrics(env.DB)).toContain('hearthroom_review_fast_track_revokes_total{operation="revoke",outcome="success"} 1');
    // 重送同一個撤回不多算
    expect((await correct('mgr', operationId)).status).toBe(200);
    expect(await opsMetrics(env.DB)).toContain('hearthroom_review_fast_track_revokes_total{operation="revoke",outcome="success"} 1');
  });

  it('一般人工改判不算快速通道撤回', async () => {
    const { update } = await liveCardWithUpdate();
    await humanDecide(update, 'approve');
    expect((await post(`/v1/review/${update}/correction`, 'mgr', { operationId: crypto.randomUUID(), note: '這次更新的開場還需要調整。' })).status).toBe(200);
    expect(await opsMetrics(env.DB)).not.toContain('hearthroom_review_fast_track_revokes_total{operation="revoke",outcome="success"}');
  });

  it('審核紀錄可以篩快速通道（限管理員）；詳情標出快速通道那一章；報表算件數、通過率、撤回數', async () => {
    const { update } = await liveCardWithUpdate();
    await suggest(update);
    const list = await SELF.fetch('https://c.test/v1/review/decisions?source=ai_fast_track', { headers: bearer('mgr') });
    expect(list.status).toBe(200);
    const items = (await json(list)).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: update, verdict: 'approve', status: 'approved', canCorrect: true, finalSource: 'ai_fast_track' });
    expect((await SELF.fetch('https://c.test/v1/review/decisions?source=ai_fast_track', { headers: bearer('reviewer') })).status).toBe(403);
    expect((await SELF.fetch('https://c.test/v1/review/decisions?source=other', { headers: bearer('mgr') })).status).toBe(400);
    // 我自己的紀錄裡沒有系統蓋的章
    expect((await json(await SELF.fetch('https://c.test/v1/review/decisions', { headers: bearer('mgr') }))).items).toEqual([]);

    const detail = await json(await SELF.fetch(`https://c.test/v1/review/${update}/detail`, { headers: bearer('mgr') }));
    expect(detail.submission.stamps).toEqual([expect.objectContaining({ verdict: 'approve', mine: false, finalSource: 'ai_fast_track' })]);
    expect(detail.submission.canCorrect).toBe(true);
    const timeline = await json(await SELF.fetch(`https://c.test/v1/review/${update}/timeline`, { headers: bearer('mgr') }));
    expect(timeline.items.filter((i: any) => i.current && i.action === 'approve')).toEqual([expect.objectContaining({ actor: null, mine: false, system: 'ai_fast_track' })]);

    const report = async () => (await json(await SELF.fetch('https://c.test/v1/review-ai/report', { headers: bearer('mgr') }))).versions.find((v: any) => v.criteriaVersion === 'v1');
    let v1 = await report();
    expect(v1.fastTrack).toEqual({ approved: 1, eligible: 1, rate: 1, revoked: 0 });
    expect(v1.finalSource).toMatchObject({ ai_fast_track: 1 });
    // 快速通道不是人的判斷：不進人機對照矩陣
    expect(v1.matrix.approved.pass).toBe(0);
    expect((await post(`/v1/review/${update}/correction`, 'mgr', { operationId: crypto.randomUUID(), note: '這次更新的開場還需要調整。' })).status).toBe(200);
    v1 = await report();
    expect(v1.fastTrack).toMatchObject({ approved: 1, revoked: 1 });
  });
});
