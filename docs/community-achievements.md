# Community achievements and purchased-credit policy

## Accepted requirements

Chat activity, creator impact and paid play are independent progression tracks. A shared badge catalog and award ledger supports earned milestones, current qualifications and staff-issued event badges. Members can feature up to three badges and separately opt into publishing their collection. Discord displays only the highest current tier in each new track; earlier achievements remain in the website collection.

Only consumed credits backed by a verified monetary purchase qualify for the paid-play track. Buying credits does not itself advance the consumption track. Free grants, promotions, compensation, trials and unknown historical sources do not qualify. A purchase package that includes bonus credits must preserve separate purchased and bonus allocations. Permanent versus expiring balance is not proof of purchase. A generic subscription allowance is not sufficient evidence either: its purchased and complimentary components need an explicit allocation policy before qualification.

## Accounting contract

The provider owns payment evidence, balance lots, deduction order and settlement. HearthRoom must not infer paid consumption from balance changes, nominal total deduction, `recordType=sub`, a successful generation alone or browser-reported counters.

Each finalized deduction carries immutable allocation identities and a funding classification: `purchased`, `gift`, `promotion`, `compensation`, `subscription`, or `unknown`. Purchased allocations also need verified purchase evidence. Refunds/reversals refer to the original allocation. A cumulative reversed amount cannot exceed the amount actually consumed from that allocation. Partial refunds reduce only the referenced allocation; never subtract all refunds from paid consumption regardless of their original source.

Example: a 100-credit deduction consists of 70 purchased and 30 gift credits. It contributes 70, not 100. Refunding 20 gift credits leaves 70 qualifying credits. Refunding 15 purchased credits leaves 55. A fully released reservation contributes zero. A pending deduction contributes zero. Unknown funding contributes zero until independently verified; it must never default to purchased.

The receipt identity is `(provider, settlementId)` with monotonic revision and immutable subject/unit attribution. Same-version retries are idempotent; conflicting or stale revisions cannot mutate totals. A corrected or refunded receipt replaces its prior contribution rather than adding another delta. Source purchase evidence stays with the provider; the community stores only the minimal verified classification and receipt reference. The browser never grants its own achievement.

Provider units stay separate. A conversion policy must be explicitly configured and versioned before combining providers into one paid-play tier; neither equal field names nor similar prices establish equivalence. Unknown units remain pending. Store integer atomic units, not floating-point currency. A future top-up achievement is a separate rule and must not silently change this consumption rule.

## Creator statistics

Current `cards.talk_num` is a provider-derived display counter; `getAuthor` sums registered listed cards and synchronization also aggregates provider copies. It is not verified distinct-player evidence. `member_conversations` stores latest continuation pointers, not a complete event ledger. Neither surface can directly grant creator tiers.

Qualifying play requires a server-confirmed completed interaction threshold, excludes self-play and duplicate/replayed events, and maps approved versions/provider copies to one canonical work. Count distinct verified players per author; only merge cross-provider players when the same community membership is proven. Never infer identity from a display name. Unresolved subjects remain provider-scoped or pending, with the counting scope shown explicitly. Historical data is backfilled only where evidence supports the same rule. Do not manufacture historical distinct players from aggregate dialogue counts.

Creator tier names: 初聲說書人、新銳說書人、人氣說書人、名家說書人、傳奇說書人. Thresholds remain versioned configuration and need a distribution check before activation. Paid-play tier thresholds remain inactive until verified allocation feeds and a unit policy exist.

## Badge catalog and lifecycle

Every definition includes stable key, icon from an allowlist, localized title/description, category, acquisition rule version, current-versus-historical semantics and optional activity window. Awards include earned time, provenance, expiry/revocation state and an auditable reason. Staff actions use the existing manager/owner authorization, not ordinary reviewer or Discord reward roles; grants and revocations are idempotent and audited. Event badge text is plain text, with a locale fallback, never HTML.

The wall shows earned badges, locked milestones, next progress and rule explanations. Own exact paid totals are private. Public viewers and Discord see only opted-in badges/tiers, not spending amounts, purchase evidence, player identifiers or private work names. Up to three featured badges must be currently displayable. Unlink stops Discord projection without transferring community awards. Revocation or refund corrects current entitlement and keeps an audit trail; ordinary progression preserves prior earned milestones. Source outages do not turn unknown data into a verified zero.

## Delivery and dependencies

The existing website award table, private/public community routes, signed Bot bridge and Bot-owned role reconciliation are extension points. The collectible badge wall is implemented independently of future creator/paid tiers; deployment is verified separately through CI and production readback. No provider has yet been certified against this settlement contract. The reusable evaluator in `src/community/paid-play.ts` implements `purchased-consumption-v1`; it is not yet connected to a provider feed or role grants. It accepts only integer atomic allocations, applies source-specific cumulative refunds and returns separate qualifying/excluded contributions. Its `purchaseVerified` flag is an internal adapter assertion, not proof verification; no public endpoint accepts it. Unknown funding categories fail closed. Pending/released receipts contribute zero after validation.

The catalog, award lifecycle and website UI are implemented in migration 0030 and the community badge service. Remaining future work is verified creator/paid provider producer/consumer paths, including durable receipt revision handling. Activate one certified provider at a time; other providers visibly remain pending. Never substitute current display counters or grants to make the interface look populated.

