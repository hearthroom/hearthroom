/**
 * AI 審卡影子模式的審核端畫面（任務 2026-11-23-ai-card-review）：
 *   - 審核詳情的 AI 為主、人為輔（ui-ai-first.md）：作者區下方的「AI 審卡」區塊；決定區預設 AI 的建議，沒改照 AI 定案、
 *     改了記為改了 AI、沒有 AI 照一般流程；只有會讓卡上架的覆寫才確認；AI 沒審完每 10 秒重讀、晚到不覆蓋；婉拒理由；保留期。
 *   - 定案後的結果卡：照 AI／改了 AI 的單可以再標或取消「AI 判斷不準確」，按下就寫入。
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

// ---------- AI 為主、人為輔（ui-ai-first.md v25，取代兩段式盲審） ----------

const posts = (action: string) => calls.filter((c) => c.method === 'POST' && c.url === `/v1/review/s1/${action}`);
const stampOk = (finalSource: string, status = 'approved'): [number, unknown] => [200, { id: 's1', status, cardStatus: status, stamps: { approve: 1, required: 1 }, finalSource }];
const chooseDecision = async (v: 'approve' | 'reject') => { host.querySelector<HTMLInputElement>(`[data-decide-choices] input[value=${v}]`)!.click(); await nextTick(); };
const pickReason = async (code: string) => { host.querySelector<HTMLInputElement>(`[data-reason="${code}"]`)!.click(); await nextTick(); };
const checked = () => host.querySelector<HTMLInputElement>('[data-decide-choices] input:checked')?.value ?? null;
const typeInto = async (el: HTMLTextAreaElement, value: string) => { el.value = value; el.dispatchEvent(new Event('input')); await nextTick(); };
const aiWith = (...list: unknown[]) => (): [number, unknown] => [200, { suggestions: list, current: 'v2', inaccurate: false }];
/** 每次讀都是新的一份：定案後頁面會先在畫面上記下我的章 */
const pending = () => mocks.fetchReviewDetail.mockImplementation(async () => detail({}));
/** 第一次讀是待審，之後是我已經定案的那一份 */
const thenDecided = (verdict: 'approve' | 'reject', finalSource: string) => mocks.fetchReviewDetail.mockResolvedValueOnce(detail({})).mockResolvedValue(detail({ status: verdict === 'approve' ? 'approved' : 'rejected', claimedByMe: false, stampedByMe: true, stamps: [{ verdict, note: '', at: 2, mine: true, finalSource }] }, { retainUntil: Date.UTC(2026, 11, 1) }));
const waitAi = async () => { await vi.waitFor(() => expect($('[data-ai-first]')!.dataset.aiView).toBe('ready')); await nextTick(); };

