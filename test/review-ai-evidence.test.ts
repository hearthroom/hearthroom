import { SELF, env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERAL_RATING, bearer, identities, makeAgent, makeMember, makeReviewer, resetDb, restoreUpstream, role } from './helpers';
import { hostGateway, submitHosted } from '../src/hosting';
import { claim, pendingSubmissionOf, stamp } from '../src/review';
import { getCard } from '../src/cards';
import { upstream } from '../src/upstream';
import { opsMetrics } from '../src/ops-metrics';
import { HttpError } from '../src/types';

// 審卡員讀得到審核頁上的證據（任務 2026-11-23-ai-card-review）：完整查重、作者側寫、作者其他卡、上架版內容、自己的作者筆記。
const AUTHOR = 10001, OTHER = 10002, AGENT = 30001, HUMAN = 20001;
const KEY = 'b'.repeat(64);
const DEVICE = 'device-hash-fixture-0123456789abcdef';
let humanId = '';
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
async function seedReviewAgentIdentity() {
  const migration = (env as unknown as { TEST_MIGRATIONS: { name: string; queries: string[] }[] }).TEST_MIGRATIONS.find((m) => m.name.endsWith('_review_ai.sql') || m.name.endsWith('_review_ai'))!;
  for (const q of migration.queries.filter((q) => /_review_agent_identity_guard|system-review-agent/.test(q))) await env.DB.prepare(q).run();
}

beforeEach(async () => {
  await resetDb();
  identities({ agent: AGENT, human: HUMAN, author: AUTHOR });
  await makeAgent(AGENT);
  await seedReviewAgentIdentity();
  (env as { REVIEW_AGENT_CONFIG?: string }).REVIEW_AGENT_CONFIG = JSON.stringify({ memberId: 'system-review-agent', keySha256: await sha(KEY) });
  humanId = await makeReviewer(HUMAN);
});
afterEach(() => { vi.restoreAllMocks(); restoreUpstream(); delete (env as { REVIEW_AGENT_CONFIG?: string }).REVIEW_AGENT_CONFIG; });

/** 一段每句都不一樣的長設定（同一句重複會被當成套語） */
const prose = (seed: string, n: number) => Array.from({ length: n }, (_, i) => `${seed}第${i}段：${'春夏秋冬東南西北金木水火土日月星辰'.slice(i % 9, (i % 9) + 7)}的${seed}在第${i * 7 + 3}號月台等著末班車。`).join('');
const TEMPLATE = prose('模板', 160);
const WELCOME = '末班車剛走，月台上只剩你和她。「你也錯過了嗎？」她問。';

async function submitCard(roleId: string, setting: string, opts: { author?: number; deviceHash?: string | null } = {}) {
  const author = opts.author ?? AUTHOR;
  const memberId = await makeMember(author);
  const draft = role({ roleId, authorNumId: author });
  vi.spyOn(hostGateway, 'seal').mockImplementation(async (_e, _t, _id, workId, versionId) => ({ workId, versionId, hostedRevisionId: `sealed-${roleId}` }));
  vi.spyOn(hostGateway, 'read').mockImplementation(async (_e, _t, id) => ({ ...draft, roleId: id }));
  const settings = {
    document: { roleName: `名字${roleId}`, roleTag: ['Roleplay'], roleDetailDesc: setting, customInstructions: '', talkExample: '' },
    greetings: { welcome: WELCOME, alternates: [], prologue: [] },
    worldbooks: [],
    authorAsset: { rules: [], mountTrigger: '', mountLayer: '', pageMode: 'classic', status: 'ok', version: 1 },
    hashes: { card: '', welcome: '', worldbook: '', authorAsset: '', content: '' },
  };
  vi.spyOn(upstream, 'readForReview').mockImplementation(async () => structuredClone(settings) as never);
  await submitHosted(env, { memberId, account: author, role: draft, token: 'fixture', rating: GENERAL_RATING, operationId: crypto.randomUUID(), now: Date.now(), deviceHash: opts.deviceHash ?? null });
  const card = (await getCard(env.DB, roleId, 'harbor'))!;
  const s = (await pendingSubmissionOf(env.DB, card.id))!;
  return { id: s.id, cardId: String(card.id), memberId, settings };
}

