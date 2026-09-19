---
id: WORKSPACE-01
priority: P1
platforms: [desktop, mobile]
page: /mine, /create
preconditions: isolated local app with two synthetic linked accounts and provider fixtures
states: [work-grid, play-choices, missing-copy, synchronized, review-consent, pending, save-destinations, saved]
critical_payloads: [workIdentity, sourceAccount, hostingState, contentRating, communityReviewResult]
mutating: true
---

# One work, hosting choices, one community review

Use synthetic local responses only. Seed a work with a mapped copy on another service,
another work without a copy, and distinct account emails. Community quota is shared.
Provider writes and community registration must terminate in the local fixture, never
in a real provider. This case covers UI orchestration, not immutable hosting contracts.

1. Open My cards.
2. Expand the first work's Play action.
3. Expand Manage sync for the work with a missing copy.
4. Synchronize the selected destination.
5. Submit a work for review.
6. Select a content rating.
7. Confirm submission.
8. Open New card.
9. Fill the required name, private settings and opening message with synthetic text.
10. Save to open the hosting chooser.
11. Toggle one of the two selected services.
12. Save the card to the remaining service.
13. Submit the saved card for community review.
14. Choose a rating and confirm.

Pass criteria:

- One tile per mapped work, with image/fallback, name, summary and community state.
  No provider-management tabs or provider-console authoring links.
- Play choices show the actual source/copy role links, matching provider and account email.
- Sync changes the selected hosting state to Copy saved, without a provider-review toggle.
- Review confirmation has no preselected content rating; submission is disabled until
  the author chooses. Confirmation updates one community review state and quota entry.
- Save choices are called hosting services. Existing source stays selected; one or both
  linked destinations may be selected when creating. This dialog does not claim approval.
- The editor's review action opens community consent directly, never a hosting chooser.
  Successful registration returns to My cards without an unsaved-navigation trap.
- At a 390 × 844 viewport, the grid is one column, text/actions stay inside their cards,
  primary card controls and modal buttons are at least 44 px tall, and page width does
  not overflow the viewport. Restore the viewport override after the check.

## Local evidence, 2026-09-19

Chrome natural-path checks passed for Traditional Chinese desktop/mobile and English
mobile work cards, play account choices, missing-copy synchronization, community rating
confirmation, single-service save, and editor submission returning to My cards. The save
chooser initially showed two selected services and correctly changed to one. The 36 px
modal buttons were enlarged and remeasured at 44 px; card actions measured 44 px and play
choices about 70 px. English action text and the page had no horizontal overflow.

Two-service save/partial-failure retry and locale-key parity have automated coverage;
this run did not perform a fresh browser sweep of Japanese, Korean, Simplified Chinese,
light mode, full embedded gameplay, or live provider writes. The synthetic editor's player
fixture lacks role detail and emits a player error; no real embedded-play claim is made.
An incidental Me-page check could not render because the synthetic profile omitted its
join timestamp. Me is unchanged by this patch; its existing case remains separate.

Worker: 341 tests passed. Web: 356 tests passed in 59 files; one pre-existing real-card
probe suite skipped. Web typecheck and build passed. Existing embedded-player loopback
warnings and the large bundle warning remain. Review/hosting separation tests first
failed on the former destination chooser and provider-review checkbox, then passed with
the new behavior. Older checkbox expectations were intentionally updated to the accepted
hosting-only semantics.

## Release dependency

The browser backend is synthetic. Existing private HarperHarbor drafts still cannot
complete HearthRoom registration/public play through the legacy API. Authoritative
version issuance, immutable host receipts and version-bound play are specified in
`docs/contracts/hosting-versions-v1.md`, not implemented by this UI patch. This evidence
must not be used as a production or end-to-end hosting-version release receipt.

MCP: not applicable to these private web presentation changes; no new provider capability.
Observability: existing registration/synchronization outcomes remain authoritative; no
new client logs, account identifiers or private content are emitted.


## 2026-09-20 final integration checks

- Chrome DevTools fallback used after runtime-native Chrome reported no surfaces.
- Actual visible Chrome, isolated synthetic fixture context: card grid, account playtest
  choices, 390px hosting dialog, toggling two hosts to one and saving into the editor.
  Both publication controls use HearthRoom review and an explicit content rating.
- 390px viewport has no horizontal overflow; workspace buttons and sync controls target
  44px. New review/update states have all five locales (LLM-approximation).
- Provider tests use real PostgreSQL and OAuth; generation uses a synthetic upstream only.
  Sealed settings reach the model, never the public projection; draft changes do not
  alter sealed model input; revoked/unavailable authority denies generation.
- Worker HTTP/D1 tests cover a private Harbor draft, one immutable review, approved host
  selection, failed update retaining old approval, withdrawal, concurrent retries and
  rollback without consuming a publication slot. Browser fixtures are UI evidence only.
- Full frontend suite retains the existing opt-in real-card probe skip; no production
  author card was created, reviewed, changed or deleted as a test.

## Compact card layout, 2026-09-20

At 1280 px, the workspace has four 276 px columns. Default synthetic cards measure
about 426 px high (previously 606 px); covers are 138 px high, capped at 160 px on
wider tiles. At 390 px, cards remain one column and about 448 px high. Keep three
common actions in one row with at least 44 px touch height; a fourth recovery action
may occupy a separate row. Expanded play choices and sync management grow naturally.

Recheck all five locale layouts for horizontal overflow, long action labels and the
44 px action minimum. Inspect image and fallback covers, two-line descriptions,
review badges, light/dark appearances, and open both Play and Manage sync. Use the
synthetic fixture for account interactions; production asset readback proves delivery,
not authenticated account or hosting mutation coverage. The change is CSS only;
existing API/MCP and observability decisions remain unchanged.

The third action receives extra width so English "Submit for review" uses two lines,
not three. English cards remain equal height with 44 px actions at 1280, 960 and
640 px viewports. Five mobile locales have no horizontal overflow; light and dark
card appearances were visually inspected using synthetic content.
