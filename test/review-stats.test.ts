import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bearer, GENERAL_RATING, identities, makeMember, makeReviewer, resetDb, restoreUpstream, role } from './helpers';
import { hostGateway, submitHosted } from '../src/hosting';
import { claim, pendingSubmissionOf, stamp } from '../src/review';
import { getCard } from '../src/cards';
import { upstream } from '../src/upstream';
import { reviewStats, STATS_SQL, statsCsv, statsJson, weekStart, type Cell, type ReviewStats } from '../src/review-stats';

// 審核統計（審卡 V2 第二批）：首次定案的通過率、理由分布、再送、不受理第 7 天、開場字數，小格在伺服器端抑制，
// 頁面與 CSV 用同一份結果。合成資料直接寫進 D1 的事件與特徵表（跟正式流程的 trigger 與寫入同一個形狀）。
beforeEach(resetDb);
afterEach(() => { restoreUpstream(); vi.restoreAllMocks(); });

const DAY = 86_400_000, HOUR = 3_600_000, RESUBMIT = 14;
// 2026-12-30（週三）：窗口是 11-30 到 12-28 四個完整 UTC 週
const NOW = Date.UTC(2026, 11, 30, 12);
const W1 = Date.UTC(2026, 10, 30), W2 = W1 + 7 * DAY, W3 = W2 + 7 * DAY, W4 = W3 + 7 * DAY;
let seq = 0;

