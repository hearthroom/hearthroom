# HEARTHROOM-MINE-01 — Single-provider author card footer

Surface: `/mine` (including localized routes), `MyCardsPage` / `MyCardTile`.

With HarperHarbor as the sole provider, ordinary drafts and submitted cards end at the
poster/actions area. No empty provider footer, reserved padding, or provider chooser is
rendered. The playtest action links directly to the card's numeric source-play route.
Review feedback still appears when present.

## Repeatable checks

1. Sign in with an author fixture containing an unsubmitted card, a pending card, and a
   rejected card with a review note. Open My Cards through the author workspace.
2. On the first two cards, verify `.card__body` is absent and the card and poster bottom
   edges match. A rejected card retains its note and resubmission action.
3. Inspect the playtest link: `/play/{cardNumber}?mode=source&provider=harbor`, preserving
   the viewer's locale. No platform chooser is necessary. Do not spend credits to verify
   this presentation change.
4. Cover desktop and narrow mobile widths, light/dark modes, and Chinese/English labels.
   Confirm all actions remain visible, no horizontal overflow, and no uncaught errors.
5. Positive control: in a synthetic fixture only, insert an empty padded footer. The
   same bottom-edge check must fail; remove the injected node afterwards.

Automated regression: `web/test/card-workspace-ui.test.ts` also covers pending, rejected,
and superseded update feedback, portrait fallbacks, and unchanged review submission.

## Delivery boundaries

MCP/API parity is not applicable: existing routes and authorization are unchanged.
No new metrics: this is a presentation-only change; verify the deployed frontend asset
and retained API health. Existing UI strings are reused across all five locales.

Verification for this change: actual MyCardsPage mounted with synthetic data in a
visible isolated Chrome, driven through that tab's CDP because the native browser
surface was unavailable and the shared DevTools profile was occupied. Eight geometry
and screenshot cases passed (1280/390 px, light/dark, zh-Hant/en), with positive control
and no uncaught errors. This is local page evidence, not signed-in production acceptance.
