# HearthRoom and Hearthkeeper community integration

The website owns member links, chat XP receipts, achievements and notification preferences. Hearthkeeper remains the authority for support cases and projects the website's desired state into Discord. No AI service or additional public server port is required.

## Implemented journeys

- `/me`: connect Discord with `identify` OAuth, inspect sync state, retry and unlink. Discord identity is separate from permanent conversation-provider connections. An active link displays the `discord_linked` badge in account settings. Public profiles show badges and/or level only with separate opt-ins; neither Discord identity nor exact XP is public. Level zero is displayed when opted in, and unlinking immediately hides the linked badge and level.
- Website footer: configured Discord invite. Bot `/link`, `/level` and `/subscriptions`: private account state, progression and website/profile links. `/xp enabled:false` stops future chat scoring without deleting history.
- Chat rule `chat-v1`: designated public text channels only, one point per rolling 60 seconds, 60 points per UTC event day; `level = floor(sqrt(XP / 10))`. Events more than 24 hours late are rejected. No message content, threads, bots, webhooks, private channels or history imports. Edits are not counted.
- First approved work earns `first_work` once per website member from a completed review decision. Migration `0028` backfills completed, dated approvals using the same ownership view; imported or unreviewed cards do not qualify. The unique member/badge key makes replay safe and preserves existing awards. Discord roles can map to level, this badge or active linking. Each mapping is a distinct, explicitly configured display role.
- Followed authors' public work releases/updates, review decisions and comment replies create durable website notifications. Discord DM is a separate opt-in and contains only a generic website link. Unfollowing suppresses pending author DMs. Staff review reminders are generic and keep blind-review author information private.
- `/card number:<public number>` privately previews a currently approved, non-adult card and its public website link. Adult content remains behind the website's existing visibility controls.
- Card issue link → `/me?reportCard=...` → title/details form → the same Bot CaseStore. The server resolves the public card, canonical work and approved version. Existing own cases can be listed, read, supplemented and submitted for closure/reopening. Staff decisions remain in Discord. Website list/detail preserve PASS, Not adopted and the distinct problem/feedback pause rules; detail shows archive/lock flags. Attachments use the existing private Discord conversation; there is no new website attachment store.
- OAuth return restores the local language/report destination before router history initializes. Case retry IDs survive reload for 24 hours without storing report text in browser storage.

## Website configuration

Apply additive migrations `0026_community.sql`, `0027_community_public_level.sql` and `0028_community_award_backfill.sql` through the normal reviewed deployment workflow. Do not deploy website code before its migration.

| Variable / secret | Purpose |
|---|---|
| `COMMUNITY_ENABLED=true` | Opens new links, new site case jobs and chat event ingestion; absent defaults off |
| `COMMUNITY_SITE_URL` | HTTPS origin of this website, no path/query/credentials |
| `COMMUNITY_GUILD_ID` | The one authorized Discord guild, as a string |
| `COMMUNITY_INVITE_URL` | Official HTTPS discord.gg / discord.com invitation |
| `COMMUNITY_XP_CHANNELS` | Comma-separated public text channel IDs, also configured in the Bot |
| `DISCORD_CLIENT_ID` | Hearthkeeper application ID |
| `DISCORD_CLIENT_SECRET` | Worker secret; never expose to the browser or Git |
| `COMMUNITY_BRIDGE_KEY` | Independent 32 random bytes encoded as 64 hexadecimal characters, shared only with the Bot |

Register exactly `<COMMUNITY_SITE_URL>/v1/community/discord/callback` as the Discord OAuth redirect. The OAuth access token is used for `/users/@me`, then revoked/discarded; refresh tokens are never retained. Only `identify` is requested. Joining the guild remains a separate invite action.

An unset invitation is hidden. No production invitation, role ID, scoring channel, client secret or bridge key is invented by the source change. Enabling and validating the actual deployment remains a distinct operational step.

## Network boundary

The browser uses the website's HTTPS Cloudflare Worker origin; Discord OAuth returns to that same origin. Hearthkeeper opens outbound Discord Gateway/API connections and signed HTTPS requests to the Worker. The website does not call a public Bot IP or inbound Bot endpoint. Bot metrics bind to loopback. This integration needs no extra public hostname or inbound server port.

## API and authorization

Member routes use existing provider bearer validation and `X-Provider`; the authenticated community member is resolved server-side. All private responses use `private, no-store`.