interface Decision { author: string; result: 'approved' | 'rejected'; at: number; wait?: number; reasons?: string[] | null; opening?: number | null; card?: number }
async function decision(d: Decision): Promise<{ id: string; card: number }> {
  const id = `sub-${++seq}`, card = d.card ?? 500000 + seq;
  const submitted = d.at - (d.wait ?? 10 * HOUR);
  const features = d.opening === null ? '{}' : JSON.stringify({ openingChars: d.opening ?? 150 });
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO review_submission_features(submission_id,spec_version,author_member_id,features,created_at) VALUES(?,1,?,?,?)`).bind(id, d.author, features, submitted),
    event(`submit:${id}`, id, card, submitted, 'submit', 'author'),
    event(`first:${id}`, id, card, d.at, 'first_decision', 'system', d.result, d.result === 'rejected' && d.reasons ? JSON.stringify(d.reasons) : null),
  ]);
  return { id, card };
}
const event = (key: string, sid: string, card: number, at: number, action: string, actor: string, to: string | null = null, reasons: string | null = null, source: string | null = null) =>
  env.DB.prepare(`INSERT INTO review_events(event_key,spec_version,submission_id,card_id,at,action,to_state,actor_kind,reasons,source) VALUES(?,1,?,?,?,?,?,?,?,?)`)
    .bind(key, sid, card, at, action, to, actor, reasons, source);
/** n 筆、輪流分給 authors 位作者 */
async function many(n: number, authors: number, d: Omit<Decision, 'author'> & { prefix?: string }) {
  for (let i = 0; i < n; i++) await decision({ ...d, author: `${d.prefix ?? 'author'}-${i % authors}` });
}
const cellOf = async (section: string, dimension: string, now = NOW, weeks = 4) =>
  (statsJson(await reviewStats(env.DB, { now, weeks })).cells[section]?.[dimension]) as Cell;

describe('首次定案通過率', () => {
  it('每單只算第一次生效定案：通過 ÷（通過＋駁回），窗口外與其他章不算', async () => {
    await many(30, 6, { result: 'approved', at: W2 + DAY });
    await many(10, 5, { result: 'rejected', at: W2 + 2 * DAY, reasons: ['other'], prefix: 'r' });
    // 窗口之後（本週）與之前的定案不算
    await decision({ author: 'late', result: 'approved', at: NOW - HOUR });
    await decision({ author: 'early', result: 'rejected', at: W1 - DAY });
    // 一般蓋章事件不是定案
    await env.DB.batch([event('stamp:x:1', 'sub-1', 100001, W2 + DAY, 'approve', 'reviewer')]);
    const cell = await cellOf('decisions', 'all');
    expect(cell).toEqual({ status: 'ok', n: 40, values: { approved: 30, rejected: 10, rate: 0.75 } });
  });

  it('駁回數跟理由覆蓋是同一群：駁回只有 3 張時，覆蓋格與首次定案（含送審到定案的等待）一起抑制', async () => {
    await many(30, 6, { result: 'approved', at: W2 + DAY });
    await many(3, 3, { result: 'rejected', at: W2 + DAY, reasons: ['other'], prefix: 'r' });
    const s = statsJson(await reviewStats(env.DB, { now: NOW, weeks: 4 }));
    expect(s.cells.reasons!.coverage).toEqual({ status: 'suppressed' });
    expect(s.cells.decisions!.all).toEqual({ status: 'suppressed' });
    expect(s.cells.waits!.first_decision).toEqual({ status: 'suppressed' });
  });

  it('走真的蓋章流程：駁回寫出的首次定案事件被統計讀到（含理由與作者）', async () => {
    const memberId = await makeMember(10001);
    const draft = role({ roleId: 'draft', authorNumId: 10001 });
    vi.spyOn(hostGateway, 'seal').mockImplementation(async (_e, _t, _id, workId, versionId) => ({ workId, versionId, hostedRevisionId: 'sealed-1' }));
    vi.spyOn(hostGateway, 'read').mockImplementation(async (_e, _t, id) => ({ ...draft, roleId: id }));
    vi.spyOn(upstream, 'readForReview').mockResolvedValue({ document: { roleName: 'F', roleTag: ['Roleplay'], roleDetailDesc: '設定'.repeat(1600) }, greetings: { welcome: '月台上的廣播叫出你的名字。你要上車嗎？', alternates: [], prologue: [] }, hashes: { card: '', welcome: '', worldbook: '', authorAsset: '', content: '' } } as never);
    await submitHosted(env, { memberId, account: 10001, role: draft, token: 't', rating: GENERAL_RATING, operationId: crypto.randomUUID(), now: Date.now() });
    const s = (await pendingSubmissionOf(env.DB, (await getCard(env.DB, 'draft', 'harbor'))!.id))!;
    const a = await makeReviewer(20001);
    await claim(env.DB, s.id, a, Date.now());
    await stamp(env.DB, { submissionId: s.id, memberId: a, verdict: 'reject', note: '', now: Date.now(), reasons: ['opening.no_reply_hook'] });
    // 再補 9 張同理由的駁回（另 4 位作者）與 10 張通過，駁回與理由都湊滿 10 筆、5 位作者
    await many(9, 4, { result: 'rejected', at: Date.now(), reasons: ['opening.no_reply_hook'] });
    await many(10, 5, { result: 'approved', at: Date.now(), prefix: 'ok' });
    const now = Date.now() + 7 * DAY;
    expect(await cellOf('decisions', 'all', now, 1)).toEqual({ status: 'ok', n: 20, values: { approved: 10, rejected: 10, rate: 0.5 } });
    // 真的那張駁回的理由代碼與作者都讀到了：10 筆、5 位作者才會公開
    expect(await cellOf('reasons', 'opening.no_reply_hook', now, 1)).toMatchObject({ status: 'ok', n: 10, values: { count: 10, share: 1 } });
  });
});

describe('抑制', () => {
  it('9 筆抑制；10 筆但只有 4 位作者抑制；10 筆 5 位作者才顯示，抑制格不帶任何數字', async () => {
    await many(9, 9, { result: 'approved', at: W2 + DAY });
    expect(await cellOf('decisions', 'all', NOW, 1 + 3)).toEqual({ status: 'suppressed' });
    await resetDb();
    await many(10, 4, { result: 'approved', at: W2 + DAY });
    expect(await cellOf('decisions', 'all')).toEqual({ status: 'suppressed' });
    await resetDb();
    await many(10, 5, { result: 'approved', at: W2 + DAY });
    expect(await cellOf('decisions', 'all')).toMatchObject({ status: 'ok', n: 10 });
  });

  it('窗口總計：任何一週被抑制，總計也抑制（換不同週數的窗口互減也反推不出小週）', async () => {
    await many(10, 5, { result: 'approved', at: W3 + DAY });
    await many(3, 3, { result: 'approved', at: W1 + DAY, prefix: 'small' });
    expect(await cellOf('decisions', 'all')).toEqual({ status: 'suppressed' });
    // 只看最近兩週：小週不在窗口裡，總計照常顯示
    expect(await cellOf('decisions', 'all', NOW, 2)).toMatchObject({ status: 'ok', n: 10 });
  });

  it('互補格：開場字數五段裡只有一段被抑制時，再抑制一段，總數減其他段反推不出來', async () => {
    await many(12, 6, { result: 'approved', at: W2 + DAY, opening: 50 });
    await many(10, 5, { result: 'rejected', at: W2 + DAY, opening: 700, reasons: ['other'], prefix: 'long' });
    await many(3, 3, { result: 'approved', at: W2 + DAY, opening: 400, prefix: 'mid' });
    expect(await cellOf('decisions', 'all')).toMatchObject({ status: 'ok', n: 25 });
    expect(await cellOf('opening', '300_599')).toEqual({ status: 'suppressed' });
    // 最小的另一段（600–1199，10 筆）跟著抑制；沒有資料的段照實顯示 0
    expect(await cellOf('opening', '600_1199')).toEqual({ status: 'suppressed' });
    expect(await cellOf('opening', 'lt100')).toMatchObject({ status: 'ok', n: 12 });
    expect(await cellOf('opening', 'ge1200')).toEqual({ status: 'ok', n: 0, values: { approved: 0, rejected: 0, rejectRate: null } });
  });
});

it('真的 0 與量不到分開：沒有資料的段是 0，沒記錄的分母與 V2 前的理由是量不到', async () => {
  await many(10, 5, { result: 'approved', at: W2 + DAY, opening: 50 });
  await many(10, 5, { result: 'approved', at: W2 + DAY, opening: null, prefix: 'nofeat' });
  const s = statsJson(await reviewStats(env.DB, { now: NOW, weeks: 4 }));
  expect(s.cells.opening!.lt100).toEqual({ status: 'ok', n: 10, values: { approved: 10, rejected: 0, rejectRate: 0 } });
  expect(s.cells.opening!['100_299']).toEqual({ status: 'ok', n: 0, values: { approved: 0, rejected: 0, rejectRate: null } });
  // 沒有送審特徵的單不算進任何一段，另列（不是 0 字）
  expect(s.cells.opening!.missing).toEqual({ status: 'ok', n: 10, values: { approved: 10, rejected: 0, rejectRate: 0 } });
  expect(s.cells.marks!['v1:rate']).toEqual({ status: 'unmeasured' });
  expect(s.cells['baseline.reasons']!.all).toEqual({ status: 'unmeasured' });
  expect(s.empty).toBe(false);
  expect(s.specVersion).toBe(1);
  expect(s.thresholds).toEqual({ rows: 10, authors: 5 });
});

it('駁回理由：每單同理由算一次，多選合計可超過 100%；有代碼的駁回 ÷ 全部駁回', async () => {
  await many(10, 5, { result: 'rejected', at: W2 + DAY, reasons: ['opening.no_reply_hook', 'opening.exposition_only'] });
  await many(2, 2, { result: 'rejected', at: W2 + DAY, reasons: null, prefix: 'legacy' });
  const s = statsJson(await reviewStats(env.DB, { now: NOW, weeks: 4 }));
  const hook = s.cells.reasons!['opening.no_reply_hook'], setup = s.cells.reasons!['opening.exposition_only'];
  expect(hook).toEqual({ status: 'ok', n: 10, denominator: 10, values: { count: 10, share: 1 } });
  expect(setup).toEqual({ status: 'ok', n: 10, denominator: 10, values: { count: 10, share: 1 } });
  const shares = Object.values(s.cells.reasons!).flatMap((c) => (c.status === 'ok' && 'share' in c.values ? [c.values.share ?? 0] : []));
  expect(shares.reduce((a, b) => a + b, 0)).toBeGreaterThan(1);
  expect(s.cells.reasons!.coverage).toEqual({ status: 'ok', n: 12, values: { coded: 10, rejects: 12, rate: 10 / 12 } });
});

it('分母跟著上層格：有代碼的駁回被抑制時，沒用到的理由不帶分母、比例是 null（CSV 同樣）', async () => {
  await many(12, 6, { result: 'approved', at: W2 + DAY });
  await many(3, 3, { result: 'rejected', at: W2 + DAY, reasons: ['other'], prefix: 'r' });
  const stats = await reviewStats(env.DB, { now: NOW, weeks: 4 });
  const s = statsJson(stats);
  expect(s.cells.reasons!.coverage).toEqual({ status: 'suppressed' });
  expect(s.cells.reasons!.other).toEqual({ status: 'suppressed' });
  expect(s.cells.reasons!['opening.too_short']).toEqual({ status: 'ok', n: 0, values: { count: 0, share: null } });
  const csv = statsCsv(stats);
  // V2 從第一筆事件（12-07 那週）開始：總計寫實際涵蓋的範圍
  expect(csv).toContain('2026-12-07..2026-12-28,reasons.share,opening.too_short,,0\n');
  expect(csv).toContain('2026-12-07,reasons.count,opening.too_short,0,0\n');
  expect(csv).not.toMatch(/,reasons\.\w+,[^,]+,[^,]*,3\n/);
});

it('標記覆寫：沒有人改過是真的 0；比例的分母沒有記錄，是量不到', async () => {
  const s = statsJson(await reviewStats(env.DB, { now: NOW, weeks: 4 }));
  expect(s.cells.marks!.v1).toEqual({ status: 'ok', n: 0, values: { authors: 0 } });
  expect(s.cells.marks!['v1:rate']).toEqual({ status: 'unmeasured' });
});

it('存量：待審與不受理分開數，不受理的年齡從案件起點算；不到 10 張抑制', async () => {
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < 11; i++) {
    const id = `pend-${i}`;
    stmts.push(
      env.DB.prepare(`INSERT INTO review_submissions(id,card_id,provider,source_role_id,kind,status,submitted_at) VALUES(?,?,'harbor',?,'first','pending',?)`).bind(id, 300000 + i, `role-${i}`, NOW - (i === 0 ? 3.5 : 1) * DAY),
      env.DB.prepare(`INSERT INTO review_submission_features(submission_id,spec_version,author_member_id,features,created_at) VALUES(?,1,?,'{}',?)`).bind(id, `author-${i % 5}`, NOW - DAY),
    );
  }
  // 第 11 張在不受理清單：案件 2 天前開
  stmts.push(
    env.DB.prepare(`INSERT INTO review_drop_cases(id,card_id,author_member_id,source,opened_by,opened_at) VALUES('k1',300010,'author-0','single','rev',?)`).bind(NOW - 2 * DAY),
    env.DB.prepare(`INSERT INTO review_drops(id,submission_id,case_id,source,created_at) VALUES('d1','pend-10','k1','single',?)`).bind(NOW - 2 * DAY),
  );
  await env.DB.batch(stmts);
  const s = statsJson(await reviewStats(env.DB, { now: NOW, weeks: 4 }));
  expect(s.cells.stock!.pending).toEqual({ status: 'ok', n: 10, values: { count: 10, oldestDays: 3 } });
  expect(s.cells.stock!.dropped).toEqual({ status: 'suppressed' });
});

it('駁回後 14 天內再送：只算已滿 14 天的駁回，第 15 天才送的不算', async () => {
  const rejectAt = W2 + DAY;
  const cards: number[] = [];
  for (let i = 0; i < 10; i++) cards.push((await decision({ author: `a-${i % 5}`, result: 'rejected', at: rejectAt, reasons: ['opening.too_short'] })).card);
  // 6 張在 3 天內改了再送；1 張第 15 天才送
  for (let i = 0; i < 6; i++) await env.DB.batch([event(`submit:re-${i}`, `re-${i}`, cards[i]!, rejectAt + 3 * DAY, 'submit', 'author')]);
  await env.DB.batch([event('submit:late', 'late', cards[6]!, rejectAt + 15 * DAY, 'submit', 'author')]);
  // 不滿 14 天的駁回不進分母
  await many(3, 3, { result: 'rejected', at: NOW - 10 * DAY, reasons: ['other'], prefix: 'fresh' });
  const cell = await cellOf('resubmit', 'all');
  expect(cell).toMatchObject({ status: 'ok', n: 10, values: { resubmitted: 6, rate: 0.6 } });
  expect(await cellOf('resubmit', 'reason:opening.too_short')).toMatchObject({ status: 'ok', n: 10, values: { resubmitted: 6 } });
});

describe('不受理第 7 天', () => {
  async function cases(restoreDay: number | null, opts: { withdrawDay?: number } = {}) {
    const opened = W1 + DAY;
    for (let i = 0; i < 10; i++) {
      const caseId = `case-${restoreDay}-${i}`, sid = `drop-sub-${restoreDay}-${i}`;
      const restored = restoreDay === null ? null : opened + restoreDay * DAY;
      const stmts = [
        env.DB.prepare(`INSERT INTO review_drop_cases(id,card_id,author_member_id,fingerprint,source,opened_by,opened_at,closed_at,close_reason) VALUES(?,?,?,NULL,'single','rev',?,?,?)`)
          .bind(caseId, 200000 + i, `author-${i % 5}`, opened, restored, restored === null ? null : 'restored'),
        env.DB.prepare(`INSERT INTO review_drops(id,submission_id,case_id,source,actor_member_id,created_at,restored_at,restored_by) VALUES(?,?,?,'single','rev',?,?,?)`)
          .bind(`d-${caseId}`, sid, caseId, opened, restored, restored === null ? null : 'rev'),
        event(`drop:${caseId}`, sid, 200000 + i, opened, 'drop', 'reviewer', 'dropped', null, 'single'),
      ];
      if (opts.withdrawDay !== undefined) stmts.push(event(`superseded:${sid}`, sid, 200000 + i, opened + opts.withdrawDay * DAY, 'superseded', 'system', 'superseded', null, 'dropped'));
      await env.DB.batch(stmts);
    }
  }
  it('第 8 天才復原：第 7 天的狀態是仍不受理，不是已復原', async () => {
    await cases(8);
    expect(await cellOf('drop_outcome', 'still_dropped')).toMatchObject({ status: 'ok', n: 10, values: { count: 10, share: 1 } });
    expect(await cellOf('drop_outcome', 'restored')).toMatchObject({ status: 'ok', n: 0 });
  });
  it('第 6 天復原算已復原；作者第 2 天撤回、沒再送算撤回未送', async () => {
    await cases(6);
    expect(await cellOf('drop_outcome', 'restored')).toMatchObject({ status: 'ok', n: 10 });
    await resetDb();
    await cases(null, { withdrawDay: 2 });
    expect(await cellOf('drop_outcome', 'withdrawn')).toMatchObject({ status: 'ok', n: 10 });
    expect(await cellOf('drop_outcome', 'still_dropped')).toMatchObject({ status: 'ok', n: 0 });
  });
  it('入案不滿 7 天的案件不進分母', async () => {
    await cases(null);
    // W1 那週要到 W2 結束（週末＋7 天）才成熟：之前是量不到，不是 0
    expect(await cellOf('drop_outcome', 'all', W2 + 12 * HOUR, 1)).toEqual({ status: 'unmeasured' });
    expect(await cellOf('drop_outcome', 'all', W3 - HOUR, 2)).toEqual({ status: 'unmeasured' });
    expect(await cellOf('drop_outcome', 'all', W3 + 12 * HOUR, 2)).toMatchObject({ status: 'ok', n: 10 });
  });
});

it('CSV：同一份抑制結果，沒有作者、單號、卡號或精確時間', async () => {
  await many(12, 6, { result: 'approved', at: W2 + DAY, opening: 50 });
  await many(3, 3, { result: 'rejected', at: W2 + DAY, opening: 400, reasons: ['other'], prefix: 'mid' });
  const stats = await reviewStats(env.DB, { now: NOW, weeks: 4 });
  const csv = statsCsv(stats);
  const json = statsJson(stats);
  expect(csv.split('\n')[0]).toBe('utc_week,section,dimension,value,denominator');
  for (const bad of ['author-', 'mid-', 'sub-', '10000', 'card:', 'T0', 'Z']) expect(csv).not.toContain(bad);
  const total = '2026-12-07..2026-12-28';
  for (const [section, dims] of Object.entries(json.cells)) {
    for (const [dimension, cell] of Object.entries(dims)) {
      if (section === 'stock' || section.startsWith('baseline.')) continue;
      // 再送與不受理的總計只到已成熟的週（現在 12-30：再送到 12-14、不受理到 12-21）
      const label = section === 'resubmit' ? '2026-12-07..2026-12-14' : section.startsWith('drop_outcome') || section === 'drop_restored' ? '2026-12-07..2026-12-21' : total;
      if (cell.status === 'ok') for (const k of Object.keys(cell.values)) expect(csv).toContain(`${label},${section}.${k},${dimension},`);
      else expect(csv).toContain(`${label},${section},${dimension},${cell.status},`);
    }
  }
  // 小格：週與總計都只寫 suppressed
  expect(csv).toContain(`2026-12-07,opening,300_599,suppressed,`);
  expect(csv).toContain(`${total},opening,300_599,suppressed,`);
  expect(csv).not.toMatch(/^(2026-12-07|2026-11-30\.\.2026-12-28),opening\.\w+,300_599,/m);
});

describe('權限', () => {
  beforeEach(async () => {
    await makeMember(10001);
    await makeReviewer(2); await makeReviewer(3); await makeReviewer(4);
    await env.DB.prepare("UPDATE reviewers SET role='manager' WHERE member_id='member-3'").run();
    await env.DB.prepare("UPDATE reviewers SET role='owner' WHERE member_id='member-4'").run();
    identities({ author: 10001, reviewer: 2, manager: 3, owner: 4 });
  });
  const get = (path: string, token?: string) => SELF.fetch(`https://c.test${path}`, { headers: token ? bearer(token) : {} });
  it('一般審核員與作者 403、未登入 401；管理員與擁有者讀得到 JSON 與 CSV', async () => {
    for (const path of ['/v1/review/stats', '/v1/review/stats/export']) {
      expect((await get(path)).status).toBe(401);
      expect((await get(path, 'author')).status).toBe(403);
      expect((await get(path, 'reviewer')).status).toBe(403);
      expect((await get(path, 'manager')).status).toBe(200);
      expect((await get(path, 'owner')).status).toBe(200);
    }
    const json = await (await get('/v1/review/stats?weeks=2', 'manager')).json<{ weeks: number; cells: Record<string, unknown>; specVersion: number; generatedAt: number }>();
    expect(json.weeks).toBe(2);
    expect(json.cells.decisions).toBeDefined();
    const csv = await get('/v1/review/stats/export', 'manager');
    expect(csv.headers.get('Content-Type')).toContain('text/csv');
    expect(csv.headers.get('Content-Disposition')).toMatch(/^attachment; filename="review-stats-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect((await get('/v1/review/stats?weeks=13', 'manager')).status).toBe(400);
    expect((await get('/v1/review/stats?weeks=0', 'manager')).status).toBe(400);
    const metrics = await SELF.fetch('https://c.test/metrics').then((r) => r.text());
    expect(metrics).toContain('hearthroom_review_stats_total{operation="read",outcome="denied"}');
  });
});

