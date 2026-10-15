/**
 * 分享活動的資料層：每個呼叫打到正確的方法、路徑、本體與令牌；截圖上傳走 multipart、讀取轉成 blob 網址；
 * 錯誤碼翻成人話；活動頁的來源標記。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../src/lib/i18n';
import { ApiError, describeApiError } from '../src/lib/api';
import * as campaign from '../src/lib/campaign';
import { CampaignError, campaignErrorText, evidenceBlobUrl, fieldLabel, uploadEvidence } from '../src/lib/campaign';

vi.mock('../src/lib/session', () => ({ useSession: () => ({ me: null, profile: {}, ready: true, accessToken: async () => null, restore: async () => {} }) }));
import { surfaceOf } from '../src/router';

type Call = { method: string; path: string; body: unknown; auth: string | null; contentType: string | null };
let calls: Call[];
let reply: { status: number; body: unknown } = { status: 200, body: {} };

beforeEach(() => {
  i18n.global.locale.value = 'zh-Hant';
  calls = [];
  reply = { status: 200, body: {} };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const h = new Headers(init.headers);
    calls.push({
      method: init.method ?? 'GET', path: url, auth: h.get('Authorization'), contentType: h.get('Content-Type'),
      body: init.body instanceof FormData ? init.body : init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return reply.body instanceof Blob
      ? new Response(reply.body, { status: reply.status })
      : new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const t = (k: string, p?: Record<string, unknown>) => i18n.global.t(k, p ?? {});
const last = () => calls[calls.length - 1]!;

describe('呼叫', () => {
  const cases: [string, () => Promise<unknown>, string, string, unknown][] = [
    ['submitPlacement', () => campaign.submitPlacement('tk', 'launch', { content: { title: '介紹' }, platform: 'tieba', location: '吧', publishedAt: 1, requestedTier: 'light', operationId: 'op1' }),
      'POST', '/v1/campaigns/launch/placements', { content: { title: '介紹' }, platform: 'tieba', location: '吧', publishedAt: 1, requestedTier: 'light', operationId: 'op1' }],
    ['resubmitPlacement', () => campaign.resubmitPlacement('tk', 'p 1', { operationId: 'op2', url: null }), 'PUT', '/v1/campaign/placements/p%201', { operationId: 'op2', url: null }],
    ['fetchMyContents', () => campaign.fetchMyContents('tk', 'launch'), 'GET', '/v1/me/campaign/contents?campaign=launch', undefined],
    ['fetchMyContents 全部', () => campaign.fetchMyContents('tk'), 'GET', '/v1/me/campaign/contents', undefined],
    ['fetchQueue', () => campaign.fetchQueue('tk', { status: 'needs_info', campaign: 'launch', page: 2 }), 'GET', '/v1/moderation/campaign/placements?status=needs_info&campaign=launch&page=2', undefined],
    ['fetchQueue 預設', () => campaign.fetchQueue('tk', { page: 1 }), 'GET', '/v1/moderation/campaign/placements?page=1', undefined],
    ['fetchContentDetail', () => campaign.fetchContentDetail('tk', 'c1'), 'GET', '/v1/moderation/campaign/contents/c1', undefined],
    ['decide', () => campaign.decide('tk', 'p1', { decision: 'approve', tier: 'guide', expectedVersion: 3, operationId: 'op3' }),
      'POST', '/v1/moderation/campaign/placements/p1/decision', { decision: 'approve', tier: 'guide', expectedVersion: 3, operationId: 'op3' }],
    ['fetchPayouts', () => campaign.fetchPayouts('tk', { status: 'failed', page: 1 }), 'GET', '/v1/moderation/campaign/payouts?status=failed&page=1', undefined],
    ['fetchPayable', () => campaign.fetchPayable('tk', { campaign: 'launch', page: 3 }), 'GET', '/v1/moderation/campaign/payable?campaign=launch&page=3', undefined],
    ['requestPayout', () => campaign.requestPayout('tk', 'c1', 'op4'), 'POST', '/v1/moderation/campaign/contents/c1/payout', { operationId: 'op4' }],
    ['batchPayout', () => campaign.batchPayout('tk', ['c1', 'c2'], 'op5'), 'POST', '/v1/moderation/campaign/payouts/batch', { contentIds: ['c1', 'c2'], operationId: 'op5' }],
    ['retryPayout', () => campaign.retryPayout('tk', 'y1', 'op6'), 'POST', '/v1/moderation/campaign/payouts/y1/retry', { operationId: 'op6' }],
    ['cancelPayout', () => campaign.cancelPayout('tk', 'y1', '池不會補', 'op7'), 'POST', '/v1/moderation/campaign/payouts/y1/cancel', { reason: '池不會補', operationId: 'op7' }],
    ['checkPayout', () => campaign.checkPayout('tk', 'y1'), 'POST', '/v1/moderation/campaign/payouts/y1/check', {}],
    ['reconcilePayouts', () => campaign.reconcilePayouts('tk'), 'POST', '/v1/moderation/campaign/payouts/reconcile', {}],
  ];
  it.each(cases)('%s', async (_name, run, method, path, body) => {
    await run();
    expect(last()).toMatchObject({ method, path, auth: 'Bearer tk' });
    expect(last().body).toEqual(body);
    if (body !== undefined) expect(last().contentType).toBe('application/json');
  });

  it('截圖上傳用 FormData 的 file 欄位，不自己設 Content-Type', async () => {
    reply = { status: 200, body: { id: 'e1', sha256: 'ab', bytes: 3 } };
    const file = new File(['png'], 'a.png', { type: 'image/png' });
    expect(await uploadEvidence('tk', file)).toEqual({ id: 'e1', sha256: 'ab', bytes: 3 });
    expect(last()).toMatchObject({ method: 'POST', path: '/v1/campaign/evidence', auth: 'Bearer tk', contentType: null });
    expect((last().body as FormData).get('file')).toBeInstanceOf(File);
  });

  it('截圖讀取帶令牌，回 blob 網址', async () => {
    reply = { status: 200, body: new Blob(['img'], { type: 'image/png' }) };
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:evidence-test');
    expect(await evidenceBlobUrl('tk', 'e 1')).toBe('blob:evidence-test');
    expect(last()).toMatchObject({ method: 'GET', path: '/v1/campaign/evidence/e%201', auth: 'Bearer tk' });
    expect(create.mock.calls[0]![0]).toBeInstanceOf(Blob);
    create.mockRestore();
  });

  it('截圖已刪除：410 是 evidence_purged；其他失敗帶伺服器的碼', async () => {
    reply = { status: 410, body: {} };
    const gone = await evidenceBlobUrl('tk', 'e1').catch((e) => e);
    expect(gone).toBeInstanceOf(CampaignError);
    expect(gone).toMatchObject({ status: 410, code: 'evidence_purged', message: t('campaign.error.evidence_purged') });
    reply = { status: 404, body: { error: 'evidence_not_found' } };
    expect(await evidenceBlobUrl('tk', 'e1').catch((e) => e)).toMatchObject({ status: 404, code: 'evidence_not_found' });
  });

  it('失敗時丟 CampaignError，帶碼與欄位', async () => {
    reply = { status: 400, body: { error: 'share_invalid', field: 'location' } };
    const e = await campaign.submitPlacement('tk', 'launch', { operationId: 'x' } as never).catch((x) => x);
    expect(e).toBeInstanceOf(CampaignError);
    expect(e).toMatchObject({ status: 400, code: 'share_invalid', field: 'location' });
    expect(e.message).toBe(t('campaign.error.share_invalidField', { field: fieldLabel('location', 'share') }));
  });
});

describe('錯誤文案', () => {
  it.each(['share_payout_stale', 'campaign_submit_closed', 'share_self_review'])('%s 有自己的一句話', (code) => {
    const text = campaignErrorText(new ApiError(409, 'x', code));
    expect(text).toBe(t(`campaign.error.${code}`));
    expect(text).not.toContain('campaign.error');
    expect(text).not.toContain(code);
  });

  it('附錄裡每個錯誤碼都有五語文案', async () => {
    const codes = ['campaign_not_found', 'campaign_not_open', 'share_invalid', 'share_content_not_found', 'evidence_not_attachable', 'campaign_rate_limited',
      'campaign_operation_repeated', 'share_placement_not_found', 'share_not_editable', 'campaign_submit_closed', 'evidence_invalid', 'evidence_rate_limited',
      'evidence_unavailable', 'evidence_purged', 'evidence_not_found', 'share_self_review', 'share_version_conflict', 'share_already_decided', 'agent_not_allowed',
      'community_admin_required', 'share_self_payout', 'share_payout_not_found', 'campaign_not_payable', 'campaign_payout_closed', 'share_nothing_due',
      'share_payout_in_progress', 'share_payout_not_retryable', 'share_payout_not_cancellable', 'share_payout_not_pending', 'share_payout_stale'];
    for (const locale of ['zh-Hant', 'zh-Hans', 'en', 'ja', 'ko']) {
      const messages = (await import(`../src/locales/${locale}.json`)).default as Record<string, string>;
      for (const code of codes) expect(messages[`campaign.error.${code}`], `${locale} ${code}`).toBeTruthy();
    }
  });

  it('share_invalid 帶欄位時講是哪一格；不認得的欄位講通用的一句；帳號不對講要用哪種帳號', () => {
    expect(campaignErrorText(new CampaignError(400, 'x', 'share_invalid', 'url'))).toBe(t('campaign.error.share_invalidField', { field: t('campaign.share.field.url') }));
    expect(campaignErrorText(new CampaignError(400, 'x', 'share_invalid', 'body'))).toBe(t('campaign.error.share_invalid'));
    expect(campaignErrorText(new CampaignError(400, 'x', 'share_invalid', 'account'))).toBe(t('campaign.error.share_invalidAccount'));
  });

  it('不認得的碼退回通用文案；字串碼也收；不是 API 錯誤就講原句', () => {
    expect(campaignErrorText(new ApiError(500, 'x', 'internal_error'))).toBe(describeApiError(500, 'internal_error'));
    expect(campaignErrorText('share_nothing_due')).toBe(t('campaign.error.share_nothing_due'));
    expect(campaignErrorText(new Error('網路斷了'))).toBe('網路斷了');
    expect(campaignErrorText(null)).toBe(t('state.requestFailed'));
  });
});

describe('來源標記', () => {
  it('活動頁是 campaign，我的申請算在 mine', () => {
    expect(surfaceOf('/campaign/launch')).toBe('campaign');
    expect(surfaceOf('/zh-Hans/campaign/x')).toBe('campaign');
    expect(surfaceOf('/me/campaign')).toBe('mine');
    expect(surfaceOf('/en/me/campaign')).toBe('mine');
  });
});