/** 封存內容依 hosted revision 回傳（每張卡各自的內容） */
function sealedByRevision(cards: { roleId: string; settings: unknown }[]) {
  const map = new Map(cards.map((c) => [`sealed-${c.roleId}`, c.settings]));
  return vi.spyOn(upstream, 'readSealedForReview').mockImplementation(async (_e, id) => {
    const hit = map.get(id);
    if (!hit) throw new HttpError(404, 'settings not found');
    return structuredClone(hit) as never;
  });
}

const auth = (token: string): Record<string, string> => (token === 'key' ? { 'X-Review-Agent-Key': KEY } : bearer(token));
const get = (path: string, token = 'key') => SELF.fetch(`https://c.test${path}`, { headers: auth(token) });
const put = (path: string, body: unknown, token = 'key') =>
  SELF.fetch(`https://c.test${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...auth(token) }, body: JSON.stringify(body) });
const json = async (res: Response) => (await res.json()) as any;
const decide = async (id: string, verdict: 'approve' | 'reject') => {
  await claim(env.DB, id, humanId, Date.now());
  await stamp(env.DB, { submissionId: id, memberId: humanId, verdict, note: '', now: Date.now(), ...(verdict === 'reject' ? { reasons: ['opening.no_reply_hook', 'character.setting_thin'] } : {}) });
};
const NEW_ROUTES = (id: string, cardId: string) => [
  `/v1/review-ai/submissions/${id}/originality`,
  `/v1/review-ai/submissions/${id}/author`,
  `/v1/review-ai/submissions/${id}/author-cards`,
  `/v1/review-ai/submissions/${id}/author-note`,
  `/v1/review-ai/cards/${cardId}`,
];

describe('只給審卡員金鑰', () => {
  it('人類審核員 403、未登入 401；寫筆記也一樣', async () => {
    const { id, cardId } = await submitCard('only', TEMPLATE);
    for (const path of NEW_ROUTES(id, cardId)) {
      expect((await get(path, 'human')).status, path).toBe(403);
      expect((await SELF.fetch(`https://c.test${path}`)).status, path).toBe(401);
    }
    expect((await put(`/v1/review-ai/submissions/${id}/author-note`, { note: 'x' }, 'human')).status).toBe(403);
  });
});

describe('完整查重', () => {
  it('列出每張相似卡的卡號、名稱、相似度、早晚、狀態與重疊原文；作者自己的卡不算', async () => {
    const other = await submitCard('other', TEMPLATE, { author: OTHER });
    const mine = await submitCard('mine-old', prose('自己', 120) + TEMPLATE.slice(0, 1500));
    const cur = await submitCard('cur', TEMPLATE + prose('新寫', 60));
    sealedByRevision([]);
    const body = await json(await get(`/v1/review-ai/submissions/${cur.id}/originality`));
    expect(body.available).toBe(true);
    expect(body.similarity).toBeGreaterThan(0.3);
    expect(body.sources.map((s: any) => s.cardId)).toEqual([other.cardId]);
    expect(body.sources.map((s: any) => s.cardId)).not.toContain(mine.cardId);
    const src = body.sources[0];
    expect(src).toMatchObject({ cardId: other.cardId, name: expect.any(String), earlier: true, status: 'pending' });
    expect(src.similarity).toBeGreaterThan(0.3);
    expect(src.overlap.length).toBeGreaterThan(0);
    expect(TEMPLATE).toContain(src.overlap[0]);
    const total = body.sources.reduce((n: number, s: any) => n + s.overlap.join('').length, 0);
    expect(total).toBeLessThanOrEqual(4000);
    expect(src.overlapChars).toBeGreaterThanOrEqual(src.overlap.join('').length);
    expect(src.clipped).toBe(true);
    expect(JSON.stringify(body)).not.toContain(other.memberId);
  });
});

