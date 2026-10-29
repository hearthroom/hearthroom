import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { upstream } from '../src/upstream';
import { makeMember, resetDb } from './helpers';

const account = 80001;
let trusted: Record<string, unknown>;
let member: string;
const source = '00000000-0000-4000-8000-000000000001';

beforeEach(async () => {
  await resetDb();
  member = await makeMember(account);
  await env.DB.prepare("UPDATE members SET account_class='test',test_generation=2 WHERE id=?").bind(member).run();
  trusted = { accountNumId: account, accountClass: 'test', testState: 'active', testGeneration: 2 };
  vi.spyOn(upstream, 'fetchMyRoles').mockResolvedValue({
    items: [{ roleId: source, name: 'Synthetic private draft', summary: '', avatarUrl: null, backgroundUrl: null, zone: 'all', visibility: 'private', talkNum: 0 }],
    total: 1, hasNext: false,
  });
  // Keep the real fetchMe parser and real member/quota queries in this HTTP path.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/open/v1/me')) return Response.json(trusted);
    if (url.endsWith('/hosting/work-access/owner-batch')) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer synthetic-owner');
      return Response.json({ items: [{ sourceRoleId: source, workId: '00000000-0000-4000-8000-000000000002', managed: false, access: 'private', epoch: 0,
        restriction: 'none', state: 'complete', replayed: false, approvedRoleId: '', policyRevision: 'synthetic-policy',
        approvalRevision: 'synthetic-approval', revisionState: 'unknown', restorable: false, restoreReason: 'not_approved', providerRestriction: 'none' }] });
    }
    throw new Error('Unexpected synthetic mine request');
  });
});
afterEach(() => vi.restoreAllMocks());

async function request(query: string, sharing: boolean) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`https://c.test/v1/me/cards?fresh=1&${query}`, {
    headers: { Authorization: 'Bearer synthetic-owner' },
  }), { ...env, HARBOR_TEST_ACCOUNTS_ENABLED: '1', HOSTING_SERVICE_KEY: 'synthetic-issuer', WORK_SHARING_ENABLED: String(sharing) }, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

const paths = [
  { query: '', sharing: false },
  { query: 'filter=listed', sharing: false },
  { query: 'filter=unlisted', sharing: false },
  { query: '', sharing: true },
  { query: 'filter=listed', sharing: true },
  { query: 'access=private', sharing: true },
] as const;

it.each(paths)('preserves trusted test classification for $query (sharing=$sharing)', async ({ query, sharing }) => {
  const response = await request(query, sharing);
  const body = await response.json();
  expect({ status: response.status, body }).toMatchObject({ status: 200, body: { quota: { used: 0, packRemaining: 0 } } });
  if (!query.includes('listed')) expect(body).toMatchObject({ items: [{ roleId: source, visibility: 'private' }] });
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await env.DB.prepare('SELECT account_class,test_generation,test_state FROM members WHERE id=?').bind(member).first())
    .toEqual({ account_class: 'test', test_generation: 2, test_state: 'active' });
});

it.each(paths)('keeps normal accounts working for $query (sharing=$sharing)', async ({ query, sharing }) => {
  await makeMember(account + 1);
  trusted = { accountNumId: account + 1, accountClass: 'normal' };
  expect((await request(query, sharing)).status).toBe(200);
});

it.each([
  { query: '', sharing: false, mismatch: 'class' },
  { query: 'filter=listed', sharing: false, mismatch: 'generation' },
  { query: 'access=private', sharing: true, mismatch: 'state' },
])('retains classification conflict denial for $mismatch', async ({ query, sharing, mismatch }) => {
  if (mismatch === 'class') trusted = { accountNumId: account, accountClass: 'normal' };
  if (mismatch === 'generation') trusted.testGeneration = 1;
  if (mismatch === 'state') await env.DB.prepare("UPDATE members SET test_state='paused' WHERE id=?").bind(member).run();
  const before = await env.DB.prepare('SELECT account_class,test_generation,test_state FROM members WHERE id=?').bind(member).first();
  const response = await request(query, sharing);
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: 'identity_classification_conflict' });
  expect(await env.DB.prepare('SELECT account_class,test_generation,test_state FROM members WHERE id=?').bind(member).first()).toEqual(before);
});
