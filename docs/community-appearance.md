# Community supporter appearance

## Scope and acceptance

An active link to a current booster of the configured Discord guild unlocks a HearthRoom supporter badge, three optional name effects, a site frame and the currently equipped Discord decoration. All linked members can choose their existing site avatar, Discord global avatar or guild avatar. Existing manual avatar upload remains available. A saved upload switches avatar source back to site while preserving other appearance choices.

Members preview changes, save explicitly, cancel without writes, or restore plain appearance. Public appearance is separately opt-in; the existing public-badges preference controls the supporter badge. The shared avatar/name components apply on own/public profiles, card author rows and comment/reply rows. Public payloads contain neither Discord IDs nor direct Discord CDN URLs. Five locales cover the UI. Reduced-motion users see a static site frame instead of potentially animated decoration assets.

Not included: Nitro subscription detection, purchased decoration catalogs, Discord display-name font/effect replication, boosting XP bonuses or moderation/administration rights. Server boosting is verified independently of Nitro and cosmetic purchases. No AI or new server/listening port is required.

## Source, synchronization and lifecycle

Hearthkeeper fetches each linked guild member and sends `premiumSinceTimestamp`, global/guild avatar hashes and equipped global/guild decoration asset hashes through the existing signed HTTPS bridge. The Worker accepts only the configured guild, current active link version and a strictly newer observation within the ten-minute delivery window. Asset paths are constructed from validated hashes, never arbitrary caller URLs. An atomic receipt gates both entitlement and media mapping updates.

Linked members are rechecked approximately every 15 minutes (subject to queue/API availability), with the existing manual sync action available. Role safety checks remain independent; a role permission failure does not erase a successful membership observation. Only Discord Unknown Member revokes membership; network/permission failures preserve the last confirmed observation. Verified data expires after 24 hours without refresh, disabling active perks and synced media until verification resumes. Confirmed boost loss immediately disables name/frame perks while preserving avatar selection. Unlink removes snapshot/media access immediately; saved cosmetic preferences remain dormant and can resume on a later valid link. No historical supporter award is invented.

Private appearance preferences/snapshots/media mappings live in additive migration 0029. The default is the existing avatar, plain name, no frame and no public appearance. The previous uploaded site image is retained when selecting Discord, so returning to it is reversible. Missing guild avatar falls back to global; missing decoration falls back to the site frame. Failed image loads fall back to the existing avatar. Source images are served via opaque same-origin Worker URLs with bounded PNG streaming, a two-megabyte maximum, no redirects and five-minute private browser caching. Unlink denies new media reads; already downloaded images cannot be recalled.

## API and parity

- `PATCH /v1/me/community/appearance`: member authentication, strict enumerated cosmetic choices, server-side entitlement check. Response returns the refreshed private community view.
- `POST /internal/community/appearance-sync`: existing HMAC timestamp/nonce/guild/link-version protections; Bot-only status source.
- `GET /v1/community/members/:handle`: optional public effective appearance, existing badge/level privacy rules.
- `GET /v1/community/media/:opaqueKey`: current active link and fresh snapshot required; no Discord identity in the URL.

MCP: not applicable. These preferences and Discord link consent belong to HearthRoom member sessions; Provider MCP credentials do not prove the same member or authorize cosmetic/Discord changes. Public appearances use the existing public author HTTP surface.

Observability uses `hearthroom_community_requests_total{operation="member|bridge|oauth|media",outcome="success|denied|error"}` and `hearthkeeper_community_sync_total{outcome="synced|not_member|denied|failed"}`. Member saves, signed observations and media failures use the same request outcome handling; role sync outcomes remain explicit. Verify both registries after deployment. No identity/assets are metric labels or error log payloads.

## Delivery

Run focused Red/Green plus the entire HearthRoom Worker/web suite, typechecks/build and Hearthkeeper `npm run check`. Exercise preview/save/cancel, non-supporter/stale/error/revocation and public privacy on desktop/mobile and English. Deployment order: pushed Worker source and additive migration through CI, then pushed Bot release on the authorized Hearthkeeper host. Read back running source versions, a real observation and metrics. Do not fabricate a production boost to demonstrate entitlement; if no verified test booster is available, report fixture coverage separately from live acceptance. Rollback Bot before website code; retain additive tables and preferences.