it('the AI review block sits below the author area and above the tabs: suggestion, confidence, reason chips and a reviewers-only internal note; there is no blind step', async () => {
  pending();
  routes['/v1/review/s1/ai'] = aiWith(suggestion({ reasons: ['opening.no_reply_hook', 'decline.not_ready'], note: 'Opening ends without a hook.', authorNote: 'Give the player something to answer.' }));
  await mountPage('/en/review/s1');
  await waitAi();
  const block = $('[data-ai-first]')!;
  // 位置：作者區（頁首）之後、分頁條之前
  expect($('.layout__head')!.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(block.compareDocumentPosition($('.tabs-bar')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(block.querySelector('h3')!.textContent).toBe(t('reviewAi.first.title'));
  expect(block.querySelector('[data-ai-verdict]')!.textContent).toBe(t('reviewAi.first.verdict.reject'));
  expect(block.querySelector('[data-ai-confidence]')!.textContent).toBe(t('reviewAi.reveal.confidence', { pct: '82%' }));
  expect([...block.querySelectorAll('[data-ai-reasons] li')].map((li) => li.textContent)).toEqual([t('review.reasons.opening.no_reply_hook.name'), t('review.reasons.decline.not_ready.name')]);
  const internalNote = block.querySelector('[data-ai-internal]')!;
  expect(internalNote.querySelector('[data-ai-internal-note]')!.textContent).toBe('Opening ends without a hook.');
  expect(internalNote.querySelector('[data-visibility=reviewers]')).not.toBeNull();
  // 給作者的草稿不在區塊裡重複，直接帶進決定區
  expect(block.textContent).not.toContain('Give the player something to answer.');
  expect(block.querySelector('[data-ai-inaccurate]')!.getAttribute('aria-pressed')).toBe('false');
  expect(block.querySelector('[data-ai-inaccurate-hint]')!.textContent).toBe(t('reviewAi.first.inaccurateHint'));
  // 沒有盲審步驟
  expect($('[data-steps]')).toBeNull();
  expect(posts('blind')).toEqual([]);
  expect(aiCalls().map((c) => c.url)).toEqual(['/v1/review/s1/ai']);
});

it('the decision defaults to the AI rejection; unchanged it finalizes as the AI suggests in one click, with the AI id and time, the inaccurate mark and the note for the AI', async () => {
  thenDecided('reject', 'ai');
  routes['/v1/review/s1/ai'] = aiWith(suggestion({ at: 5, authorNote: 'Give the player something to answer.' }));
  routes['/v1/review/s1/stamp'] = () => stampOk('ai', 'rejected');
  await mountPage('/en/review/s1');
  await waitAi();
  expect(checked()).toBe('reject');
  expect($('[data-ai-default]')!.textContent).toBe(t('reviewAi.first.defaultChip'));
  const option = $('[data-ai-option]')!;
  expect(option.textContent).toBe(t('reviewAi.first.optionChip'));
  expect(option.closest('label')!.querySelector('input')!.value).toBe('reject');
  expect(host.querySelector<HTMLInputElement>('[data-reason="opening.no_reply_hook"]')!.checked).toBe(true);
  expect(host.querySelector<HTMLTextAreaElement>('#review-note')!.value).toBe('Give the player something to answer.');
  // 說明欄是 AI 草稿帶進來的：說明句先講可以直接改
  expect($('#review-note-hint')!.textContent).toBe(t('reviewAi.two.authorNote.prefilledHint'));
  expect($('#review-note-hint')!.hasAttribute('data-note-prefilled')).toBe(true);
  expect($('[data-ai-modified]')).toBeNull();
  const submit = $('[data-submit-reject]') as HTMLButtonElement;
  expect(submit.classList.contains('btn--danger')).toBe(true);
  expect(submit.textContent!.trim()).toBe(t('reviewAi.first.submitAi.reject'));
  expect($('[data-ai-submit-hint]')!.textContent).toBe(t('reviewAi.first.submitHint'));
  // AI 判斷不準確：單鈕、可取消
  $('[data-ai-inaccurate]')!.click(); await nextTick();
  expect($('[data-ai-inaccurate]')!.getAttribute('aria-pressed')).toBe('true');
  expect($('[data-ai-inaccurate-hint]')!.textContent).toBe(t('reviewAi.first.inaccurateOn'));
  // 標了不準確仍是照 AI 定案（兩件事）
  expect(submit.textContent!.trim()).toBe(t('reviewAi.first.submitAi.reject'));
  $('[data-ai-note-toggle]')!.click(); await nextTick();
  await typeInto(host.querySelector<HTMLTextAreaElement>('[data-ai-note-text]')!, 'Reason right, wording off');
  submit.click();
  await vi.waitFor(() => expect(posts('stamp').length).toBe(1));
  expect(confirmState.current).toBeNull();
  expect(posts('stamp')[0]!.body).toEqual({ generation: 'g', finalSource: 'ai', aiSuggestionId: 'g1', aiSuggestionAt: 5, aiNote: 'Reason right, wording off', aiInaccurate: true });
  await vi.waitFor(() => expect($('[data-result-card]')).not.toBeNull());
  expect($('[data-final-source]')!.textContent).toBe(t('reviewAi.two.sourceChip', { source: t('reviewAi.two.source.ai') }));
});

it('an AI approval is preselected and finalizes as the AI suggests without a confirmation', async () => {
  pending();
  routes['/v1/review/s1/ai'] = aiWith(suggestion({ verdict: 'pass', reasons: [], at: 7 }));
  routes['/v1/review/s1/stamp'] = () => stampOk('ai');
  await mountPage('/en/review/s1');
  await waitAi();
  expect(checked()).toBe('approve');
  expect($('[data-ai-option]')!.closest('label')!.querySelector('input')!.value).toBe('approve');
  const submit = $('[data-submit-approve]') as HTMLButtonElement;
  expect(submit.textContent!.trim()).toBe(t('reviewAi.first.submitAi.approve'));
  // 審核標記不算修改：照 AI 定案時連結論一起送，伺服器才收得到標記
  host.querySelector<HTMLInputElement>('[data-decision-mark=suspect_ai_text]')!.click(); await nextTick();
  expect($('[data-ai-modified]')).toBeNull();
  expect(submit.textContent!.trim()).toBe(t('reviewAi.first.submitAi.approve'));
  submit.click();
  await vi.waitFor(() => expect(posts('stamp').length).toBe(1));
  expect(confirmState.current).toBeNull();
  expect(posts('stamp')[0]!.body).toEqual({ generation: 'g', finalSource: 'ai', verdict: 'approve', marks: ['suspect_ai_text'], aiSuggestionId: 'g1', aiSuggestionAt: 7 });
});

it('on a card under the length line, the auto-added length reason does not count as a change; an AI approval is not preselected there', async () => {
  const short = { reviewLength: { total: 3000, required: 3001, remaining: 1, eligible: false } };
  mocks.fetchReviewDetail.mockImplementation(async () => { const d = detail({}); return { ...d, detail: { ...d.detail, ...short } }; });
  routes['/v1/review/s1/ai'] = aiWith(suggestion({ at: 5, authorNote: 'Draft' }));
  routes['/v1/review/s1/stamp'] = () => stampOk('ai', 'rejected');
  await mountPage('/en/review/s1');
  await waitAi();
  expect(checked()).toBe('reject');
  expect(host.querySelector<HTMLInputElement>('[data-reason="content.min_length"]')!.checked).toBe(true);
  expect($('[data-ai-modified]')).toBeNull();
  $('[data-submit-reject]')!.click();
  await vi.waitFor(() => expect(posts('stamp').length).toBe(1));
  expect(posts('stamp')[0]!.body).toMatchObject({ finalSource: 'ai' });
  app!.unmount(); document.body.innerHTML = ''; calls = [];

  routes['/v1/review/s1/ai'] = aiWith(suggestion({ verdict: 'pass', reasons: [] }));
  await mountPage('/en/review/s1');
  await waitAi();
  expect(checked()).toBeNull();
  expect($('[data-ai-option]')!.closest('label')!.querySelector('input')!.value).toBe('approve');
});

it('any change to the AI suggestion is summarized and finalizes as changed, sending the edited decision', async () => {
  thenDecided('reject', 'modified');
  routes['/v1/review/s1/ai'] = aiWith(suggestion({ at: 5, authorNote: 'Draft' }));
  routes['/v1/review/s1/stamp'] = () => stampOk('modified', 'rejected');
  await mountPage('/en/review/s1');
  await waitAi();
  await pickReason('character.setting_thin');
  await typeInto(host.querySelector<HTMLTextAreaElement>('#review-note')!, 'Draft, and the setting needs more.');
  const summary = $('[data-ai-modified]')!;
  expect(summary.textContent).toBe(t('reviewAi.first.modified', { changes: [t('reviewAi.first.change.added', { names: t('review.reasons.character.setting_thin.name') }), t('reviewAi.first.change.note')].join(', ') }));
  const submit = $('[data-submit-reject]') as HTMLButtonElement;
  expect(submit.textContent!.trim()).toBe(t('reviewAi.first.submit.reject'));
  submit.click();
  await vi.waitFor(() => expect(posts('stamp').length).toBe(1));
  expect(confirmState.current).toBeNull();
  expect(posts('stamp')[0]!.body).toEqual({ generation: 'g', finalSource: 'modified', verdict: 'reject', note: 'Draft, and the setting needs more.', reasons: ['opening.no_reply_hook', 'character.setting_thin'], coaching: false, aiSuggestionId: 'g1', aiSuggestionAt: 5 });
  await vi.waitFor(() => expect($('[data-final-source]')).not.toBeNull());
  expect($('[data-final-source]')!.textContent).toBe(t('reviewAi.two.sourceChip', { source: t('reviewAi.two.source.modified') }));
});

it('only an override that would publish the card asks for confirmation', async () => {
  pending();
  routes['/v1/review/s1/ai'] = aiWith(suggestion({ at: 5, authorNote: 'Draft' }));
  routes['/v1/review/s1/stamp'] = () => stampOk('modified');
  await mountPage('/en/review/s1');
  await waitAi();
  await chooseDecision('approve');
  expect($('[data-ai-modified]')!.textContent).toBe(t('reviewAi.first.modified', { changes: t('reviewAi.first.change.verdict', { verdict: t('review.action.approve') }) }));
  const submit = $('[data-submit-approve]') as HTMLButtonElement;
  expect(submit.textContent!.trim()).toBe(t('reviewAi.first.submit.approve'));
  submit.click();
  await vi.waitFor(() => expect(confirmState.current).not.toBeNull());
  expect(confirmState.current!.title).toBe(t('reviewAi.first.confirm.title'));
  expect(confirmState.current!.message).toContain(t('reviewAi.first.confirm.body'));
  expect(posts('stamp')).toEqual([]);
  settleConfirm(true);
  await vi.waitFor(() => expect(posts('stamp').length).toBe(1));
  expect(posts('stamp')[0]!.body).toEqual({ generation: 'g', finalSource: 'modified', verdict: 'approve', note: '', aiSuggestionId: 'g1', aiSuggestionAt: 5 });
});

it('without an AI suggestion (handoff) the block says so in one line and the decision is the usual flow, recorded as no AI comparison', async () => {
  pending();
  routes['/v1/review/s1/ai'] = aiWith(suggestion({ verdict: 'handoff', reasons: [] }));
  routes['/v1/review/s1/stamp'] = () => stampOk('human_no_ai', 'rejected');
  await mountPage('/en/review/s1');
  await vi.waitFor(() => expect($('[data-ai-none]')).not.toBeNull());
  expect($('[data-ai-none]')!.textContent).toBe(t('reviewAi.first.none'));
  expect($('[data-ai-inaccurate]')).toBeNull();
  expect(checked()).toBeNull();
  expect($('[data-ai-default]')).toBeNull();
  await chooseDecision('reject');
  // 沒有 AI 草稿：說明欄照一般的說明句
  expect($('#review-note-hint')!.textContent).toBe(t('reviewAi.two.authorNote.editHint'));
  expect($('#review-note-hint')!.hasAttribute('data-note-prefilled')).toBe(false);
  await pickReason('opening.too_short');
  $('[data-submit-reject]')!.click();
  await vi.waitFor(() => expect(posts('stamp').length).toBe(1));
  expect(posts('stamp')[0]!.body).toEqual({ generation: 'g', finalSource: 'human_no_ai', verdict: 'reject', note: '', reasons: ['opening.too_short'], coaching: false });
});

it('while the AI is still reviewing it rereads every 10 seconds; arriving late it keeps what the reviewer filled and offers to apply', async () => {
  pending();
  let aiDone = false;
  routes['/v1/review/s1/ai'] = () => [200, { suggestions: aiDone ? [suggestion({ authorNote: 'AI draft' })] : [], current: 'v2', inaccurate: false }];
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    await mountPage('/en/review/s1');
    await vi.waitFor(() => expect($('[data-ai-pending]')).not.toBeNull());
    expect($('[data-ai-pending]')!.textContent).toBe(t('reviewAi.first.pending'));
    expect(checked()).toBeNull();
    expect(aiCalls().length).toBe(1);
    await chooseDecision('reject');
    await pickReason('opening.too_short');
    vi.advanceTimersByTime(9_999);
    expect(aiCalls().length).toBe(1);
    vi.advanceTimersByTime(1);
    await vi.waitFor(() => expect(aiCalls().length).toBe(2));
    aiDone = true;
    vi.advanceTimersByTime(10_000);
    await vi.waitFor(() => expect($('[data-ai-late]')).not.toBeNull());
    // 換上之後不再重讀
    vi.advanceTimersByTime(60_000);
    expect(aiCalls().length).toBe(3);
  } finally {
    vi.useRealTimers();
  }
  expect($('[data-ai-late]')!.textContent).toContain(t('reviewAi.first.late', { verdict: t('reviewAi.first.verdict.reject') }));
  // 審核員填的不動
  expect(host.querySelector<HTMLInputElement>('[data-reason="opening.too_short"]')!.checked).toBe(true);
  expect(host.querySelector<HTMLInputElement>('[data-reason="opening.no_reply_hook"]')!.checked).toBe(false);
  expect(host.querySelector<HTMLTextAreaElement>('#review-note')!.value).toBe('');
  $('[data-ai-apply]')!.click(); await nextTick();
  expect($('[data-ai-late]')).toBeNull();
  expect(host.querySelector<HTMLInputElement>('[data-reason="opening.too_short"]')!.checked).toBe(false);
  expect(host.querySelector<HTMLInputElement>('[data-reason="opening.no_reply_hook"]')!.checked).toBe(true);
  expect(host.querySelector<HTMLTextAreaElement>('#review-note')!.value).toBe('AI draft');
  expect(($('[data-submit-reject]') as HTMLButtonElement).textContent!.trim()).toBe(t('reviewAi.first.submitAi.reject'));
});

it('the AI arriving into an untouched form fills it; "not now" leaves the reviewer\'s choice and records it as changed', async () => {
  pending();
  routes['/v1/review/s1/ai'] = aiWith(suggestion({ verdict: 'pass', reasons: [], at: 9 }));
  routes['/v1/review/s1/stamp'] = () => stampOk('modified', 'rejected');
  await mountPage('/en/review/s1');
  await waitAi();
  expect(checked()).toBe('approve');
  // AI 重判（換了一筆）：已經套用過，就提示而不覆蓋
  routes['/v1/review/s1/ai'] = aiWith(suggestion({ id: 'g2', at: 12, authorNote: 'New draft' }));
  $('[data-submit-approve]')!.click();
  routes['/v1/review/s1/stamp'] = () => [409, { error: 'ai_changed' }];
  await vi.waitFor(() => expect($('[data-ai-late]')).not.toBeNull());
  expect(checked()).toBe('approve');
  expect($('[role=alert]')!.textContent).toContain(t('reviewAi.two.final.aiChanged'));
  $('[data-ai-dismiss]')!.click(); await nextTick();
  expect($('[data-ai-late]')).toBeNull();
  expect(checked()).toBe('approve');
  expect(($('[data-submit-approve]') as HTMLButtonElement).textContent!.trim()).toBe(t('reviewAi.first.submit.approve'));
});

it('decline reasons sit between rating and other, are enough on their own, and preview the gentle reply first', async () => {
  pending();
  routes['/v1/review/s1/stamp'] = () => stampOk('human_no_ai', 'rejected');
  await mountPage('/en/review/s1');
  await vi.waitFor(() => expect($('[data-ai-first]')).not.toBeNull());
  await vi.waitFor(() => expect($('[data-decide-choices]')).not.toBeNull());
  await chooseDecision('reject');
  const groups = [...host.querySelectorAll<HTMLElement>('[data-reason-group]')].map((g) => g.dataset.reasonGroup);
  expect(groups).toEqual(['opening', 'setting', 'rating', 'decline', 'other']);
  expect($('[data-reason-group=decline] legend')!.textContent).toBe(t('reviewV2.decide.group.decline'));
  await pickReason('decline.not_ready');
  const preview = $('[data-reason-preview]')!;
  expect(preview.querySelector('[data-decline-preview]')!.textContent).toContain(t('review.reasons.decline.previewLabel'));
  expect(preview.querySelector('[data-decline-preview]')!.textContent).toContain(t('review.reasons.decline.not_ready.fix'));
  expect(preview.querySelector('[data-decline-order]')).toBeNull();
  // 兩項都勾：合成一段
  await pickReason('decline.burst_similar');
  expect(preview.querySelector('[data-decline-preview]')!.textContent).toContain(t('review.reasons.decline.bothFix'));
  await pickReason('decline.burst_similar');
  // 加上其他理由：婉拒在最前面，註明順序
  await pickReason('opening.too_short');
  expect(preview.querySelector('[data-decline-order]')!.textContent).toBe(t('review.reasons.decline.orderHint'));
  expect(preview.querySelector('[data-decline-preview]')!.compareDocumentPosition(preview.querySelector('.preview__item:not([data-decline-preview])')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await pickReason('opening.too_short');
  // 只有婉拒就能送出，不用寫說明
  const submit = $('[data-submit-reject]') as HTMLButtonElement;
  expect(submit.disabled).toBe(false);
  submit.click();
  await vi.waitFor(() => expect(posts('stamp').length).toBe(1));
  expect(posts('stamp')[0]!.body).toMatchObject({ finalSource: 'human_no_ai', verdict: 'reject', note: '', reasons: ['decline.not_ready'] });
});

it('decline is not offered as an improvement suggestion on approval', async () => {
  pending();
  await mountPage('/en/review/s1');
  await vi.waitFor(() => expect($('[data-decide-choices]')).not.toBeNull());
  await chooseDecision('approve');
  $('[data-suggest-toggle]')!.click(); await nextTick();
  expect($('[data-reason-group=decline]')).toBeNull();
  expect($('[data-reason="decline.not_ready"]')).toBeNull();
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

it('an internal term in the note for the author keeps the text, the choice and the AI default, and lists each hit above the note', async () => {
  pending();
  const note = 'Same device as three other accounts.';
  let blocked = true;
  routes['/v1/review/s1/ai'] = aiWith(suggestion({ at: 5, authorNote: 'Draft' }));
  routes['/v1/review/s1/stamp'] = () => (blocked ? internal(note, [['裝置', 'device'], ['帳號', 'accounts']]) : stampOk('modified', 'rejected'));
  await mountPage('/en/review/s1');
  await waitAi();
  expect($('.field [data-visibility=author]')).not.toBeNull();
  const field = host.querySelector<HTMLTextAreaElement>('#review-note')!;
  await typeInto(field, note);
  $('[data-submit-reject]')!.click();
  await vi.waitFor(() => expect($('[data-note-guard]')).not.toBeNull());
  const guard = $('[data-note-guard]')!;
  expect(guard.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(guard.textContent).toContain(t('reviewAi.guard.footerFinal'));
  expect(guardItems(guard).map((i) => [i.term, i.mark, i.hint])).toEqual([
    ['device', 'device', t('reviewAi.guard.hint.device')], ['account', 'accounts', t('reviewAi.guard.hint.account')],
  ]);
  expect(document.activeElement).toBe(guard.querySelector('[data-guard-term]'));
  expect(field.value).toBe(note);
  expect(checked()).toBe('reject');
  expect(posts('stamp').length).toBe(1);
  blocked = false;
  await typeInto(field, 'Give the player a question to answer.');
  $('[data-submit-reject]')!.click();
  await vi.waitFor(() => expect(posts('stamp').length).toBe(2));
  expect(posts('stamp')[1]!.body).toMatchObject({ finalSource: 'modified', note: 'Give the player a question to answer.' });
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

// 回頭看我定的單：結果卡寫來源與保留期；照 AI／改了 AI 的單可以再標或取消「AI 判斷不準確」（ui-ai-first.md：可在定案前後標）
it('revisiting a card I finalized as the AI suggested shows the result card and lets me change the inaccurate mark right there', async () => {
  mocks.fetchReviewDetail.mockResolvedValue(detail({ status: 'rejected', claimedByMe: false, stampedByMe: true, stamps: [{ verdict: 'reject', note: '', at: 2, mine: true, finalSource: 'ai' }] }, { rejectReasons: ['opening.no_reply_hook'], retainUntil: Date.UTC(2026, 11, 1) }));
  routes['/v1/review/s1/ai-inaccurate'] = (c) => [200, { inaccurate: c.body.inaccurate }];
  routes['/v1/review/s1/ai'] = () => [200, { suggestions: [suggestion()], current: 'v2', inaccurate: true }];
  await mountPage('/en/review/s1');
  await vi.waitFor(() => expect($('[data-result-ai-flag]')).not.toBeNull());
  expect($('[data-ai-first]')).toBeNull();
  expect($('[data-final-source]')!.textContent).toBe(t('reviewAi.two.sourceChip', { source: t('reviewAi.two.source.ai') }));
  expect($('[data-retain-until]')).not.toBeNull();
  expect($('[data-retain-expired]')).toBeNull();
  // 照伺服器記下的標：已標
  const btn = () => $('[data-result-ai-flag] [data-ai-inaccurate]') as HTMLButtonElement;
  expect(btn().getAttribute('aria-pressed')).toBe('true');
  expect($('[data-result-ai-flag] [data-ai-inaccurate-hint]')!.textContent).toBe(t('reviewAi.first.inaccurateOn'));
  btn().click();
  await vi.waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
  expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: '/v1/review/s1/ai-inaccurate', body: { inaccurate: false } });
  await vi.waitFor(() => expect(btn().getAttribute('aria-pressed')).toBe('false'));
  expect($('[data-result-ai-flag] [data-ai-inaccurate-hint]')!.textContent).toBe(t('reviewAi.first.inaccurateHint'));
  // 沒寫進去：回到原本的狀態，說一句再試
  routes['/v1/review/s1/ai-inaccurate'] = () => [500, { error: 'boom' }];
  btn().click();
  await vi.waitFor(() => expect($('[data-ai-inaccurate-error]')).not.toBeNull());
  expect($('[data-ai-inaccurate-error]')!.textContent).toBe(t('reviewV2.toast.failed'));
  expect(btn().getAttribute('aria-pressed')).toBe('false');
  expect(btn().disabled).toBe(false);
});

it('after the criteria version moved on, a card I finalized against an older suggestion still offers the inaccurate mark', async () => {
  mocks.fetchReviewDetail.mockResolvedValue(detail({ status: 'approved', claimedByMe: false, stampedByMe: true, stamps: [{ verdict: 'approve', note: '', at: 2, mine: true, finalSource: 'modified' }] }));
  routes['/v1/review/s1/ai-inaccurate'] = (c) => [200, { inaccurate: c.body.inaccurate }];
  routes['/v1/review/s1/ai'] = () => [200, { suggestions: [suggestion({ criteriaVersion: 'v1' })], current: 'v2', inaccurate: false }];
  await mountPage('/en/review/s1');
  await vi.waitFor(() => expect($('[data-result-ai-flag]')).not.toBeNull());
  const btn = $('[data-result-ai-flag] [data-ai-inaccurate]') as HTMLButtonElement;
  expect(btn.getAttribute('aria-pressed')).toBe('false');
  btn.click();
  await vi.waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('true'));
  expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ url: '/v1/review/s1/ai-inaccurate', body: { inaccurate: true } });
});

it('a card I finalized with no AI to compare has no inaccurate mark and does not read the AI', async () => {
  mocks.fetchReviewDetail.mockResolvedValue(detail({ status: 'approved', claimedByMe: false, stampedByMe: true, stamps: [{ verdict: 'approve', note: '', at: 2, mine: true, finalSource: 'human_no_ai' }] }));
  routes['/v1/review/s1/ai'] = () => [200, { suggestions: [], current: 'v2', inaccurate: false }];
  await mountPage('/en/review/s1');
  await vi.waitFor(() => expect($('[data-result-card]')).not.toBeNull());
  await new Promise((r) => setTimeout(r, 0));
  expect($('[data-result-ai-flag]')).toBeNull();
  expect(aiCalls()).toEqual([]);
});

it('a decided card whose stamp is not mine (a manager reading it) gets no panel and no request', async () => {
  mocks.fetchReviewDetail.mockResolvedValue(detail({ status: 'approved', claimedByMe: false, stampedByMe: false, manager: true, stamps: [{ verdict: 'approve', note: '', at: 2 }] }));
  routes['/v1/review/s1/ai'] = () => [200, { suggestions: [suggestion()], inaccurate: false }];
  await mountPage('/en/review/s1');
  await vi.waitFor(() => expect($('[data-result-card]')).not.toBeNull());
  await new Promise((r) => setTimeout(r, 0));
  expect($('[data-result-ai-flag]')).toBeNull();
  expect(aiCalls()).toEqual([]);
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
