import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERAL_RATING, makeMember, makeReviewer, resetDb, role } from './helpers';
import { beginHostedEdit, hostGateway, submitHosted } from '../src/hosting';
import { claim, listQueue, pendingSubmissionOf, queueCounts, statusAmong, stamp } from '../src/review';
import { dropBatch, dropSubmission, groupSubmissionIds, listDropped, restoreBatch, restoreSubmission } from '../src/review-drop';
import { authorProfiles, autoTier, wilsonLower } from '../src/review-profile';
import { contentFingerprint } from '../src/review-v2';
import { getCard } from '../src/cards';
import { upstream } from '../src/upstream';

// 審卡 V2 第一批（任務 2026-11-23-review-system-v2）：結構化駁回理由、不受理、同內容自動移出、批量、事件紀錄。
beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const LONG = '設定'.repeat(1600);
interface Content { setting: string; welcome: string; entries?: string[] }

async function setup(opts: { account?: number; roleId?: string } = {}) {
  const account = opts.account ?? 10001, roleId = opts.roleId ?? 'draft';
  const memberId = await makeMember(account);
  const draft = role({ roleId, authorNumId: account });
  const content: Content = { setting: LONG, welcome: '月台上的廣播叫出你的名字。你要上車嗎？' };
  let seal = 0;
  vi.spyOn(hostGateway, 'seal').mockImplementation(async (_env, _token, _id, workId, versionId) => ({ workId, versionId, hostedRevisionId: `sealed-${roleId}-${++seal}` }));
  vi.spyOn(hostGateway, 'read').mockImplementation(async (_env, _token, id) => ({ ...draft, roleId: id }));
  // 每次封存，世界書都換新編號（Harbor CloneHostedBook）：指紋不能因此變
  vi.spyOn(upstream, 'readForReview').mockImplementation(async () => ({
    document: { roleName: 'Fixture', roleTag: ['Roleplay'], roleDetailDesc: content.setting, roleBackground: `https://cdn.test/versions/${crypto.randomUUID()}` },
    greetings: { welcome: content.welcome, alternates: [], prologue: [] },
    worldbooks: [{ worldbookId: crypto.randomUUID(), name: 'book', description: '', format: '', entries: (content.entries ?? []).map((e, i) => ({ entryId: String(i), name: 'e', content: e, keywords: [], secondaryKeywords: [], category: '', isEnabled: true, isConstant: false, triggerRegion: '' })) }],
    authorAsset: { rules: [], mountTrigger: '', mountLayer: '', pageMode: 'classic', status: 'ok', version: seal },
    hashes: { card: '', welcome: '', worldbook: '', authorAsset: '', content: '' },
  }) as never);
  const submit = (deviceHash?: string) => submitHosted(env, { memberId, account, role: draft, token: 'fixture', rating: GENERAL_RATING, operationId: crypto.randomUUID(), now: Date.now(), deviceHash: deviceHash ?? null });
  const pending = async () => (await pendingSubmissionOf(env.DB, (await getCard(env.DB, roleId, 'harbor'))!.id))!;
  const edit = () => beginHostedEdit(env.DB, memberId, roleId, Date.now());
  return { memberId, draft, content, submit, pending, edit, roleId };
}

const reviewer = async (n: number, manager = false) => {
  const id = await makeReviewer(n);
  if (manager) await env.DB.prepare("UPDATE reviewers SET role='manager' WHERE member_id=?").bind(id).run();
  return id;
};
const events = async (submissionId: string) => (await env.DB.prepare('SELECT action, source, reasons, actor_kind FROM review_events WHERE submission_id=? ORDER BY id').bind(submissionId).all<{ action: string; source: string | null; reasons: string | null; actor_kind: string }>()).results;
const reject = async (id: string, member: string, body: { reasons?: unknown; note?: string; coaching?: boolean }) => {
  await claim(env.DB, id, member, Date.now());
  return stamp(env.DB, { submissionId: id, memberId: member, verdict: 'reject', note: body.note ?? '', now: Date.now(), reasons: body.reasons, coaching: body.coaching });
};

