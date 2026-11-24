/**
 * AI 審卡影子模式的審核端畫面（任務 2026-11-23-ai-card-review）：
 *   - 審核詳情的兩段式決定（盲審→揭曉→定案）：決定前不讀 AI；一致一鍵定案、不一致三選一；只有改判上架才確認；
 *     AI 沒審完每 10 秒重讀；重新進來直接到揭曉；保留期。
 *   - 不受理後的「AI 的判斷」揭曉區：一致／不同的畫法；覆核每次送新的 operationId、可改選。
 *   - 管理員的「AI 分歧」分頁：只有管理員看得到；單筆仲裁的參考範例勾選與池的說明、AI 對且原為通過時的重新審核入口。
 * 網路走真的 lib/review-ai-api（全域 fetch 換成假的），只把詳情頁自己的讀取換掉。
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router';
import { i18n } from '../src/lib/i18n';
import { confirmState, settleConfirm } from '../src/lib/confirm';

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
afterEach(() => { vi.useRealTimers(); app?.unmount(); app = undefined; document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });

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
const blindOf = (verdict: 'approve' | 'reject', over: Record<string, unknown> = {}) => ({ id: 'b1', verdict, payload: { verdict, note: '', reasons: verdict === 'reject' ? ['opening.no_reply_hook'] : [], coaching: false, marks: [], suggestions: [], ...over }, at: Date.now() });
async function mountPage(path: string) {
  host = document.body.appendChild(document.createElement('div'));
  router = createRouter({ history: createMemoryHistory(), routes: siteRouter.options.routes });
  await router.push(path);
  app = createApp({ render: () => h(RouterView) }).use(createPinia()).use(router).use(i18n);
  app.mount(host);
}

it('shows nothing and asks nothing before the reviewer decides; dropping the card reveals the AI call', async () => {
  // 每次讀都是新的一份：定案後頁面會先在畫面上記下我的章
  mocks.fetchReviewDetail.mockImplementation(async () => detail({}));
  routes['/v1/review/s1/ai'] = () => [200, { suggestions: [suggestion({ verdict: 'pass', reasons: [] })], myFeedback: [] }];
  await mountPage('/en/review/s1');
  await vi.waitFor(() => expect($('[data-decide-choices]')).not.toBeNull());
  await new Promise((r) => setTimeout(r, 0));
  expect($('[data-ai-reveal]')).toBeNull();
  expect($('[data-two-stage-compare]')).toBeNull();
  expect(aiCalls()).toEqual([]);

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

// ---------- 兩段式決定（盲審→揭曉→定案） ----------

const posts = (action: string) => calls.filter((c) => c.method === 'POST' && c.url === `/v1/review/s1/${action}`);
const stampOk = (finalSource: string, status = 'approved'): [number, unknown] => [200, { id: 's1', status, cardStatus: status, stamps: { approve: 1, required: 1 }, finalSource }];
const decidedAs = (verdict: 'approve' | 'reject', finalSource: string) => detail({ status: verdict === 'approve' ? 'approved' : 'rejected', claimedByMe: false, stampedByMe: true, stamps: [{ verdict, note: '', at: 2, mine: true, finalSource }] }, { retainUntil: Date.UTC(2026, 11, 1), myBlind: blindOf(verdict) });
const chooseDecision = async (v: 'approve' | 'reject') => { host.querySelector<HTMLInputElement>(`[data-decide-choices] input[value=${v}]`)!.click(); await nextTick(); };
const pickReason = async (code: string) => { host.querySelector<HTMLInputElement>(`[data-reason="${code}"]`)!.click(); await nextTick(); };
const pickFinal = async (v: 'blind' | 'ai' | 'modified') => { host.querySelector<HTMLInputElement>(`[data-final-pick=${v}]`)!.click(); await nextTick(); };
const finalButton = () => $('[data-final-submit]') as HTMLButtonElement;
/** 送出第一步並等到第二步出現 */
async function submitBlind(verdict: 'approve' | 'reject') {
  await vi.waitFor(() => expect($('[data-decide-choices]')).not.toBeNull());
  await chooseDecision(verdict);
  if (verdict === 'reject') await pickReason('opening.no_reply_hook');
  $(`[data-submit-${verdict}]`)!.click();
  await vi.waitFor(() => expect($('[data-two-stage-compare]')).not.toBeNull());
}
const blindWith = (verdict: 'approve' | 'reject', ai: unknown, over: Record<string, unknown> = {}) => (): [number, unknown] => [200, { blind: blindOf(verdict, over), ai }];
const ready = (over: Record<string, unknown> = {}) => ({ state: 'ready', suggestion: suggestion(over) });

it('two-step: nothing about the AI before the blind call; the blind response shows both side by side; agreeing finalizes in one click', async () => {
  mocks.fetchReviewDetail.mockResolvedValueOnce(detail({})).mockResolvedValue(decidedAs('approve', 'blind'));
  routes['/v1/review/s1/blind'] = blindWith('approve', ready({ verdict: 'pass', reasons: [], confidence: 0.9 }));
  routes['/v1/review/s1/stamp'] = () => stampOk('blind');
  await mountPage('/en/review/s1');
  await vi.waitFor(() => expect($('[data-decide-choices]')).not.toBeNull());
  await chooseDecision('approve');
  expect(aiCalls()).toEqual([]);
  expect($('[data-two-stage-compare]')).toBeNull();
  $('[data-submit-approve]')!.click();
  await vi.waitFor(() => expect($('[data-two-stage-compare]')).not.toBeNull());
  expect(posts('blind').map((c) => c.body)).toEqual([{ verdict: 'approve', note: '', generation: 'g' }]);
  // 盲審回應已帶 AI 的判斷：不另外讀
  expect(aiCalls()).toEqual([]);
  expect($('[data-blind-verdict]')!.dataset.blindVerdict).toBe('approve');
  expect($('[data-ai-verdict]')!.dataset.aiVerdict).toBe('pass');
  expect($('[data-agree]')!.dataset.agree).toBe('same');
  expect($('[data-col=ai] [aria-live=polite]')).not.toBeNull();
  // 一致：給 AI 的說明收合，一顆「確認通過」
  expect($('[data-ai-note-toggle]')!.getAttribute('aria-expanded')).toBe('false');
  expect($('[data-final-choices]')).toBeNull();
  expect(finalButton().textContent!.trim()).toBe(t('reviewAi.two.final.agree.approve'));
  finalButton().click();
  await vi.waitFor(() => expect(posts('stamp').length).toBe(1));
  expect(confirmState.current).toBeNull();
  expect(posts('stamp')[0]!.body).toEqual({ generation: 'g', finalSource: 'blind' });
  await vi.waitFor(() => expect($('[data-result-card]')).not.toBeNull());
  expect($('[data-final-source]')!.dataset.finalSource).toBe('blind');
  expect($('[data-retain-until]')!.textContent).toContain(t('review.retain.until', { date: '' }).slice(0, 4));
  expect($('[data-ai-reveal]')).toBeNull();
});

