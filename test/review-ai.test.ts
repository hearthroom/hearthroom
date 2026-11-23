import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERAL_RATING, bearer, identities, makeAgent, makeMember, makeReviewer, resetDb, restoreUpstream, role } from './helpers';
import { hostGateway, submitHosted } from '../src/hosting';
import { claim, pendingSubmissionOf, stamp } from '../src/review';
import { dropSubmission } from '../src/review-drop';
import { aiCardInput } from '../src/review-ai';
import { getCard } from '../src/cards';
import { upstream } from '../src/upstream';

// AI 審卡影子模式（任務 2026-11-23-ai-card-review）：審卡員只讀與寫建議，雙盲，審完才揭曉。
const AUTHOR = 10001, AGENT = 30001, HUMAN = 20001, MANAGER = 20002;
let agentId = '', humanId = '', managerId = '';

beforeEach(async () => {
  await resetDb();
  identities({ agent: AGENT, human: HUMAN, mgr: MANAGER, author: AUTHOR });
  agentId = await makeAgent(AGENT);
  humanId = await makeReviewer(HUMAN);
  managerId = await makeReviewer(MANAGER);
  await env.DB.prepare("UPDATE reviewers SET role='manager' WHERE member_id=?").bind(managerId).run();
});
afterEach(() => { vi.restoreAllMocks(); restoreUpstream(); });

const SETTING = '她是車站的夜班站務員，說話慢、愛用敬語。'.repeat(700);
const WELCOME = '末班車剛走，月台上只剩你和她。「你也錯過了嗎？」她問。\n1. 點頭\n2. 搖頭';

async function submitCard(roleId = 'draft') {
  const memberId = await makeMember(AUTHOR);
  const draft = role({ roleId, authorNumId: AUTHOR });
  vi.spyOn(hostGateway, 'seal').mockImplementation(async (_e, _t, _id, workId, versionId) => ({ workId, versionId, hostedRevisionId: `sealed-${roleId}` }));
  vi.spyOn(hostGateway, 'read').mockImplementation(async (_e, _t, id) => ({ ...draft, roleId: id }));
  const settings = {
    document: { roleName: 'Fixture', roleTag: ['Roleplay'], roleDetailDesc: SETTING, customInstructions: '', talkExample: '' },
    greetings: { welcome: WELCOME, alternates: [], prologue: [] },
    worldbooks: [{ worldbookId: 'b', name: 'book', description: '', format: '', entries: [{ entryId: '0', name: '車站', content: '終點站。', keywords: [], secondaryKeywords: [], category: '', isEnabled: true, isConstant: false, triggerRegion: '' }] }],
    authorAsset: { rules: [], mountTrigger: '', mountLayer: '', pageMode: 'classic', status: 'ok', version: 1 },
    hashes: { card: '', welcome: '', worldbook: '', authorAsset: '', content: '' },
  };
  vi.spyOn(upstream, 'readForReview').mockImplementation(async () => structuredClone(settings) as never);
  const sealed = vi.spyOn(upstream, 'readSealedForReview').mockImplementation(async () => structuredClone(settings) as never);
  await submitHosted(env, { memberId, account: AUTHOR, role: draft, token: 'fixture', rating: GENERAL_RATING, operationId: crypto.randomUUID(), now: Date.now(), deviceHash: null });
  const s = (await pendingSubmissionOf(env.DB, (await getCard(env.DB, roleId, 'harbor'))!.id))!;
  return { id: s.id, sealed };
}

const get = (path: string, token: string) => SELF.fetch(`https://c.test${path}`, { headers: bearer(token) });
const send = (method: string, path: string, token: string, body: unknown) =>
  SELF.fetch(`https://c.test${path}`, { method, headers: { 'Content-Type': 'application/json', ...bearer(token) }, body: JSON.stringify(body) });
const suggest = (id: string, body: Record<string, unknown>, token = 'agent') =>
  send('PUT', `/v1/review-ai/submissions/${id}/suggestion`, token, { criteriaVersion: 'v1', model: 'deepseek/deepseek-v4.1-flash', ...body });
const json = async (res: Response) => (await res.json()) as any;
const decide = async (id: string, member: string, verdict: 'approve' | 'reject') => {
  await claim(env.DB, id, member, Date.now());
  await stamp(env.DB, { submissionId: id, memberId: member, verdict, note: '', now: Date.now(), ...(verdict === 'reject' ? { reasons: ['opening.no_reply_hook'] } : {}) });
};
const status = async (id: string) => (await env.DB.prepare('SELECT status FROM review_submissions WHERE id=?').bind(id).first<{ status: string }>())!.status;

