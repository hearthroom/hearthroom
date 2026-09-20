# COMMUNITY-01 — Discord community connection and own reports

Use a local fixture account for UI checks. Use the real local D1 tests for authorization; fixture UI alone is not end-to-end Discord evidence. Production OAuth and role mutations require the separately configured deployment.

1. Open a public card's report link. On `/me`, verify the card context remains after the Discord callback, including locale. The callback fragment must be removed before router initialization.
2. Verify linked/pending/not-in-guild/cleanup/error states; retry must never claim success without the Bot receipt.
3. Open privacy settings. All switches start private/off except chat XP. Verify the linked badge, own XP/level and XP needed for the next level. Turn public badges on, visit the same public author page (including an author with no cards), and verify only the badge appears. Enable public level separately; level zero must appear. Turn each switch off independently and verify the other remains visible. Neither exact XP nor Discord identity may appear publicly. Existing badge consent must not opt members into public levels.
4. Open new report, fill title/details and a category. Submit; inputs stay disabled while pending. A successful result shows the submitted title and own case details.
5. Force a delayed case response. Reload and retry the same input; the stable scoped request ID must replay the same case. A different authenticated member must not reuse it.
6. Load own reports, open one, supplement it and request closure. The website cannot decide PASS or operate another member's case. Attachments open the existing private Discord conversation.
7. Open unlink confirmation: account and effects are visible, cancel has initial focus. Cancel makes no DELETE; confirm shows cleanup, hides case access and old case results become unauthorized. The public linked badge and level disappear immediately; earned achievement visibility still follows its own preference.
8. Repeat controls at desktop and 390px mobile, zh-Hant and English; verify all five locale key sets. Run the shared visual probe plus its positive controls, inspect snapshots/screenshots and console/network. Check collapsed privacy controls are not interactive.

Backend contracts: `test/community*.test.ts`. Frontend callback/retry contracts: `web/test/discord*.test.ts`. Bot ownership and role contracts: Hearthkeeper `test/community.test.ts`.

Achievement migration contract: completed approved decisions backfill `first_work` once, while imported/unreviewed cards do not qualify. Replay must preserve the original award and use the existing role-sync dirty trigger. See `test/community-events.test.ts`; public consent and unlink contracts are in `test/community-routes.test.ts`, and author switching/level zero rendering in `web/test/community-badges.test.ts`.