it('two-step disagreement: a choice is required; using the AI stamps the verdict shown, by id and time; notes for the AI ride along', async () => {
  // 每次讀都是新的一份：定案後頁面會先在畫面上記下我的章
  mocks.fetchReviewDetail.mockImplementation(async () => detail({}));
  routes['/v1/review/s1/blind'] = blindWith('approve', ready({ at: 5 }));
  routes['/v1/review/s1/stamp'] = () => stampOk('ai', 'rejected');
  await mountPage('/en/review/s1');
  await submitBlind('approve');
  expect($('[data-agree]')!.dataset.agree).toBe('differ');
  expect($('[data-agree]')!.textContent).toBe(t('reviewAi.two.differ.approveReject'));
  const radios = [...host.querySelectorAll<HTMLInputElement>('[data-final-pick]')];
  expect(radios.map((r) => r.value)).toEqual(['blind', 'ai', 'modified']);
  expect(radios.some((r) => r.checked)).toBe(false);
  expect(finalButton().disabled).toBe(true);
  expect(finalButton().textContent!.trim()).toBe(t('reviewAi.two.final.submitIdle'));
  expect($('[data-ai-note]')).toBeNull();

  await pickFinal('ai');
  expect($('[data-final-result]')!.textContent).toBe(t('reviewAi.two.final.result.rejectAi'));
  expect($('[data-reason-preview]')!.textContent).toContain(t('review.reasons.opening.no_reply_hook.name'));
  expect(finalButton().textContent!.trim()).toBe(t('reviewAi.two.final.submit.reject'));
  // 不一致時說明區展開在選擇下方
  expect($('[data-ai-note-toggle]')).toBeNull();
  host.querySelector<HTMLInputElement>('[data-ai-note-type=author_relation]')!.click(); await nextTick();
  expect($('[data-ai-note]')!.textContent).toContain(t('reviewAi.note.authorRelationHint'));
  const text = host.querySelector<HTMLTextAreaElement>('[data-ai-note-text]')!;
  text.value = 'Same group, six cards'; text.dispatchEvent(new Event('input')); await nextTick();
  expect($('[data-ai-note-count]')!.textContent).toBe(t('reviewAi.note.count', { n: 21, max: 500 }));
  finalButton().click();
  await vi.waitFor(() => expect(posts('stamp').length).toBe(1));
  // 通過的盲審改用 AI 的駁回：不會上架，不跳確認
  expect(confirmState.current).toBeNull();
  expect(posts('stamp')[0]!.body).toEqual({ generation: 'g', finalSource: 'ai', aiSuggestionId: 'g1', aiSuggestionAt: 5, aiNoteTypes: ['author_relation'], aiNote: 'Same group, six cards' });
});

it('two-step: the final asks for confirmation only when it would publish against a rejecting blind call', async () => {
  // 每次讀都是新的一份：定案後頁面會先在畫面上記下我的章
  mocks.fetchReviewDetail.mockImplementation(async () => detail({}));
  routes['/v1/review/s1/blind'] = blindWith('reject', ready({ verdict: 'pass', reasons: [], at: 7 }));
  routes['/v1/review/s1/stamp'] = () => stampOk('blind', 'rejected');
  await mountPage('/en/review/s1');
  await submitBlind('reject');
  await pickFinal('ai');
  expect($('[data-final-result]')!.textContent).toBe(t('reviewAi.two.final.result.approve'));
  finalButton().click();
  await vi.waitFor(() => expect(confirmState.current).not.toBeNull());
  expect(confirmState.current!.title).toBe(t('reviewAi.two.confirm.title'));
  expect(confirmState.current!.message).toContain(t('review.confirm.row', { label: t('reviewAi.two.confirm.blind'), value: t('review.action.reject') }));
  expect(confirmState.current!.message).toContain(t('reviewAi.two.confirm.body'));
  settleConfirm(false);
  await vi.waitFor(() => expect(finalButton().disabled).toBe(false));
  expect(posts('stamp')).toEqual([]);
  // 用我的駁回：不跳確認
  await pickFinal('blind');
  finalButton().click();
  await vi.waitFor(() => expect(posts('stamp').length).toBe(1));
  expect(confirmState.current).toBeNull();
  expect(posts('stamp')[0]!.body).toEqual({ generation: 'g', finalSource: 'blind' });
});

it('two-step: finalizing with changes starts from the blind call, sends the edited decision and leaves the blind call as it was', async () => {
  // 每次讀都是新的一份：定案後頁面會先在畫面上記下我的章
  mocks.fetchReviewDetail.mockImplementation(async () => detail({}));
  routes['/v1/review/s1/blind'] = blindWith('reject', ready({ verdict: 'pass', reasons: [] }), { note: 'Needs a hook' });
  routes['/v1/review/s1/stamp'] = () => stampOk('modified', 'rejected');
  await mountPage('/en/review/s1');
  await submitBlind('reject');
  expect($('[data-decide-choices]')).toBeNull();
  await pickFinal('modified');
  await vi.waitFor(() => expect($('[data-decide-choices]')).not.toBeNull());
  expect($('[data-final-modified]')!.textContent).toBe(t('reviewAi.two.final.modifiedLead'));
  // 第二步沒有不受理與冷凍
  expect(host.querySelector('[data-decide-choices] input[value=drop]')).toBeNull();
  expect($('[data-hold]')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('[data-decide-choices] input[value=reject]')!.checked).toBe(true);
  expect(host.querySelector<HTMLInputElement>('[data-reason="opening.no_reply_hook"]')!.checked).toBe(true);
  expect(host.querySelector<HTMLTextAreaElement>('#review-note')!.value).toBe('Needs a hook');
  // 改成通過＝盲審駁回、定案上架：要確認
  await chooseDecision('approve');
  expect(finalButton().textContent!.trim()).toBe(t('reviewAi.two.final.submit.approve'));
  finalButton().click();
  await vi.waitFor(() => expect(confirmState.current).not.toBeNull());
  settleConfirm(false);
  await vi.waitFor(() => expect(finalButton().disabled).toBe(false));
  await chooseDecision('reject');
  await pickReason('character.setting_thin');
  // 比較欄的盲審判斷沒有跟著表單改
  expect([...host.querySelectorAll('[data-blind-reasons] li')].map((li) => li.textContent)).toEqual([t('review.reasons.opening.no_reply_hook.name')]);
  finalButton().click();
  await vi.waitFor(() => expect(posts('stamp').length).toBe(1));
  expect(posts('stamp')[0]!.body).toEqual({ generation: 'g', finalSource: 'modified', verdict: 'reject', note: 'Needs a hook', reasons: ['opening.no_reply_hook', 'character.setting_thin'], coaching: false });
});