describe('審卡員讀卡', () => {
  it('讀待審單的封存內容，不領取、不帶人工決定；人類審核員不能用這條路', async () => {
    const { id } = await submitCard();
    const res = await get(`/v1/review-ai/submissions/${id}`, 'agent');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.card.setting.length).toBeLessThanOrEqual(12_000 + 10);
    expect(body.card.setting.endsWith('…[截斷]')).toBe(true);
    expect(body.stats.settingChars).toBe(SETTING.length);
    expect(body.stats.openingChoices).toBe(true);
    expect(body.submission.phase).toBe('shadow');
    expect(body.allowed.reasons).not.toContain('rating.mismatch');
    for (const key of ['status', 'stamps', 'note', 'rejectReasons', 'dropped', 'claimedByMe']) expect(JSON.stringify(body)).not.toContain(`"${key}"`);
    const row = await env.DB.prepare('SELECT claimed_by FROM review_submissions WHERE id=?').bind(id).first<{ claimed_by: string | null }>();
    expect(row!.claimed_by).toBeNull();
    expect((await get(`/v1/review-ai/submissions/${id}`, 'human')).status).toBe(403);
  });

  it('已定案的單 7 天內可讀（試跑），超過就不給；讀到的仍不含人工決定', async () => {
    const { id } = await submitCard();
    await decide(id, humanId, 'reject');
    const res = await get(`/v1/review-ai/submissions/${id}`, 'agent');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.submission.phase).toBe('backfill');
    expect(JSON.stringify(body)).not.toContain('opening.no_reply_hook"]');
    await env.DB.prepare('UPDATE review_submissions SET submitted_at=? WHERE id=?').bind(Date.now() - 8 * 86_400_000, id).run();
    const old = await get(`/v1/review-ai/submissions/${id}`, 'agent');
    expect(old.status).toBe(410);
    expect((await json(old)).error).toBe('review_ai_window_closed');
  });

  it('審卡員的帳號不能蓋章', async () => {
    const { id } = await submitCard();
    const res = await send('POST', `/v1/review/${id}/claim`, 'agent', {});
    expect(res.status).toBe(403);
  });
});

