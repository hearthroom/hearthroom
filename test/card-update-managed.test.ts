import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GENERAL_RATING, identities, makeMember, resetDb, restoreUpstream, role, rolesOnMainSite } from './helpers';
import { legacyPolicyFixture } from './work-policy-fixture';
import { beginHostedEdit, submitHosted } from '../src/hosting';
import { claim, stamp } from '../src/review';
import { finalizeManagedReview } from '../src/work-publication';
import { enrollWorkAccess, workPolicyGateway } from '../src/work-policy';
import { opsMetrics } from '../src/ops-metrics';

const updateNote = '新增第二章劇情以及全新分支結局';
const source = 'managed-update-fixture';
let author: string;
let follower: string;

beforeEach(async () => {
  await resetDb();
  identities({ owner: 11001 });
  rolesOnMainSite({ roleId: source, authorNumId: 11001 });
  legacyPolicyFixture();
  author = await makeMember(11001);
  follower = await makeMember(21001);
});
afterEach(() => { vi.restoreAllMocks(); restoreUpstream(); });

async function submit(updateKind: 'minor' | 'major' = 'minor') {
  return submitHosted(env, {
    memberId: author, account: 11001, role: role({ roleId: source, authorNumId: 11001 }),
    token: 'owner', rating: GENERAL_RATING, operationId: crypto.randomUUID(), now: Date.now(),
    updateKind, ...(updateKind === 'major' ? { updateNote } : {}),
  });
}
async function submissionId(version: string) {
  const row = await env.DB.prepare('SELECT submission_id FROM hosting_versions WHERE version_id=?')
    .bind(version).first<{ submission_id: string }>();
  expect(row).not.toBeNull();
  return row!.submission_id;
}
async function approve(id: string, reviewer = 'managed-reviewer') {
  await claim(env.DB, id, reviewer, Date.now());
  return stamp(env.DB, { submissionId: id, memberId: reviewer, verdict: 'approve', note: '', now: Date.now() }, env);
}
async function fixture() {
  const initial = await submit();
  const first = await submissionId(initial.versionId);
  await approve(first, 'initial-reviewer-a');
  await enrollWorkAccess(env, { memberId: author, roleId: source, operationId: crypto.randomUUID(), access: 'public', token: 'owner' });
  const card = await env.DB.prepare('SELECT id FROM cards WHERE source_role_id=?').bind(source).first<{ id: number }>();
  await env.DB.prepare('INSERT INTO member_follows VALUES(?,?,?)').bind(follower, author, Date.now()).run();
  // One recipient is both following and collecting: publication must still notify once.
  await env.DB.prepare('INSERT INTO member_favorites VALUES(?,?,?)').bind(follower, card!.id, Date.now()).run();
  const update = await submit('major');
  return { initial, update, id: await submissionId(update.versionId), cardId: card!.id };
}
const event = (version: string) => env.DB.prepare('SELECT state,published_at FROM card_update_events WHERE version_id=?')
  .bind(version).first<{ state: string; published_at: number | null }>();
const updateNotices = () => env.DB.prepare("SELECT member_id,extra FROM community_notifications WHERE kind='followed_work' AND json_extract(extra,'$.event')='update'")
  .all<{ member_id: string; extra: string }>();
const queued = () => env.DB.prepare("SELECT value FROM ops_metrics WHERE metric='card_update' AND operation='publish' AND outcome='queued'")
  .first<{ value: number }>();