describe('結構化駁回理由', () => {
  it('理由代碼跟駁回同一筆寫入，作者通知帶代碼並連到結果頁，首次定案記一筆', async () => {
    const f = await setup();
    await f.submit();
    const s = await f.pending();
    const a = await reviewer(20001);
    await reject(s.id, a, { reasons: ['opening.no_reply_hook', 'opening.exposition_only', 'opening.no_reply_hook'], coaching: true });
    const row = await env.DB.prepare('SELECT status, reject_reasons, reason_version, reject_coaching FROM review_submissions WHERE id=?').bind(s.id).first<Record<string, unknown>>();
    expect(row).toEqual({ status: 'rejected', reject_reasons: '["opening.no_reply_hook","opening.exposition_only"]', reason_version: 1, reject_coaching: 1 });
    const notice = await env.DB.prepare("SELECT path, extra FROM community_notifications WHERE kind='review_result'").first<{ path: string; extra: string }>();
    expect(notice!.path).toBe('/mine/reviews/' + s.id);
    expect(JSON.parse(notice!.extra)).toEqual({ status: 'rejected', kind: 'first', reasons: ['opening.no_reply_hook', 'opening.exposition_only'] });
    const ev = await events(s.id);
    expect(ev.map((e) => e.action)).toEqual(['submit', 'reject', 'first_decision']);
    expect(JSON.parse(ev[2].reasons!)).toEqual(['opening.no_reply_hook', 'opening.exposition_only']);
  });

  it('沒有理由不能駁回；「其他」要補充；不認得的代碼擋下', async () => {
    const f = await setup();
    await f.submit();
    const s = await f.pending();
    const a = await reviewer(20001);
    await expect(reject(s.id, a, { reasons: [] })).rejects.toThrow('review_reasons_required');
    await expect(reject(s.id, a, { reasons: ['other'] })).rejects.toThrow('review_other_needs_note');
    await expect(reject(s.id, a, { reasons: ['made.up'] })).rejects.toThrow('review_reason_invalid');
    expect((await f.pending()).status).toBe('pending');
  });

  it('舊頁面只送說明：記成「其他」，說明當補充', async () => {
    const f = await setup();
    await f.submit();
    const s = await f.pending();
    await reject(s.id, await reviewer(20001), { note: '開場沒有可以接的地方' });
    const row = await env.DB.prepare('SELECT reject_reasons, note FROM review_submissions WHERE id=?').bind(s.id).first<{ reject_reasons: string; note: string }>();
    expect(row).toEqual({ reject_reasons: '["other"]', note: '開場沒有可以接的地方' });
    expect((await events(s.id)).find((e) => e.action === 'reject')?.source).toBe('legacy_note');
  });

  it('有效字數未達標：駁回一定帶「有效字數不足」', async () => {
    const f = await setup();
    await f.submit();
    const s = await f.pending();
    await env.DB.prepare('UPDATE review_submissions SET review_length_total=10 WHERE id=?').bind(s.id).run();
    await reject(s.id, await reviewer(20001), { reasons: ['opening.too_short'] });
    const row = await env.DB.prepare('SELECT reject_reasons FROM review_submissions WHERE id=?').bind(s.id).first<{ reject_reasons: string }>();
    expect(JSON.parse(row!.reject_reasons)).toEqual(['opening.too_short', 'content.min_length']);
  });
});