it('沒有任何事件：空狀態，起算日是上線時間；窗口與週一對齊', async () => {
  const s = await reviewStats(env.DB, { now: NOW, weeks: 4 });
  expect(s.empty).toBe(true);
  expect(s.v2Recorded).toBe(false);
  expect(s.v2StartedAt).toBe(Date.UTC(2026, 10, 23, 6, 27));
  expect(s.window).toMatchObject({ start: W1, end: W4 + 7 * DAY });
  // 頁面只拿到日期，不拿到最早一筆事件的時刻
  expect(statsJson(s).v2StartedAt).toBe(Date.UTC(2026, 10, 23));
  expect(new Date(weekStart(NOW)).getUTCDay()).toBe(1);
});

/** 某一週（或 all）某格的結果：CSV 才有週別，這裡直接讀彙總列 */
const weekCell = (s: ReviewStats, period: string, section: string, dimension: string) => s.rows.find((r) => r.period === period && r.section === section && r.dimension === dimension)?.cell;

describe('跨區塊的加總關係', () => {
  it('人工作業的「不受理」＝人工三種來源相加：同裝置批次 5 張被抑制時，單張也抑制（不然 25 − 20 − 0 解得出 5）', async () => {
    const stmts: D1PreparedStatement[] = [];
    for (let i = 0; i < 25; i++) {
      const sid = `dr-${i}`, card = 600000 + i, single = i < 20;
      const author = single ? `author-${i % 5}` : `dev-${i - 20}`;
      stmts.push(
        env.DB.prepare(`INSERT INTO review_submission_features(submission_id,spec_version,author_member_id,features,created_at) VALUES(?,1,?,'{}',?)`).bind(sid, author, W2),
        env.DB.prepare(`INSERT INTO review_drop_cases(id,card_id,author_member_id,source,opened_by,opened_at) VALUES(?,?,?,?,'rev',?)`).bind(`k-${i}`, card, author, single ? 'single' : 'device_batch', W2 + DAY),
        env.DB.prepare(`INSERT INTO review_drops(id,submission_id,case_id,source,actor_member_id,batch_id,created_at) VALUES(?,?,?,?,'rev',?,?)`).bind(`d-${i}`, sid, `k-${i}`, single ? 'single' : 'device_batch', single ? null : 'b1', W2 + DAY),
        event(`drop:d-${i}`, sid, card, W2 + DAY, 'drop', 'reviewer', 'dropped', null, single ? 'single' : 'device_batch'),
      );
    }
    await env.DB.batch(stmts);
    const s = statsJson(await reviewStats(env.DB, { now: NOW, weeks: 4 }));
    expect(s.cells.operations!.drop).toMatchObject({ status: 'ok', n: 25 });
    expect(s.cells.drop_source!.device_batch).toEqual({ status: 'suppressed' });
    expect(s.cells.drop_source!.single).toEqual({ status: 'suppressed' });
    expect(s.cells.drop_source!.author_batch).toEqual({ status: 'ok', n: 0, values: { count: 0 } });
  });

  it('標記：各類×方向加起來等於該版；取消 3 位被抑制時，加標也抑制；沒出現的組合是明確的 0', async () => {
    const stmts: D1PreparedStatement[] = [];
    const mark = (author: string, value: string, auto: string) => env.DB.prepare(`INSERT INTO review_author_marks(id,author_member_id,kind,value,auto_value,reason_code,note,rule_version,actor_member_id,created_at,expires_at)
      VALUES(?,?,'tier',?,?,'content_checked','',1,'rev',?,?)`).bind(crypto.randomUUID(), author, value, auto, W2 + DAY, W2 + 90 * DAY);
    for (let i = 0; i < 12; i++) stmts.push(mark(`m-${i}`, 'stable', 'general'));
    for (let i = 0; i < 3; i++) stmts.push(mark(`c-${i}`, 'none', 'stable'));
    await env.DB.batch(stmts);
    const s = statsJson(await reviewStats(env.DB, { now: NOW, weeks: 4 }));
    expect(s.cells.marks!.v1).toEqual({ status: 'ok', n: 15, values: { authors: 15 } });
    expect(s.cells.marks!['v1:tier:cancel']).toEqual({ status: 'suppressed' });
    expect(s.cells.marks!['v1:tier:add']).toEqual({ status: 'suppressed' });
    expect(s.cells.marks!['v1:batch:add']).toEqual({ status: 'ok', n: 0, values: { authors: 0 } });
    expect(s.cells.marks!['v1:tier:change']).toEqual({ status: 'ok', n: 0, values: { authors: 0 } });
  });

  it('陪抑制只挑一格：一段被抑制、總數也被抑制時，其餘沒有資料的段照實顯示 0，不會一路連鎖', async () => {
    await many(3, 3, { result: 'approved', at: W2 + DAY, opening: 400 });
    const s = statsJson(await reviewStats(env.DB, { now: NOW, weeks: 4 }));
    expect(s.cells.decisions!.all).toEqual({ status: 'suppressed' });
    expect(s.cells.opening!['300_599']).toEqual({ status: 'suppressed' });
    for (const k of ['lt100', '100_299', '600_1199', 'ge1200', 'missing']) expect(s.cells.opening![k], k).toMatchObject({ status: 'ok', n: 0 });
  });
});