Provider deployment remains outside the existing Hearthkeeper-only deployment exception. Prepare and verify any required provider changes before requesting the concrete deployment exception. Website/Bot releases use their established anonymous source and CI/release readback flow.

MCP: private spending, badge curation and Discord consent are member-session surfaces; existing provider MCP credentials do not confer community-manager authority. Any future provider achievement-statistics endpoint must document its own account/tenant/scope contract. Do not add a privileged badge-grant MCP tool by inference.

Observability: badge routes emit the existing `hearthroom_community_requests_total` counter with fixed operations `badge_read`, `badge_write`, `badge_admin` and outcomes `success`, `denied`, `error`. The route middleware records the final response outcome. Verify `/metrics` or `sum by (operation,outcome) (rate(hearthroom_community_requests_total{operation=~"badge_.*"}[5m]))`. No identity or amount enters labels. The pure paid evaluator still has no deployed caller, so it emits no counters. Future provider ingestion will use fixed operation/outcome/provider labels only. Verify real `/metrics` output, not just database rows. Never label or log identities, purchase references, exact amounts, private works, receipt payloads or tokens.

## Acceptance

Paid-allocation tests cover mixed purchased/free deductions, purchase proof missing, bonus/subscription/unknown sources, partial source-specific refunds, released/pending settlement, malformed and duplicate allocations, mismatched units and safe integer bounds. Later integration acceptance must cover authenticated provider evidence, durable idempotency/out-of-order corrections, author/self-play/copy identity, staff denial/audit, public privacy, highest-tier role replacement, and desktop/mobile five-language natural browser journeys. Fixture evidence and live payment/Discord evidence are distinct.

Local evaluator verification: Red/Green completed, including a malformed-state regression; 50 policy cases pass. The full repository suites pass (452 Worker tests and 432 web tests), and Worker TypeScript checking passes. One optional real-card probe suite is skipped because external fixtures were not supplied. The web suite emits local iframe connection warnings; its assertions pass, and this is not live-browser evidence. No UI behavior, provider deployment, production accounting, or Discord entitlement was changed by this foundation.

## Badge collection delivery

Members reach `/me/badges` from the icon entry on their personal page or Discord settings. The page includes the complete catalog, earned/locked/expired/revoked states, conditions, collection dates and activity milestone progress. Existing Discord linkage, first approved work and current server booster badges retain their source of truth. Activity milestones at levels 5/10/20 are recorded by D1 triggers and retained after unlinking. The backfill collection date is the date the achievement was added to this collection, not a fabricated historical crossing date.

`community_badge_definitions` holds localized metadata, category and allowlisted icon; `community_awards` retains its existing primary key and first-work producer, with expiry/revocation fields added. `community_badge_audit` records manager award actions and their immutable retry payloads. Event definitions use the `event_` namespace and are immutable once created; the same definition can be retried. V1 limits the catalog to 200 definitions; future larger catalogs need pagination and event retirement before raising that limit.

`GET /v1/me/community/badges` returns the owner's collection and management eligibility. `PATCH /v1/me/community/badges/featured` validates at most three distinct currently earned keys and atomically saves the ordered selection and optional `public` consent. Empty selection intentionally displays no featured badges. Existing accounts without a selection start with up to three earned badges. Inactive selections are omitted from every display; previously selected current qualifications can reappear when valid again. Public badge visibility never enables public current-level visibility.

`GET /v1/community/members/:handle/badges` returns only active earned badges and selected keys if `public_badges` is enabled, otherwise empty arrays. It never returns locked progress, manager eligibility, audit reasons or internal identities. The public author page shows selected badges beside the name and a full collection below. Public endpoints remain uncached. The private profile always shows the owner's selected badges.

Active manager/owner roles can open the management section on the collection page. Definitions and awards use `/v1/me/community/badges/manage/definitions` and `/awards`; ordinary reviewers and members are denied. The UI supplies the current locale, with catalog text falling back to English, Traditional Chinese, then the available translation. Text renders without HTML. Grants/revocations and the audit record commit in one D1 batch. A request ID retry is a no-op only if actor, member, badge, action, reason and expiry match. A revoke ensures the badge is not active; recording a repeat revoke does not recreate an award. Re-granting is an explicit new audited operation. Management reads show the last 50 award actions and keep reasons manager-only.

Website and Bot projections exclude expired/revoked awards immediately on read. Maintenance marks newly expired awards dirty; normal linked-member reconciliation also runs about every 15 minutes. Discord delivery depends on the Bot being connected and having permissions. Existing Bot configuration maps badge keys to Bot-owned roles; this release does not create a Discord role for every collectible or change existing activity-role mappings. Activity history and current booster qualification remain distinct. Only the website badge curation and management UI are new; no provider backend deployment is involved.

MCP decision: not applicable to these session-owned community settings and manager-only event administration. HearthRoom has no community MCP authorization surface; provider MCP credentials do not carry community consent or manager scope. Existing Discord bridge remains the role consumer. A future community MCP must use the same service logic and introduce an explicit matching authorization contract.

Creator-impact and purchased-consumption rules remain separate extensibility points. New certified producers can add catalog definitions and audited awards without redesigning the wall. No author tiers, paid tiers, fake counts or unverified source classifications are activated in this release.
