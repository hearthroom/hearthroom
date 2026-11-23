/**
 * AI 審卡影子模式的兩個審核端畫面（任務 2026-11-23-ai-card-review）：
 *   - 審核詳情的「AI 的判斷」揭曉區：決定前不出現也不發請求；一致／不同的畫法；覆核每次送新的 operationId、可改選。
 *   - 管理員的「AI 分歧」分頁：只有管理員看得到；單筆仲裁的參考範例勾選與池的說明、AI 對且原為通過時的重新審核入口。
 * 網路走真的 lib/review-ai-api（全域 fetch 換成假的），只把詳情頁自己的讀取換掉。
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import { i18n } from '../src/lib/i18n';

const mocks = vi.hoisted(() => ({
  role: 'manager' as string,
  fetchReviewDetail: vi.fn(),
  dropReview: vi.fn(async () => ({ caseId: 'k1' })),
}));
vi.mock('../src/lib/session', () => ({ useSession: () => ({ me: { accountNumId: 7 }, profile: {}, ready: true, accessToken: async () => 'synthetic' }) }));
vi.mock('../src/lib/api', async (original) => ({
  ...(await original<object>()),
  fetchReviewMe: async () => ({ reviewer: true, pending: 0, reviews: 0, cases: 0, comments: 0, role: mocks.role }),
  fetchReviewDetail: mocks.fetchReviewDetail,
  fetchReviewOriginality: async () => ({ available: false, reason: 'too_short' }),
  fetchReviewQueue: async () => ({ items: [], claimTtlMs: 1 }),
  claimReview: async () => ({}),
  dropReview: mocks.dropReview,
}));
import { router as siteRouter } from '../src/router';
import Reveal from '../src/components/ReviewAiReveal.vue';

type Call = { url: string; method: string; body: any };
let calls: Call[] = [];
let routes: Record<string, (call: Call) => [number, unknown]> = {};
const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  i18n.global.locale.value = 'en';
  calls = []; routes = {}; mocks.role = 'manager';
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const call = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) return respond(404, { error: 'not_found' });
    const [status, body] = routes[key]!(call);
    return respond(status, body);
  }));
  let n = 0;
  vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(() => `op-${++n}` as ReturnType<Crypto['randomUUID']>);
});
let app: App | undefined, host: HTMLElement, router: Router;
afterEach(() => { app?.unmount(); app = undefined; document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

const t = (k: string, p?: Record<string, unknown>) => i18n.global.t(k, p ?? {});
const $ = (sel: string) => host.querySelector<HTMLElement>(sel);
const aiCalls = () => calls.filter((c) => /\/review\/[^/]+\/ai/.test(c.url));

const suggestion = (over: Record<string, unknown> = {}) => ({ id: 'g1', criteriaVersion: 'v2', model: 'm', verdict: 'reject', reasons: ['opening.no_reply_hook'], flags: [], confidence: 0.82, handoffCause: null, note: '', phase: 'shadow', at: 5, ...over });

async function mountReveal(props: { mine: 'approve' | 'reject' | 'drop'; myReasons?: string[] }) {
  host = document.body.appendChild(document.createElement('div'));
  app = createApp(Reveal, { submissionId: 's1', myReasons: [], ...props }).use(createPinia()).use(i18n);
  app.mount(host);
}

// ---------- 揭曉區 ----------

const empty = { personaChars: 0, worldbookEntryCount: 0, worldbookEnabledCount: 0, worldbookConstantCount: 0, worldbookChars: 0, worldbookConstantChars: 0, estimatedConstantTokens: 0, estimatedMaxTokens: 0 };
const detail = (submission: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  submission: { id: 's1', kind: 'first', status: 'pending', contentHash: 'v', submittedAt: 1, rating: null, claimedByMe: true, stampedByMe: false, claimGeneration: 'g', required: 1, stamps: [], ...submission },
  card: { id: '100001', roleId: 'r1' },
  detail: { partial: false, document: { roleName: 'Night Detective', roleDesc: '', roleAvatar: '', roleBackground: '', roleTag: '[]', userName: '', roleDetailDesc: '', roleType: '', roleSex: '', roleSpeech: '', language: 'en', talkExample: '', roleOutputContract: '' },
    greetings: { welcome: '', alternates: [], prologue: [] }, worldbook: null, worldbookAvailable: false,
    authorAsset: { rules: [], mountTrigger: '', mountLayer: '', pageMode: 'classic', status: '', version: 0 },
    hashes: { card: '', welcome: '', worldbook: '', authorAsset: '', content: 'v' }, costProfile: empty, reviewLength: { total: 4000, required: 3001, remaining: 0, eligible: true } },
  ...extra,
});
async function mountPage(path: string) {
  host = document.body.appendChild(document.createElement('div'));
  router = createRouter({ history: createMemoryHistory(), routes: siteRouter.options.routes });
  await router.push(path);
  app = createApp({ render: () => h(RouterView) }).use(createPinia()).use(router).use(i18n);
  app.mount(host);
}

it('shows nothing and asks nothing before the reviewer decides; dropping the card reveals the AI call', async () => {
  mocks.fetchReviewDetail.mockResolvedValue(detail({}));
  routes['/v1/review/s1/ai'] = () => [200, { suggestions: [suggestion({ verdict: 'pass', reasons: [] })], myFeedback: [] }];
  await mountPage('/en/review/s1');
  await vi.waitFor(() => expect($('[data-decide-choices]')).not.toBeNull());
  await new Promise((r) => setTimeout(r, 0));
  expect($('[data-ai-reveal]')).toBeNull();
  expect(aiCalls()).toEqual([]);
  expect(host.textContent).not.toContain(t('reviewAi.reveal.title'));

  const drop = host.querySelector<HTMLInputElement>('[data-decide-choices] input[value=drop]')!;
  drop.click(); await nextTick();
  expect(aiCalls()).toEqual([]);
  $('[data-submit-drop]')!.click();
  await vi.waitFor(() => expect($('[data-ai-reveal] [data-ai-verdict]')).not.toBeNull());
  expect(aiCalls().map((c) => c.url)).toEqual(['/v1/review/s1/ai']);
  // 不受理算「駁回」：AI 建議通過＝與你不同，有覆核
  expect($('[data-ai-agree]')!.dataset.aiAgree).toBe('differ');
  expect($('[data-ai-feedback]')).not.toBeNull();
  expect($('[data-ai-reveal]')!.getAttribute('aria-live')).toBe('polite');
});

it('revisiting a card I stamped shows the latest decided suggestion, agreement and the reason comparison without feedback', async () => {
  mocks.fetchReviewDetail.mockResolvedValue(detail({ status: 'rejected', claimedByMe: false, stampedByMe: true, stamps: [{ verdict: 'reject', note: '', at: 2, mine: true }] }, { rejectReasons: ['opening.no_reply_hook', 'character.setting_thin'] }));
  routes['/v1/review/s1/ai'] = () => [200, { suggestions: [
    suggestion({ id: 'old', criteriaVersion: 'v9', verdict: 'pass', reasons: [] }),
    suggestion({ id: 'new', criteriaVersion: 'v10', verdict: 'reject', reasons: ['opening.no_reply_hook', 'opening.exposition_only'], confidence: 0.91 }),
    suggestion({ id: 'tags', criteriaVersion: 'v11', verdict: null, reasons: [] }),
  ], myFeedback: [] }];
  await mountPage('/en/review/s1');
  await vi.waitFor(() => expect($('[data-ai-reveal] [data-ai-verdict]')).not.toBeNull());
  expect($('[data-ai-verdict]')!.dataset.aiVerdict).toBe('reject');
  expect($('[data-ai-confidence]')!.textContent).toContain('91%');
  expect($('[data-ai-agree]')!.dataset.aiAgree).toBe('same');
  const sides = [...host.querySelectorAll<HTMLElement>('[data-ai-compare] [data-ai-side]')].map((li) => [li.dataset.aiSide, li.textContent!.includes(t('review.reasons.opening.no_reply_hook.name'))]);
  expect(sides.map((s) => s[0])).toEqual(['both', 'ai', 'mine']);
  expect($('[data-ai-feedback]')).toBeNull();
  expect($('[data-ai-recorded]')).toBeNull();
});

it('disagreement: three unselected options, each submit sends a fresh operationId, and the answer can be changed', async () => {
  let fb: unknown[] = [];
  routes['/v1/review/s1/ai-feedback'] = (c) => [200, { value: c.body.value }];
  routes['/v1/review/s1/ai'] = () => [200, { suggestions: [suggestion()], myFeedback: fb }];
  await mountReveal({ mine: 'approve' });
  await vi.waitFor(() => expect($('[data-ai-feedback]')).not.toBeNull());
  expect($('[data-ai-agree]')!.dataset.aiAgree).toBe('differ');
  const radios = () => [...host.querySelectorAll<HTMLInputElement>('[data-ai-option]')];
  expect(radios().map((r) => r.value)).toEqual(['ai_right', 'ai_wrong', 'both_ok']);
  expect(radios().some((r) => r.checked)).toBe(false);
  expect(host.querySelector('[role=radiogroup]')).not.toBeNull();
  expect(($('[data-ai-submit]') as HTMLButtonElement).disabled).toBe(true);

  radios()[1]!.click(); await nextTick();
  $('[data-ai-submit]')!.click();
  await vi.waitFor(() => expect($('[data-ai-recorded]')).not.toBeNull());
  expect($('[data-ai-recorded]')!.textContent).toContain(t('reviewAi.reveal.feedback.recorded', { value: t('reviewAi.reveal.feedback.ai_wrong') }));

  $('[data-ai-change]')!.click(); await nextTick();
  expect(radios().find((r) => r.checked)?.value).toBe('ai_wrong');
  radios()[2]!.click(); await nextTick();
  $('[data-ai-submit]')!.click();
  await vi.waitFor(() => expect($('[data-ai-recorded]')!.textContent).toContain(t('reviewAi.reveal.feedback.both_ok')));

  const posts = calls.filter((c) => c.method === 'POST');
  expect(posts.map((c) => c.body)).toEqual([
    { suggestionId: 'g1', value: 'ai_wrong', operationId: 'op-1' },
    { suggestionId: 'g1', value: 'both_ok', operationId: 'op-2' },
  ]);
});

it('a failed feedback keeps the choice; a recorded answer from earlier shows as recorded', async () => {
  routes['/v1/review/s1/ai-feedback'] = () => [500, { error: 'boom' }];
  routes['/v1/review/s1/ai'] = () => [200, { suggestions: [suggestion()], myFeedback: [] }];
  await mountReveal({ mine: 'approve' });
  await vi.waitFor(() => expect($('[data-ai-feedback]')).not.toBeNull());
  host.querySelector<HTMLInputElement>('[data-ai-option=ai_right]')!.click(); await nextTick();
  $('[data-ai-submit]')!.click();
  await vi.waitFor(() => expect($('[data-ai-send-error]')).not.toBeNull());
  expect(host.querySelector<HTMLInputElement>('[data-ai-option=ai_right]')!.checked).toBe(true);
  app!.unmount(); document.body.innerHTML = '';

  routes['/v1/review/s1/ai'] = () => [200, { suggestions: [suggestion()], myFeedback: [{ suggestionId: 'g1', value: 'ai_right' }] }];
  await mountReveal({ mine: 'approve' });
  await vi.waitFor(() => expect($('[data-ai-recorded]')).not.toBeNull());
  expect($('[data-ai-feedback]')).toBeNull();
});

it('403 renders nothing; handoff and no suggestion say so without feedback; a load error offers a retry', async () => {
  routes['/v1/review/s1/ai'] = () => [403, { error: 'ai_hidden_until_decided' }];
  await mountReveal({ mine: 'approve' });
  await vi.waitFor(() => expect(aiCalls().length).toBe(1));
  await new Promise((r) => setTimeout(r, 0));
  expect($('[data-ai-reveal]')).toBeNull();
  app!.unmount(); document.body.innerHTML = '';

  routes['/v1/review/s1/ai'] = () => [200, { suggestions: [suggestion({ verdict: 'handoff', reasons: [], confidence: null, handoffCause: 'unsure' })], myFeedback: [] }];
  await mountReveal({ mine: 'reject' });
  await vi.waitFor(() => expect($('[data-ai-handoff]')).not.toBeNull());
  expect(host.textContent).toContain(t('reviewAi.reveal.handoffBody'));
  expect($('[data-ai-feedback]')).toBeNull();
  app!.unmount(); document.body.innerHTML = '';

  routes['/v1/review/s1/ai'] = () => [200, { suggestions: [suggestion({ verdict: null })], myFeedback: [] }];
  await mountReveal({ mine: 'reject' });
  await vi.waitFor(() => expect($('[data-ai-none]')).not.toBeNull());
  app!.unmount(); document.body.innerHTML = '';

  let fail = true;
  routes['/v1/review/s1/ai'] = () => (fail ? [500, { error: 'x' }] : [200, { suggestions: [], myFeedback: [] }]);
  await mountReveal({ mine: 'reject' });
  await vi.waitFor(() => expect($('[data-ai-error]')).not.toBeNull());
  fail = false;
  $('[data-ai-retry]')!.click();
  await vi.waitFor(() => expect($('[data-ai-none]')).not.toBeNull());
});

// ---------- AI 分歧（管理員） ----------

const disagreement = (over: Record<string, unknown> = {}) => ({
  submission: { id: 's1', cardId: '123', status: 'approved', submittedAt: 1 },
  direction: 'ai_stricter',
  human: { decision: 'approved', reasons: [], note: '', at: 2, stamps: [{ verdict: 'approve', at: 2, reviewer: 'Rin' }], feedback: [{ value: 'ai_wrong', at: 3, reviewer: 'Rin' }] },
  ai: { suggestionId: 'g1', criteriaVersion: 'v3', model: 'deepseek-x', verdict: 'reject', reasons: ['opening.no_reply_hook'], flags: ['ai_unedited'], confidence: 0.82, note: 'No hook.', phase: 'shadow', at: 1 },
  arbitrations: [],
  content: { state: 'ready', card: { name: 'Last Train', summary: '', tags: ['drama'], originalWork: null, userName: '', setting: 'She pauses.', speech: '', instructions: '', examples: '', openings: { mode: 'greeting', page: '', welcome: 'The station is quiet.', alternates: [], prologue: [] }, lorebook: { entryCount: 0, entries: [] } }, stats: {} },
  update: null,
  ...over,
});

it('shows the AI disagreement tab next to review stats only to managers, and denies the route to others', async () => {
  routes['/v1/review-ai/disagreements?'] = () => [200, { total: 0, items: [] }];
  routes['/v1/review-ai/report'] = () => [200, { from: 0, to: 1, versions: [] }];
  await mountPage('/en/review/ai');
  await vi.waitFor(() => expect(host.querySelector('.management-nav a[href="/en/review/ai"][aria-current="page"]')).not.toBeNull());
  const hrefs = [...host.querySelectorAll('.management-nav a')].map((a) => a.getAttribute('href'));
  expect(hrefs.indexOf('/en/review/ai')).toBe(hrefs.indexOf('/en/review/stats') + 1);
  expect(router.currentRoute.value.meta.managementTab).toBe('aiReview');
  await vi.waitFor(() => expect($('[data-empty]')).not.toBeNull());
  expect(calls.some((c) => c.url.startsWith('/v1/review-ai/disagreements?state=open'))).toBe(true);
  for (const path of ['/en/review/ai/report', '/en/review/ai/g1']) {
    await router.push(path); await nextTick();
    expect(router.currentRoute.value.meta.managementTab).toBe('aiReview');
  }
  await vi.waitFor(() => expect(calls.some((c) => c.url === '/v1/review-ai/disagreements/g1')).toBe(true));
  app!.unmount(); document.body.innerHTML = ''; calls = [];

  mocks.role = 'reviewer';
  await mountPage('/en/review/ai');
  await vi.waitFor(() => expect(host.querySelector('.management-nav a')).not.toBeNull());
  await vi.waitFor(() => expect($('[data-forbidden]')).not.toBeNull());
  expect(host.querySelector('.management-nav a[href="/en/review/ai"]')).toBeNull();
  expect(calls.filter((c) => c.url.startsWith('/v1/review-ai/'))).toEqual([]);
});

it('arbitration: reference checkbox only for a winner, names the pool, links to re-review when the AI was right about an approved card', async () => {
  routes['/v1/review-ai/disagreements/g1/arbitration'] = (c) => [200, { id: 'x1', value: c.body.value, referencePool: c.body.addToReference ? 'reject' : null }];
  routes['/v1/review-ai/disagreements/g1'] = () => [200, disagreement()];
  routes['/v1/review-ai/disagreements?'] = () => [200, { total: 4, items: [{ suggestionId: 'g2' }] }];
  await mountPage('/en/review/ai/g1');
  await vi.waitFor(() => expect($('[data-arbitration]')).not.toBeNull());
  expect(host.querySelectorAll('[data-col]').length).toBe(3);
  expect($('[data-col=human]')!.textContent).toContain('Rin');
  expect($('[data-col=ai]')!.textContent).toContain(t('reviewAi.flag.ai_unedited'));
  expect($('[data-col=ai]')!.textContent).toContain('deepseek-x');

  const box = () => host.querySelector<HTMLInputElement>('[data-reference]')!;
  const hint = () => $('[data-pool-hint]')!.textContent!.trim();
  const pick = async (v: string) => { host.querySelector<HTMLInputElement>(`[data-value=${v}]`)!.click(); await nextTick(); };
  expect([...host.querySelectorAll<HTMLInputElement>('[data-value]')].some((r) => r.checked)).toBe(false);
  expect(box().disabled).toBe(true);
  expect(hint()).toBe(t('reviewAi.arb.form.pool.pick'));
  expect(($('[data-action=submit]') as HTMLButtonElement).disabled).toBe(true);

  await pick('both_ok');
  expect(box().disabled).toBe(true);
  expect(hint()).toBe(t('reviewAi.arb.form.pool.none'));
  await pick('human_right');
  expect(box().disabled).toBe(false);
  expect(hint()).toBe(t('reviewAi.arb.form.pool.pass'));
  expect($('[data-reopen-hint]')).toBeNull();
  box().click(); await nextTick();
  await pick('both_wrong');
  expect(box().checked).toBe(false);
  expect(box().disabled).toBe(true);

  await pick('ai_right');
  expect(hint()).toBe(t('reviewAi.arb.form.pool.reject'));
  expect($('[data-reopen-link]')!.getAttribute('href')).toBe('/en/review/cards?q=123');
  box().click(); await nextTick();
  (host.querySelector('#ai-arb-note') as HTMLTextAreaElement).value = 'Opening has no hook';
  host.querySelector('#ai-arb-note')!.dispatchEvent(new Event('input'));
  $('[data-action=submit]')!.click();
  await vi.waitFor(() => expect($('[data-result]')).not.toBeNull());
  expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ value: 'ai_right', addToReference: true, note: 'Opening has no hook', operationId: 'op-1' });
  expect($('[data-result-pool]')!.textContent).toBe(t('reviewAi.arb.done.pool.reject'));
  expect($('[data-reopen-link]')).not.toBeNull();
  await vi.waitFor(() => expect($('[data-next]')).not.toBeNull());
  expect($('[data-next]')!.textContent).toContain(t('reviewAi.arb.done.next', { n: 4 }));
  expect($('[data-next]')!.getAttribute('href')).toBe('/en/review/ai/g2');
});

it('arbitration: a failed submit keeps the choice and note; unreadable content says so', async () => {
  routes['/v1/review-ai/disagreements/g1/arbitration'] = () => [503, { error: 'unavailable' }];
  routes['/v1/review-ai/disagreements/g1'] = () => [200, disagreement({ content: { state: 'unavailable' }, direction: 'human_stricter', human: { decision: 'dropped', reasons: [], note: '', at: null, stamps: [], feedback: [] }, ai: { ...disagreement().ai, verdict: 'pass', reasons: [], flags: [] } })];
  await mountPage('/en/review/ai/g1');
  await vi.waitFor(() => expect($('[data-arbitration]')).not.toBeNull());
  expect($('[data-unavailable]')!.textContent).toBe(t('reviewAi.arb.content.unavailable'));
  host.querySelector<HTMLInputElement>('[data-value=human_right]')!.click(); await nextTick();
  // 人對、原為不受理：池是駁回
  expect($('[data-pool-hint]')!.textContent!.trim()).toBe(t('reviewAi.arb.form.pool.reject'));
  $('[data-action=submit]')!.click();
  await vi.waitFor(() => expect($('[data-send-error]')).not.toBeNull());
  expect(host.querySelector<HTMLInputElement>('[data-value=human_right]')!.checked).toBe(true);
  // 同一組內容重試沿用同一個 operationId
  $('[data-action=submit]')!.click();
  await vi.waitFor(() => expect(calls.filter((c) => c.method === 'POST').length).toBe(2));
  expect(calls.filter((c) => c.method === 'POST').map((c) => c.body.operationId)).toEqual(['op-1', 'op-1']);
});

it('report: suppresses figures under ten samples and exports the reference draft', async () => {
  routes['/v1/review-ai/report'] = () => [200, { from: 0, to: 1, versions: [
    { criteriaVersion: 'v1', total: 4, ai: { pass: 2, reject: 2, handoff: 0 }, matrix: { approved: { pass: 2, reject: 1, handoff: 0 }, rejected: { pass: 0, reject: 1, handoff: 0 }, dropped: { pass: 0, reject: 0, handoff: 0 } }, agreement: 0.75, comparable: 4, aiStricter: 1, humanStricter: 0, handoffRate: 0, refusalRate: 0, costUsd: 0.01, arbitration: { values: { human_right: 1, ai_right: 0, both_ok: 0, both_wrong: 0 }, reasons: { 'opening.no_reply_hook': { humanWrong: 0, aiWrong: 1 } } } },
    { criteriaVersion: 'v2', total: 40, ai: { pass: 20, reject: 18, handoff: 2 }, matrix: { approved: { pass: 18, reject: 4, handoff: 1 }, rejected: { pass: 3, reject: 13, handoff: 1 }, dropped: { pass: 0, reject: 0, handoff: 0 } }, agreement: 0.815, comparable: 38, aiStricter: 4, humanStricter: 3, handoffRate: 0.05, refusalRate: 0, costUsd: 0.1234, arbitration: { values: { human_right: 6, ai_right: 4, both_ok: 1, both_wrong: 1 }, reasons: { 'opening.no_reply_hook': { humanWrong: 4, aiWrong: 6 }, 'character.setting_thin': { humanWrong: 1, aiWrong: 2 } } } },
  ] }];
  routes['/v1/review-ai/reference-candidates'] = () => [200, { items: [{ id: 'c1', verdict: 'pass' }, { id: 'c2', verdict: 'reject' }, { id: 'c3', verdict: 'reject' }], skipped: 1 }];
  const created: Blob[] = [];
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: (b: Blob) => { created.push(b); return 'blob:x'; }, revokeObjectURL: () => {} }));
  await mountPage('/en/review/ai/report');
  await vi.waitFor(() => expect($('[data-version=v2]')).not.toBeNull());
  // 新版本在前
  expect([...host.querySelectorAll<HTMLElement>('[data-version]')].map((s) => s.dataset.version)).toEqual(['v2', 'v1']);
  const small = t('reviewStats.suppressed');
  expect($('[data-version=v1] [data-cell=agreement]')!.textContent).toContain(small);
  expect($('[data-version=v1] [data-table=matrix]')!.textContent).toContain(small);
  expect($('[data-version=v1] [data-arb-small]')).not.toBeNull();
  expect($('[data-version=v2] [data-cell=agreement]')!.textContent).toContain('81.5%');
  expect($('[data-version=v2] [data-table=arbitration]')!.textContent).toContain('50.0%');
  expect($('[data-version=v2] [data-row="opening.no_reply_hook"]')!.textContent).not.toContain(small);
  expect($('[data-version=v2] [data-row="character.setting_thin"]')!.textContent).toContain(small);

  await vi.waitFor(() => expect($('[data-ref-counts]')).not.toBeNull());
  expect($('[data-ref-counts]')!.textContent).toBe(t('reviewAi.arb.refs.counts', { n: '3', pass: '1', reject: '2' }));
  expect($('[data-ref-skipped]')).not.toBeNull();
  $('[data-action=export]')!.click();
  expect(created).toHaveLength(1);
  expect(JSON.parse(await created[0]!.text()).map((i: { id: string }) => i.id)).toEqual(['c1', 'c2', 'c3']);
});