describe('隨時間成熟的格子', () => {
  it('10 天前的駁回所在的週還沒成熟：量不到、不算進總計；之後才定案的新單不改寫已公開的週', async () => {
    const rejectAt = W2 + DAY;
    const cards: number[] = [];
    for (let i = 0; i < 10; i++) cards.push((await decision({ author: `a-${i % 5}`, result: 'rejected', at: rejectAt, reasons: ['opening.too_short'] })).card);
    const horizon = W3 + RESUBMIT * DAY; // W2 結束＋14 天
    for (let i = 0; i < 6; i++) {
      const sid = `re-${i}`;
      const stmts = [event(`submit:${sid}`, sid, cards[i]!, rejectAt + 3 * DAY, 'submit', 'author')];
      // 3 張在期限內通過；1 張期限後才通過（不算已定案）
      if (i < 3) stmts.push(event(`first:${sid}`, sid, cards[i]!, rejectAt + 5 * DAY, 'first_decision', 'system', 'approved'));
      if (i === 3) stmts.push(event(`first:${sid}`, sid, cards[i]!, horizon + DAY, 'first_decision', 'system', 'approved'));
      await env.DB.batch(stmts);
    }
    // 10 天前的駁回（12-20，在 12-14 那週）：那週要到 12-21＋14 天才成熟
    await many(10, 5, { result: 'rejected', at: NOW - 10 * DAY, reasons: ['other'], prefix: 'fresh' });
    const a = await reviewStats(env.DB, { now: NOW, weeks: 4 });
    expect(weekCell(a, '2026-12-14', 'resubmit', 'all')).toEqual({ status: 'unmeasured' });
    expect(weekCell(a, '2026-12-21', 'resubmit', 'all')).toEqual({ status: 'unmeasured' });
    const w2 = weekCell(a, '2026-12-07', 'resubmit', 'all');
    expect(w2).toEqual({ status: 'ok', n: 10, values: { resubmitted: 6, rate: 0.6, decided: 3, approved: 3, passRate: 1 } });
    expect(weekCell(a, 'all', 'resubmit', 'all')).toEqual(w2);
    expect(a.matured.resubmit).toBe(W3);
    // 現在往後推八天：W2 那一格一模一樣（期限後才定案的那張依然不算）
    const b = await reviewStats(env.DB, { now: NOW + 8 * DAY, weeks: 4 });
    expect(weekCell(b, '2026-12-07', 'resubmit', 'all')).toEqual(w2);
  });
});

