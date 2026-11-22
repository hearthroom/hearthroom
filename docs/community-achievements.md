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

## Milestone catalog (migration 0040)

The catalog now carries generic milestone definitions next to the original six badges. Each milestone row names a `metric` and a `threshold`; the badge service owns the counter queries, so adding a tier is a catalog row, not code. Categories render as sections in this order: connection, community activity, support, creation, play, conversation, membership, events. Members may feature up to five earned badges.

| Metric | Counted from | Tiers |
|---|---|---|
| `works_listed` | listed cards the member owns (same ownership rule as the author page, copies excluded, adult cards included; private and removed cards do not count) | 1 (`first_work`, also granted by the review trigger) / 3 / 10 / 30 |
| `works_featured` | owned listed cards picked as HearthRoom Featured | 1 |
| `followers` | members following the author | 10 / 100 |
| `favorites_received` | saves on the author's listed cards | 10 / 100 |
| `cards_played` | distinct characters the member has continued a conversation with | 1 / 10 / 50 |
| `saves` | characters with at least one archived conversation | 1 |
| `favorites` | cards the member saved | 10 / 50 |
| `follows` | creators the member follows | 5 |
| `comments` | the member's undeleted comments | 1 / 10 / 100 |
| `likes_received` | likes on those comments | 10 / 100 |
| `profile` | profile edited at least once | — |
| `founder` | member joined before 2026-10-01 UTC | — |
| `tenure_days` | days since joining | 365 |
| `xp` | linked Discord chat XP (existing level badges, now expressed as thresholds) | 250 / 1000 / 4000 |

Milestones are one-way: the award persists even when the counter later drops, and `changeBadgeAward` still refuses to grant or revoke anything outside the `event_` namespace. Awards land on two paths that read the same tables: the owner's own collection read evaluates every metric in one query and records newly crossed tiers, and the hourly maintenance job runs one set-based `INSERT OR IGNORE … SELECT` per metric so members who never open the page still receive their badges within the hour. Public collection reads never evaluate counters; they show recorded awards only, with no progress. This sweep is also the backfill for existing members, so the migration inserts no awards.

Provider display counters remain outside the catalog. `cards.talk_num` is not a verified player count, so no milestone reads it; the 說書人 creator tiers described above stay reserved until a verified feed exists. Reviewer activity is intentionally not a badge.

Discord: the projection already carries every active award key. Only a few top badges deserve a role; the recommended mapping for Hearthkeeper's `COMMUNITY_ROLES` is `creator_featured`, `creator_works_30`, `creator_followers_100`, `creator_favorited_100` and `member_anniversary`, each as a `{ "id": "<role id>", "badge": "<key>" }` rule. Creating the roles and setting that configuration is a Bot deployment change, not a website release.

Verification: Worker suite (real D1 migrations) covers catalog completeness in five locales, owner-read awarding with progress, one-way persistence, public reads without evaluation, the sweep awarding without a visit, creator ownership/copy/hidden-card rules, social/profile/tenure counters and the five-badge feature limit. Web suite covers unit-aware progress labels, the six-badge guard and category headings. Observability is unchanged: badge routes still emit `hearthroom_community_requests_total{operation="badge_read"|"badge_write"|"badge_admin"}`; the sweep runs inside the existing maintenance job and writes only `community_awards` rows with `source='metric-v1'`, which is the durable readback (`SELECT COUNT(*) FROM community_awards WHERE source='metric-v1'`).

## Leaderboard honors and pre-launch backfill (migrations 0102–0105, 0128)

Cohort leaderboard honors (`rank_<clean|all>_<day|week|month>_<1|3|10>`, 18 definitions) compare approved non-test Harbor works grouped by immutable first publication (`rank_publications.published_at`) in `Asia/Taipei` day, Monday-week and calendar-month cohorts over each work's completed `24h`, `7d` and `30d` Harbor popularity window (`/open/v1/role/heat/windows` with `complete === true`). SFW (`clean`) excludes `R`-rated works; overall (`all`) includes all eligible public works. Cohorts with fewer than 10 positive-heat works award `#1` (`band = 1`) only; cohorts with at least 10 positive-heat works award `#1` (`band = 1`), `#2–3` (`band = 3`) and `#4–10` (`band = 10`).

Historical eligibility follows verified Harbor window-heat completeness rather than guessing missing eras:

- `day` and `week` cohorts start at `2026-09-24T00:00:00+08:00` (`RANK_START`), when native Harbor publication and complete `role_heat_event` windows begin (`2026-09-18..09-23` had zero first-published works, so `week` `'2026-09-21'` is complete; `2026-09-17` and earlier LunaTalk-era works lack pre-cutover Harbor window heat and are excluded).
- `month` cohorts start at `2026-10-01T00:00:00+08:00` (`RANK_MONTH_START`). September `2026-09-01` mixes incomplete LunaTalk-era works and is not settled; October `2026-10-01` includes `10/01–10/16` native Harbor works when maturing on `2026-12-01`.
- Cross-boundary `week` `'2026-10-12'` (originally settled with `>= 2026-10-17` works only) is supplemented idempotently once via `rank_settlement_supplements` (`supplement_key = 'pre-2026-10-17-v1'`), granting missing pre-`10/17` winners (`rank_awards` + `community_awards` with `source='rank-v1'`) without revoking or altering previously issued honors.
- Pre-`2026-10-17` (`RANK_PAYOUT_START`) `day` and `week` honors record `payout_hold = 1` on `rank_awards`: card and author badges appear immediately while `rankPaymentMaintenance` skips held rows (`rank_awards_payable` partial index). Releasing those held leaderboard credits later uses the pre-reserved idempotent `releaseHeldRankPayouts` batch (`rank_payout_releases` receipt, gated by `RANK_PRE_LAUNCH_PAYOUTS_ENABLED=true`) rather than manual table edits.