describe('寫建議', () => {
  it('只記錄、不改送審狀態；同版本重寫覆蓋同一筆；標記不蓋掉結論', async () => {
    const { id } = await submitCard();
    const first = await suggest(id, { verdict: 'reject', reasons: ['opening.no_reply_hook'], flags: ['ai_unedited'], confidence: 0.8, note: '開場沒有接話點', inputTokens: 9000, outputTokens: 200, costUsd: 0.0005, latencyMs: 3200 });
    expect(first.status).toBe(200);
    expect(await status(id)).toBe('pending');
    expect((await suggest(id, { verdict: 'pass', confidence: 0.7 })).status).toBe(200);
    const tag = await send('PUT', `/v1/review-ai/submissions/${id}/tags`, 'agent', { criteriaVersion: 'v1', model: 'm', flags: ['copied_text'] });
    expect(tag.status).toBe(200);
    const rows = (await env.DB.prepare('SELECT verdict, flags, phase FROM review_ai_suggestions WHERE submission_id=?').bind(id).all()).results;
    expect(rows).toEqual([{ verdict: 'pass', flags: '["copied_text"]', phase: 'shadow' }]);
    expect((await suggest(id, { verdict: 'pass' }, 'human')).status).toBe(403);
  });

  it('不合規的建議擋下：不通過沒理由、清單外代碼、分級理由、信心超出範圍、判準版本格式', async () => {
    const { id } = await submitCard();
    for (const body of [
      { verdict: 'reject' },
      { verdict: 'reject', reasons: ['made.up'] },
      { verdict: 'reject', reasons: ['rating.mismatch'] },
      { verdict: 'pass', confidence: 1.5 },
      { verdict: 'pass', criteriaVersion: 'latest' },
      { verdict: 'maybe' },
    ]) {
      const res = await suggest(id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const handoff = await suggest(id, { verdict: 'handoff', handoffCause: 'refusal' });
    expect(handoff.status).toBe(200);
  });
});

describe('佇列', () => {
  it('unshadowed 只列還沒下結論的；count 只回數量；recent 含近 7 天已定案的', async () => {
    const a = await submitCard('draft-a');
    const b = await submitCard('draft-b');
    await decide(b.id, humanId, 'approve');
    const pending = await json(await get('/v1/review-ai/queue?unshadowed=1', 'agent'));
    expect(pending.items.map((i: any) => i.id)).toEqual([a.id]);
    expect(JSON.stringify(pending)).not.toContain('"status"');
    const recent = await json(await get('/v1/review-ai/queue?scope=recent&unshadowed=1&criteria=v1', 'agent'));
    expect(recent.items.map((i: any) => i.id).sort()).toEqual([a.id, b.id].sort());
    await suggest(a.id, { verdict: 'pass' });
    expect(await json(await get('/v1/review-ai/queue?unshadowed=1&count=1', 'agent'))).toEqual({ count: 0 });
    expect(await json(await get('/v1/review-ai/queue?unshadowed=1&criteria=v2&count=1', 'agent'))).toEqual({ count: 1 });
    expect((await get('/v1/review-ai/queue', 'human')).status).toBe(403);
  });
});

describe('雙盲與揭曉', () => {
  it('審核員自己決定前看不到；蓋章或不受理後才看得到，覆核寫成審核事件', async () => {
    const { id } = await submitCard();
    const { id: sid } = await json(await suggest(id, { verdict: 'reject', reasons: ['opening.exposition_only'], confidence: 0.9 }));
    const hidden = await get(`/v1/review/${id}/ai`, 'human');
    expect(hidden.status).toBe(403);
    expect((await json(hidden)).error).toBe('ai_hidden_until_decided');
    // 審核頁本身也不帶 AI 建議
    await claim(env.DB, id, humanId, Date.now());
    const detail = await get(`/v1/review/${id}/detail`, 'human');
    expect(JSON.stringify(await json(detail))).not.toContain('opening.exposition_only');
    await stamp(env.DB, { submissionId: id, memberId: humanId, verdict: 'approve', note: '', now: Date.now() });
    const shown = await json(await get(`/v1/review/${id}/ai`, 'human'));
    expect(shown.suggestions).toHaveLength(1);
    expect(shown.suggestions[0]).toMatchObject({ id: sid, verdict: 'reject', reasons: ['opening.exposition_only'] });
    const fb = await send('POST', `/v1/review/${id}/ai-feedback`, 'human', { suggestionId: sid, value: 'ai_wrong', operationId: crypto.randomUUID() });
    expect(fb.status).toBe(200);
    const ev = await env.DB.prepare("SELECT actor_kind, actor_member_id, source, ai_suggestion_id FROM review_events WHERE action='ai_feedback'").first();
    expect(ev).toEqual({ actor_kind: 'reviewer', actor_member_id: humanId, source: 'ai_wrong', ai_suggestion_id: sid });
    // 另一位沒參與的審核員仍看不到；管理員在定案後可看
    expect((await get(`/v1/review/${id}/ai`, 'agent')).status).toBe(403);
    expect((await get(`/v1/review/${id}/ai`, 'mgr')).status).toBe(200);
  });

  it('不受理也算做完決定', async () => {
    const { id } = await submitCard();
    await suggest(id, { verdict: 'pass' });
    expect((await get(`/v1/review/${id}/ai`, 'human')).status).toBe(403);
    await dropSubmission(env.DB, { submissionId: id, memberId: humanId, now: Date.now() });
    expect((await get(`/v1/review/${id}/ai`, 'human')).status).toBe(200);
  });
});

describe('對照報表', () => {
  it('人過 AI 不過算 AI 較嚴；一致率只算兩邊都下了結論的；只給管理員', async () => {
    const a = await submitCard('draft-a');
    const b = await submitCard('draft-b');
    const c = await submitCard('draft-c');
    await suggest(a.id, { verdict: 'reject', reasons: ['opening.no_reply_hook'], costUsd: 0.001, latencyMs: 1000 });
    await suggest(b.id, { verdict: 'reject', reasons: ['opening.no_reply_hook'], costUsd: 0.001, latencyMs: 3000 });
    await suggest(c.id, { verdict: 'handoff', handoffCause: 'refusal' });
    await decide(a.id, humanId, 'approve');
    await decide(b.id, humanId, 'reject');
    await decide(c.id, humanId, 'approve');
    expect((await get('/v1/review-ai/report', 'human')).status).toBe(403);
    const report = await json(await get('/v1/review-ai/report', 'mgr'));
    const v1 = report.versions.find((v: any) => v.criteriaVersion === 'v1');
    expect(v1).toMatchObject({ total: 3, comparable: 2, agreement: 0.5, aiStricter: 1, humanStricter: 0, avgLatencyMs: 2000, costUsd: 0.002 });
    expect(v1.matrix.approved).toEqual({ pass: 0, reject: 1, handoff: 1 });
    expect(v1.reasonAgreement['opening.no_reply_hook']).toEqual({ human: 1, ai: 1, both: 1 });
    expect(v1.refusalRate).toBeCloseTo(1 / 3);
  });
});

describe('卡片輸入', () => {
  it('省略號密度用全文算，世界書只取啟用的條目', () => {
    const input = aiCardInput({
      document: { roleDetailDesc: '她……看著你……'.repeat(10) },
      greetings: { welcome: '你好。' },
      worldbooks: [{ entries: [{ name: 'a', content: 'x', isEnabled: true }, { name: 'b', content: 'y', isEnabled: false }] }],
    }, { tags: [], fandom: '' });
    expect(input.stats.ellipsisPer1k).toBeGreaterThan(100);
    expect(input.card.lorebook.entryCount).toBe(1);
    expect(input.card.originalWork).toBeNull();
    expect(input.stats.openingQuestion).toBe(false);
  });
});
