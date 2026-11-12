import { expect, it } from 'vitest';
import { applyLocale, i18n } from '../src/lib/i18n';
import { noticeText } from '../src/lib/notifications';
import type { CommunityNotice } from '../src/lib/community';

const locales = ['zh-Hant', 'zh-Hans', 'en', 'ja', 'ko'] as const;
const generic = ['新通知', '新通知', 'New notification', '新しいお知らせ', '새 알림'];
const digest = ['「合成卡」有 3 則新評論', '「合成卡」有 3 条新评论', '“合成卡” has 3 new comments',
  '『合成卡』に新しいコメントが 3 件あります', '“合成卡”에 새 댓글이 3개 달렸습니다'];
const notice = (kind: string): CommunityNotice => ({ id: 'fixture', kind, path: '/me/notifications', created_at: 1, read_at: null });

// Producer inventory, not an automatic catalog: SQL triggers (0062, 0092, 0114,
// 0117), comment-moderation, review-notifications, moderation, updates, suki,
// campaign-review/payout, enforcement-notices; routes derives the expired kind.
// Include sparse payloads: dedicated detail branches must retain plain labels.
const kinds = [
  'comment_reply', 'comment_like', 'card_comments', 'followed_work',
  'review_result', 'review_reminder', 'review_reminder_expired', 'comment_removed',
  'registration_pack', 'report_shipped', 'suki_recall',
  'share_needs_info', 'share_approved', 'share_rejected', 'share_paid', 'share_queued',
  'enforcement_notice', 'enforcement_result',
];

it.each(locales)('has local copy for every audited producer kind in %s', async locale => {
  await applyLocale(locale);
  for (const kind of kinds) {
    const key = kind === 'enforcement_notice' ? 'enforcement.notification.title'
      : kind === 'enforcement_result' ? 'enforcement.result.subject.maintained'
      : `community.notices.${kind}`;
    expect(i18n.global.te(key, locale), `${locale}: ${kind}`).toBe(true);
    expect(noticeText(notice(kind))).not.toMatch(/^(?:community\.|enforcement\.)/);
  }
  for (const key of ['community.noticeText.card_comments', 'community.notices.card_comments',
    'enforcement.result.subject.revoked', 'notifications.newNotice']) {
    expect(i18n.global.te(key, locale), `${locale}: ${key}`).toBe(true);
  }
});

it.each(locales)('shows a neutral label for an unknown kind in %s', async locale => {
  await applyLocale(locale);
  expect(noticeText(notice('future_kind'))).toBe(generic[locales.indexOf(locale)]);
});

it.each(locales)('retains the card name and comment count in %s', async locale => {
  await applyLocale(locale);
  expect(noticeText({ ...notice('card_comments'), card: { id: 12, name: '合成卡' }, extra: { count: 3 } }))
    .toBe(digest[locales.indexOf(locale)]);
});

it('also shields a known kind whose plain copy is missing in every loaded language', async () => {
  for (const locale of locales) await applyLocale(locale);
  const saved = locales.map(locale => i18n.global.getLocaleMessage(locale));
  try {
    for (const locale of locales) {
      const messages = { ...i18n.global.getLocaleMessage(locale) };
      delete messages['community.notices.comment_reply'];
      i18n.global.setLocaleMessage(locale, messages);
    }
    for (const locale of locales) {
      await applyLocale(locale);
      expect(noticeText(notice('comment_reply'))).toBe(generic[locales.indexOf(locale)]);
    }
  } finally {
    locales.forEach((locale, index) => i18n.global.setLocaleMessage(locale, saved[index]));
  }
});