describe('不受理', () => {
  it('不必領取就能移出；移出後不在佇列、領不到也蓋不了章；復原回到原位', async () => {
    const f = await setup();
    await f.submit();
    const s = await f.pending();
    const a = await reviewer(20001), b = await reviewer(20002);
    await dropSubmission(env.DB, { submissionId: s.id, memberId: a, now: Date.now() });
    expect(await listQueue(env.DB, b, Date.now(), 'zh')).toEqual([]);
    expect(await queueCounts(env.DB)).toEqual({ new: 0, updates: 0, dropped: 1 });
    await expect(claim(env.DB, s.id, b, Date.now())).rejects.toThrow('review_dropped');
    // 資料庫也擋：繞過程式直接寫章會失敗
    await expect(env.DB.prepare("INSERT INTO review_stamps(submission_id,member_id,verdict,note,created_at,claim_generation) VALUES(?,?,'approve','',?,'')").bind(s.id, b, Date.now()).run()).rejects.toThrow(/review_dropped/);
    const dropped = await listDropped(env.DB, { memberId: b, adultAllowed: true, now: Date.now(), lang: 'zh' }, 'all');
    expect(dropped.items.map((i) => [i.id, i.source])).toEqual([[s.id, 'single']]);
    expect((await restoreSubmission(env.DB, { submissionId: s.id, memberId: b, now: Date.now() })).restored).toBe(true);
    const back = await listQueue(env.DB, b, Date.now(), 'zh');
    expect(back.map((q) => [q.id, q.submittedAt])).toEqual([[s.id, s.submitted_at]]);
    expect((await events(s.id)).map((e) => e.action)).toEqual(['submit', 'drop', 'restore']);
  });

  it('別人領著、冷凍中的不能移出；自己領著的可以並放回領取', async () => {
    const f = await setup();
    await f.submit();
    const s = await f.pending();
    const a = await reviewer(20001), b = await reviewer(20002);
    await claim(env.DB, s.id, a, Date.now());
    await expect(dropSubmission(env.DB, { submissionId: s.id, memberId: b, now: Date.now() })).rejects.toThrow('claimed_by_other');
    await dropSubmission(env.DB, { submissionId: s.id, memberId: a, now: Date.now() });
    expect((await env.DB.prepare('SELECT claimed_by FROM review_submissions WHERE id=?').bind(s.id).first<{ claimed_by: string | null }>())!.claimed_by).toBeNull();
    await restoreSubmission(env.DB, { submissionId: s.id, memberId: a, now: Date.now() });
    await env.DB.prepare('INSERT INTO review_holds(card_id,member_id,submission_id,created_at) VALUES(?,?,?,?)').bind(s.card_id, a, s.id, Date.now()).run();
    await expect(dropSubmission(env.DB, { submissionId: s.id, memberId: b, now: Date.now() })).rejects.toThrow('review_held');
  });

  it('作者那邊看不出差別：不受理前後審核狀態完全一樣', async () => {
    const f = await setup();
    await f.submit();
    const s = await f.pending();
    const author = async () => {
      const st = (await statusAmong(env.DB, [f.roleId])).get(f.roleId);
      const own = await env.DB.prepare("SELECT s.status, s.note FROM review_submissions s WHERE s.id=?").bind(s.id).first();
      return { st, own };
    };
    const before = await author();
    await dropSubmission(env.DB, { submissionId: s.id, memberId: await reviewer(20001), now: Date.now() });
    expect(await author()).toEqual(before);
    expect(before.st?.status).toBe('pending');
  });

  it('作者撤回後原樣重送：自動回到不受理、沿用同一個案件；改了再送就回待審並標記', async () => {
    const f = await setup();
    await f.submit();
    const first = await f.pending();
    const a = await reviewer(20001);
    const { caseId } = await dropSubmission(env.DB, { submissionId: first.id, memberId: a, now: Date.now() });
    await f.edit();
    await f.submit();
    const second = await f.pending();
    expect(second.id).not.toBe(first.id);
    expect(await listQueue(env.DB, a, Date.now(), 'zh')).toEqual([]);
    const drop = await env.DB.prepare('SELECT case_id, source FROM review_drops WHERE submission_id=? AND restored_at IS NULL').bind(second.id).first<{ case_id: string; source: string }>();
    expect(drop).toEqual({ case_id: caseId, source: 'auto_same_content' });
    // 審核頻道不再為原樣重送發一則待審
    expect(await env.DB.prepare('SELECT 1 FROM review_deliveries WHERE id=?').bind('review:' + second.id).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM review_deliveries WHERE id=?').bind('review:' + first.id).first()).not.toBeNull();
    expect((await events(first.id)).map((e) => [e.action, e.source])).toContainEqual(['superseded', 'dropped']);

    await f.edit();
    f.content.welcome = '列車進站，車門打開。站務員看著你：「要上車嗎？還是留在月台？」';
    await f.submit();
    const third = await f.pending();
    const queue = await listQueue(env.DB, a, Date.now(), 'zh');
    expect(queue.map((q) => [q.id, q.afterDrop])).toEqual([[third.id, true]]);
    expect((await env.DB.prepare('SELECT close_reason FROM review_drop_cases WHERE id=?').bind(caseId).first<{ close_reason: string }>())!.close_reason).toBe('resubmitted_changed');
  });
});

describe('批量不受理（管理員）', () => {
  it('同一個安裝的待審單一次移出；不是管理員擋下；別人領著的略過並寫原因；可一鍵復原', async () => {
    const one = await setup({ account: 10001, roleId: 'r1' });
    await one.submit('v1:device-a');
    const two = await setup({ account: 10002, roleId: 'r2' });
    await two.submit('v1:device-a');
    const s1 = await one.pending(), s2 = await two.pending();
    const plain = await reviewer(20001), mgr = await reviewer(20003, true);
    expect((await groupSubmissionIds(env.DB, s1.id, 'device'))?.sort()).toEqual([s1.id, s2.id].sort());
    await expect(dropBatch(env.DB, { anchorId: s1.id, scope: 'device', ids: [s1.id, s2.id], memberId: plain, now: Date.now() })).rejects.toThrow('review_batch_manager_required');
    await claim(env.DB, s2.id, plain, Date.now());
    const result = await dropBatch(env.DB, { anchorId: s1.id, scope: 'device', ids: [s1.id, s2.id, 'elsewhere'], memberId: mgr, now: Date.now() });
    expect(result.dropped).toEqual([s1.id]);
    expect(result.skipped).toEqual([{ id: s2.id, reason: 'claimed_by_other' }, { id: 'elsewhere', reason: 'not_in_group' }]);
    expect((await events(s1.id)).find((e) => e.action === 'drop')?.source).toBe('device_batch');
    expect((await restoreBatch(env.DB, { batchId: result.batchId, memberId: mgr, now: Date.now() })).restored).toEqual([s1.id]);
  });

  it('安裝不認識就沒有同裝置這一組', async () => {
    const f = await setup();
    await f.submit();
    expect(await groupSubmissionIds(env.DB, (await f.pending()).id, 'device')).toBeNull();
  });

  it('離開待審就刪掉這張單的安裝紀錄', async () => {
    const f = await setup();
    await f.submit('v1:device-a');
    const s = await f.pending();
    await reject(s.id, await reviewer(20001), { reasons: ['opening.too_short'] });
    expect(await env.DB.prepare('SELECT 1 FROM review_submission_devices WHERE submission_id=?').bind(s.id).first()).toBeNull();
  });
});

describe('佇列分頁與作者標記', () => {
  it('新卡與更新分開；駁回後重送在更新；計數不受 200 筆影響', async () => {
    const f = await setup();
    await f.submit();
    const a = await reviewer(20001);
    expect((await listQueue(env.DB, a, Date.now(), 'zh', 'new')).length).toBe(1);
    expect((await listQueue(env.DB, a, Date.now(), 'zh', 'updates')).length).toBe(0);
    await reject((await f.pending()).id, a, { reasons: ['opening.too_short'] });
    await f.edit();
    f.content.welcome = '新的開場';
    await f.submit();
    expect((await listQueue(env.DB, a, Date.now(), 'zh', 'new')).length).toBe(0);
    const updates = await listQueue(env.DB, a, Date.now(), 'zh', 'updates');
    expect(updates.map((q) => q.type)).toEqual(['resubmit']);
    expect(await queueCounts(env.DB)).toEqual({ new: 0, updates: 1, dropped: 0 });
  });

  it('第一張卡的作者是新人；佇列不帶作者身分', async () => {
    const f = await setup();
    await f.submit();
    const [item] = await listQueue(env.DB, await reviewer(20001), Date.now(), 'zh');
    expect(item.authorMark).toEqual({ tier: 'new', manualTier: false, batchSuspected: false, deviceAccounts: null });
    expect(JSON.stringify(item)).not.toContain(f.memberId);
    expect(item.fast).toBe(false);
  });

  it('頭部門檻：20 件首次定案、Wilson 下限 ≥ 75；穩定：5 件 80%', () => {
    expect(autoTier({ works: 25, decided: 20, firstPass: 20, legacy: false })).toBe('top');
    expect(Math.round(wilsonLower(20, 20) * 100)).toBe(84);
    expect(autoTier({ works: 25, decided: 20, firstPass: 17, legacy: false })).toBe('stable');
    expect(autoTier({ works: 6, decided: 5, firstPass: 3, legacy: false })).toBe('general');
    expect(autoTier({ works: 2, decided: 0, firstPass: 0, legacy: true })).toBe('unknown');
    expect(autoTier({ works: 2, decided: 0, firstPass: 0, legacy: false })).toBe('new');
  });

  it('沒有成員列的作者量不到', async () => {
    expect((await authorProfiles(env.DB, ['nobody'], Date.now())).get('nobody')?.basis.memberSince).toBeNull();
  });
});

describe('內容指紋', () => {
  const draft = { avatarUrl: 'https://cdn.test/u/a.png', backgroundUrl: 'https://cdn.test/u/b.png' };
  const settings = (over: Record<string, unknown> = {}) => ({
    document: { roleName: 'A', roleDetailDesc: 'x', roleBackground: 'https://cdn.test/versions/1' },
    greetings: { welcome: 'hi', alternates: [], prologue: [] },
    worldbooks: [{ worldbookId: 'w1', name: 'b', entries: [{ entryId: '0', content: 'c' }] }],
    authorAsset: { rules: [], status: 'ok', version: 1 },
    ...over,
  });
  const fp = (s: Record<string, unknown>, d: typeof draft = draft, answers = '{}') => contentFingerprint(s, d, { ratingAnswers: answers, fandomKey: '' });

  it('重新封存（新的圖片路徑、世界書編號、版本號）指紋不變', async () => {
    const again = settings({ document: { roleName: 'A', roleDetailDesc: 'x', roleBackground: 'https://cdn.test/versions/2' }, worldbooks: [{ worldbookId: 'w2', name: 'b', entries: [{ entryId: '0', content: 'c' }] }], authorAsset: { rules: [], status: 'x', version: 9 } });
    expect(await fp(again)).toBe(await fp(settings()));
  });

  it('換封面、改世界書內容、改分級答案都會變', async () => {
    const base = await fp(settings());
    expect(await fp(settings(), { ...draft, backgroundUrl: 'https://cdn.test/u/c.png' })).not.toBe(base);
    expect(await fp(settings({ worldbooks: [{ worldbookId: 'w1', name: 'b', entries: [{ entryId: '0', content: 'changed' }] }] }))).not.toBe(base);
    expect(await fp(settings(), draft, '{"q":1}')).not.toBe(base);
  });

  it('讀不到設定就算不出來', async () => {
    expect(await fp({})).toBeNull();
  });
});
