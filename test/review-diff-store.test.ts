import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERAL_RATING, makeMember, makeReviewer, resetDb, role } from './helpers';
import { beginHostedEdit, hostGateway, submitHosted } from '../src/hosting';
import { claim, listQueue, pendingSubmissionOf, stamp } from '../src/review';
import { computeDiffSummary, diffMaintenance, diffView } from '../src/review-diff-store';
import { getCard } from '../src/cards';
import { upstream } from '../src/upstream';

// 審卡 V2 第二批：更新差異的基準在送審時固定，摘要送審後補算，讀不到就是「無法比較」。
beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const LONG = '設定'.repeat(1600);
async function setup() {
  const memberId = await makeMember(10001);
  const draft = role({ roleId: 'draft', authorNumId: 10001 });
  const content = { setting: LONG, welcome: '月台上的廣播叫出你的名字。你要上車嗎？' };
  const sealed = new Map<string, unknown>();
  let seal = 0;
  vi.spyOn(hostGateway, 'seal').mockImplementation(async (_e, _t, _id, workId, versionId) => ({ workId, versionId, hostedRevisionId: `sealed-${++seal}` }));
  vi.spyOn(hostGateway, 'read').mockImplementation(async (_e, _t, id) => ({ ...draft, roleId: id }));
  const settings = () => ({
    document: { roleName: 'Fixture', roleTag: ['Roleplay'], roleDetailDesc: content.setting },
    greetings: { welcome: content.welcome, alternates: [], prologue: [] },
    worldbooks: [], authorAsset: { rules: [] }, hashes: { card: '', welcome: '', worldbook: '', authorAsset: '', content: '' },
  });
  // 封存當下的設定記在封存版號底下：之後讀封存版拿到的是那一刻的內容
  vi.spyOn(upstream, 'readForReview').mockImplementation(async (_e, _t, id) => { const s = settings(); sealed.set(id, structuredClone(s)); return s as never; });
  const readSealed = vi.spyOn(upstream, 'readSealedForReview').mockImplementation(async (_e, id) => { const s = sealed.get(id); if (!s) throw new Error('not found'); return structuredClone(s) as never; });
  const submit = () => submitHosted(env, { memberId, account: 10001, role: draft, token: 't', rating: GENERAL_RATING, operationId: crypto.randomUUID(), now: Date.now() });
  const pending = async () => (await pendingSubmissionOf(env.DB, (await getCard(env.DB, 'draft', 'harbor'))!.id))!;
  const decide = async (verdict: 'approve' | 'reject') => {
    const s = await pending(); const r = await makeReviewer(20000 + Math.floor(Math.random() * 9000));
    await claim(env.DB, s.id, r, Date.now());
    await stamp(env.DB, { submissionId: s.id, memberId: r, verdict, note: '', now: Date.now(), reasons: verdict === 'reject' ? ['opening.too_short'] : undefined }, env as never);
  };
  return { memberId, content, submit, pending, decide, readSealed, edit: () => beginHostedEdit(env.DB, memberId, 'draft', Date.now()) };
}
const rowOf = (id: string) => env.DB.prepare('SELECT base_kind, base_revision, state, summary, attempts FROM review_submission_diffs WHERE submission_id=?').bind(id).first<Record<string, unknown>>();

describe('更新差異', () => {
  it('新卡沒有基準；駁回後重送比上次駁回版，摘要只寫改了什麼', async () => {
    const f = await setup();
    await f.submit();
    const first = await f.pending();
    expect(await rowOf(first.id)).toBeNull();
    await f.decide('reject');
    await f.edit();
    f.content.welcome = '列車進站，車門打開。站務員看著你：「要上車嗎？」';
    await f.submit();
    const second = await f.pending();
    const row = await rowOf(second.id);
    expect(row).toMatchObject({ base_kind: 'rejected', base_revision: first.source_role_id, state: 'pending' });
    expect(await computeDiffSummary(env as never, second.id)).toBe('done');
    const summary = JSON.parse(String((await rowOf(second.id))!.summary));
    expect(summary.changedFields).toEqual(['opening']);
    expect(summary.opening.changed).toBe(true);
    // 佇列的「更新」列帶著摘要
    const [item] = await listQueue(env.DB, await makeReviewer(29999), Date.now(), 'zh', 'updates');
    expect(item.diff).toMatchObject({ state: 'done' });
  });

  it('已上架的卡送更新：比上次過審版；兩邊一樣就是沒有改動', async () => {
    const f = await setup();
    await f.submit();
    const first = await f.pending();
    await f.decide('approve');
    await f.submit();
    const update = await f.pending();
    expect(await rowOf(update.id)).toMatchObject({ base_kind: 'approved', base_revision: first.source_role_id });
    const view = await diffView(env as never, update.id);
    expect(view.state).toBe('ready');
    if (view.state === 'ready') expect(view.diff.summary.unchanged).toBe(true);
  });

  it('讀不到封存版：三次後記成無法比較，排程會補漏', async () => {
    const f = await setup();
    await f.submit();
    await f.decide('reject');
    await f.edit();
    await f.submit();
    const s = await f.pending();
    f.readSealed.mockRejectedValue(new Error('sealed revision read failed with 502'));
    await diffMaintenance(env as never, Date.now());
    await diffMaintenance(env as never, Date.now());
    expect(await rowOf(s.id)).toMatchObject({ state: 'pending', attempts: 2 });
    await diffMaintenance(env as never, Date.now());
    expect(await rowOf(s.id)).toMatchObject({ state: 'unreadable', attempts: 3 });
    expect((await diffView(env as never, s.id)).state).toBe('unreadable');
  });

  it('0146 之前就在排隊的單：排程替它補上基準', async () => {
    const f = await setup();
    await f.submit();
    await f.decide('reject');
    await f.edit();
    await f.submit();
    const s = await f.pending();
    await env.DB.prepare('DELETE FROM review_submission_diffs').run();
    await diffMaintenance(env as never, Date.now());
    expect(await rowOf(s.id)).toMatchObject({ base_kind: 'rejected', state: 'done' });
  });
});
