import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bearer, makeMember, resetDb, restoreUpstream, whoAmI } from './helpers';

// The editor's chat test resolves the author's own saved role through this route.
// A draft that was saved but never submitted has no works row yet.
const realFetch = globalThis.fetch;
function roleDetail(owners: Record<string, number>): void {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!url.pathname.endsWith('/open/v1/role/detail')) return realFetch(input, init);
    const owner = owners[url.searchParams.get('roleId') ?? ''];
    return owner === undefined
      ? Response.json({ error: 'role_not_found' }, { status: 404 })
      : Response.json({ accountNumId: owner });
  });
}
const copies = (roleId: string) => SELF.fetch(`https://c.test/v1/me/card-copies/${roleId}`, { headers: { ...bearer(), 'X-Provider': 'harbor' } });

beforeEach(async () => { await resetDb(); await makeMember(10001); whoAmI(10001); });
afterEach(() => { vi.unstubAllGlobals(); restoreUpstream(); });

it('lets the author playtest a saved draft that has never been submitted', async () => {
  roleDetail({ 'unsubmitted-draft': 10001 });
  const response = await copies('unsubmitted-draft');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ copies: [{ provider: 'harbor', roleId: 'unsubmitted-draft', status: 'source', error: '', updatedAt: 0 }] });
});

it('keeps the recorded source for a registered work', async () => {
  roleDetail({ 'registered-source': 10001 });
  await env.DB.prepare("INSERT INTO works VALUES ('work-1','member-10001','harbor','registered-source',1)").run();
  expect(await (await copies('registered-source')).json()).toEqual({ copies: [{ provider: 'harbor', roleId: 'registered-source', status: 'source', error: '', updatedAt: 0 }] });
});

it('still refuses another author and roles the host cannot find', async () => {
  roleDetail({ 'someone-else': 20002 });
  expect((await copies('someone-else')).status).toBe(403);
  expect((await copies('missing')).status).toBe(404);
});
