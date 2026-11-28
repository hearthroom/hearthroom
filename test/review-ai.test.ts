import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERAL_RATING, bearer, identities, makeAgent, makeMember, makeReviewer, resetDb, restoreUpstream, role } from './helpers';
import { hostGateway, submitHosted } from '../src/hosting';
import { claim, pendingSubmissionOf, stamp } from '../src/review';
import { dropSubmission } from '../src/review-drop';
import { aiCardInput } from '../src/review-ai';
import { getCard } from '../src/cards';
import { upstream } from '../src/upstream';
import { opsMetrics } from '../src/ops-metrics';

// AI 審卡影子模式（任務 2026-11-23-ai-card-review）：審卡員只讀與寫建議，雙盲，審完才揭曉。
const AUTHOR = 10001, AGENT = 30001, HUMAN = 20001, MANAGER = 20002;
const KEY = 'a'.repeat(64);
let humanId = '', managerId = '';
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
/** 重跑 migration 裡建審卡員身分的那幾句（resetDb 會清掉成員與審核員表） */
async function seedReviewAgentIdentity() {
  const migration = (env as unknown as { TEST_MIGRATIONS: { name: string; queries: string[] }[] }).TEST_MIGRATIONS.find((m) => m.name.endsWith('_review_ai.sql') || m.name.endsWith('_review_ai'))!;
  for (const q of migration.queries.filter((q) => /_review_agent_identity_guard|system-review-agent/.test(q))) await env.DB.prepare(q).run();
}

beforeEach(async () => {
  await resetDb();
  identities({ agent: AGENT, human: HUMAN, mgr: MANAGER, author: AUTHOR });
  await makeAgent(AGENT);
  await seedReviewAgentIdentity();
  (env as { REVIEW_AGENT_CONFIG?: string }).REVIEW_AGENT_CONFIG = JSON.stringify({ memberId: 'system-review-agent', keySha256: await sha(KEY) });
  humanId = await makeReviewer(HUMAN);
  managerId = await makeReviewer(MANAGER);
  await env.DB.prepare("UPDATE reviewers SET role='manager' WHERE member_id=?").bind(managerId).run();
});
afterEach(() => { vi.restoreAllMocks(); restoreUpstream(); delete (env as { REVIEW_AGENT_CONFIG?: string }).REVIEW_AGENT_CONFIG; });

const SETTING = '她是車站的夜班站務員，說話慢、愛用敬語。'.repeat(700);
const WELCOME = '末班車剛走，月台上只剩你和她。「你也錯過了嗎？」她問。\n1. 點頭\n2. 搖頭';

async function submitCard(roleId = 'draft', author = AUTHOR) {
  const memberId = await makeMember(author);
  const draft = role({ roleId, authorNumId: author });
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
  await submitHosted(env, { memberId, account: author, role: draft, token: 'fixture', rating: GENERAL_RATING, operationId: crypto.randomUUID(), now: Date.now(), deviceHash: null });
  const s = (await pendingSubmissionOf(env.DB, (await getCard(env.DB, roleId, 'harbor'))!.id))!;
  return { id: s.id, sealed };
}

// 'key'＝審卡員的固定金鑰；其他是 Harbor 登入的帳號（'agent' 是留言審核那類一般 AI 審核帳號）
const auth = (token: string): Record<string, string> => (token === 'key' ? { 'X-Review-Agent-Key': KEY } : bearer(token));
const get = (path: string, token: string) => SELF.fetch(`https://c.test${path}`, { headers: auth(token) });
const send = (method: string, path: string, token: string, body: unknown) =>
  SELF.fetch(`https://c.test${path}`, { method, headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify(body) });
// AI 為主之後每張駁回都要附給作者的說明；測試沒特別指定時帶一段
const suggest = (id: string, body: Record<string, unknown>, token = 'key') =>
  send('PUT', `/v1/review-ai/submissions/${id}/suggestion`, token, { criteriaVersion: 'v1', model: 'deepseek/deepseek-v4.1-flash', ...(body.verdict === 'reject' && !('authorNote' in body) ? { authorNote: '開場停在描寫，請讓角色提出一件需要玩家回應的事。' } : {}), ...body });
const json = async (res: Response) => (await res.json()) as any;
const decide = async (id: string, member: string, verdict: 'approve' | 'reject') => {
  await claim(env.DB, id, member, Date.now());
  await stamp(env.DB, { submissionId: id, memberId: member, verdict, note: '', now: Date.now(), ...(verdict === 'reject' ? { reasons: ['opening.no_reply_hook'] } : {}) });
};
const status = async (id: string) => (await env.DB.prepare('SELECT status FROM review_submissions WHERE id=?').bind(id).first<{ status: string }>())!.status;

describe('審卡員讀卡', () => {
  it('讀待審單的封存內容，不領取、不帶人工決定；人類審核員不能用這條路', async () => {
    const { id } = await submitCard();
    const res = await get(`/v1/review-ai/submissions/${id}`, 'key');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.card.setting.length).toBeLessThanOrEqual(12_000 + 10);
    expect(body.card.setting.endsWith('…[截斷]')).toBe(true);
    expect(body.stats.settingChars).toBe(SETTING.length);
    expect(body.stats.openingChoices).toBe(true);
    expect(body.submission.phase).toBe('shadow');
    expect(body.author).toMatchObject({ batchSuspected: false });
    expect(body.allowed.reasons).not.toContain('rating.mismatch');
    for (const key of ['status', 'stamps', 'note', 'rejectReasons', 'dropped', 'claimedByMe']) expect(JSON.stringify(body)).not.toContain(`"${key}"`);
    const row = await env.DB.prepare('SELECT claimed_by FROM review_submissions WHERE id=?').bind(id).first<{ claimed_by: string | null }>();
    expect(row!.claimed_by).toBeNull();
    expect((await get(`/v1/review-ai/submissions/${id}`, 'human')).status).toBe(403);
  });

  it('已定案的單 7 天內可讀可寫（試跑），超過只讀不寫；讀到的仍不含人工決定', async () => {
    const { id } = await submitCard();
    await decide(id, humanId, 'reject');
    const res = await get(`/v1/review-ai/submissions/${id}`, 'key');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.submission.phase).toBe('backfill');
    // 作者標記是現在算的、會含這張單自己的結果：已定案的單不給；行為訊號算到送審那一刻，照給
    expect(body.author).toMatchObject({ tier: null, batchSuspected: null });
    expect(JSON.stringify(body)).not.toContain('opening.no_reply_hook"]');
    await env.DB.prepare('UPDATE review_submissions SET submitted_at=? WHERE id=?').bind(Date.now() - 8 * 86_400_000, id).run();
    // 超過 7 天：讀照給（phase=closed，查作者其他卡用），寫建議擋下
    const old = await get(`/v1/review-ai/submissions/${id}`, 'key');
    expect(old.status).toBe(200);
    expect((await json(old)).submission.phase).toBe('closed');
    const write = await suggest(id, { verdict: 'pass' });
    expect(write.status).toBe(410);
    expect((await json(write)).error).toBe('review_ai_window_closed');
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
    const tag = await send('PUT', `/v1/review-ai/submissions/${id}/tags`, 'key', { criteriaVersion: 'v1', model: 'm', flags: ['copied_text'] });
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

  it('只接受明確的品質原因交給人工，並用固定說明保護交人工欄位', async () => {
    const { id } = await submitCard();
    const detail = await json(await get(`/v1/review-ai/submissions/${id}`, 'key'));
    const badReasons = [[], ['unrelated'], ['opening.no_reply_hook'], ['quality_evidence', 'update_diff_unavailable']];
    for (const reasons of badReasons) {
      const res = await suggest(id, { verdict: 'handoff', handoffCause: 'unsure', reasons, note: 'Unrelated assessment' });
      expect(res.status).toBe(400);
      expect(await json(res)).toMatchObject({
        error: 'review_unsure_reason_required',
        detail: { field: 'reasons', hint: expect.stringContaining('pass') },
      });
    }
    expect((await suggest(id, { verdict: 'handoff' })).status).toBe(400);
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM review_ai_suggestions WHERE submission_id=?').bind(id).first('n')).toBe(0);
    expect(detail.allowed.handoffReasons).toEqual(['quality_evidence', 'suspected_template', 'update_diff_unavailable']);
    for (const reason of detail.allowed.handoffReasons) {
      const res = await suggest(id, { verdict: 'handoff', handoffCause: 'unsure', reasons: [reason], note: 'Unrelated assessment' });
      expect(res.status).toBe(200);
      const row = await env.DB.prepare('SELECT verdict, reasons, note FROM review_ai_suggestions WHERE submission_id=?').bind(id).first();
      expect(row).toMatchObject({ verdict: 'handoff', reasons: JSON.stringify([reason]), note: expect.any(String) });
      expect(row?.note).not.toBe('Unrelated assessment');
    }
    expect(await status(id)).toBe('pending');
    expect((await suggest(id, { verdict: 'reject', reasons: ['quality_evidence'] })).status).toBe(400);
    expect((await suggest(id, { verdict: 'handoff', handoffCause: 'timeout' })).status).toBe(200);
    const metrics = await opsMetrics(env.DB);
    expect(metrics).toContain('hearthroom_review_ai_unsure_total{operation="suggest",outcome="invalid_reason"} 5');
    expect(metrics).toContain('hearthroom_review_ai_unsure_total{operation="suggest",outcome="saved"} 3');
  });
});