it('reserves before Provider commit and recovers its lost reply without publishing twice', async () => {
  const f = await fixture();
  const commitAtProvider = workPolicyGateway.commit;
  const commit = vi.spyOn(workPolicyGateway, 'commit').mockImplementation(async (...args) => {
    expect(await event(f.update.versionId)).toEqual({ state: 'reserved', published_at: null });
    expect((await updateNotices()).results).toHaveLength(0);
    expect(await env.DB.prepare('SELECT approved_version_id FROM cards WHERE id=?').bind(f.cardId).first())
      .toEqual({ approved_version_id: f.initial.versionId });
    // The Provider did commit. Only the response disappears; its operation readback survives.
    await commitAtProvider(...args);
    throw new Error('Synthetic reply lost after Provider commit');
  });
  await expect(approve(f.id)).rejects.toThrow('visibility_sync_pending');
  expect(commit).toHaveBeenCalledTimes(1);
  expect(await event(f.update.versionId)).toEqual({ state: 'reserved', published_at: null });
  expect(await env.DB.prepare('SELECT status FROM review_submissions WHERE id=?').bind(f.id).first())
    .toEqual({ status: 'pending' });
  expect(await queued()).toBeNull();
  expect((await updateNotices()).results).toHaveLength(0);

  const recovered = await stamp(env.DB, { submissionId: f.id, memberId: 'managed-reviewer', verdict: 'approve', note: '', now: Date.now() }, env);
  expect(recovered.submission.status).toBe('approved');
  expect(commit).toHaveBeenCalledTimes(1);
  expect(await event(f.update.versionId)).toEqual({ state: 'published', published_at: expect.any(Number) });
  expect(await env.DB.prepare('SELECT approved_version_id,last_public_version_id FROM cards WHERE id=?').bind(f.cardId).first())
    .toEqual({ approved_version_id: f.update.versionId, last_public_version_id: f.update.versionId });
  expect((await updateNotices()).results).toEqual([{ member_id: follower, extra: expect.any(String) }]);
  expect(JSON.parse((await updateNotices()).results[0].extra)).toEqual({ event: 'update', note: updateNote, version: f.update.versionId });
  expect(await queued()).toEqual({ value: 1 });
  expect(await opsMetrics(env.DB)).toContain('hearthroom_card_update_notifications_total{operation="publish",outcome="queued"} 1');

  await finalizeManagedReview(env, f.id);
  await finalizeManagedReview(env, f.id);
  expect(commit).toHaveBeenCalledTimes(1);
  expect((await updateNotices()).results).toHaveLength(1);
  expect(await queued()).toEqual({ value: 1 });
  expect((await env.DB.prepare("SELECT COUNT(*) n FROM card_update_events WHERE work_id=? AND state='published'").bind(f.update.workId).first<{ n: number }>())?.n).toBe(1);
});

it('rechecks a cooldown acquired after submission before calling Provider commit', async () => {
  const f = await fixture();
  // Admission was allowed, but another publication has consumed the cooldown before this review finishes.
  await env.DB.prepare("INSERT INTO card_update_events(version_id,work_id,state,reserved_at,published_at) VALUES(?,?,'published',?,?)")
    .bind(f.initial.versionId, f.update.workId, Date.now(), Date.now()).run();
  const commit = vi.spyOn(workPolicyGateway, 'commit');
  await expect(approve(f.id)).rejects.toThrow('update_notification_cooldown');
  expect(commit).not.toHaveBeenCalled();
  expect(await event(f.update.versionId)).toBeNull();
  expect(await env.DB.prepare('SELECT status FROM review_submissions WHERE id=?').bind(f.id).first()).toEqual({ status: 'pending' });
  expect(await env.DB.prepare('SELECT approved_version_id FROM cards WHERE id=?').bind(f.cardId).first())
    .toEqual({ approved_version_id: f.initial.versionId });
  expect((await updateNotices()).results).toHaveLength(0);
  expect(await queued()).toBeNull();
  expect(await opsMetrics(env.DB)).toContain('hearthroom_card_update_notifications_total{operation="admission",outcome="cooldown"} 1');
});

it.each(['cancel', 'superseded'] as const)('clears a reserved intent and never notifies after %s', async mode => {
  const f = await fixture();
  const commitAtProvider = workPolicyGateway.commit;
  const commit = vi.spyOn(workPolicyGateway, 'commit').mockRejectedValueOnce(new Error('Synthetic Provider unavailable'));
  await expect(approve(f.id)).rejects.toThrow('visibility_sync_pending');
  expect(await event(f.update.versionId)).toEqual({ state: 'reserved', published_at: null });

  if (mode === 'cancel') {
    await beginHostedEdit(env.DB, author, source, Date.now(), 'harbor', env);
    expect(await env.DB.prepare('SELECT state FROM work_publication_permits WHERE version_id=?').bind(f.update.versionId).first())
      .toEqual({ state: 'cancelled' });
  } else {
    commit.mockImplementation(commitAtProvider);
    const current = await workPolicyGateway.state(env, 'harbor', source);
    vi.spyOn(workPolicyGateway, 'state').mockResolvedValue({ ...current!, epoch: current!.epoch + 2, access: 'private' });
    await expect(finalizeManagedReview(env, f.id)).rejects.toThrow('visibility_operation_conflict');
    expect(await env.DB.prepare('SELECT state FROM work_publication_permits WHERE version_id=?').bind(f.update.versionId).first())
      .toEqual({ state: 'conflict' });
  }
  expect(await env.DB.prepare('SELECT status FROM review_submissions WHERE id=?').bind(f.id).first()).toEqual({ status: 'superseded' });
  expect(await event(f.update.versionId)).toBeNull();
  const calls = commit.mock.calls.length;
  await expect(finalizeManagedReview(env, f.id)).rejects.toThrow('visibility_operation_conflict');
  expect(commit).toHaveBeenCalledTimes(calls);
  expect((await updateNotices()).results).toHaveLength(0);
  expect(await queued()).toBeNull();
  expect(await env.DB.prepare('SELECT approved_version_id FROM cards WHERE id=?').bind(f.cardId).first())
    .toEqual({ approved_version_id: f.initial.versionId });
});
