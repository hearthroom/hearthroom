# Numeric card identity and unlisted sharing

Status: implemented and verified locally on 2026-09-22. Owner authorized production
migration and deployment; cutover preparation on 2026-09-23. Live results are recorded
separately after execution.

## Contract

`cards.id` is the existing permanent public card number, stored as an INTEGER
primary key. HTTP card projections retain their string `id` type, for example
`"100001"`, and expose the same value as numeric `num`. Boards, favorites,
comments, review submissions and hosted versions reference that number. URLs,
workspace tiles, editor routes, report links and play-page return links use it.
The board cache namespace changes to prevent cached UUID responses surviving
the migration.

Numbers are allocated on authenticated draft save, owned inventory read, or
successful public preview resolution. Existing works are backfilled during the
migration; older private assets known only to a provider are numbered on first
inventory read. Concurrent allocation returns the same permanent number.
Publication and withdrawal do not change it or reclaim it.

An unlisted card remains absent from boards and recommendations. A visitor with
its number may read the host-authorized public presentation and choose an
available play platform. Possession of a number never grants editing or private
configuration access. Provider availability, ownership, moderation and existing
adult-content checks remain authoritative. Number allocation does not submit a
card for review or consume community publication quota.

Provider `roleId` / `sourceRoleId` remain necessary external locators. Distribution
work IDs, version IDs, member IDs and conversation IDs are separate identities;
this migration removes the former community card UUID rather than changing those
protocols. Resolvable provider/work aliases canonicalize to a numeric browser URL.
Former community UUID URLs stop resolving: no durable UUID alias table is kept,
as requested. Existing numbers remain valid.

## Migration and cutover

Migration `0036_numeric_card_identity.sql` recreates affected tables, indexes,
triggers, the ownership view and FTS. It maps old references inside one migration
transaction and then drops its temporary mapping. Favorites are copied before
dropping their referenced table: deferred foreign keys do not suppress cascade
actions ([D1 foreign-key behavior](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)).
Unmappable historical comments or favorites abort the migration instead of being
deleted. Notification card paths are rewritten. Moderation cache state advances.

This is a coordinated cutover, not a rolling schema-compatible change. The
previous main-branch CI applied migrations before deploying the Worker; the old
Worker cannot insert UUIDs into the new INTEGER primary key. The cutover workflow
now detects the old TEXT primary key, deploys the new Worker first, drains requests
for 120 seconds and records a recovery bookmark before applying migrations. While
the old schema remains, the new Worker returns 503 with Retry-After and skips cron.
It resumes only after the atomic migration commits. Successful schema detection is
cached per database binding per isolate, so warm board requests add no query.
The release operator must:

1. Reconcile the migration number against current `origin/main`, commit intended
   paths, rebase, run the full trusted set, push and obtain CI success for that
   exact source. Build the pinned Stage and web assets before the write pause.
2. Capture a D1 recovery bookmark/export and durable aggregate counts. Check for
   unmappable comment/favorite references using the migration's mapping query.
   A failure requires investigation; never delete the offending rows to proceed.
3. Confirm CI includes the schema guard deployment before migration. The guard
   pauses Worker HTTP handling and scheduled sync during the drain/migration window.
4. Let source CI apply the migration and deploy the matching Worker; do not
   manually publish generated assets. Keep writes paused if deployment fails.
5. Verify numeric column types, aggregate counts and `PRAGMA foreign_key_check`;
   check a published card, an owner-approved unlisted card and board JSON through
   the deployed application. Confirm source ownership/editing, number copy,
   private play selection, exclusion from discovery, and cache replacement.
6. Resume writes and sync only after readback passes. If rollback is necessary,
   restore the matching pre-migration database and Worker together before opening
   traffic. Rolling back only the Worker is unsafe.

The preparation readback confirmed a D1 recovery bookmark, TEXT primary key and no
foreign-key violations. Live migration and application acceptance still require
the release execution steps above.

## API / MCP and observability decisions

The owner-save helper is documented in `docs/developers.md`; it uses the same
provider ownership checks as authoring. MCP: not applicable to this community
identity projection. Hearthroom has no community MCP transport, and the existing
provider authoring/Moonloom protocol continues to use its provider role locator.
No new privileged authoring action or provider capability is introduced.

No new Prometheus metric is added: an idempotent identity lookup is diagnosed by
existing HTTP outcomes and durable `card_numbers` / relationship readback. The
Worker does not expose a Prometheus endpoint. Card numbers, UUIDs and private
content are not added to logs or labels. Release verification uses aggregate SQL,
foreign-key integrity, numeric response types and existing request/cache timing.

## Verification

- Red: old primary key returned a UUID; private preview omitted the number;
  the new owner-save endpoint returned 404; workspace links chose a work ID;
  header number search opened text results. Tests/real browser reproduced these
  before their respective fixes.
- Green: full `npm test`: 2 migration tests, 594 Worker tests and 507 web tests.
  One web file (`real-cards.probe.test.ts`) is intentionally opt-in and skipped;
  no production fixture credentials were used.
- `npm run typecheck`, the pinned Stage build and `npm run build:web` passed.
  Local Node 26 used `NODE_OPTIONS=--no-experimental-webstorage`; CI remains Node
  22 and was not run remotely. Stage tests are not claimed: its source is unchanged.
- The first full Worker run exposed 79 old UUID fixture assumptions and one
  numeric-to-string API serialization regression. Fixtures and projections were
  corrected; the complete set then passed. Frontend mock omissions and a Vue
  template quoting regression were corrected before the complete passing run.
  A final review-detail contract assertion caught another integer response where
  the client expects a string; it now explicitly serializes the numeric identity.
  Its first assertion also assumed the source role rather than the intended
  frozen review role; that unrelated expectation was removed.
- Web test stderr still includes mocked/local host connection refusals; assertions
  passed. Builds report existing Sass/CJS deprecations, unresolved font references,
  mixed static/dynamic locale imports and large chunks. No warnings were hidden.
- Native Chrome exercised synthetic public/unlisted cards, board-to-card
  navigation, actual copy/paste, numeric search, platform selection and missing
  number 404. Desktop and 390×844 screens were inspected in Traditional Chinese
  and English. Five-language key coverage is 100% in the web suite.
- Shared visual audit v3 used 24px desktop / 44px mobile thresholds. No raw i18n
  keys, overlaps, clipped controls/text, off-center icons or known contrast
  failures. Two gradient backgrounds have unknown contrast. Existing small
  links/controls were reported (7 desktop / 17 mobile); horizontal text-box skew
  was reported (3 / 4), including the card-number row's label/code/copy layout.
  Its vertical skew was -0.5px with no overflow. The changed number button is
  163×44px on mobile, vertically centered. The old 31.195px height triggered the
  maintained hit-target positive control. No claim of zero visual observations.
- Browser console error collection was empty. Browser verification used a local
  synthetic HTTP fixture, not the production backend; real OAuth, author saving
  and billed conversation execution were not performed in the browser. Owner-save
  and private access rules are covered by Worker/editor tests.

The cross-repository reproducible case is `HEARTH-CARD-ID-01-numeric-private-card`.

Cutover additions: the real legacy-schema HTTP test failed with 200 instead of 503
before the guard, then passed with HTTP blocked, cron skipped and automatic resume
after schema replacement. The deployment detector rejects missing/unknown/error
schema results. The first full suite exposed a cold-binding query in the warm-board
test; it now separately asserts the single schema query and retains the original
two-query warm-request budget. Release testing includes these additional cases.