describe('作者側寫', () => {
  it('帳號年齡、過去通過與駁回（含理由分佈）、新卡與更新數、新卡節奏、同裝置帳號數、標記與筆記；沒有任何識別碼', async () => {
    const a = await submitCard('a', prose('甲', 160), { deviceHash: DEVICE });
    await decide(a.id, 'reject');
    const b = await submitCard('b', prose('乙', 160), { deviceHash: DEVICE });
    await decide(b.id, 'approve');
    const cur = await submitCard('c', prose('丙', 160), { deviceHash: DEVICE });
    const second = await makeMember(40001), third = await makeMember(40002);
    for (const m of [cur.memberId, second, third]) await env.DB.prepare('INSERT OR IGNORE INTO reward_devices (device_hash, member_id, first_seen, last_seen) VALUES (?,?,?,?)').bind(DEVICE, m, 1, 1).run();
    await env.DB.prepare(`INSERT INTO review_author_marks(id,author_member_id,kind,value,auto_value,reason_code,note,rule_version,actor_member_id,created_at,expires_at)
      VALUES ('m1',?,'batch','suspected','clear','other','同一批人輪流送卡',1,?,?,?)`).bind(cur.memberId, humanId, Date.now(), Date.now() + 86_400_000).run();
    await put(`/v1/review-ai/submissions/${cur.id}/author-note`, { note: '這位作者常用同一個設定模板' });
    const res = await get(`/v1/review-ai/submissions/${cur.id}/author`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({
      accountAgeDays: 0,
      prior: { approved: 1, rejected: 1, rejectReasons: { 'opening.no_reply_hook': 1, 'character.setting_thin': 1 } },
      submissions: { last7d: { newCard: 3, update: 0 }, last30d: { newCard: 3, update: 0 }, newCardLast24h: 3 },
      deviceAccounts: 3,
      batchSuspected: true,
      marks: [{ kind: 'batch', value: 'suspected', reason: 'other', note: '同一批人輪流送卡' }],
      authorNote: { note: '這位作者常用同一個設定模板' },
    });
    expect(typeof body.tier).toBe('string');
    const text = JSON.stringify(body);
    for (const secret of [cur.memberId, second, third, DEVICE, humanId, 'system-review-agent', String(AUTHOR)]) expect(text).not.toContain(secret);
  });

  it('已定案的單：數字算到送審那一刻，不給標記與作者分級', async () => {
    const cur = await submitCard('d', prose('丁', 160));
    await decide(cur.id, 'reject');
    const body = await json(await get(`/v1/review-ai/submissions/${cur.id}/author`));
    expect(body).toMatchObject({ tier: null, batchSuspected: null, marks: [], prior: { approved: 0, rejected: 0 } });
    expect(body.asOf).toBeLessThanOrEqual(Date.now());
  });
});

describe('作者的其他卡', () => {
  it('列出其他卡（不含這張）與最新送審；同一個模板的卡相似度高，換寫的低', async () => {
    // 預設每週 3 張；開一個每週 20 張的活動才送得了 8 張
    await env.DB.prepare(`INSERT INTO card_reward_campaigns (id, slug, starts_at, ends_at, payout_deadline, weekly_limit, reward, status, created_at, updated_at)
      VALUES ('wk', 'wk', ?, ?, ?, 20, 10000, 'active', 0, 0)`).bind(Date.now() - 86_400_000, Date.now() + 86_400_000, Date.now() + 15 * 86_400_000).run();
    const twins: Awaited<ReturnType<typeof submitCard>>[] = [];
    for (let i = 0; i < 6; i++) twins.push(await submitCard(`twin-${i}`, TEMPLATE + prose(`變${i}`, 4)));
    const fresh = await submitCard('fresh', prose('完全不同', 160));
    await decide(twins[0].id, 'reject');
    const cur = await submitCard('cur', TEMPLATE + prose('這次', 4));
    const body = await json(await get(`/v1/review-ai/submissions/${cur.id}/author-cards`));
    const ids = body.items.map((i: any) => i.cardId);
    expect(ids).not.toContain(cur.cardId);
    expect(ids.sort()).toEqual([...twins.map((t) => t.cardId), fresh.cardId].sort());
    const twin = body.items.find((i: any) => i.cardId === twins[0].cardId);
    expect(twin).toMatchObject({ name: expect.any(String), live: false, latest: { id: twins[0].id, kind: 'first', status: 'rejected', submittedAt: expect.any(Number), chars: expect.any(Number) } });
    for (const t of twins.slice(1)) expect(body.items.find((i: any) => i.cardId === t.cardId).settingSimilarity).toBeGreaterThan(0.8);
    // 被駁回的卡指紋已清掉：量不到是 null，不是 0
    expect(body.items.find((i: any) => i.cardId === twins[0].cardId).settingSimilarity).toBeNull();
    expect(body.items.find((i: any) => i.cardId === fresh.cardId).settingSimilarity).toBeLessThan(0.1);
    expect(JSON.stringify(body)).not.toContain(cur.memberId);
    // 列出的單可以直接打開：已定案而且超過 7 天也讀得到（寫入仍然擋）
    await env.DB.prepare('UPDATE review_submissions SET submitted_at=? WHERE id=?').bind(Date.now() - 20 * 86_400_000, twins[0].id).run();
    sealedByRevision([{ roleId: 'twin-0', settings: twins[0].settings }]);
    const old = await get(`/v1/review-ai/submissions/${twins[0].id}`);
    expect(old.status).toBe(200);
    expect((await json(old)).submission.phase).toBe('closed');
    const write = await put(`/v1/review-ai/submissions/${twins[0].id}/suggestion`, { criteriaVersion: 'v1', model: 'm', verdict: 'pass' });
    expect(write.status).toBe(410);
    expect((await json(write)).error).toBe('review_ai_window_closed');
  });
});

describe('上架版內容', () => {
  it('已上架的卡回目前上架那一版的內容與統計；沒上架 404', async () => {
    const live = await submitCard('live', prose('上架', 160));
    await decide(live.id, 'approve');
    await env.DB.prepare("UPDATE cards SET status='approved', approved_version_id=(SELECT version_id FROM hosting_versions WHERE submission_id=?) WHERE id=?").bind(live.id, live.cardId).run();
    const pending = await submitCard('pend', prose('待審', 160));
    sealedByRevision([{ roleId: 'live', settings: live.settings }]);
    const res = await get(`/v1/review-ai/cards/${live.cardId}`);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.cardId).toBe(live.cardId);
    expect(body.card.name).toBe('名字live');
    expect(body.stats.settingChars).toBe(live.settings.document.roleDetailDesc.length);
    const missing = await get(`/v1/review-ai/cards/${pending.cardId}`);
    expect(missing.status).toBe(404);
    expect((await json(missing)).error).toBe('card_not_live');
    expect((await get('/v1/review-ai/cards/999999')).status).toBe(404);
  });
});