describe('佇列', () => {
  it('unshadowed 只列還沒下結論的；count 只回數量；recent 含近 7 天已定案的', async () => {
    const a = await submitCard('draft-a');
    const b = await submitCard('draft-b');
    await decide(b.id, humanId, 'approve');
    const pending = await json(await get('/v1/review-ai/queue?unshadowed=1', 'key'));
    expect(pending.items.map((i: any) => i.id)).toEqual([a.id]);
    expect(JSON.stringify(pending)).not.toContain('"status"');
    const recent = await json(await get('/v1/review-ai/queue?scope=recent&unshadowed=1&criteria=v1', 'key'));
    expect(recent.items.map((i: any) => i.id).sort()).toEqual([a.id, b.id].sort());
    await suggest(a.id, { verdict: 'pass' });
    expect(await json(await get('/v1/review-ai/queue?unshadowed=1&count=1', 'key'))).toEqual({ count: 0 });
    expect(await json(await get('/v1/review-ai/queue?unshadowed=1&criteria=v2&count=1', 'key'))).toEqual({ count: 1 });
    expect((await get('/v1/review-ai/queue', 'human')).status).toBe(403);
  });
});

describe('雙盲與揭曉', () => {
  it('AI 為主（owner 11-24）：待審單一進來就看得到 AI 建議；定案後本人與管理員也看得到', async () => {
    const { id } = await submitCard();
    const { id: sid } = await json(await suggest(id, { verdict: 'reject', reasons: ['opening.exposition_only'], confidence: 0.9 }));
    const visible = await get(`/v1/review/${id}/ai`, 'human');
    expect(visible.status).toBe(200);
    expect((await json(visible)).suggestions).toHaveLength(1);
    // 審核頁本身也不帶 AI 建議
    await claim(env.DB, id, humanId, Date.now());
    const detail = await get(`/v1/review/${id}/detail`, 'human');
    expect(JSON.stringify(await json(detail))).not.toContain('opening.exposition_only');
    await stamp(env.DB, { submissionId: id, memberId: humanId, verdict: 'approve', note: '', now: Date.now() });
    const shown = await json(await get(`/v1/review/${id}/ai`, 'human'));
    expect(shown.suggestions).toHaveLength(1);
    expect(shown.suggestions[0]).toMatchObject({ id: sid, verdict: 'reject', reasons: ['opening.exposition_only'] });
    // 揭曉後的覆核三選項已退場（ui-ai-first.md）：路由不在了；回應改帶我對 AI 的標記
    expect((await send('POST', `/v1/review/${id}/ai-feedback`, 'human', { suggestionId: sid, value: 'ai_wrong', operationId: crypto.randomUUID() })).status).toBe(404);
    expect(shown.myFeedback).toBeUndefined();
    expect(shown.inaccurate).toBe(false);
    // 另一位沒參與的審核員仍看不到；管理員在定案後可看
    expect((await get(`/v1/review/${id}/ai`, 'agent')).status).toBe(403);
    expect((await get(`/v1/review/${id}/ai`, 'mgr')).status).toBe(200);
  });

  it('不受理也算做完決定', async () => {
    const { id } = await submitCard();
    await suggest(id, { verdict: 'pass' });
    expect((await get(`/v1/review/${id}/ai`, 'human')).status).toBe(200); // AI 為主：待審單直接看得到 AI 建議
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
    const d = await submitCard('draft-d', 10002);
    await suggest(d.id, { verdict: 'reject', reasons: ['opening.too_short'] });
    expect((await get('/v1/review-ai/report', 'human')).status).toBe(403);
    const report = await json(await get('/v1/review-ai/report', 'mgr'));
    const v1 = report.versions.find((v: any) => v.criteriaVersion === 'v1');
    expect(v1).toMatchObject({ total: 3, comparable: 2, agreement: 0.5, aiStricter: 1, humanStricter: 0, avgLatencyMs: 2000, costUsd: 0.002 });
    expect(v1.matrix.approved).toEqual({ pass: 0, reject: 1, handoff: 1 });
    // 還在待審的 d 不進報表（不能提前從報表看到 AI 對待審卡的判斷）
    expect(v1.matrix.pending).toBeUndefined();
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

describe('審卡員服務金鑰', () => {
  const withKey = (path: string, key = KEY, extra: Record<string, string> = {}) => SELF.fetch(`https://c.test${path}`, { headers: { 'X-Review-Agent-Key': key, ...extra } });

  it('資料庫裡有專用的審卡員身分：審核員＋AI 審核帳號，沒有登入身分', async () => {
    const row = await env.DB.prepare(`SELECT m.handle,
      EXISTS(SELECT 1 FROM reviewers r WHERE r.member_id=m.id AND r.revoked_at IS NULL AND r.role='reviewer') AS reviewer,
      EXISTS(SELECT 1 FROM review_agents a WHERE a.member_id=m.id AND a.revoked_at IS NULL) AS agent,
      EXISTS(SELECT 1 FROM member_identities i WHERE i.member_id=m.id) AS login
      FROM members m WHERE m.id='system-review-agent'`).first();
    expect(row).toEqual({ handle: 'sukirevw', reviewer: 1, agent: 1, login: 0 });
  });

  it('固定金鑰不必登入就能用審卡員的路由，寫的建議記在專用身分下', async () => {
    const { id } = await submitCard();
    expect((await withKey('/v1/review-ai/queue?unshadowed=1')).status).toBe(200);
    expect((await withKey(`/v1/review-ai/submissions/${id}`)).status).toBe(200);
    const res = await SELF.fetch(`https://c.test/v1/review-ai/submissions/${id}/suggestion`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Review-Agent-Key': KEY }, body: JSON.stringify({ criteriaVersion: 'v1', model: 'm', verdict: 'pass' }) });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare('SELECT agent_member_id FROM review_ai_suggestions WHERE submission_id=?').bind(id).first<{ agent_member_id: string }>();
    expect(row!.agent_member_id).toBe('system-review-agent');
  });

  it('錯的金鑰、瀏覽器來源、沒設定、身分被撤銷都擋下；金鑰在其他路由無效', async () => {
    const { id } = await submitCard();
    expect((await withKey('/v1/review-ai/queue', 'b'.repeat(64))).status).toBe(403);
    expect((await withKey('/v1/review-ai/queue', KEY, { Origin: 'https://sukisuki.ai' })).status).toBe(403);
    expect((await withKey(`/v1/review/${id}/detail`)).status).toBe(401);
    expect((await withKey('/v1/review-ai/report')).status).toBe(401);
    // 其他 AI 審核帳號（例如留言審核）不能讀卡片私有設定
    expect((await get('/v1/review-ai/queue', 'agent')).status).toBe(403);
    expect((await get(`/v1/review-ai/submissions/${id}`, 'agent')).status).toBe(403);
    await env.DB.prepare("UPDATE review_agents SET revoked_at=? WHERE member_id='system-review-agent'").bind(Date.now()).run();
    expect((await withKey('/v1/review-ai/queue')).status).toBe(403);
    delete (env as { REVIEW_AGENT_CONFIG?: string }).REVIEW_AGENT_CONFIG;
    expect((await withKey('/v1/review-ai/queue')).status).toBe(403);
  });
});

describe('AI 分歧仲裁', () => {
  const arbitrate = (sid: string, body: Record<string, unknown>, token = 'mgr') =>
    send('POST', `/v1/review-ai/disagreements/${sid}/arbitration`, token, { operationId: crypto.randomUUID(), ...body });
  async function setup() {
    const a = await submitCard('draft-a');
    const b = await submitCard('draft-b');
    const c = await submitCard('draft-c');
    const sa = (await json(await suggest(a.id, { verdict: 'reject', reasons: ['opening.no_reply_hook'] }))).id;
    const sb = (await json(await suggest(b.id, { verdict: 'pass' }))).id;
    await suggest(c.id, { verdict: 'pass' });
    await decide(a.id, humanId, 'approve');
    await decide(b.id, humanId, 'reject');
    await decide(c.id, humanId, 'approve');
    return { a, b, c, sa, sb };
  }

  it('清單只列人機相反的單，標出方向；審核員都能用（owner 11-24），但看不到審核員名字、看不到自己寫的卡', async () => {
    const { sa, sb } = await setup();
    const asReviewer = await json(await get('/v1/review-ai/disagreements', 'human'));
    expect(asReviewer.total).toBe(2);
    const detail = await json(await get(`/v1/review-ai/disagreements/${sa}`, 'human'));
    expect(detail.human.stamps[0].reviewer).toBeNull();
    expect((await send('POST', `/v1/review-ai/disagreements/${sa}/arbitration`, 'human', { value: 'human_right', operationId: crypto.randomUUID() })).status).toBe(200);
    // 報表與參考範例匯出仍限管理員
    expect((await get('/v1/review-ai/report', 'human')).status).toBe(403);
    expect((await get('/v1/review-ai/reference-candidates', 'human')).status).toBe(403);
    // 作者自己也是審核員時，自己的卡不出現、也不能仲裁
    identities({ agent: AGENT, human: HUMAN, mgr: MANAGER, author: AUTHOR });
    await makeReviewer(AUTHOR);
    expect((await json(await get('/v1/review-ai/disagreements?state=all', 'author'))).total).toBe(0);
    expect((await get(`/v1/review-ai/disagreements/${sa}`, 'author')).status).toBe(404);
    expect((await send('POST', `/v1/review-ai/disagreements/${sa}/arbitration`, 'author', { value: 'ai_right', operationId: crypto.randomUUID() })).status).toBe(404);
    const list = await json(await get('/v1/review-ai/disagreements?state=all', 'mgr'));
    expect(list.total).toBe(2);
    expect(Object.fromEntries(list.items.map((i: any) => [i.suggestionId, i.direction]))).toEqual({ [sa]: 'ai_stricter', [sb]: 'human_stricter' });
    const stricter = await json(await get('/v1/review-ai/disagreements?state=all&direction=ai_stricter&reason=opening.no_reply_hook', 'mgr'));
    expect(stricter.items.map((i: any) => i.suggestionId)).toEqual([sa]);
  });

  it('單筆並排：卡片內容、人工（含審核員名字）、AI；仲裁不改原決定，待仲裁清單少一筆', async () => {
    const { a, sa } = await setup();
    const detail = await json(await get(`/v1/review-ai/disagreements/${sa}`, 'mgr'));
    expect(detail.content.state).toBe('ready');
    expect(detail.content.card.setting.length).toBeGreaterThan(0);
    expect(detail.human.decision).toBe('approved');
    expect(detail.human.stamps).toHaveLength(1);
    expect(detail.human.stamps[0].reviewer).toBeTruthy();
    expect(detail.ai).toMatchObject({ verdict: 'reject', reasons: ['opening.no_reply_hook'] });
    const res = await arbitrate(sa, { value: 'ai_right', addToReference: true, note: '開場確實停在旁白' });
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ value: 'ai_right', referencePool: 'reject' });
    expect(await status(a.id)).toBe('approved');
    const open = await json(await get('/v1/review-ai/disagreements', 'mgr'));
    expect(open.items.map((i: any) => i.suggestionId)).not.toContain(sa);
    const ev = await env.DB.prepare("SELECT actor_kind, source, ai_suggestion_id FROM review_events WHERE action='ai_arbitration'").first();
    expect(ev).toEqual({ actor_kind: 'reviewer', source: 'ai_right', ai_suggestion_id: sa });
  });

  it('駁回後改判為通過（版本列轉給改判單）：自己寫的卡照樣排除、卡名照樣顯示', async () => {
    const { b, sb } = await setup();
    // 模擬改判通過：新的一張改判單通過，版本列從原本的駁回單轉過去
    const flip = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO review_submissions (id,card_id,provider,source_role_id,kind,status,content_hash,submitted_at,decided_at,flip_of,flip_by)
      SELECT ?,card_id,provider,source_role_id,kind,'approved',content_hash,?,?,id,? FROM review_submissions WHERE id=?`).bind(flip, Date.now(), Date.now(), managerId, b.id).run();
    await env.DB.prepare('UPDATE hosting_versions SET submission_id=? WHERE submission_id=?').bind(flip, b.id).run();
    const item = (await json(await get('/v1/review-ai/disagreements', 'mgr'))).items.find((i: any) => i.suggestionId === sb);
    expect(item.name).not.toBe('');
    await makeReviewer(AUTHOR);
    expect((await json(await get('/v1/review-ai/disagreements', 'author'))).items.map((i: any) => i.suggestionId)).not.toContain(sb);
    expect((await get(`/v1/review-ai/disagreements/${sb}`, 'author')).status).toBe(404);
    expect((await send('PUT', `/v1/review-ai/disagreements/${sb}/persuasion`, 'author', { value: 'convinced' })).status).toBe(404);
    const authorMember = (await env.DB.prepare('SELECT member_id FROM hosting_versions WHERE submission_id=?').bind(flip).first<{ member_id: string }>())!.member_id;
    await env.DB.prepare("UPDATE reviewers SET role='manager' WHERE member_id=?").bind(authorMember).run();
    expect((await arbitrate(sb, { value: 'human_right' }, 'author')).status).toBe(404);
  });

  it('同一個操作重送不重複寫；都說得通不能加入參考範例；一致的單不能仲裁', async () => {
    const { sa, c } = await setup();
    const op = crypto.randomUUID();
    expect((await arbitrate(sa, { value: 'human_right', operationId: op })).status).toBe(200);
    expect((await arbitrate(sa, { value: 'human_right', operationId: op })).status).toBe(200);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM review_ai_arbitrations').first<{ n: number }>())!.n).toBe(1);
    expect((await arbitrate(sa, { value: 'ai_right', operationId: op })).status).toBe(409);
    expect((await arbitrate(sa, { value: 'both_ok', addToReference: true })).status).toBe(400);
    const agreed = await env.DB.prepare('SELECT id FROM review_ai_suggestions WHERE submission_id=?').bind(c.id).first<{ id: string }>();
    expect((await arbitrate(agreed!.id, { value: 'human_right' })).status).toBe(404);
  });

  it('參考範例草稿取最後一次仲裁的池；報表有仲裁分佈與各理由的人錯／AI 錯', async () => {
    const { sa, sb } = await setup();
    await arbitrate(sa, { value: 'ai_right', addToReference: true });
    await arbitrate(sb, { value: 'human_right', addToReference: true });
    // 重新仲裁 b、不再勾：草稿裡就沒有它
    await arbitrate(sb, { value: 'both_ok' });
    const refs = await json(await get('/v1/review-ai/reference-candidates', 'mgr'));
    expect(refs.items).toHaveLength(1);
    expect(refs.items[0]).toMatchObject({ verdict: 'reject', reasons: ['opening.no_reply_hook'], why: '' });
    expect(refs.items[0].excerpt.opening.length).toBeGreaterThan(0);
    expect(JSON.stringify(refs)).not.toMatch(/member-|submission|draft-/);
    const report = await json(await get('/v1/review-ai/report', 'mgr'));
    const v1 = report.versions.find((v: any) => v.criteriaVersion === 'v1');
    expect(v1.arbitration.values).toEqual({ human_right: 0, ai_right: 1, both_ok: 1, both_wrong: 0 });
    expect(v1.arbitration.reasons['opening.no_reply_hook']).toEqual({ humanWrong: 1, aiWrong: 0 });
  });
});

describe('AI 說服你了嗎（owner 2026-11-24）', () => {
  const persuade = (sid: string, value: unknown, token = 'human') => send('PUT', `/v1/review-ai/disagreements/${sid}/persuasion`, token, { value });
  async function setup() {
    const a = await submitCard('draft-a');
    const c = await submitCard('draft-c');
    const sa = (await json(await suggest(a.id, { verdict: 'reject', reasons: ['opening.no_reply_hook'] }))).id;
    const sc = (await json(await suggest(c.id, { verdict: 'pass' }))).id;
    await decide(a.id, humanId, 'approve');
    await decide(c.id, humanId, 'approve');
    return { a, sa, sc };
  }
  const rows = async () => (await env.DB.prepare('SELECT suggestion_id, member_id, value FROM review_ai_persuasion ORDER BY member_id').all()).results;

  it('評一次、改選、重送同一個選擇都只有一列，取最後一次；不動仲裁、不寫審核事件、仍是待仲裁', async () => {
    const { sa } = await setup();
    expect((await json(await get(`/v1/review-ai/disagreements/${sa}`, 'human'))).myPersuasion).toBeNull();
    const first = await persuade(sa, 'convinced');
    expect(first.status).toBe(200);
    expect(await json(first)).toMatchObject({ value: 'convinced' });
    expect((await persuade(sa, 'not_convinced')).status).toBe(200);
    expect((await persuade(sa, 'not_convinced')).status).toBe(200);
    expect(await rows()).toEqual([{ suggestion_id: sa, member_id: humanId, value: 'not_convinced' }]);
    expect((await json(await get(`/v1/review-ai/disagreements/${sa}`, 'human'))).myPersuasion).toBe('not_convinced');
    expect((await persuade(sa, 'maybe')).status).toBe(400);
    expect((await persuade(sa, undefined)).status).toBe(400);
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM review_ai_arbitrations').first<{ n: number }>())!.n).toBe(0);
    // 審卡員寫結論時的快速通道判定事件也帶建議編號（review-fast-track.ts），評說服不另寫事件
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM review_events WHERE ai_suggestion_id=? AND action<>'fast_track_check'").bind(sa).first<{ n: number }>())!.n).toBe(0);
    expect((await json(await get('/v1/review-ai/disagreements', 'human'))).items.map((i: any) => i.suggestionId)).toContain(sa);
    const metrics = await opsMetrics(env.DB);
    expect(metrics).toContain('hearthroom_review_ai_operations_total{operation="persuade",outcome="success"} 3');
    expect(metrics).toContain('hearthroom_review_ai_operations_total{operation="persuade",outcome="rejected"} 2');
  });

  it('能打開這筆分歧的審核員都能評，各算各的；只回自己的選擇；自己的卡、不是分歧、不是審核員都不行', async () => {
    const { sa, sc } = await setup();
    await persuade(sa, 'convinced', 'human');
    await persuade(sa, 'not_convinced', 'mgr');
    expect((await rows()).map((r: any) => r.value).sort()).toEqual(['convinced', 'not_convinced']);
    expect((await json(await get(`/v1/review-ai/disagreements/${sa}`, 'human'))).myPersuasion).toBe('convinced');
    expect((await json(await get(`/v1/review-ai/disagreements/${sa}`, 'mgr'))).myPersuasion).toBe('not_convinced');
    expect((await persuade(sc, 'convinced')).status).toBe(404);
    expect((await persuade('nope', 'convinced')).status).toBe(404);
    expect((await persuade(sa, 'convinced', 'author')).status).toBe(403);
    expect((await persuade(sa, 'convinced', 'key')).status).toBe(401);
    await makeReviewer(AUTHOR);
    expect((await persuade(sa, 'convinced', 'author')).status).toBe(404);
    expect(await rows()).toHaveLength(2);
  });

  it('清單帶本週（UTC 週）被說服比例：不受篩選影響，上週的不算，已判不到 10 筆標樣本不足', async () => {
    const { sa } = await setup();
    await persuade(sa, 'convinced');
    let week = (await json(await get('/v1/review-ai/disagreements?state=done&criteria=v9', 'human'))).persuasion;
    const monday = new Date(week.weekStart);
    expect(monday.getUTCDay()).toBe(1);
    expect(monday.getUTCHours()).toBe(0);
    expect(Date.now() - week.weekStart).toBeLessThan(7 * 86_400_000);
    expect(week).toMatchObject({ convinced: 1, rated: 1, suppressed: true });
    // 再補 10 位審核員本週、1 位上週對同一筆分歧的選擇（直接寫表，只看統計口徑）
    const now = Date.now();
    const at = (await env.DB.prepare('SELECT updated_at FROM review_ai_suggestions WHERE id=?').bind(sa).first<{ updated_at: number }>())!.updated_at;
    const sub = (await env.DB.prepare('SELECT submission_id FROM review_ai_suggestions WHERE id=?').bind(sa).first<{ submission_id: string }>())!.submission_id;
    for (let i = 0; i < 10; i++) {
      await env.DB.prepare('INSERT INTO review_ai_persuasion (suggestion_id,member_id,submission_id,value,created_at,updated_at,suggestion_at) VALUES (?,?,?,?,?,?,?)')
        .bind(sa, `m-${i}`, sub, i < 4 ? 'convinced' : 'not_convinced', now, now, at).run();
    }
    await env.DB.prepare('INSERT INTO review_ai_persuasion (suggestion_id,member_id,submission_id,value,created_at,updated_at,suggestion_at) VALUES (?,?,?,?,?,?,?)')
      .bind(sa, 'm-old', sub, 'convinced', week.weekStart - 1, week.weekStart - 1, at).run();
    week = (await json(await get('/v1/review-ai/disagreements', 'human'))).persuasion;
    expect(week).toMatchObject({ convinced: 5, rated: 11, suppressed: false });
  });

  it('AI 重判（同一筆建議覆寫）後，之前的選擇不再算：我的選擇回到未評，本週與報表都不計', async () => {
    const { a, sa } = await setup();
    await persuade(sa, 'convinced');
    expect((await json(await get('/v1/review-ai/disagreements', 'human'))).persuasion).toMatchObject({ rated: 1 });
    await env.DB.prepare('UPDATE review_ai_suggestions SET updated_at=updated_at+1000, reasons=? WHERE id=?').bind('["opening.too_short"]', sa).run();
    expect((await json(await get(`/v1/review-ai/disagreements/${sa}`, 'human'))).myPersuasion).toBeNull();
    expect((await json(await get('/v1/review-ai/disagreements', 'human'))).persuasion).toMatchObject({ rated: 0 });
    expect((await json(await get('/v1/review-ai/report', 'mgr'))).versions.find((v: any) => v.criteriaVersion === 'v1').persuasion).toEqual({ convinced: 0, rated: 0 });
    expect((await persuade(sa, 'not_convinced')).status).toBe(200);
    expect((await json(await get(`/v1/review-ai/disagreements/${sa}`, 'human'))).myPersuasion).toBe('not_convinced');
    void a;
  });

  it('已不是分歧的（例如之後被改判）不算進本週與報表', async () => {
    const { a, sa } = await setup();
    await persuade(sa, 'convinced');
    // AI 那邊改成通過（跟人工一致），這筆就不再是分歧
    await env.DB.prepare("UPDATE review_ai_suggestions SET verdict='pass', reasons='[]' WHERE id=?").bind(sa).run();
    void a;
    expect((await json(await get('/v1/review-ai/disagreements', 'human'))).persuasion).toMatchObject({ rated: 0 });
    expect((await json(await get('/v1/review-ai/report', 'mgr'))).versions.find((v: any) => v.criteriaVersion === 'v1').persuasion ?? { rated: 0 }).toMatchObject({ rated: 0 });
  });

  it('報表每個判準版本帶被說服筆數（沒仲裁過也有），每人每筆取最後一次', async () => {
    const { sa } = await setup();
    await persuade(sa, 'convinced', 'human');
    await persuade(sa, 'not_convinced', 'human');
    await persuade(sa, 'convinced', 'mgr');
    const v1 = (await json(await get('/v1/review-ai/report', 'mgr'))).versions.find((v: any) => v.criteriaVersion === 'v1');
    expect(v1.arbitration).toBeNull();
    expect(v1.persuasion).toEqual({ convinced: 1, rated: 2 });
  });
});

describe('AI 讀卡的開場網頁與新理由', () => {
  it('開場網頁只留玩家看得到的字；新的兩個駁回理由可以用', async () => {
    const input = aiCardInput({
      document: {}, greetings: { welcome: '' },
      authorAsset: { openingMode: 'page', openingPage: '<style>.x{}</style><div class="x">清晨的訓練場</div><button>認真對練</button><script>alert(1)</script>' },
    }, { tags: [], fandom: '' });
    expect(input.card.openings.mode).toBe('page');
    expect(input.card.openings.page).toBe('清晨的訓練場\n認真對練');
    const { id } = await submitCard();
    expect((await suggest(id, { verdict: 'reject', reasons: ['opening.unedited_generated', 'character.copied_verbatim'] })).status).toBe(200);
  });
});

describe('不受理後復原', () => {
  // AI 為主之後看過 AI 再決定是正常流程（不再有「看過才蓋章」的排除），這種單照樣進對照報表與分歧清單
  it('不受理→看 AI→復原→蓋章的單照樣進對照報表與分歧清單', async () => {
    const { id } = await submitCard();
    await suggest(id, { verdict: 'reject', reasons: ['opening.too_short'] });
    await dropSubmission(env.DB, { submissionId: id, memberId: humanId, now: Date.now() });
    expect((await get(`/v1/review/${id}/ai`, 'human')).status).toBe(200);
    await env.DB.prepare('UPDATE review_drops SET restored_at=?, restored_by=? WHERE submission_id=?').bind(Date.now(), humanId, id).run();
    expect((await get(`/v1/review/${id}/ai`, 'human')).status).toBe(200); // AI 為主：待審單直接看得到 AI 建議
    await new Promise((r) => setTimeout(r, 5));
    await decide(id, humanId, 'approve');
    const report = await json(await get('/v1/review-ai/report', 'mgr'));
    expect(report.versions.find((v: any) => v.criteriaVersion === 'v1').matrix.approved.reject).toBe(1);
    expect((await json(await get('/v1/review-ai/disagreements?state=all', 'mgr'))).total).toBe(1);
  });
});

describe('仲裁：不受理中的單與改判', () => {
  it('不受理中（仍待審）的單不進分歧清單，管理員看不到 AI 判斷', async () => {
    const { id } = await submitCard();
    await suggest(id, { verdict: 'pass' });
    await dropSubmission(env.DB, { submissionId: id, memberId: humanId, now: Date.now() });
    expect((await json(await get('/v1/review-ai/disagreements?state=all', 'mgr'))).total).toBe(0);
  });

  it('仲裁後兩邊不再相反（審卡員改判成交人），仲裁仍找得到，統計照仲裁當時的方向與理由', async () => {
    const { id } = await submitCard();
    const sid = (await json(await suggest(id, { verdict: 'reject', reasons: ['opening.no_reply_hook'] }))).id;
    await decide(id, humanId, 'approve');
    const res = await send('POST', `/v1/review-ai/disagreements/${sid}/arbitration`, 'mgr', { value: 'ai_right', operationId: crypto.randomUUID() });
    expect(res.status).toBe(200);
    // 審卡員同一版判準重寫成交人：現在已經不算分歧（重新審核改判也會這樣）
    await suggest(id, { verdict: 'handoff', handoffCause: 'unsure', reasons: ['quality_evidence'] });
    const done = await json(await get('/v1/review-ai/disagreements?state=done', 'mgr'));
    expect(done.items.map((i: any) => [i.suggestionId, i.direction, i.human.decision])).toEqual([[sid, 'ai_stricter', 'approved']]);
    expect((await get(`/v1/review-ai/disagreements/${sid}`, 'mgr')).status).toBe(200);
    const v1 = (await json(await get('/v1/review-ai/report', 'mgr'))).versions.find((v: any) => v.criteriaVersion === 'v1');
    expect(v1.arbitration.reasons).toEqual({ 'opening.no_reply_hook': { humanWrong: 1, aiWrong: 0 } });
  });
});

describe('判準 v4 的讀卡輸入', () => {
  it('長 HTML 替換仍留下開場文字，依序套用規則並摘要備選開場與開場網頁', () => {
    const input = aiCardInput({
      greetings: { welcome: '[scene]', alternates: ['[ALT]'] },
      authorAsset: {
        openingMode: 'greeting',
        openingPage: '<section><h2>作者說明</h2><button>開始</button></section>',
        rules: [
          { find: '/\\[SCENE\\]/i', replace: `<style>${'.unused{color:blue}'.repeat(100)}</style><section><h2>角色介紹</h2><aside>狀態欄：夜班</aside><button>[CHOOSE]</button></section>` },
          { find: '[CHOOSE]', replace: '替車掌驗票' },
          { find: '[ALT]', replace: '<article>上月台找列車長</article>' },
          { find: '替車掌驗票', replace: '只給模型', promptOnly: true },
          { find: '替車掌驗票', replace: '玩家訊息專用', targets: ['user'] },
        ],
      },
    }, { tags: [], fandom: '' }, { applyRules: true });
    expect(input.card.openings.welcomeRendered).toBe('角色介紹\n狀態欄：夜班\n替車掌驗票');
    expect(input.card.openings.alternatesRendered).toEqual(['上月台找列車長']);
    expect(input.card.openings.presentation).toMatchObject({
      welcome: { source: 'display_rules', coverage: 'complete', structure: { headings: 1, controls: 1, characterIntro: true, statusPanel: true } },
      page: { coverage: 'complete', structure: { headings: 1, controls: 1 } },
    });
    expect(input.stats.openingRuleHits).toBe(3);
  });

  it('世界書目錄（常駐／召回、是否在卡裡提到）、顯示規則摘要、開場選項；開場被規則替換時給套用後的純文字', () => {
    const input = aiCardInput({
      document: { roleDetailDesc: '她是車站站務員，常去月台。' },
      greetings: { welcome: '<status hp="80" mood="緊張"></status>末班車到了。', prologue: ['上車', '留下'] },
      worldbooks: [{ entries: [
        { name: '月台', content: '終點站的月台。', isEnabled: true, isConstant: true, keywords: [] },
        { name: '列車長', content: 'x'.repeat(50), isEnabled: true, isConstant: false, keywords: ['列車長', '車長'] },
        { name: '停用', content: 'y', isEnabled: false },
      ] }],
      authorAsset: { rules: [
        { name: '狀態欄', find: '/<status hp="(\\d+)" mood="([^"]+)"><\\/status>/', replace: '<div>生命 $1｜心情 $2</div>', enabled: true },
        { name: '壞掉的', find: '/(/', replace: '', enabled: true },
        { name: '關掉的', find: '末班車', replace: '刪掉', enabled: false },
        // 目前的摘錄引擎不支援前瞻，並標示證據可能不完整。
        { name: '危險的', find: '/到(?=了)/', replace: 'X', enabled: true },
      ], cardCss: '.a{}' },
    }, { tags: [], fandom: '' }, { applyRules: true });
    expect(input.card.lorebook).toMatchObject({ entryCount: 2, constantCount: 1, recallCount: 1 });
    expect(input.card.lorebook.index).toEqual([
      { name: '月台', chars: 7, constant: true, keywords: 0, mentionedInCard: true },
      { name: '列車長', chars: 50, constant: false, keywords: 2, mentionedInCard: false },
    ]);
    expect(input.card.rules).toMatchObject({ count: 4, enabled: 3, hasCardCss: true });
    expect(input.card.rules.list.map((r) => r.name)).toEqual(['狀態欄', '壞掉的', '危險的']);
    expect(input.stats.openingRuleHits).toBe(1);
    expect(input.stats.openingOptions).toBe(2);
    expect(input.card.openings.welcomeRendered).toBe('生命 80｜心情 緊張\n末班車到了。');
    expect(input.card.openings.prologue).toEqual(['上車', '留下']);
    // 審卡員以外的路由不執行作者的規則
    const plain = aiCardInput({ greetings: { welcome: '<status hp="1" mood="x"></status>' }, authorAsset: { rules: [{ name: 'a', find: 'status', replace: 'b' }] } }, { tags: [], fandom: '' });
    expect(plain.stats.openingRuleHits).toBeNull();
    expect(plain.card.openings.welcomeRendered).toBeNull();
  });

  it('作者行為訊號算到送審那一刻；已定案的單不給作者標記，但照樣給訊號', async () => {
    const { id } = await submitCard();
    await decide(id, humanId, 'approve');
    const body = await json(await get(`/v1/review-ai/submissions/${id}`, 'key'));
    expect(body.author).toMatchObject({ tier: null, batchSuspected: null, submissions7d: 1, priorApproved: 0 });
    expect(typeof body.author.registrations7d).toBe('number');
    // 只有數字、布林或 null，沒有任何識別碼
    for (const v of Object.values(body.author)) expect(v === null || typeof v === 'number' || typeof v === 'boolean' || (Array.isArray(v) && v.every((x) => x === null || typeof x === 'number'))).toBe(true);
    // 額度：送審前 7 天登記滿每週上限（禮包登記不算）就算用滿；送審之後的登記不算
    const sub = (await env.DB.prepare('SELECT submitted_at FROM review_submissions WHERE id=?').bind(id).first<{ submitted_at: number }>())!.submitted_at;
    for (const [i, at] of [sub - 1000, sub - 2000].entries()) await env.DB.prepare("INSERT INTO card_registrations (provider, author_num_id, source_role_id, registered_at) VALUES ('harbor', ?, ?, ?)").bind(AUTHOR, `extra-${i}`, at).run();
    await env.DB.prepare("INSERT INTO card_registrations (provider, author_num_id, source_role_id, registered_at) VALUES ('harbor', ?, 'later', ?)").bind(AUTHOR, sub + 8 * 86_400_000).run();
    const again = await json(await get(`/v1/review-ai/submissions/${id}`, 'key'));
    expect(again.author.registrations7d).toBe(body.author.registrations7d + 2);
    expect(again.author.quotaFull).toBe(true);
  });
});

describe('AI 為主的定案', () => {
  const gen = async (id: string) => (await env.DB.prepare('SELECT claim_generation FROM review_submissions WHERE id=?').bind(id).first<{ claim_generation: string }>())!.claim_generation;
  const final = async (id: string, body: Record<string, unknown>, token = 'human') => send('POST', `/v1/review/${id}/stamp`, token, { generation: await gen(id), ...body });
  const lastStampEvent = (id: string) => env.DB.prepare("SELECT action, final_source, ai_suggestion_id, ai_note_types, ai_note FROM review_events WHERE submission_id=? AND action IN ('approve','reject') ORDER BY id DESC LIMIT 1").bind(id).first<Record<string, unknown>>();

  it('盲審退場：沒有 /blind；finalSource blind 是 400；沒帶來源的舊頁面照舊直接蓋章；詳情不帶 AI 也不帶盲審', async () => {
    const { id } = await submitCard();
    await suggest(id, { verdict: 'reject', reasons: ['opening.no_reply_hook'] });
    await claim(env.DB, id, humanId, Date.now());
    expect((await send('POST', `/v1/review/${id}/blind`, 'human', { verdict: 'approve', generation: await gen(id) })).status).toBe(404);
    expect(await json(await final(id, { finalSource: 'blind', verdict: 'approve' }))).toMatchObject({ error: 'invalid_arguments', field: 'finalSource' });
    expect(await status(id)).toBe('pending');
    const d = await json(await get(`/v1/review/${id}/detail`, 'human'));
    expect('myBlind' in d).toBe(false);
    expect(JSON.stringify(d)).not.toContain('opening.no_reply_hook');
    expect((await final(id, { verdict: 'approve' })).status).toBe(200);
    expect((await lastStampEvent(id))!.final_source).toBeNull();
  });

  it('照 AI：照 AI 結論與理由定案（與 AI 一致，保留 7 天）；報表人那邊是定案；給 AI 的說明進事件與說明清單', async () => {
    const { id } = await submitCard();
    await suggest(id, { verdict: 'reject', reasons: ['opening.no_reply_hook'] });
    await claim(env.DB, id, humanId, Date.now());
    const shown = (await json(await get(`/v1/review/${id}/ai`, 'human'))).suggestions[0];
    // 審卡員在畫面打開之後重判了：照 AI 定案要先看新的判斷
    await new Promise((r) => setTimeout(r, 5));
    await suggest(id, { verdict: 'reject', reasons: ['opening.no_reply_hook'], confidence: 0.9 });
    expect(await json(await final(id, { finalSource: 'ai', aiSuggestionId: shown.id, aiSuggestionAt: shown.at }))).toEqual({ error: 'ai_changed' });
    const now = (await json(await get(`/v1/review/${id}/ai`, 'human'))).suggestions[0];
    const res = await final(id, { finalSource: 'ai', aiSuggestionId: now.id, aiSuggestionAt: now.at, aiNoteTypes: ['author_relation', 'card_content'], aiNote: '同一群人的多個帳號' });
    expect(res.status).toBe(200);
    expect((await json(res)).finalSource).toBe('ai');
    const after = await json(await get(`/v1/review/${id}/detail`, 'human'));
    expect(after.submission.stamps).toMatchObject([{ mine: true, finalSource: 'ai' }]);
    const row = await env.DB.prepare('SELECT status, reject_reasons FROM review_submissions WHERE id=?').bind(id).first<{ status: string; reject_reasons: string }>();
    expect(row).toEqual({ status: 'rejected', reject_reasons: '["opening.no_reply_hook"]' });
    const ev = await lastStampEvent(id);
    expect(ev).toMatchObject({ action: 'reject', final_source: 'ai', ai_note_types: '["card_content","author_relation"]', ai_note: '同一群人的多個帳號' });
    expect(ev!.ai_suggestion_id).toBeTruthy();
    const kept = await env.DB.prepare('SELECT expires_at - decided_at AS ms FROM review_snapshot_retention WHERE submission_id=?').bind(id).first<{ ms: number }>();
    expect(kept!.ms).toBe(7 * 86_400_000);
    const v1 = (await json(await get('/v1/review-ai/report', 'mgr'))).versions.find((v: any) => v.criteriaVersion === 'v1');
    expect(v1.matrix.rejected.reject).toBe(1);
    expect(v1).toMatchObject({ agreement: 1, finalSource: { ai: 1 } });
    const notes = await json(await get('/v1/review-ai/notes?type=author_relation', 'mgr'));
    expect(notes.items).toHaveLength(1);
    expect(notes.items[0]).toMatchObject({ kind: 'final', note: '同一群人的多個帳號', finalSource: 'ai' });
    expect((await get('/v1/review-ai/notes', 'human')).status).toBe(403);
    // 定案與 AI 一致：不是分歧，不用仲裁
    expect((await json(await get('/v1/review-ai/disagreements?state=all', 'mgr'))).total).toBe(0);
  });

  it('改了 AI：定案與 AI 不同就進分歧清單、保留 14 天；仲裁後縮回 7 天；仲裁可帶原因類型', async () => {
    const { id } = await submitCard();
    const sid = (await json(await suggest(id, { verdict: 'reject', reasons: ['opening.too_short'] }))).id;
    await claim(env.DB, id, humanId, Date.now());
    expect((await final(id, { finalSource: 'modified', verdict: 'approve' })).status).toBe(200);
    expect(await status(id)).toBe('approved');
    expect((await lastStampEvent(id))!.final_source).toBe('modified');
    const longer = await env.DB.prepare('SELECT expires_at - decided_at AS ms FROM review_snapshot_retention WHERE submission_id=?').bind(id).first<{ ms: number }>();
    expect(longer!.ms).toBe(14 * 86_400_000);
    const list = await json(await get('/v1/review-ai/disagreements', 'mgr'));
    expect(list.items.map((i: any) => i.suggestionId)).toEqual([sid]);
    expect((await send('POST', `/v1/review-ai/disagreements/${sid}/arbitration`, 'mgr', { value: 'human_right', noteTypes: ['criteria_issue'], note: '開場其實有接話點', operationId: crypto.randomUUID() })).status).toBe(200);
    const kept = await env.DB.prepare('SELECT expires_at - decided_at AS ms FROM review_snapshot_retention WHERE submission_id=?').bind(id).first<{ ms: number }>();
    expect(kept!.ms).toBe(7 * 86_400_000);
    const notes = await json(await get('/v1/review-ai/notes?type=criteria_issue', 'mgr'));
    expect(notes.items[0]).toMatchObject({ kind: 'arbitration', arbitration: 'human_right', note: '開場其實有接話點' });
  });

  it('AI 還沒審：human_no_ai 要帶這次的決定；照 AI 是 409；AI 其實已審好就記成 modified；原因類型不認得 400', async () => {
    const a = await submitCard('draft-a');
    await claim(env.DB, a.id, humanId, Date.now());
    expect((await final(a.id, { finalSource: 'ai' })).status).toBe(409);
    expect(await json(await final(a.id, { finalSource: 'human_no_ai' }))).toMatchObject({ error: 'verdict must be approve or reject' });
    expect((await final(a.id, { finalSource: 'human_no_ai', verdict: 'approve' })).status).toBe(200);
    expect((await lastStampEvent(a.id))!.final_source).toBe('human_no_ai');
    const b = await submitCard('draft-b');
    await suggest(b.id, { verdict: 'pass' });
    await claim(env.DB, b.id, humanId, Date.now());
    expect((await final(b.id, { finalSource: 'modified', verdict: 'approve', aiNoteTypes: ['nope'] })).status).toBe(400);
    expect((await final(b.id, { finalSource: 'human_no_ai', verdict: 'reject', reasons: ['opening.too_short'] })).status).toBe(200);
    expect(await status(b.id)).toBe('rejected');
    expect((await lastStampEvent(b.id))!.final_source).toBe('modified');
  });
});

describe('定案：審查修正', () => {
  const gen = async (id: string) => (await env.DB.prepare('SELECT claim_generation FROM review_submissions WHERE id=?').bind(id).first<{ claim_generation: string }>())!.claim_generation;
  it('作者標記只在定案那一章記一次；只打標記不改建議的更新時間', async () => {
    const { id } = await submitCard();
    await suggest(id, { verdict: 'pass' });
    const before = (await env.DB.prepare('SELECT updated_at FROM review_ai_suggestions WHERE submission_id=?').bind(id).first<{ updated_at: number }>())!.updated_at;
    await new Promise((r) => setTimeout(r, 5));
    await send('PUT', `/v1/review-ai/submissions/${id}/tags`, 'key', { criteriaVersion: 'v1', model: 'm', flags: ['ai_unedited'] });
    expect((await env.DB.prepare('SELECT updated_at FROM review_ai_suggestions WHERE submission_id=?').bind(id).first<{ updated_at: number }>())!.updated_at).toBe(before);
    await claim(env.DB, id, humanId, Date.now());
    // 照 AI 定案時審核標記跟著結論一起送（審核頁就是這樣送）
    expect((await send('POST', `/v1/review/${id}/stamp`, 'human', { finalSource: 'ai', verdict: 'approve', marks: ['suspect_ai_text'], generation: await gen(id) })).status).toBe(200);
    const rows = (await env.DB.prepare("SELECT action, marks FROM review_events WHERE submission_id=? AND marks IS NOT NULL").bind(id).all()).results;
    expect(rows.map((r: any) => r.action)).toEqual(['approve']);
  });

  it('過了保留期：查重與完整內容都不再給（排程還沒刪也一樣）', async () => {
    const { id } = await submitCard();
    await decide(id, humanId, 'approve');
    await env.DB.prepare('UPDATE review_snapshot_retention SET expires_at=? WHERE submission_id=?').bind(Date.now() - 1, id).run();
    const d = await json(await get(`/v1/review/${id}/detail`, 'human'));
    expect(d.retainUntil).toBeNull();
    expect(d.detail.closed).toBe(true);
    const o = await json(await get(`/v1/review/${id}/originality`, 'human'));
    expect(o.available).toBe(false);
  });
});

describe('目前判準版本', () => {
  const gen = async (id: string) => (await env.DB.prepare('SELECT claim_generation FROM review_submissions WHERE id=?').bind(id).first<{ claim_generation: string }>())!.claim_generation;
  it('設了目前版本，揭曉與兩段式只看這一版；還沒用這版審過就是 AI 尚未審完', async () => {
    const { id } = await submitCard();
    await suggest(id, { verdict: 'reject', reasons: ['opening.too_short'], criteriaVersion: 'v3' });
    expect((await send('PUT', '/v1/review-ai/criteria', 'key', { version: 'v4' })).status).toBe(200);
    expect((await json(await get('/v1/review-ai/criteria', 'key'))).current).toBe('v4');
    expect((await send('PUT', '/v1/review-ai/criteria', 'human', { version: 'v9' })).status).toBe(403);
    await claim(env.DB, id, humanId, Date.now());
    // 只有 v3 的建議：照 AI 定案不成立（AI 尚未用目前判準審完）
    expect((await send('POST', `/v1/review/${id}/stamp`, 'human', { finalSource: 'ai', generation: await gen(id) })).status).toBe(409);
    expect((await json(await get(`/v1/review/${id}/ai`, 'human'))).current).toBe('v4');
    await suggest(id, { verdict: 'pass', criteriaVersion: 'v4' });
    const ai = await json(await get(`/v1/review/${id}/ai`, 'human'));
    expect(ai.suggestions.map((x: any) => x.criteriaVersion).sort()).toEqual(['v3', 'v4']);
    expect((await json(await send('POST', `/v1/review/${id}/stamp`, 'human', { finalSource: 'ai', generation: await gen(id) }))).finalSource).toBe('ai');
    expect(await status(id)).toBe('approved');
  });

  it('仲裁清單預設只看目前版本，criteria=all 看全部；沒設目前版本就取近 7 天用過的最新版', async () => {
    const a = await submitCard('draft-a');
    const b = await submitCard('draft-b');
    await suggest(a.id, { verdict: 'reject', reasons: ['opening.too_short'], criteriaVersion: 'v3' });
    await suggest(b.id, { verdict: 'reject', reasons: ['opening.too_short'], criteriaVersion: 'v4' });
    await decide(a.id, humanId, 'approve');
    await decide(b.id, humanId, 'approve');
    const def = await json(await get('/v1/review-ai/disagreements?state=all', 'mgr'));
    expect(def.criteria).toBe('v4');
    expect(def.total).toBe(1);
    expect((await json(await get('/v1/review-ai/disagreements?state=all&criteria=all', 'mgr'))).total).toBe(2);
    expect((await json(await get('/v1/review-ai/disagreements?state=all&criteria=v3', 'mgr'))).total).toBe(1);
  });
});

describe('作者行為（審核頁）與 v7 讀卡訊號', () => {
  it('一晚多張長卡、送審間隔極短都會提示；只回數字', async () => {
    const a = await submitCard('draft-a');
    const b = await submitCard('draft-b');
    const c = await submitCard('draft-c');
    const now = Date.now();
    for (const [id, at] of [[a.id, now - 60 * 60_000], [b.id, now - 30 * 60_000], [c.id, now - 10 * 60_000]] as const) {
      await env.DB.prepare('UPDATE review_submissions SET submitted_at=?, review_length_total=2000 WHERE id=?').bind(at, id).run();
    }
    await claim(env.DB, c.id, humanId, Date.now());
    const res = await get(`/v1/review/${c.id}/author-activity`, 'human');
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({ submissions24h: 3, submissions7d: 3, minutesSincePrevious: 20, pendingNow: 3 });
    expect(body.anomalies.map((x: any) => x.code)).toEqual(expect.arrayContaining(['burst_long', 'quick_gap']));
    expect(body.recent.filter((r: any) => r.current)).toHaveLength(1);
    expect(JSON.stringify(body)).not.toMatch(/member-|draft-|sealed-/);
    // 跟審核頁同一道門：沒領取的審核員打不開
    expect((await get(`/v1/review/${a.id}/author-activity`, 'human')).status).toBe(409);
  });

  it('審卡員讀卡多了 24 小時送審數、送審當下待審數、間隔與近期字數；開場網頁的結構訊號', async () => {
    const a = await submitCard('draft-a');
    const b = await submitCard('draft-b');
    await env.DB.prepare('UPDATE review_submissions SET review_length_total=1800 WHERE id IN (?, ?)').bind(a.id, b.id).run();
    const body = await json(await get(`/v1/review-ai/submissions/${b.id}`, 'key'));
    expect(body.author).toMatchObject({ submissions24h: 2, pendingAtSubmit: 2 });
    expect(body.author.recentChars).toEqual([1800, 1800]);
    const input = aiCardInput({
      greetings: { welcome: '<div class="hc"><b>夜</b></div>你醒了。' },
      authorAsset: { openingMode: 'page', openingPage: '<div><button data-tab="1">角色</button><button data-tab="2">世界</button><div id="app">載入中</div><script>render()</script></div>' },
    }, { tags: [], fandom: '' });
    expect(input.stats).toMatchObject({ openingPageScript: true, openingPageInteractive: 4, openingHtmlTags: 2 });
    expect(input.stats.openingPageElements).toBeGreaterThanOrEqual(5);
  });
});

describe('作者行為：同一張卡改字重送不算另一張', () => {
  it('重送同一張卡不觸發間隔極短，也不算一晚多張', async () => {
    const a = await submitCard('draft-a');
    const now = Date.now();
    await env.DB.prepare('UPDATE review_submissions SET submitted_at=?, review_length_total=2000, status=? WHERE id=?').bind(now - 20 * 60_000, 'superseded', a.id).run();
    const again = await env.DB.prepare("SELECT card_id FROM review_submissions WHERE id=?").bind(a.id).first<{ card_id: number }>();
    const b = await submitCard('draft-a');
    await env.DB.prepare('UPDATE review_submissions SET submitted_at=?, review_length_total=2000 WHERE id=?').bind(now - 5 * 60_000, b.id).run();
    expect((await env.DB.prepare("SELECT card_id FROM review_submissions WHERE id=?").bind(b.id).first<{ card_id: number }>())!.card_id).toBe(again!.card_id);
    await claim(env.DB, b.id, humanId, Date.now());
    const body = await json(await get(`/v1/review/${b.id}/author-activity`, 'human'));
    expect(body.minutesSincePrevious).toBeNull();
    expect(body.anomalies.map((x: any) => x.code)).not.toContain('quick_gap');
    expect(body.submissions7d).toBe(2);
  });
});

describe('給作者的說明（AI 草稿）', () => {
  const final = async (id: string, body: Record<string, unknown>, token = 'human') => {
    const gen = (await env.DB.prepare('SELECT claim_generation FROM review_submissions WHERE id=?').bind(id).first<{ claim_generation: string }>())!.claim_generation;
    return send('POST', `/v1/review/${id}/stamp`, token, { generation: gen, ...body });
  };
  it('AI 寫的作者說明不能帶內部資訊；用 AI 的定案帶入草稿，審核員改過也要過檢查', async () => {
    const { id } = await submitCard();
    const leak = await suggest(id, { verdict: 'reject', reasons: ['opening.no_reply_hook'], authorNote: '本週額度已用滿，同裝置有 4 個帳號。' });
    expect(leak.status).toBe(400);
    const err = await json(leak);
    expect(err).toMatchObject({ error: 'author_note_internal', field: 'authorNote', terms: ['額度', '裝置', '帳號'] });
    expect(err.hint).toContain('note');
    const draft = '開場白停在角色的外貌描寫，沒有一件要玩家回應的事。可以讓角色在開場提出一個請求或遇到狀況。';
    expect((await suggest(id, { verdict: 'reject', reasons: ['opening.no_reply_hook'], note: '本週額度用滿、一晚送 6 張', authorNote: draft })).status).toBe(200);
    await claim(env.DB, id, humanId, Date.now());
    const shown = (await json(await get(`/v1/review/${id}/ai`, 'human'))).suggestions[0];
    expect(shown).toMatchObject({ authorNote: draft, note: '本週額度用滿、一晚送 6 張' });
    // 審核員改過的說明帶了內部字詞：擋下，告訴他是哪個詞
    const bad = await final(id, { finalSource: 'ai', aiSuggestionId: shown.id, aiSuggestionAt: shown.at, authorNote: draft + '另外你的送審次數太多。' });
    expect(bad.status).toBe(400);
    expect(await json(bad)).toMatchObject({ error: 'author_note_internal', terms: ['送審次數'], matches: [{ term: '送審次數', snippet: '請求或遇到狀況。另外你的送審次數太多。', start: 12, length: 4 }] });
    expect(await status(id)).toBe('pending');
    expect((await final(id, { finalSource: 'ai', aiSuggestionId: shown.id, aiSuggestionAt: shown.at })).status).toBe(200);
    const row = await env.DB.prepare('SELECT note FROM review_submissions WHERE id=?').bind(id).first<{ note: string }>();
    expect(row!.note).toBe(draft);
  });

  it('自己寫的駁回說明一樣不能帶內部資訊', async () => {
    const { id } = await submitCard();
    await claim(env.DB, id, humanId, Date.now());
    const res = await final(id, { finalSource: 'human_no_ai', verdict: 'reject', reasons: ['other'], note: '同一裝置上有好幾個帳號，不受理。' });
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ error: 'author_note_internal', terms: ['裝置', '帳號'] });
  });
});

describe('已上架卡的更新', () => {
  it('審卡員讀卡時看得到這張卡送審當下是否已上架', async () => {
    const first = await submitCard('draft-a');
    expect((await json(await get(`/v1/review-ai/submissions/${first.id}`, 'key'))).submission.published).toBe(false);
    await env.DB.prepare("UPDATE review_submissions SET status='approved', decided_at=? WHERE id=?").bind(Date.now() - 60_000, first.id).run();
    const update = await submitCard('draft-a');
    expect((await json(await get(`/v1/review-ai/submissions/${update.id}`, 'key'))).submission.published).toBe(true);
  });
});

describe('審卡員讀得到查重數字', () => {
  it('回整體重複率與比這張早的卡最高重複率，不帶別張卡的編號或名稱', async () => {
    const { id } = await submitCard();
    const body = await json(await get(`/v1/review-ai/submissions/${id}`, 'key'));
    expect(body.originality).toBeDefined();
    expect(Object.keys(body.originality).sort()).toEqual(body.originality.available ? ['available', 'earlierMax', 'similarity', 'sources'] : ['available']);
  });
});

describe('送審節奏只算還沒上架的卡', () => {
  it('已上架卡的更新不算進 24 小時送審數與一晚多張', async () => {
    const a = await submitCard('draft-a');
    await env.DB.prepare("UPDATE review_submissions SET status='approved', decided_at=?, review_length_total=2000 WHERE id=?").bind(Date.now() - 3 * 3_600_000, a.id).run();
    // 同一張已上架的卡連送三次更新
    const ups = [await submitCard('draft-a')];
    await env.DB.prepare("UPDATE review_submissions SET status='superseded' WHERE id=?").bind(ups[0].id).run();
    ups.push(await submitCard('draft-a'));
    await env.DB.prepare("UPDATE review_submissions SET status='superseded' WHERE id=?").bind(ups[1].id).run();
    ups.push(await submitCard('draft-a'));
    await env.DB.prepare('UPDATE review_submissions SET review_length_total=2000 WHERE id IN (?,?,?)').bind(ups[0].id, ups[1].id, ups[2].id).run();
    const body = await json(await get(`/v1/review-ai/submissions/${ups[2].id}`, 'key'));
    // 只剩這張卡第一次送審（當時還沒上架）；三次更新都不算
    expect(body.author.submissions24h).toBe(1);
    await claim(env.DB, ups[2].id, humanId, Date.now());
    const act = await json(await get(`/v1/review/${ups[2].id}/author-activity`, 'human'));
    expect(act.submissions24h).toBe(1);
    expect(act.anomalies.map((x: any) => x.code)).not.toContain('burst_long');
  });
});

describe('AI 為主、人為輔（owner 2026-11-24）', () => {
  const final = async (id: string, body: Record<string, unknown>, token = 'human') => {
    const g = (await env.DB.prepare('SELECT claim_generation FROM review_submissions WHERE id=?').bind(id).first<{ claim_generation: string }>())!.claim_generation;
    return send('POST', `/v1/review/${id}/stamp`, token, { generation: g, ...body });
  };
  it('AI 駁回一定要附給作者的說明', async () => {
    const { id } = await submitCard();
    const res = await send('PUT', `/v1/review-ai/submissions/${id}/suggestion`, 'key', { criteriaVersion: 'v1', model: 'm', verdict: 'reject', reasons: ['decline.not_ready'] });
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ error: 'author_note_required', field: 'authorNote' });
    expect((await suggest(id, { verdict: 'reject', reasons: ['decline.not_ready'], authorNote: '開場還需要一件要玩家回應的事。' })).status).toBe(200);
  });

  it('照 AI 定案記 ai，帶「AI 不準確」；改了記 modified；AI 還沒審記 human_no_ai', async () => {
    const a = await submitCard('draft-a');
    await suggest(a.id, { verdict: 'reject', reasons: ['opening.no_reply_hook'], authorNote: '開場停在描寫，請讓角色提出一件需要玩家回應的事。' });
    await claim(env.DB, a.id, humanId, Date.now());
    const shown = (await json(await get(`/v1/review/${a.id}/ai`, 'human'))).suggestions[0];
    const ok = await final(a.id, { finalSource: 'ai', aiSuggestionId: shown.id, aiSuggestionAt: shown.at, aiInaccurate: true });
    expect(ok.status).toBe(200);
    expect(await json(ok)).toMatchObject({ finalSource: 'ai' });
    const ev = await env.DB.prepare("SELECT final_source, ai_note_types FROM review_events WHERE submission_id=? AND action IN ('approve','reject')").bind(a.id).first<{ final_source: string; ai_note_types: string }>();
    expect(ev!.final_source).toBe('ai');
    expect(JSON.parse(ev!.ai_note_types)).toContain('ai_inaccurate');
    expect((await env.DB.prepare('SELECT note FROM review_submissions WHERE id=?').bind(a.id).first<{ note: string }>())!.note).toBe('開場停在描寫，請讓角色提出一件需要玩家回應的事。');
    expect((await json(await get('/v1/review-ai/report', 'mgr'))).versions[0]).toMatchObject({ inaccurate: 1, finalSource: { ai: 1 } });

    const b = await submitCard('draft-b');
    await suggest(b.id, { verdict: 'reject', reasons: ['opening.no_reply_hook'] });
    await claim(env.DB, b.id, humanId, Date.now());
    const sb = (await json(await get(`/v1/review/${b.id}/ai`, 'human'))).suggestions[0];
    const mod = await final(b.id, { finalSource: 'modified', aiSuggestionId: sb.id, aiSuggestionAt: sb.at, verdict: 'reject', reasons: ['decline.burst_similar'], note: '' });
    expect(mod.status).toBe(200);
    expect(await json(mod)).toMatchObject({ finalSource: 'modified' });
    expect(await status(b.id)).toBe('rejected');

    // AI 還沒審：照這次在畫面上選的定案
    const c = await submitCard('draft-c');
    await claim(env.DB, c.id, humanId, Date.now());
    const none = await final(c.id, { finalSource: 'human_no_ai', verdict: 'reject', reasons: ['decline.not_ready'], note: '' });
    expect(none.status).toBe(200);
    expect(await json(none)).toMatchObject({ finalSource: 'human_no_ai' });
    expect(await status(c.id)).toBe('rejected');
  });
});

describe('定案後標「AI 判斷不準確」（ui-ai-first.md：可在定案前後標）', () => {
  const gen = async (id: string) => (await env.DB.prepare('SELECT claim_generation FROM review_submissions WHERE id=?').bind(id).first<{ claim_generation: string }>())!.claim_generation;
  const final = async (id: string, body: Record<string, unknown>, token = 'human') => send('POST', `/v1/review/${id}/stamp`, token, { generation: await gen(id), ...body });
  const mark = (id: string, inaccurate: unknown, token = 'human') => send('PUT', `/v1/review/${id}/ai-inaccurate`, token, { inaccurate });
  const types = async (id: string) => {
    const row = await env.DB.prepare("SELECT ai_note_types FROM review_events WHERE submission_id=? AND final_source IS NOT NULL").bind(id).first<{ ai_note_types: string | null }>();
    return row!.ai_note_types === null ? null : JSON.parse(row!.ai_note_types);
  };
  const inaccurate = async () => (await json(await get('/v1/review-ai/report', 'mgr'))).versions[0].inaccurate;

  it('定案的審核員與管理員可以標、可以取消；重送同一個值不多記；報表與 AI 建議的讀取跟著變', async () => {
    const { id } = await submitCard();
    await suggest(id, { verdict: 'pass' });
    await claim(env.DB, id, humanId, Date.now());
    // 定案前沒有這條路：照舊跟著定案一起送
    expect(await json(await mark(id, true))).toMatchObject({ error: 'review_not_decided' });
    const shown = (await json(await get(`/v1/review/${id}/ai`, 'human'))).suggestions[0];
    expect((await final(id, { finalSource: 'ai', aiSuggestionId: shown.id, aiSuggestionAt: shown.at, aiNoteTypes: ['card_content'] })).status).toBe(200);
    expect((await json(await get(`/v1/review/${id}/ai`, 'human'))).inaccurate).toBe(false);
    expect(await inaccurate()).toBe(0);
    const on = await mark(id, true);
    expect(on.status).toBe(200);
    expect(await json(on)).toEqual({ inaccurate: true });
    expect(await types(id)).toEqual(['card_content', 'ai_inaccurate']);
    expect(await json(await mark(id, true))).toEqual({ inaccurate: true });
    expect(await types(id)).toEqual(['card_content', 'ai_inaccurate']);
    expect((await json(await get(`/v1/review/${id}/ai`, 'human'))).inaccurate).toBe(true);
    expect(await inaccurate()).toBe(1);
    // 補標只給做這個決定的審核員；管理員看別人的定案是唯讀（UI/UX、PM 11-25）
    const byMgr = await mark(id, false, 'mgr');
    expect(byMgr.status).toBe(403);
    expect(await json(byMgr)).toMatchObject({ error: 'ai_inaccurate_not_allowed' });
    expect(await types(id)).toEqual(['card_content', 'ai_inaccurate']);
    expect(await json(await mark(id, false))).toEqual({ inaccurate: false });
    expect(await types(id)).toEqual(['card_content']);
    expect(await inaccurate()).toBe(0);
    expect((await json(await get(`/v1/review/${id}/ai`, 'mgr'))).inaccurate).toBe(false);
    // 給 AI 的說明不受影響，說明清單照列
    expect((await json(await get('/v1/review-ai/notes?type=card_content', 'mgr'))).items).toHaveLength(1);
  });

  it('定案時已標的可以在結果頁取消；只剩這個標記時取消後清空', async () => {
    const { id } = await submitCard();
    await suggest(id, { verdict: 'reject', reasons: ['opening.no_reply_hook'] });
    await claim(env.DB, id, humanId, Date.now());
    expect((await final(id, { finalSource: 'ai', aiInaccurate: true })).status).toBe(200);
    expect(await types(id)).toEqual(['ai_inaccurate']);
    expect(await json(await mark(id, false))).toEqual({ inaccurate: false });
    expect(await types(id)).toBeNull();
    expect((await json(await get('/v1/review-ai/notes', 'mgr'))).items).toHaveLength(0);
  });

  it('沒參與的審核員不行；值要是布林；沒有 AI 結論對照的定案不能標；記一個操作標籤', async () => {
    identities({ agent: AGENT, human: HUMAN, mgr: MANAGER, author: AUTHOR, other: 20003 });
    await makeReviewer(20003);
    const { id } = await submitCard('draft-a');
    await suggest(id, { verdict: 'pass' });
    await claim(env.DB, id, humanId, Date.now());
    expect((await final(id, { finalSource: 'ai' })).status).toBe(200);
    expect((await mark(id, true, 'other')).status).toBe(403);
    expect((await mark(id, 'yes')).status).toBe(400);
    expect((await mark(id, true, 'author')).status).toBe(403);
    // AI 沒審的單：定案沒有 AI 對照，沒有東西可評
    const b = await submitCard('draft-b');
    await claim(env.DB, b.id, humanId, Date.now());
    expect((await final(b.id, { finalSource: 'human_no_ai', verdict: 'approve' })).status).toBe(200);
    expect(await json(await mark(b.id, true))).toMatchObject({ error: 'ai_inaccurate_unavailable' });
    expect((await mark(id, true)).status).toBe(200);
    const metrics = await opsMetrics(env.DB);
    expect(metrics).toContain('hearthroom_review_ai_operations_total{operation="inaccurate",outcome="success"} 1');
    expect(metrics).toContain('hearthroom_review_ai_operations_total{operation="inaccurate",outcome="denied"} 2');
    expect(metrics).toContain('hearthroom_review_ai_operations_total{operation="inaccurate",outcome="rejected"} 2');
  });
});

describe('作者行為的使用量', () => {
  it('讀取成功、被擋、出錯各記一次（只有操作與結果，沒有單號）', async () => {
    const a = await submitCard('draft-a');
    await claim(env.DB, a.id, humanId, Date.now());
    expect((await get(`/v1/review/${a.id}/author-activity`, 'human')).status).toBe(200);
    expect((await get(`/v1/review/${a.id}/author-activity`, 'mgr')).status).toBe(409);
    const text = await opsMetrics(env.DB);
    expect(text).toContain('hearthroom_review_author_activity_total{operation="read",outcome="success"} 1');
    expect(text).toContain('hearthroom_review_author_activity_total{operation="read",outcome="denied"} 1');
  });
});