it('two-step: while the AI is not done it rereads every 10 seconds with no limit and swaps the verdict in; the reviewer can finalize without it', async () => {
  // 每次讀都是新的一份：定案後頁面會先在畫面上記下我的章
  mocks.fetchReviewDetail.mockImplementation(async () => detail({}));
  let aiDone = false;
  routes['/v1/review/s1/blind'] = blindWith('approve', { state: 'pending', suggestion: null });
  routes['/v1/review/s1/ai'] = () => [200, { suggestions: aiDone ? [suggestion({ verdict: 'pass', reasons: [] })] : [], myFeedback: [] }];
  await mountPage('/en/review/s1');
  await vi.waitFor(() => expect($('[data-decide-choices]')).not.toBeNull());
  await chooseDecision('approve');
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    $('[data-submit-approve]')!.click();
    await vi.waitFor(() => expect($('[data-ai-pending]')).not.toBeNull());
    expect($('[data-col=ai]')!.dataset.aiView).toBe('pending');
    expect($('[data-ai-waited]')!.textContent).toBe(t('reviewAi.two.pending.waitedSeconds', { n: 0 }));
    // 「已等 N 秒」不在 aria-live 區裡
    expect($('[data-col=ai] [aria-live=polite] [data-ai-waited]')).toBeNull();
    expect($('[data-final-skip]')!.textContent!.trim()).toBe(t('reviewAi.two.pending.skip.approve'));
    expect(aiCalls()).toEqual([]);
    vi.advanceTimersByTime(9_999);
    expect(aiCalls().length).toBe(0);
    vi.advanceTimersByTime(1);
    await vi.waitFor(() => expect(aiCalls().length).toBe(1));
    for (let i = 2; i <= 6; i++) { vi.advanceTimersByTime(10_000); await vi.waitFor(() => expect(aiCalls().length).toBe(i)); }
    expect($('[data-ai-pending]')).not.toBeNull();
    aiDone = true;
    vi.advanceTimersByTime(10_000);
    await vi.waitFor(() => expect($('[data-agree]')).not.toBeNull());
    expect($('[data-agree]')!.dataset.agree).toBe('same');
    expect($('[data-final-skip]')).toBeNull();
    // 換上之後不再重讀
    vi.advanceTimersByTime(60_000);
    expect(aiCalls().length).toBe(7);
  } finally {
    vi.useRealTimers();
  }
  app!.unmount(); document.body.innerHTML = ''; calls = [];

  aiDone = false;
  routes['/v1/review/s1/stamp'] = () => stampOk('human_no_ai');
  await mountPage('/en/review/s1');
  await submitBlind('approve');
  $('[data-final-skip]')!.click();
  await vi.waitFor(() => expect(posts('stamp').length).toBe(1));
  expect(posts('stamp')[0]!.body).toEqual({ generation: 'g', finalSource: 'human_no_ai' });
});