MCP decision: not applicable — cohort settlement and historical honor backfill are internal scheduled Worker jobs reading existing anonymous/confidential Provider endpoints; public `/v1/cards/{id}/honors` and community badge endpoints already expose settled honors. Observability reuses `hearthroom_rank_settlements_total{operation="day"|"week"|"month"|"payout"|"run",outcome="success"|"pending"|"error"}` with zero high-cardinality labels.

## Achievements V2: points, levels, boards, rewards and one-of-a-kind badges (migrations 0136–0140)

**Points and levels.** Rarity lives in `shared/badge-rarity.ts`, shared by the Worker and the web: common, rare, epic, legendary and unique (one of a kind). Each badge carries fixed achievement points by rarity (5 / 15 / 40 / 100 / 300). Board honors count every repeat. Lv.L needs `25 × L(L−1)/2` points (`shared/achievements.ts`). Collections return `ap`, `level` and the member's place on the all-time author board. Earned badges show the site-wide holder share (30-minute snapshot) and the order the member earned it in (earlier active awards plus one; a bulk backfill shares one place). Your own `/authors/<you>/badges` opens in owner mode; `/me/badges` moves there.

**Boards.** `GET /v1/rankings/achievements?board=author|all&period=all|YYYY-MM` (30-minute snapshot). The author board counts creation badges and board honors only, which are already public on author pages and card covers, for every author. The overall board counts everything except spending and invite badges and lists only members who show their badges and have not chosen leaderboard anonymity. Spending and invites never enter any board.

**Annual crown.** `GET /v1/rankings/annual?year=&zone=` (`src/annual-honors.ts`). Placements earned by cards first published in a Taipei year add up per author: day 3/2/1, week 10/6/3, month 25/15/8, SFW and Overall separately. Ties: more #1s, then more top-3s, then whoever reached the final score first. From February 1 of the next year, once every cohort of that year is settled, the top ten are frozen once in `annual_settlements`/`annual_awards`: #1 gets `annual_<zone>_<year>_1` and 200,000 credits from the leaderboard pool (key `annual-<zone>-<year>`), #2–10 get `annual_<zone>_<year>_10`. Each new year needs its two badge definitions added as catalog rows.

**Badge credits.** Members claim each earned badge once (`POST /v1/me/community/badges/:key/claim`): common 100, rare 500, epic 2,000, legendary 6,000; one-of-a-kind badges set their own amount. Board honors (already paid), spending (pricing charter bonus cap), event and contest badges, and veteran badges pay nothing. The server decides the amount; the payout uses the activity campaign pool through the card-reward service client with the stable key `badge-<claim id>`, and the minute cron retries pending claims. A badge revoked before payment voids its claim. Amounts above the pool's per-payout cap are refused by the provider and recorded as `rejected`; raise the cap before such a badge can be reached.

**One-of-a-kind badges** (`sole_<name>`, pioneer version `sole_<name>_pioneer` for places 2–10; `src/community/first-badges.ts`). The winner is decided by the time the threshold was crossed, not the time it was read. Harbor statistics badges wait out a confirmation period (paid friends 7 days, spending 30 days) and must still qualify; badges computed from the site's own records wait one day if the count can be withdrawn and not at all for settled honors. A partial unique index keeps each crown with one holder, and a revoked crown stays empty. Others see "taken", with the holder's handle only when the holder shows their badges. The `first_` prefix is not used because `first_work` already exists.

| Key | Crossing |
|---|---|
| `sole_lighthouse` | 100 invitees whose first top-up settled as granted (Harbor `paidInvites100At`) |
| `sole_starlight` | US$1,000 net top-up and 6,000,000 credits used (Harbor `starlightAt`); no credits until the owner decides |
| `sole_treasured` | a listed card reaches 1,000 saves (to its author) |
| `sole_beloved` | an author reaches 500 followers |
| `sole_founder` | 30 listed cards, 5 of which made a top 10 |
| `sole_triple_crown` | weekly #1 three weeks in a row |
| `sole_double_crown` | SFW and Overall monthly #1 in the same month |
| `sole_grand_slam` | all 18 board honors |
| `sole_eloquent` | a comment reaches 100 likes |
| `sole_wanderer` | conversations with 500 different characters; credits for `player_explorer_50/100/300`, `sole_wanderer` and `sole_wanderer_pioneer` are controlled by `CONVERSATION_BADGE_REWARD_FREEZE` (`"all"` default fail-closed freeze, or ISO/ms cutoff with `CONVERSATION_BADGE_FREEZE_EXCLUDED` secret) pending Harbor paid-turn counting |

New milestones: `invite_paid_10` (Harbor `paidInvites`), longer player ladders (characters 100/300, follows 20/50, saves 100), `player_scout_1/5/20` (saving a card before its first placement, own cards excluded) and `player_rater_10/50`.

**Observability.** `hearthroom_rank_settlements_total{operation="year"}`, `hearthroom_badge_rewards_total{operation="claim"|"payout",outcome}` and `hearthroom_badge_stats_total{operation="first",outcome}`; no identities or amounts in labels. Verify with `sum by (operation,outcome) (increase(hearthroom_badge_rewards_total[1h]))`.

**MCP.** Not applicable: claims and display settings are member-session actions, and the boards are public website reads. HearthRoom has no community MCP authorization surface; provider MCP credentials carry no community consent or manager scope.