it('V2 開始之前就結束的週是量不到，不是 0；回應帶實際起算日', async () => {
  await many(10, 5, { result: 'approved', at: W3 + DAY });
  const stats = await reviewStats(env.DB, { now: NOW, weeks: 4 });
  expect(weekCell(stats, '2026-11-30', 'decisions', 'all')).toEqual({ status: 'unmeasured' });
  expect(weekCell(stats, '2026-12-07', 'decisions', 'all')).toEqual({ status: 'unmeasured' });
  expect(weekCell(stats, '2026-12-14', 'decisions', 'all')).toMatchObject({ status: 'ok', n: 10 });
  expect(weekCell(stats, 'all', 'decisions', 'all')).toMatchObject({ status: 'ok', n: 10 });
  const json = statsJson(stats);
  // 第一筆事件是 12-14 14:00 的送審（定案前 10 小時）
  expect(json.window.effectiveStart).toBe(Date.UTC(2026, 11, 14));
  expect(statsCsv(stats)).toContain('2026-12-14..2026-12-28,decisions.rate,all,1,10\n');
  expect(statsCsv(stats)).toContain('2026-11-30,decisions,all,unmeasured,\n');
});

it('查詢走索引：大表（審核事件、審核章、審核單）都不整表掃描', async () => {
  const binds: Partial<Record<keyof typeof STATS_SQL, unknown[]>> = { decisions: [1, 2], firstAction: [1, 2, 0], rejects: [1, 2], ops: [1, 2], bStamps: [1, 2], bDecisions: [1, 2], candidates: ['[]', '[]'], drops: ['[]'], cases: [1, 2], sources: [1, 2], marks: [1, 2] };
  const plans: Record<string, string[]> = {};
  for (const [k, sql] of Object.entries(STATS_SQL)) {
    plans[k] = (await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...(binds[k as keyof typeof STATS_SQL] ?? [])).all<{ detail: string }>()).results.map((r) => r.detail);
  }
  for (const [k, lines] of Object.entries(plans)) {
    for (const line of lines) expect(line, `${k}: ${line}`).not.toMatch(/^SCAN (review_events|review_stamps|review_submissions|e|x|y|s|st|sub)\b/);
  }
  expect(plans.ops!.join('\n')).toContain('idx_review_events_action_time (action=? AND at>? AND at<?)');
  expect(plans.bStamps!.join('\n')).toContain('idx_review_stamps_created');
  expect(plans.candidates!.join('\n')).toContain('idx_review_events_card_time (card_id=?)');
  expect(plans.candidates!.join('\n')).toContain('idx_submissions_card (card_id=?)');
  expect(plans.firstAction!.join('\n')).toContain('idx_review_events_submission (submission_id=?)');
  expect(plans.v2Start!.every((l) => !/^SCAN review_events/.test(l))).toBe(true);
});