it('two-step: no AI call (handoff) or an AI choice the server will not take leaves one exit, finalizing with my call', async () => {
  // 每次讀都是新的一份：定案後頁面會先在畫面上記下我的章
  mocks.fetchReviewDetail.mockImplementation(async () => detail({}));
  routes['/v1/review/s1/blind'] = blindWith('approve', { state: 'handoff', suggestion: suggestion({ verdict: 'handoff', reasons: [], confidence: null, handoffCause: 'refusal' }) });
  routes['/v1/review/s1/ai'] = () => [200, { suggestions: [suggestion({ verdict: 'handoff', reasons: [] })], myFeedback: [] }];
  routes['/v1/review/s1/stamp'] = () => stampOk('human_no_ai');
  await mountPage('/en/review/s1');
  await submitBlind('approve');
  expect($('[data-ai-none]')!.textContent).toBe(t('reviewAi.two.none.title'));
  expect($('[data-final-submit]')).toBeNull();
  $('[data-ai-retry]')!.click();
  await vi.waitFor(() => expect(aiCalls().length).toBe(1));
  expect($('[data-final-mine]')!.textContent!.trim()).toBe(t('reviewAi.two.none.final.approve'));
  // AI 沒判的出口也有「給 AI 的說明」，收合在出口按鈕上方（UI/UX 2026-11-24）
  expect($('[data-ai-note-toggle]')).not.toBeNull();
  expect($('[data-ai-note-toggle]')!.compareDocumentPosition($('[data-final-mine]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  $('[data-final-mine]')!.click();
  await vi.waitFor(() => expect(posts('stamp').length).toBe(1));
  expect(posts('stamp')[0]!.body).toEqual({ generation: 'g', finalSource: 'human_no_ai' });
  app!.unmount(); document.body.innerHTML = ''; calls = [];

  routes['/v1/review/s1/blind'] = blindWith('approve', ready());
  routes['/v1/review/s1/stamp'] = () => [409, { error: 'ai_choice_unavailable' }];
  await mountPage('/en/review/s1');
  await submitBlind('approve');
  await pickFinal('ai');
  finalButton().click();
  await vi.waitFor(() => expect($('[data-ai-none]')).not.toBeNull());
  expect($('[data-final-choices]')).toBeNull();
  expect($('[data-final-mine]')).not.toBeNull();
  app!.unmount(); document.body.innerHTML = ''; calls = [];

  // AI 駁回但只打了標記、沒有作者看得到的理由：照樣並排比，「用 AI 的」停用並說明
  routes['/v1/review/s1/blind'] = blindWith('approve', ready({ reasons: [], flags: ['mass_produced'] }));
  await mountPage('/en/review/s1');
  await submitBlind('approve');
  expect($('[data-agree]')!.dataset.agree).toBe('differ');
  const ai = host.querySelector<HTMLInputElement>('[data-final-pick=ai]')!;
  expect(ai.disabled).toBe(true);
  expect(ai.closest('label')!.textContent).toContain(t('reviewAi.two.final.pick.aiNoReasons'));
});

it('two-step: if the AI re-judged after the reveal, the new call is swapped in and the reviewer chooses again', async () => {
  // 每次讀都是新的一份：定案後頁面會先在畫面上記下我的章
  mocks.fetchReviewDetail.mockImplementation(async () => detail({}));
  let changed = true;
  routes['/v1/review/s1/blind'] = blindWith('approve', ready({ at: 5 }));
  routes['/v1/review/s1/ai'] = () => [200, { suggestions: [suggestion({ at: 9, reasons: ['character.setting_thin'] })], myFeedback: [] }];
  routes['/v1/review/s1/stamp'] = () => (changed ? [409, { error: 'ai_changed' }] : stampOk('ai', 'rejected'));
  await mountPage('/en/review/s1');
  await submitBlind('approve');
  await pickFinal('ai');
  finalButton().click();
  await vi.waitFor(() => expect($('[data-ai-changed]')).not.toBeNull());
  expect(aiCalls().length).toBe(1);
  expect([...host.querySelectorAll<HTMLInputElement>('[data-final-pick]')].some((r) => r.checked)).toBe(false);
  expect($('[data-ai-reasons]')!.textContent).toContain(t('review.reasons.character.setting_thin.name'));
  changed = false;
  await pickFinal('ai');
  finalButton().click();
  await vi.waitFor(() => expect(posts('stamp').length).toBe(2));
  expect(posts('stamp')[1]!.body).toMatchObject({ finalSource: 'ai', aiSuggestionId: 'g1', aiSuggestionAt: 9 });
});

// ---------- 揭曉區分欄：內部說明｜給作者的說明，與內部字詞檢查 ----------

/** 伺服器 author_note_guard 的片段算法：命中處前後各 12 字，start/length 是命中字在片段裡的位置 */
function matchOf(text: string, term: string, word: string) {
  const at = text.indexOf(word);
  const from = Math.max(0, at - 12);
  return { term, snippet: text.slice(from, at + word.length + 12), start: at - from, length: word.length };
}
const internal = (text: string, hits: [string, string][]): [number, unknown] =>
  [400, { error: 'author_note_internal', field: 'note', terms: hits.map(([term]) => term), matches: hits.map(([term, word]) => matchOf(text, term, word)) }];
/** 錯誤區逐項：類別 chip、標底色的字、改寫提示 */
const guardItems = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('[data-guard-term]')].map((li) => ({
  term: li.dataset.guardTerm, chip: li.querySelector('.chip')!.textContent, mark: li.querySelector('mark')?.textContent ?? null,
  snippet: li.querySelector('[data-guard-snippet]')?.textContent ?? null, hint: li.querySelector('[data-guard-hint]')?.textContent ?? null,
}));

it('reveal: the AI column splits into a reviewers-only internal note and the note the author sees, each marked with an icon and words', async () => {
  mocks.fetchReviewDetail.mockImplementation(async () => detail({}));
  routes['/v1/review/s1/blind'] = blindWith('approve', ready({ confidence: 0.82, note: 'Six cards from one device tonight', authorNote: 'The opening never gives the player a reason to reply.' }));
  await mountPage('/en/review/s1');
  await submitBlind('approve');
  // 結論與理由代碼在上，兩塊在下
  const col = $('[data-col=ai]')!;
  const order = [...col.querySelectorAll('[data-ai-verdict], [data-ai-reasons], [data-ai-internal], [data-ai-author-note]')].map((el) => (el as HTMLElement).dataset.aiVerdict ? 'verdict' : el.hasAttribute('data-ai-reasons') ? 'reasons' : el.hasAttribute('data-ai-internal') ? 'internal' : 'author');
  expect(order).toEqual(['verdict', 'reasons', 'internal', 'author']);
  const inner = $('[data-ai-internal]')!;
  expect(inner.querySelector('h5')!.textContent).toBe(t('reviewAi.two.internalNote.title'));
  expect(inner.querySelector('[data-visibility]')!.textContent!.trim()).toBe(t('reviewAi.two.visibility.reviewerOnly'));
  expect(inner.querySelector('[data-visibility=reviewers] svg[aria-hidden=true]')).not.toBeNull();
  expect(inner.querySelector('[data-ai-confidence]')!.textContent).toBe(t('reviewAi.reveal.confidence', { pct: '82%' }));
  expect(inner.querySelector('[data-ai-internal-note]')!.textContent).toBe('Six cards from one device tonight');
  const author = $('[data-ai-author-note]')!;
  expect(author.querySelector('h5')!.textContent).toBe(t('reviewAi.two.authorNote.title'));
  expect(author.querySelector('[data-visibility=author]')!.textContent!.trim()).toBe(t('reviewAi.two.visibility.authorSees'));
  expect(author.querySelector('[data-visibility=author] svg[aria-hidden=true]')).not.toBeNull();
  expect(author.querySelector('[data-ai-author-note-text]')!.textContent).toBe('The opening never gives the player a reason to reply.');
  // 內部說明不會出現在給作者的那一塊
  expect(author.textContent).not.toContain('device');
  // 給 AI 的說明一樣標「只有審核員看得到」
  await pickFinal('blind');
  expect($('[data-ai-note] [data-visibility=reviewers]')!.textContent!.trim()).toBe(t('reviewAi.two.visibility.reviewerOnly'));
  app!.unmount(); document.body.innerHTML = ''; calls = [];

  // AI 沒寫給作者的說明：照樣有這一塊，寫明沒有；沒有信心與依據時不畫內部說明
  routes['/v1/review/s1/blind'] = blindWith('approve', ready({ confidence: null, note: '' }));
  await mountPage('/en/review/s1');
  await submitBlind('approve');
  expect($('[data-ai-internal]')).toBeNull();
  expect($('[data-ai-author-note-empty]')!.textContent).toBe(t('reviewAi.two.authorNote.empty'));
});

it('use the AI: the note for the author is prefilled with the AI draft; an edit is sent as authorNote, an untouched draft is left to the server', async () => {
  mocks.fetchReviewDetail.mockImplementation(async () => detail({}));
  const draft = 'The opening never gives the player a reason to reply.';
  routes['/v1/review/s1/blind'] = blindWith('approve', ready({ at: 5, authorNote: draft }));
  routes['/v1/review/s1/stamp'] = () => stampOk('ai', 'rejected');
  await mountPage('/en/review/s1');
  await submitBlind('approve');
  expect($('[data-author-note-field]')).toBeNull();
  await pickFinal('ai');
  const field = $('[data-author-note-field]')!;
  const text = field.querySelector<HTMLTextAreaElement>('[data-author-note-text]')!;
  expect(text.value).toBe(draft);
  expect(text.maxLength).toBe(1500);
  expect(field.querySelector('label')!.textContent).toBe(t('reviewAi.two.authorNote.title'));
  expect(field.querySelector('[data-visibility=author]')).not.toBeNull();
  expect(field.textContent).toContain(t('reviewAi.two.authorNote.prefilledHint'));
  expect($('[data-author-note-count]')!.textContent).toBe(t('reviewAi.two.authorNote.count', { n: draft.length, max: 1500 }));
  // 順序：給作者的說明 → 理由與改法預覽 → 給 AI 的說明
  expect($('[data-reason-preview]')!.textContent).toContain(t('reviewAi.two.authorNote.reasonsPreviewTitle'));
  expect(field.compareDocumentPosition($('[data-reason-preview]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect($('[data-reason-preview]')!.compareDocumentPosition($('[data-ai-note]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // 換去「用我的」再回來，改過的字還在
  text.value = 'Give the player a question to answer in the first message.'; text.dispatchEvent(new Event('input')); await nextTick();
  await pickFinal('blind');
  expect($('[data-author-note-field]')).toBeNull();
  await pickFinal('ai');
  expect(host.querySelector<HTMLTextAreaElement>('[data-author-note-text]')!.value).toBe('Give the player a question to answer in the first message.');
  finalButton().click();
  await vi.waitFor(() => expect(posts('stamp').length).toBe(1));
  expect(posts('stamp')[0]!.body).toEqual({ generation: 'g', finalSource: 'ai', aiSuggestionId: 'g1', aiSuggestionAt: 5, authorNote: 'Give the player a question to answer in the first message.' });
  app!.unmount(); document.body.innerHTML = ''; calls = [];

  // 沒改：不帶 authorNote，伺服器用 AI 的草稿
  await mountPage('/en/review/s1');
  await submitBlind('approve');
  await pickFinal('ai');
  expect(host.querySelector<HTMLTextAreaElement>('[data-author-note-text]')!.value).toBe(draft);
  finalButton().click();
  await vi.waitFor(() => expect(posts('stamp').length).toBe(1));
  expect(posts('stamp')[0]!.body).toEqual({ generation: 'g', finalSource: 'ai', aiSuggestionId: 'g1', aiSuggestionAt: 5 });
  app!.unmount(); document.body.innerHTML = ''; calls = [];

  // AI 是通過：伺服器不帶說明給作者，沒有這個欄位
  routes['/v1/review/s1/blind'] = blindWith('reject', ready({ verdict: 'pass', reasons: [], authorNote: draft }));
  await mountPage('/en/review/s1');
  await submitBlind('reject');
  await pickFinal('ai');
  expect($('[data-final-result]')).not.toBeNull();
  expect($('[data-author-note-field]')).toBeNull();
});

it('use the AI: a note naming internal signals is not sent; the error above the field lists each term with its snippet and a rewrite hint, and the text stays', async () => {
  mocks.fetchReviewDetail.mockImplementation(async () => detail({}));
  const edited = 'Your alt accounts sent six cards; low confidence in the setting.';
  let blocked = true;
  routes['/v1/review/s1/blind'] = blindWith('approve', ready({ at: 5, authorNote: 'Draft' }));
  routes['/v1/review/s1/stamp'] = () => (blocked ? internal(edited, [['帳號', 'accounts'], ['分數', 'confidence']]) : stampOk('ai', 'rejected'));
  await mountPage('/en/review/s1');
  await submitBlind('approve');
  await pickFinal('ai');
  const text = host.querySelector<HTMLTextAreaElement>('[data-author-note-text]')!;
  text.value = edited; text.dispatchEvent(new Event('input')); await nextTick();
  finalButton().click();
  await vi.waitFor(() => expect($('[data-note-guard]')).not.toBeNull());
  expect(posts('stamp').length).toBe(1);
  const guard = $('[data-note-guard]')!;
  expect(guard.getAttribute('role')).toBe('alert');
  // 錯誤區在欄位上方（同一個欄位區塊裡、文字框之前）
  expect(guard.closest('[data-author-note-field]')).not.toBeNull();
  expect(guard.compareDocumentPosition(host.querySelector('[data-author-note-text]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(guard.textContent).toContain(t('reviewAi.guard.title'));
  expect(guard.textContent).toContain(t('reviewAi.guard.footerFinal'));
  const a = matchOf(edited, '帳號', 'accounts'), c = matchOf(edited, '分數', 'confidence');
  expect(guardItems(guard)).toEqual([
    { term: 'account', chip: t('reviewAi.guard.term.account'), mark: a.snippet.slice(a.start, a.start + a.length), snippet: a.snippet, hint: t('reviewAi.guard.hint.account') },
    { term: 'score', chip: t('reviewAi.guard.term.score'), mark: 'confidence', snippet: c.snippet, hint: t('reviewAi.guard.hint.score') },
  ]);
  expect(document.activeElement).toBe(guard.querySelector('[data-guard-term]'));
  // 字留著、選擇留著、還在揭曉步驟；沒有另外的錯誤訊息
  expect(host.querySelector<HTMLTextAreaElement>('[data-author-note-text]')!.value).toBe(edited);
  expect(host.querySelector<HTMLTextAreaElement>('[data-author-note-text]')!.getAttribute('aria-invalid')).toBe('true');
  expect(host.querySelector<HTMLInputElement>('[data-final-pick=ai]')!.checked).toBe(true);
  expect($('[data-two-stage-compare]')).not.toBeNull();
  expect(host.querySelectorAll('[role=alert]').length).toBe(1);
  // 改好再送：錯誤區收起、送出改過的字
  blocked = false;
  text.value = 'Give the player a question to answer.'; text.dispatchEvent(new Event('input')); await nextTick();
  finalButton().click();
  await vi.waitFor(() => expect(posts('stamp').length).toBe(2));
  expect(posts('stamp')[1]!.body).toMatchObject({ finalSource: 'ai', authorNote: 'Give the player a question to answer.' });
});

it('blind step and finalize-with-changes: an internal term in the note keeps the text and shows the error above that note', async () => {
  mocks.fetchReviewDetail.mockImplementation(async () => detail({}));
  const note = 'Same device as three other accounts.';
  routes['/v1/review/s1/blind'] = () => internal(note, [['裝置', 'device'], ['帳號', 'accounts']]);
  await mountPage('/en/review/s1');
  await vi.waitFor(() => expect($('[data-decide-choices]')).not.toBeNull());
  await chooseDecision('reject');
  await pickReason('opening.no_reply_hook');
  // 駁回說明標「作者會看到」，下一行寫只寫卡片本身
  expect($('.field [data-visibility=author]')).not.toBeNull();
  expect($('#review-note-hint')!.textContent).toBe(t('reviewAi.two.authorNote.editHint'));
  const field = host.querySelector<HTMLTextAreaElement>('#review-note')!;
  field.value = note; field.dispatchEvent(new Event('input')); await nextTick();
  $('[data-submit-reject]')!.click();
  await vi.waitFor(() => expect($('[data-note-guard]')).not.toBeNull());
  const guard = $('[data-note-guard]')!;
  expect(guard.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(guard.textContent).toContain(t('reviewAi.guard.footer'));
  expect(guard.textContent).not.toContain(t('reviewAi.guard.footerFinal'));
  expect(guardItems(guard).map((i) => [i.term, i.mark, i.hint])).toEqual([
    ['device', 'device', t('reviewAi.guard.hint.device')], ['account', 'accounts', t('reviewAi.guard.hint.account')],
  ]);
  expect(document.activeElement).toBe(guard.querySelector('[data-guard-term]'));
  expect(host.querySelector<HTMLTextAreaElement>('#review-note')!.value).toBe(note);
  expect($('[data-two-stage-compare]')).toBeNull();
  expect(posts('blind').length).toBe(1);
  app!.unmount(); document.body.innerHTML = ''; calls = [];

  // 修改後定案：同一道檢查，錯誤區在駁回說明上方，結尾寫「再按一次定案」
  routes['/v1/review/s1/blind'] = blindWith('reject', ready({ verdict: 'pass', reasons: [] }), { note: 'Needs a hook' });
  const changed = 'Needs a hook; your weekly quota is used up.';
  routes['/v1/review/s1/stamp'] = () => internal(changed, [['額度', 'quota']]);
  await mountPage('/en/review/s1');
  await submitBlind('reject');
  await pickFinal('modified');
  await vi.waitFor(() => expect($('#review-note')).not.toBeNull());
  const edit = host.querySelector<HTMLTextAreaElement>('#review-note')!;
  edit.value = changed; edit.dispatchEvent(new Event('input')); await nextTick();
  finalButton().click();
  await vi.waitFor(() => expect($('[data-note-guard]')).not.toBeNull());
  expect(posts('stamp').length).toBe(1);
  expect($('[data-note-guard]')!.textContent).toContain(t('reviewAi.guard.footerFinal'));
  expect(guardItems($('[data-note-guard]')!).map((i) => [i.term, i.chip, i.mark])).toEqual([['quota', t('reviewAi.guard.term.quota'), 'quota']]);
  expect(host.querySelector<HTMLTextAreaElement>('#review-note')!.value).toBe(changed);
  expect(host.querySelector<HTMLInputElement>('[data-final-pick=modified]')!.checked).toBe(true);
});

it('two-step re-entry: a second blind call goes straight to the AI step, and so does reopening a card with my blind call', async () => {
  mocks.fetchReviewDetail.mockResolvedValueOnce(detail({})).mockResolvedValue(detail({}, { myBlind: blindOf('reject') }));
  routes['/v1/review/s1/blind'] = () => [409, { error: 'blind_already_recorded' }];
  routes['/v1/review/s1/ai'] = () => [200, { suggestions: [suggestion()], myFeedback: [] }];
  await mountPage('/en/review/s1');
  await submitBlind('reject');
  await vi.waitFor(() => expect($('[data-agree]')).not.toBeNull());
  expect(posts('blind').length).toBe(1);
  expect(aiCalls().length).toBe(1);
  expect($('[data-agree]')!.dataset.agree).toBe('same');
  expect($('[role=alert]')).toBeNull();
  app!.unmount(); document.body.innerHTML = ''; calls = [];

  mocks.fetchReviewDetail.mockReset().mockResolvedValue(detail({}, { myBlind: blindOf('reject') }));
  await mountPage('/en/review/s1');
  await vi.waitFor(() => expect($('[data-agree]')).not.toBeNull());
  expect($('[data-decide-choices]')).toBeNull();
  expect(posts('blind')).toEqual([]);
  expect(aiCalls().map((c) => c.url)).toEqual(['/v1/review/s1/ai']);
});

it('retention: a decided card past its retention says only public data is left; within retention it shows the date', async () => {
  mocks.fetchReviewDetail.mockResolvedValue(detail({ status: 'approved', claimedByMe: false, stampedByMe: false, manager: true, stamps: [{ verdict: 'approve', note: '', at: 2 }] }, { retainUntil: null, detail: { ...detail({}).detail, partial: true, closed: true } }));
  await mountPage('/en/review/s1');
  await vi.waitFor(() => expect($('[data-retain-expired]')).not.toBeNull());
  expect($('[data-retain-expired]')!.textContent).toBe(t('review.retain.expired'));
  expect(host.textContent).not.toContain(t('review.closedPartial'));
  expect($('[data-retain-until]')).toBeNull();
  app!.unmount(); document.body.innerHTML = '';

  const until = Date.UTC(2026, 11, 1, 4);
  mocks.fetchReviewDetail.mockReset().mockResolvedValue(detail({ status: 'approved', claimedByMe: false, stampedByMe: false, manager: true, stamps: [{ verdict: 'approve', note: '', at: 2 }] }, { retainUntil: until }));
  await mountPage('/en/review/s1');
  await vi.waitFor(() => expect($('[data-retain-until]')).not.toBeNull());
  expect($('[data-retain-expired]')).toBeNull();
  expect(aiCalls()).toEqual([]);
});

// 兩段式之後（ui-two-stage.md）：通過與駁回在定案前已經並排比過，結果卡下不再掛揭曉區；只剩不受理用
it('revisiting a card I stamped shows the result card without the old reveal panel and asks nothing', async () => {
  mocks.fetchReviewDetail.mockResolvedValue(detail({ status: 'rejected', claimedByMe: false, stampedByMe: true, stamps: [{ verdict: 'reject', note: '', at: 2, mine: true, finalSource: 'ai' }] }, { rejectReasons: ['opening.no_reply_hook'], retainUntil: Date.UTC(2026, 11, 1), myBlind: blindOf('approve') }));
  routes['/v1/review/s1/ai'] = () => [200, { suggestions: [suggestion()], myFeedback: [] }];
  await mountPage('/en/review/s1');
  await vi.waitFor(() => expect($('[data-result-card]')).not.toBeNull());
  await new Promise((r) => setTimeout(r, 0));
  expect($('[data-ai-reveal]')).toBeNull();
  expect($('[data-two-stage-compare]')).toBeNull();
  expect(aiCalls()).toEqual([]);
  // 定案來源與保留期：來源讀我那一章，保留期寫到期日
  expect($('[data-final-source]')!.textContent).toBe(t('reviewAi.two.sourceChip', { source: t('reviewAi.two.source.ai') }));
  expect($('[data-retain-until]')).not.toBeNull();
  expect($('[data-retain-expired]')).toBeNull();
});

it('a decided card whose stamp is not mine (a manager reading it) gets no panel and no request', async () => {
  mocks.fetchReviewDetail.mockResolvedValue(detail({ status: 'approved', claimedByMe: false, stampedByMe: false, manager: true, stamps: [{ verdict: 'approve', note: '', at: 2 }] }));
  routes['/v1/review/s1/ai'] = () => [200, { suggestions: [suggestion()], myFeedback: [] }];
  await mountPage('/en/review/s1');
  await vi.waitFor(() => expect($('[data-result-card]')).not.toBeNull());
  await new Promise((r) => setTimeout(r, 0));
  expect($('[data-ai-reveal]')).toBeNull();
  expect(aiCalls()).toEqual([]);
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

it('shows the AI arbitration tab to every reviewer (managers also get stats and the report)', async () => {
  routes['/v1/review-ai/disagreements?'] = () => [200, { total: 0, items: [] }];
  routes['/v1/review-ai/report'] = () => [200, { from: 0, to: 1, versions: [] }];
  await mountPage('/en/review/ai');
  await vi.waitFor(() => expect(host.querySelector('.management-nav a[href="/en/review/ai"][aria-current="page"]')).not.toBeNull());
  await vi.waitFor(() => expect(host.querySelector('.management-nav a[href="/en/review/stats"]')).not.toBeNull());
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

  // 一般審核員（owner 2026-11-24）：有 AI 仲裁分頁、清單可用；沒有審核統計、沒有報表子頁，報表網址顯示沒有權限
  mocks.role = 'reviewer';
  await mountPage('/en/review/ai');
  await vi.waitFor(() => expect(host.querySelector('.management-nav a[href="/en/review/ai"]')).not.toBeNull());
  expect(host.querySelector('.management-nav a[href="/en/review/stats"]')).toBeNull();
  await vi.waitFor(() => expect($('[data-empty]')).not.toBeNull());
  expect($('[data-ai-sub="report"]')).toBeNull();
  calls = [];
  await router.push('/en/review/ai/report'); await nextTick();
  await vi.waitFor(() => expect($('[data-forbidden]')).not.toBeNull());
  expect(calls.filter((c) => c.url.startsWith('/v1/review-ai/report'))).toEqual([]);
});

it('arbitration: reference checkbox only for a winner, names the pool, links to re-review when the AI was right about an approved card', async () => {
  routes['/v1/review-ai/disagreements/g1/arbitration'] = (c) => [200, { id: 'x1', value: c.body.value, referencePool: c.body.addToReference ? 'reject' : null }];
  routes['/v1/review-ai/disagreements/g1'] = () => [200, disagreement({ update: { state: 'ready', baseKind: 'approved', fields: [{ key: 'opening', before: 'Old opening', after: 'New opening' }], lorebook: { added: 1, removed: 0, modified: 0 } } })];
  routes['/v1/review-ai/disagreements?'] = () => [200, { total: 4, items: [{ suggestionId: 'g2' }] }];
  await mountPage('/en/review/ai/g1');
  await vi.waitFor(() => expect($('[data-arbitration]')).not.toBeNull());
  expect(host.querySelectorAll('[data-col]').length).toBe(3);
  expect($('[data-col=human]')!.textContent).toContain('Rin');
  expect($('[data-col=ai]')!.textContent).toContain(t('reviewAi.flag.ai_unedited'));
  expect($('[data-col=ai]')!.textContent).toContain('deepseek-x');
  // 更新：逐欄改前改後，欄位名稱與審核頁「更新內容」同一份
  const field = $('[data-update-field=opening]')!;
  expect(field.querySelector('summary')!.textContent).toBe(t('editor.welcome'));
  expect(field.textContent).toContain('Old opening');
  expect(field.textContent).toContain('New opening');

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
  // 給 AI 的說明（取代原本的備註）：原因類型可多選，不給作者看
  expect($('[data-ai-note]')!.textContent).toContain(t('reviewAi.note.subArbitration'));
  host.querySelector<HTMLInputElement>('[data-ai-note-type=criteria_issue]')!.click(); await nextTick();
  host.querySelector<HTMLInputElement>('[data-ai-note-type=card_content]')!.click(); await nextTick();
  (host.querySelector('#ai-arb-note-text') as HTMLTextAreaElement).value = 'Opening has no hook';
  host.querySelector('#ai-arb-note-text')!.dispatchEvent(new Event('input'));
  $('[data-action=submit]')!.click();
  await vi.waitFor(() => expect($('[data-result]')).not.toBeNull());
  // 類型照清單順序送
  expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ value: 'ai_right', addToReference: true, note: 'Opening has no hook', noteTypes: ['card_content', 'criteria_issue'], operationId: 'op-1' });
  expect($('[data-result-note-types]')!.textContent).toContain(t('reviewAi.note.type.criteria_issue'));
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

// ---------- AI 說服你了嗎（v21） ----------

it('persuade: the AI column shows its trade-offs once, reviewers only; the two-way choice is unselected, saves on click, can change, and stays out of the arbitration', async () => {
  let fail = false;
  routes['/v1/review-ai/disagreements/g1/persuasion'] = (c) => (fail ? [503, { error: 'unavailable' }] : [200, { value: c.body.value, updatedAt: 9 }]);
  routes['/v1/review-ai/disagreements/g1/arbitration'] = (c) => [200, { id: 'x1', value: c.body.value, referencePool: null }];
  routes['/v1/review-ai/disagreements/g1'] = () => [200, disagreement()];
  routes['/v1/review-ai/disagreements?'] = () => [200, { total: 0, items: [] }];
  await mountPage('/en/review/ai/g1');
  await vi.waitFor(() => expect($('[data-tradeoff]')).not.toBeNull());
  const block = $('[data-col=ai] [data-tradeoff]')!;
  expect(block.textContent).toContain(t('reviewAi.arb.tradeoff.title'));
  expect(block.querySelector('[data-visibility=reviewers]')!.textContent).toContain(t('reviewAi.two.visibility.reviewerOnly'));
  expect($('[data-tradeoff-note]')!.textContent).toBe('No hook.');
  // 說明只出現一次（原本的「依據」搬進權衡區塊）
  expect($('[data-col=ai]')!.textContent!.split('No hook.').length).toBe(2);
  expect(block.textContent).toContain(t('reviewAi.arb.persuade.title'));
  expect(block.textContent).toContain(t('reviewAi.arb.persuade.hint'));
  expect($('[data-persuade]')!.getAttribute('role')).toBe('radiogroup');
  const radio = (v: string) => host.querySelector<HTMLInputElement>(`[data-persuade-value=${v}]`)!;
  const puts = () => calls.filter((c) => c.method === 'PUT');
  expect(radio('convinced').checked || radio('not_convinced').checked).toBe(false);
  expect($('[data-persuade-recorded]')).toBeNull();

  radio('convinced').click();
  await vi.waitFor(() => expect($('[data-persuade-recorded]')).not.toBeNull());
  expect(puts().map((c) => [c.url, c.body])).toEqual([['/v1/review-ai/disagreements/g1/persuasion', { value: 'convinced' }]]);
  expect($('[data-persuade-recorded]')!.textContent).toBe(t('reviewAi.arb.persuade.recorded', { value: t('reviewAi.arb.persuade.yes') }));
  radio('not_convinced').click();
  await vi.waitFor(() => expect(puts().length).toBe(2));
  await vi.waitFor(() => expect($('[data-persuade-recorded]')!.textContent).toContain(t('reviewAi.arb.persuade.no')));
  expect(puts()[1]!.body).toEqual({ value: 'not_convinced' });

  // 存不起來：回到上一次存好的選擇，說一句
  fail = true;
  radio('convinced').click();
  await vi.waitFor(() => expect($('[data-persuade-error]')).not.toBeNull());
  expect($('[data-persuade-error]')!.textContent).toBe(t('reviewAi.arb.persuade.failed'));
  expect(radio('not_convinced').checked).toBe(true);
  expect(radio('convinced').checked).toBe(false);

  // 仲裁照舊：不帶被說服，送出後還能改
  fail = false;
  host.querySelector<HTMLInputElement>('[data-value=human_right]')!.click(); await nextTick();
  $('[data-action=submit]')!.click();
  await vi.waitFor(() => expect($('[data-result]')).not.toBeNull());
  expect(Object.keys(calls.find((c) => c.method === 'POST')!.body).sort()).toEqual(['addToReference', 'note', 'noteTypes', 'operationId', 'value']);
  radio('convinced').click();
  await vi.waitFor(() => expect(puts().length).toBe(4));
  await vi.waitFor(() => expect($('[data-persuade-recorded]')!.textContent).toContain(t('reviewAi.arb.persuade.yes')));
});

it('persuade: the item stopped being a disagreement (404) — the page reloads and says it is gone instead of asking to retry', async () => {
  let gone = false;
  routes['/v1/review-ai/disagreements/g1/persuasion'] = () => { gone = true; return [404, { error: 'disagreement_not_found' }]; };
  routes['/v1/review-ai/disagreements/g1'] = () => (gone ? [404, { error: 'disagreement_not_found' }] : [200, disagreement()]);
  routes['/v1/review-ai/disagreements?'] = () => [200, { total: 0, items: [] }];
  await mountPage('/en/review/ai/g1');
  await vi.waitFor(() => expect($('[data-persuade]')).not.toBeNull());
  host.querySelector<HTMLInputElement>('[data-persuade-value=convinced]')!.click();
  await vi.waitFor(() => expect(host.textContent).toContain(t('reviewAi.arb.detail.notFound')));
  expect($('[data-persuade-error]')).toBeNull();
});

it('persuade: my earlier choice comes back checked; no AI note says so', async () => {
  routes['/v1/review-ai/disagreements/g1'] = () => [200, disagreement({ myPersuasion: 'not_convinced', ai: { ...disagreement().ai, note: '' } })];
  await mountPage('/en/review/ai/g1');
  await vi.waitFor(() => expect($('[data-tradeoff]')).not.toBeNull());
  expect($('[data-tradeoff-empty]')!.textContent).toBe(t('reviewAi.arb.tradeoff.empty'));
  expect($('[data-tradeoff-note]')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('[data-persuade-value=not_convinced]')!.checked).toBe(true);
  expect($('[data-persuade-recorded]')!.textContent).toContain(t('reviewAi.arb.persuade.no'));
});

it('list: the weekly convinced card shows a ratio from ten rated, counts and "not enough samples" below, and stays when the list is empty', async () => {
  let week = { weekStart: 1, convinced: 3, rated: 9, suppressed: true };
  routes['/v1/review-ai/disagreements?'] = (c) => [200, { total: c.url.includes('direction=') ? 0 : 1, items: c.url.includes('direction=') ? [] : [{ ...listItem }], persuasion: week }];
  routes['/v1/review-ai/report'] = () => [200, { from: 0, to: 1, versions: [] }];
  await mountPage('/en/review/ai');
  await vi.waitFor(() => expect($('[data-weekly]')).not.toBeNull());
  expect($('[data-weekly]')!.textContent).toContain(t('reviewAi.arb.persuade.weeklyTitle'));
  expect($('[data-weekly]')!.textContent).toContain(t('reviewAi.arb.persuade.weeklyRule'));
  expect($('[data-weekly-value]')!.textContent).toBe(t('reviewAi.arb.persuade.weeklySmall', { yes: 3, total: 9 }));
  expect($('[data-weekly-value]')!.textContent).not.toContain('%');
  week = { weekStart: 1, convinced: 12, rated: 29, suppressed: false };
  await router.replace({ query: { direction: 'ai_stricter' } });
  await vi.waitFor(() => expect($('[data-weekly-value]')!.textContent).toBe(t('reviewAi.arb.persuade.weeklyValue', { pct: '41%', yes: 12, total: 29 })));
  expect($('[data-empty]')).not.toBeNull();
  expect($('[data-weekly]')).not.toBeNull();
});

const listItem = { suggestionId: 'g1', submissionId: 's1', cardId: '123', name: 'Last Train', direction: 'ai_stricter', criteriaVersion: 'v3', human: { decision: 'approved', reasons: [], at: 2 }, ai: { verdict: 'reject', reasons: [], flags: [], confidence: 0.8, at: 1 }, arbitration: null };

it('report: the arbitration table gains a convinced column, suppressed on its own rated count', async () => {
  const base = { total: 40, ai: { pass: 20, reject: 18, handoff: 2 }, matrix: { approved: { pass: 18, reject: 4, handoff: 1 }, rejected: { pass: 3, reject: 13, handoff: 1 }, dropped: { pass: 0, reject: 0, handoff: 0 } }, agreement: 0.8, comparable: 38, aiStricter: 4, humanStricter: 3, handoffRate: 0.05, refusalRate: 0, costUsd: 0.1 };
  const arb = { values: { human_right: 6, ai_right: 4, both_ok: 1, both_wrong: 1 }, reasons: {} };
  routes['/v1/review-ai/report'] = () => [200, { from: 0, to: 1, versions: [
    { ...base, criteriaVersion: 'v3', arbitration: arb, persuasion: { convinced: 5, rated: 12 } },
    { ...base, criteriaVersion: 'v2', arbitration: arb, persuasion: { convinced: 2, rated: 4 } },
    { ...base, criteriaVersion: 'v1', arbitration: null, persuasion: { convinced: 3, rated: 10 } },
  ] }];
  routes['/v1/review-ai/reference-candidates'] = () => [200, { items: [], skipped: 0 }];
  routes['/v1/review-ai/notes'] = () => [200, { from: 0, to: 1, items: [] }];
  await mountPage('/en/review/ai/report');
  await vi.waitFor(() => expect($('[data-version=v3] [data-table=arbitration]')).not.toBeNull());
  const heads = [...host.querySelectorAll('[data-version=v3] [data-table=arbitration] th')].map((th) => th.textContent!.trim());
  expect(heads.at(-1)).toBe(t('reviewAi.arb.report.col.persuaded'));
  expect($('[data-version=v3] [data-cell=persuaded]')!.textContent).toBe(t('reviewAi.arb.report.persuadedCell', { pct: '41.7%', yes: '5', total: '12' }));
  expect($('[data-version=v2] [data-cell=persuaded]')!.textContent).toBe(t('reviewStats.suppressed'));
  // 沒有仲裁表的版本：被說服單獨一張小表
  expect($('[data-version=v1] [data-table=arbitration]')).toBeNull();
  expect($('[data-version=v1] [data-table=persuasion] [data-cell=persuaded]')!.textContent).toBe(t('reviewAi.arb.report.persuadedCell', { pct: '30.0%', yes: '3', total: '10' }));
});

it('report: suppresses figures under ten samples and exports the reference draft', async () => {
  routes['/v1/review-ai/report'] = () => [200, { from: 0, to: 1, versions: [
    { criteriaVersion: 'v1', total: 4, ai: { pass: 2, reject: 2, handoff: 0 }, matrix: { approved: { pass: 2, reject: 1, handoff: 0 }, rejected: { pass: 0, reject: 1, handoff: 0 }, dropped: { pass: 0, reject: 0, handoff: 0 } }, agreement: 0.75, comparable: 4, aiStricter: 1, humanStricter: 0, handoffRate: 0, refusalRate: 0, costUsd: 0.01, arbitration: { values: { human_right: 1, ai_right: 0, both_ok: 0, both_wrong: 0 }, reasons: { 'opening.no_reply_hook': { humanWrong: 0, aiWrong: 1 } } } },
    { criteriaVersion: 'v2', total: 40, finalSource: { blind: 20, ai: 6, modified: 2, human_no_ai: 3 }, corrected: 6, ai: { pass: 20, reject: 18, handoff: 2 }, matrix: { approved: { pass: 18, reject: 4, handoff: 1 }, rejected: { pass: 3, reject: 13, handoff: 1 }, dropped: { pass: 0, reject: 0, handoff: 0 } }, agreement: 0.815, comparable: 38, aiStricter: 4, humanStricter: 3, handoffRate: 0.05, refusalRate: 0, costUsd: 0.1234, arbitration: { values: { human_right: 6, ai_right: 4, both_ok: 1, both_wrong: 1 }, reasons: { 'opening.no_reply_hook': { humanWrong: 4, aiWrong: 6 }, 'character.setting_thin': { humanWrong: 1, aiWrong: 2 } } } },
  ] }];
  routes['/v1/review-ai/reference-candidates'] = () => [200, { items: [{ id: 'c1', verdict: 'pass' }, { id: 'c2', verdict: 'reject' }, { id: 'c3', verdict: 'reject' }], skipped: 1 }];
  routes['/v1/review-ai/notes'] = (c) => [200, { from: 0, to: 1, items: c.url.includes('type=author_relation')
    ? [{ kind: 'final', at: 3, types: ['author_relation'], note: 'Six cards from one group', finalSource: 'ai', decision: 'reject', arbitration: null, criteriaVersion: 'v2', cardId: '9' }]
    : [
      { kind: 'final', at: 3, types: ['author_relation'], note: 'Six cards from one group', finalSource: 'ai', decision: 'reject', arbitration: null, criteriaVersion: 'v2', cardId: '9' },
      { kind: 'arbitration', at: 2, types: ['criteria_issue'], note: null, finalSource: null, decision: 'approved', arbitration: 'human_right', criteriaVersion: 'v2', cardId: '8' },
    ] }];
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

  // 定案來源與改用 AI 結論的筆數（少於 10 筆的版本沒有這一段資料就不畫）
  expect($('[data-version=v2] [data-final-cell=ai]')!.textContent).toBe('6');
  expect($('[data-version=v2] [data-final-cell=corrected]')!.textContent).toBe('6');
  expect($('[data-version=v1] [data-table=final]')).toBeNull();
  // 給 AI 的說明：新的在前、全文；只選了類型的寫明沒有說明；可依類型篩
  await vi.waitFor(() => expect($('[data-notes]')).not.toBeNull());
  const items = () => [...host.querySelectorAll<HTMLElement>('[data-notes] [data-note-kind]')];
  expect(items().map((li) => li.dataset.noteKind)).toEqual(['final', 'arbitration']);
  expect(items()[0]!.textContent).toContain('Six cards from one group');
  expect(items()[0]!.textContent).toContain(t('reviewAi.two.source.ai'));
  expect(items()[1]!.textContent).toContain(t('reviewAi.arb.notes.typesOnly'));
  expect(items()[1]!.textContent).toContain(t('reviewAi.arb.value.human_right'));
  const select = host.querySelector<HTMLSelectElement>('[data-filter=note-type]')!;
  select.value = 'author_relation'; select.dispatchEvent(new Event('change'));
  await vi.waitFor(() => expect(items().length).toBe(1));
  expect(calls.filter((c) => c.url.startsWith('/v1/review-ai/notes')).at(-1)!.url).toContain('type=author_relation');

  await vi.waitFor(() => expect($('[data-ref-counts]')).not.toBeNull());
  expect($('[data-ref-counts]')!.textContent).toBe(t('reviewAi.arb.refs.counts', { n: '3', pass: '1', reject: '2' }));
  expect($('[data-ref-skipped]')).not.toBeNull();
  $('[data-action=export]')!.click();
  expect(created).toHaveLength(1);
  expect(JSON.parse(await created[0]!.text()).map((i: { id: string }) => i.id)).toEqual(['c1', 'c2', 'c3']);
});

it('AI state uses only the current criteria version when the server names one', async () => {
  const { aiStateOf } = await import('@/lib/review-ai');
  const v3 = { id: 'a', criteriaVersion: 'v3', model: 'm', verdict: 'reject', reasons: ['opening.too_short'], flags: [], confidence: 0.9, handoffCause: null, note: '', phase: 'shadow', at: 2 } as any;
  expect(aiStateOf([v3], 'v4')).toEqual({ state: 'pending', suggestion: null });
  expect(aiStateOf([{ ...v3, id: 'b', criteriaVersion: 'v4', verdict: 'pass', reasons: [] }, v3], 'v4').suggestion!.id).toBe('b');
  expect(aiStateOf([v3]).suggestion!.id).toBe('a');
});
