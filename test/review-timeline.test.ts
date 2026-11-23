import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GENERAL_RATING, makeMember, makeReviewer, resetDb, role } from './helpers';
import { beginHostedEdit, hostGateway, submitHosted } from '../src/hosting';
import { claim, hold, pendingSubmissionOf, stamp, unhold } from '../src/review';
import { dropSubmission, restoreSubmission } from '../src/review-drop';
import { reviewTimeline } from '../src/review-timeline';
import { getCard } from '../src/cards';
import { upstream } from '../src/upstream';

// 單卡審核紀錄：送審、駁回（理由）、不受理與復原、冷凍、撤回後重送，依時間排成一條線，輪次分開。
beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

it('一張卡的每一件事照時間排，輪次與目前這張分得出來；作者送審不帶帳號', async () => {
  const memberId = await makeMember(10001);
  const draft = role({ roleId: 'draft', authorNumId: 10001 });
  let seal = 0, t = 1_800_000_000_000;
  vi.spyOn(hostGateway, 'seal').mockImplementation(async (_e, _t, _id, workId, versionId) => ({ workId, versionId, hostedRevisionId: `sealed-${++seal}` }));
  vi.spyOn(hostGateway, 'read').mockImplementation(async (_e, _t, id) => ({ ...draft, roleId: id }));
  vi.spyOn(upstream, 'readForReview').mockResolvedValue({ document: { roleName: 'F', roleTag: ['Roleplay'], roleDetailDesc: '設定'.repeat(1600) }, greetings: { welcome: 'hi', alternates: [], prologue: [] }, hashes: { card: '', welcome: '', worldbook: '', authorAsset: '', content: '' } } as never);
  const submit = () => submitHosted(env, { memberId, account: 10001, role: draft, token: 't', rating: GENERAL_RATING, operationId: crypto.randomUUID(), now: ++t });
  const pending = async () => (await pendingSubmissionOf(env.DB, (await getCard(env.DB, 'draft', 'harbor'))!.id))!;
  const a = await makeReviewer(20001);
  await submit();
  const s1 = await pending();
  await claim(env.DB, s1.id, a, ++t);
  const gen = (await env.DB.prepare('SELECT claim_generation FROM review_submissions WHERE id=?').bind(s1.id).first<{ claim_generation: string }>())!.claim_generation;
  await hold(env.DB, { submissionId: s1.id, memberId: a, now: ++t, generation: gen });
  await unhold(env.DB, { submissionId: s1.id, memberId: a, reason: '', now: ++t });
  await claim(env.DB, s1.id, a, ++t);
  await stamp(env.DB, { submissionId: s1.id, memberId: a, verdict: 'reject', note: '開場沒有接話點', now: ++t, reasons: ['opening.no_reply_hook'] });
  await beginHostedEdit(env.DB, memberId, 'draft', ++t);
  await submit();
  const s2 = await pending();
  await dropSubmission(env.DB, { submissionId: s2.id, memberId: a, now: ++t });
  await restoreSubmission(env.DB, { submissionId: s2.id, memberId: a, now: ++t });

  const { items, coverageFrom } = await reviewTimeline(env.DB, s2.id, a);
  expect(items.map((i) => [i.action, i.round, i.current])).toEqual([
    ['submit', 1, false], ['hold', 1, false], ['unhold', 1, false], ['reject', 1, false],
    ['submit', 2, true], ['drop', 2, true], ['restore', 2, true],
  ]);
  const reject = items.find((i) => i.action === 'reject')!;
  expect(reject).toMatchObject({ reasons: ['opening.no_reply_hook'], note: '開場沒有接話點', mine: true });
  expect(items.find((i) => i.action === 'drop')).toMatchObject({ source: 'single', mine: true });
  expect(items.filter((i) => i.action === 'submit').every((i) => i.actor === null)).toBe(true);
  expect(coverageFrom).not.toBeNull();
});
