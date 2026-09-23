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

Migration `0037_numeric_card_identity.sql` recreates affected tables, indexes,
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

The first production attempt rolled back atomically at the temporary mapping's
unique constraint. Hosted review submissions can use a frozen role as their
`source_role_id`, while sharing the original card's `card_id`. The mapping now
prefers the live card, then the hosting version's original source, and only uses
the review source for legacy records without either authority. Frozen snapshots
do not receive additional public numbers. The migration fixture reproduces this
conflict and verifies that all review references retain the original number.
The maintenance Worker stayed closed during correction; no migration record or
temporary mapping survived the failed transaction.

## Numeric play URLs (2026-09-23 follow-up)

The first cutover missed `/play/`: its links still contained the provider role ID.
The public play route now takes the same numeric identity as `/cards/`. It resolves
that number through the existing card/platform APIs, selects the requested provider,
and passes only that provider's role ID to Stage. Legacy source/hosted-role links
are replaced in browser history with the numeric URL, preserving language, provider,
other query parameters and fragment. Missing or non-playable providers fail closed;
an in-document provider change reloads before reusing Stage's installed host.

Card platform buttons, author workspaces, editor test frames, review links, library
links and PWA entry points emit numeric identities when allocated. Compatibility
fallbacks for old incomplete workspace/library records resolve at the play entrance.
Author `mode=source` uses the ownership-checked copies API to retain draft playtests.
Review links use an authenticated submission lookup and require its card ID to match,
retaining the review snapshot rather than substituting an approved version.
Library `resume` links use `GET /v1/me/conversations/:conversationId?provider=...`:
`requireMember` and the exact provider scope the row; the resolved card number must
match before Stage receives the previously played revision. This avoids silently
starting a new conversation after a card update. Credentials remain issuer-scoped.
No schema migration or role/conversation rewrite is needed for this follow-up.

PWA manifests use numeric IDs/scopes/start URLs and explicitly select the source
provider. Existing UUID shortcuts still enter the legacy resolver; their old
installed scope may open the numeric destination in a browser until reinstalled.
No installation or device state was changed during verification.

MCP/Moonloom: not applicable to the provider MCP contract; this is Hearthroom's
browser routing and private community conversation index. The read-only resume
endpoint uses the same member authorization as the existing library and returns no
chat text or credentials. Provider role IDs remain internal integration identifiers.
Observability: the existing `hearthroom_library_requests_total` counter includes
resume reads as `operation="conversations_get"` with `success|denied|error`; verify
`sum by (outcome) (hearthroom_library_requests_total{operation="conversations_get"})`.
No card, conversation or account identifiers are metric labels.

Regression evidence: maintained tests reproduced UUID URL emission, raw numeric IDs
reaching Stage, wrong-provider launch, missing canonicalization, review snapshot
substitution, and resuming the latest revision instead of the recorded revision.
They cover ownership denial, provider mismatch, delayed navigation and PWA scopes.
Native Chrome exercised card -> Harbor selection -> numeric play URL, and an English
legacy private-card link -> numeric URL while preserving query/fragment. The local
fixture replaces login/player rendering only; the real route, resolver and platform
button execute unchanged. It is not evidence of billed AI generation.

The unrelated root harness run was not green: local checkout files for UI lint,
Moonloom workflow and shared author assets are missing/drifted; socket and process
fixtures hit sandbox restrictions, and case-index checks report missing rows. The
Hearthroom trusted suite is evaluated independently. No unrelated repository or
harness implementation was changed to hide those failures.

## Guest opening decoration follow-up

The card page previously requested display rules only from its source provider;
that provider's anonymous refusal silently reduced the opening to plain text even
when an approved public replica supplied those rules. Numeric IDs still resolve to
provider role IDs before either request; the regex engine itself was not removed.

The preview now tries the source's public player asset, then its own scoped login
if available, then publicly discoverable replicas. Replica assets are read without
credentials and only when their opening matches the displayed opening. Discovery
keeps existing moderation and visibility checks; author-only settings are never
read. An accessible empty rule list is authoritative. Denied/missing assets still
fall back to text. Full-page mount triggers remain excluded from card previews.

MCP/Moonloom: not applicable, because this repairs an existing browser-only display
path using unchanged public APIs. Observability: no new server operation or metric;
HTTP refusal and browser rendering remain the relevant diagnostics, without logging
card content or identifiers. No user-facing copy or locale changes.

Regression: a mounted visitor CardPage initially failed to render the expected
rule-generated frame, then passed along with denied discovery, denied replica,
mismatched opening, and intentionally empty source rules. Native Chrome's synthetic
visitor journey rendered the expected 3px author-defined border inside the sandbox
iframe while showing the login link and both providers as unconnected.