| Route | Method | Contract |
|---|---|---|
| `/v1/community/config` | GET | Enabled flag and validated invite |
| `/v1/community/members/:handle` | GET | Opted-in badge keys and separately opted-in optional `level`; no Discord identity or exact XP |
| `/v1/me/community` | GET | Own link state, XP, badges and preferences |
| `/v1/me/community/link` | POST / DELETE | Begin using browser nonce / immediately revoke link access |
| `/v1/me/community/complete` | POST | One-use receipt plus original browser nonce and same authenticated member |
| `/v1/me/community/preferences` | PATCH | Boolean `publicBadges`, `publicLevel`, `notifications`, `discordDm`, `caseAccess`, `xpEnabled` |
| `/v1/me/community/retry` | POST | Schedule current role projection |
| `/v1/me/community/notifications` | GET | Latest 50 own notifications; opaque notification IDs |
| `/v1/me/community/notifications/read` | POST | Mark own ID read |
| `/v1/me/community/cases` | POST | Durable request with `requestId` and `list/read/create/supplement/request_close/request_reopen` |
| `/v1/me/community/cases/:id` | GET | Own result only while current link version and explicit case consent remain valid |

Bot-only POST operations are under `/internal/community/:operation`: `events`, `pending`, `projection`, `ack`, `xp-preference`, `card`, `case-lease`, `case-check`, `case-result`, `notification`, `review-ack`. They require HMAC over method, exact path/query, timestamp, nonce and SHA-256 body hash; timestamps expire after 60 seconds and nonces cannot be reused. The signed body must contain the configured guild. Bridge authentication does not grant a website reviewer or staff identity.

Case work carries a 15-second lease. The Bot rechecks it and guild membership before calling CaseStore with the proven Discord user and `staff:false`. Owner checks, versions, cooldowns and operation replay still run in CaseStore. Browser input cannot supply a staff actor. Case payload/results are encrypted in D1, expire after 10 minutes and are reauthorized on every read. Unlinking or withdrawing case consent removes cached work immediately. An operation already executing under a valid short lease may finish, but the revoked website link cannot read its result.

## Lifecycle, roles and rollback

Unlink increments the active link version and immediately blocks cross-site identity/case access. Both accounts remain reserved until the Bot reads back role cleanup; old acknowledgements cannot clear a newer revision. Discord-only chat roles may remain. Website achievements and Discord XP keep their original owners and are not copied on rebind.

The Bot only edits individual configured roles, never replaces the member's role array. Roles must have zero base permissions, no granting channel overrides, be below the Bot, and not be managed or one of the staff roles. Existing unrelated/human roles remain intact. Removing a mapped role from configuration while it remains Bot-owned blocks cleanup; remove its assignments through the authorized operational path before retiring the mapping. Configuration/permission drift stops grants. Not-in-guild and failure states are explicit. Membership is periodically rechecked without a privileged members intent; sync state older than a day is shown as pending.

Keep the website bridge and Bot cleanup worker running during rollback. Disable **website** `COMMUNITY_ENABLED` to stop new ingestion/link/case creation, revoke affected links through their authenticated path, and wait for cleanup receipts before stopping the Bot or removing the shared key. Do not drop the additive tables during emergency rollback. Back up both databases before migration.

OAuth attempts/case caches expire in 10 minutes; nonces in 2 minutes; notifications in 30 days. Website scheduled maintenance and Bot polling remove expired caches, while reads deny them immediately. The local Bot XP outbox keeps at most 48 hours of metadata. The central XP ledger is retained to preserve lifetime points and auditability; announce this before enabling scoring. No public leaderboard, spendable currency, XP cash rewards or automated moderation rights are introduced.

Business notification records are unique; Discord delivery uses a local receipt and enforced nonce for retries. Discord does not offer an unlimited exactly-once delivery guarantee across a crash before the local receipt; rare delayed replay can duplicate a generic reminder, never the review decision or achievement.

## MCP and observability decisions

MCP: not applicable to the initial private identity/role/case surfaces. Existing provider MCP credentials prove a provider account, not a direct Discord link or website case consent. No private bridge method is exposed as an upstream MCP tool. Existing public card URLs remain shareable. Public badge/level presentation extends the existing public author HTTP surface, not a new member-authenticated MCP capability. A future member-scoped MCP flow must use this same community service and consent rather than accepting a caller-supplied member ID.

The public-level preference uses existing member-operation metrics; read-only badge/level rendering adds no background job or new metric. The existing `/metrics` endpoint includes counter `hearthroom_community_requests_total{operation="member|bridge|oauth",outcome="success|denied|error"}`. The Bot adds `hearthkeeper_community_sync_total{outcome="synced|not_member|denied|failed"}` to its loopback registry. Verify with `sum by (outcome) (rate(hearthroom_community_requests_total[5m]))` and the corresponding Bot counter. Labels never contain member, Discord, case, message, email, token or text values. Production validation requires actual link/cleanup receipts and these live metrics; local tests do not prove deployment.

## Boundaries

This release implements the account/progression and existing work/review/report integration. The separately scoped P3 activity/curation product, seasonal resets, retroactive XP import, Discord-only website login are not included. The existing website staff moderation console remains independent of Discord support cases. It replaces the requested chat-level/role slice of MEE6, not every MEE6 feature.