describe('作者筆記', () => {
  it('依作者存一份，換一張單讀到同一份；覆蓋、清空、長度上限', async () => {
    const a = await submitCard('na', prose('筆記甲', 160));
    const b = await submitCard('nb', prose('筆記乙', 160));
    expect(await json(await get(`/v1/review-ai/submissions/${a.id}/author-note`))).toEqual({ note: '', updatedAt: null });
    const saved = await put(`/v1/review-ai/submissions/${a.id}/author-note`, { note: '第一版' });
    expect(saved.status).toBe(200);
    expect(await json(saved)).toMatchObject({ note: '第一版', updatedAt: expect.any(Number) });
    await put(`/v1/review-ai/submissions/${a.id}/author-note`, { note: '第二版' });
    expect((await json(await get(`/v1/review-ai/submissions/${b.id}/author-note`))).note).toBe('第二版');
    const tooLong = await put(`/v1/review-ai/submissions/${a.id}/author-note`, { note: '字'.repeat(2001) });
    expect(tooLong.status).toBe(400);
    expect(await json(tooLong)).toMatchObject({ error: 'invalid_arguments', field: 'note' });
    expect((await put(`/v1/review-ai/submissions/${a.id}/author-note`, { note: 3 })).status).toBe(400);
    expect((await put(`/v1/review-ai/submissions/${a.id}/author-note`, { note: '字'.repeat(2000) })).status).toBe(200);
    expect((await json(await put(`/v1/review-ai/submissions/${a.id}/author-note`, { note: '' })))).toEqual({ note: '', updatedAt: null });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM review_ai_author_notes').first<{ n: number }>())!.n).toBe(0);
  });
});

describe('觀測', () => {
  it('新路由各自記一個操作標籤', async () => {
    const { id, cardId } = await submitCard('m', TEMPLATE);
    sealedByRevision([]);
    for (const path of NEW_ROUTES(id, cardId)) await get(path);
    await put(`/v1/review-ai/submissions/${id}/author-note`, { note: 'n' });
    const text = await opsMetrics(env.DB);
    for (const op of ['originality', 'author', 'author_cards', 'card', 'author_note_read', 'author_note_write']) expect(text, op).toContain(`hearthroom_review_ai_operations_total{operation="${op}",outcome="${op === 'card' ? 'rejected' : 'success'}"}`);
  });
});
