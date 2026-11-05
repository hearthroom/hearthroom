import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { fetchCard } from '@/lib/api';
import { resetManagedAuthForTest } from '@/lib/managed-auth';
import { setProvider } from '@/lib/provider';
import { useSession } from '@/lib/session';
import { signedInHint } from '@/lib/signin-hint';

const identity = { accountNumId: 22, nickName: 'fixture', avatar: '' };
const pair = () => ({ accessToken: 'synthetic-access', expiresAt: Date.now() + 3_600_000 });
let cardBearer: string | null;
let cardRequested: boolean;
let releaseSession: (() => void) | undefined;

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  resetManagedAuthForTest(true);
  setProvider('harbor');
  setActivePinia(createPinia());
  cardBearer = null;
  cardRequested = false;
  releaseSession = undefined;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/open/v1/me')) return Response.json(identity);
    if (url === '/v1/auth/session') {
      // A fresh document must wait for its cookie-backed identity before reading a private card.
      if (JSON.parse(String(init?.body)).token) {
        await new Promise<void>(resolve => { releaseSession = resolve; });
      }
      return Response.json({ provider: 'harbor', me: identity, profile: { identities: [] }, token: pair() });
    }
    if (url.startsWith('/v1/cards/')) {
      cardRequested = true;
      cardBearer = new Headers(init?.headers).get('Authorization');
      return cardBearer
        ? Response.json({ id: 'fixture-card', title: 'Fixture' })
        : Response.json({ error: 'not_found' }, { status: 404 });
    }
    return Response.json({});
  }));
});
afterEach(() => { releaseSession?.(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('sends Bearer on the first private-card read in a new document after OAuth adoption', async () => {
  await useSession().adopt(pair());
  await useSession().ensureProfile();
  // Keep only browser storage; discard the previous document's Pinia and in-memory credentials.
  resetManagedAuthForTest(true);
  setActivePinia(createPinia());
  useSession();
  const reading = fetchCard('fixture-card');
  // Attach the rejection handler before allowing the request to finish, including on the red path.
  const result = reading.then(card => ({ card }), error => ({ error }));
  await vi.waitFor(() => expect(!!releaseSession || cardRequested).toBe(true));
  releaseSession?.();
  const outcome = await result;
  expect(cardBearer).toBe('Bearer synthetic-access');
  expect(outcome).toHaveProperty('card.id', 'fixture-card');
});

it('remembers the verified identity immediately after adoption', async () => {
  await useSession().adopt(pair());
  expect(signedInHint()).toBe(identity.accountNumId);
});

it('does not remember an identity when adoption is rejected', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'unauthorized' }, { status: 401 })));
  await expect(useSession().adopt(pair())).rejects.toMatchObject({ status: 401 });
  expect(signedInHint()).toBeNull();
});

it('clears the adopted hint on logout and ignores an adoption response from the old generation', async () => {
  const session = useSession();
  await session.adopt(pair());
  await session.ensureProfile();
  const originalFetch = fetch;
  let releaseIdentity!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    String(input).endsWith('/open/v1/me')
      ? new Promise<Response>(resolve => { releaseIdentity = resolve; })
      : originalFetch(input, init)));
  vi.stubGlobal('location', { reload: vi.fn() });
  const staleAdoption = session.adopt(pair());
  await session.logout();
  expect(signedInHint()).toBeNull();
  releaseIdentity(Response.json({ ...identity, accountNumId: 23 }));
  await staleAdoption;
  expect(signedInHint()).toBeNull();
  expect(session.me).toBeNull();
  expect(session.token).toBeNull();
});

it('keeps successful adoption usable when browser storage rejects writes', async () => {
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
  const session = useSession();
  await expect(session.adopt(pair())).resolves.toBeUndefined();
  await session.ensureProfile();
  expect(session.me?.accountNumId).toBe(identity.accountNumId);
  expect(session.token?.accessToken).toBe('synthetic-access');
  expect(signedInHint()).toBeNull();
  await expect(fetchCard('fixture-card')).resolves.toHaveProperty('id', 'fixture-card');
  expect(cardBearer).toBe('Bearer synthetic-access');
});

it('keeps a new visitor anonymous without waiting for session restoration', async () => {
  useSession();
  await expect(fetchCard('fixture-card')).rejects.toMatchObject({ status: 404 });
  expect(cardBearer).toBeNull();
  expect(releaseSession).toBeUndefined();
});
