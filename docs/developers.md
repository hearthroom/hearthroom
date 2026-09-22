# Developer documentation

Hearthroom is a community-maintained, open-source character-card board. The site itself stores **no cards, runs no models and keeps no passwords**: accounts, card content and conversations live with a *provider*. The site owns what belongs to the community: who listed which card, how far it got in review and who stamped it, and the comments under each card. The only card content it ever holds is the review copy an author submits, and that copy is deleted when the review ends. LunaTalk and HarperHarbor implement the shared Open API (`/open/v1`) with different capability sets; see the provider matrix below.

This page has two parts:

1. **The provider contract** — what a provider must implement, grouped by capability level, so that this site (or any fork of it) can run against it.
2. **The API reference** — every endpoint the site and the embedded conversation stage call, with parameters, request and response schemas, and error codes. The reference is generated from `docs/openapi.json` in the repository; the machine-readable spec is the source of truth and can be fed to any OpenAPI 3.1 tool.

The documentation lives next to the code. A test in the repository (`web/test/protocol-doc.test.ts`) fails whenever the site's code calls an upstream path that is missing from the spec, so the two cannot drift apart silently.

## Conventions

| Topic | Rule |
|---|---|
| Base URL | Every resource lives under `<API_BASE>/open/v1/...`. `<API_BASE>` is configured per deployment (see *Plugging in a provider*). |
| Authentication | `Authorization: Bearer <token>`. The token is a user access token obtained through OAuth. The site holds no key of its own at any provider. |
| Language | Requests may send a `language` header (`zh-Hant`, `zh-Hans`, `en`, `ja`, `ko`). The provider uses it for human-readable text in responses. |
| Guest-readable | A small set of read endpoints accept requests without a token; they are marked **no auth** in the reference. A token, when present, is still honoured. |
| Error envelope | The canonical shape for non-2xx responses is `{ "error": "<snake_case_code>", "message": "<human sentence>", "retryable": <bool> }`; the identity middleware and the newer endpoints use it. Several older endpoints return narrower legacy shapes (for example `{ "error": "<code>" }` only, or `{ "errorCode", "messageKey" }`). The reference documents the exact shape per endpoint and the *Notes* section lists every shape and code found. HTTP status follows the semantics (400 / 401 / 403 / 404 / 409 / 429 / 5xx). |
| Error codes | The site translates these for end users: `invalid_arguments`, `role_in_review`, `visibility_requires_review`, `public_role_requires_clone`, `permission_denied`, `not_found`, `validate_reject` (when a `detail` with `reason`/`index`/`name`/`max`/`actual` is attached, the sentence names the rule and the sizes), and the role field limits `role_desc_too_long`, `role_detail_too_long`, `role_welcome_too_long`, `custom_instructions_too_long`, `role_output_contract_too_long` (400 with `detail` `{field, max, actual, unit: chars}`), and the direct-upload handshake codes `upload_invalid`, `upload_expired`, `upload_missing`, `upload_size_mismatch` (see `/open/v1/image/uploadIntent` and `/open/v1/image/uploadComplete`), and the media-library quota codes `quota_image_exceeded`, `quota_bytes_exceeded`. Others pass through; a `message` that is not a code is shown verbatim (for example a moderation reason). |
| Timestamps | Each field says whether it is Unix milliseconds, seconds or an RFC 3339 string; the server is not uniform. |
| Identifiers | Users are identified by `accountNumId`, a public numeric id. Internal UUIDs never appear on the wire. |
| Macros | `{{user}}` and `{{char}}` inside card text are substituted by the provider before the text reaches the model, case-insensitively. `{{char}}` becomes the character name; `{{user}}` follows the persona precedence below. |
| User-Agent | The site's server-side and scheduled requests carry a fixed `User-Agent`. Providers should not treat it as browser traffic to be challenged. |

### A second code table

A provider does not have to reuse the code names above. The second provider the site runs
against numbers the same situations differently — it says `forbidden` where the table above
says `permission_denied`, and `invalid_request` where that one says `invalid_arguments` —
so the site translates both tables. If your codes mean the same thing as an existing one,
tell us and we map them to the same sentence; a code nobody has mapped reaches the user as
the bare code, which helps no one.

Mapped onto sentences the site already had: `invalid_request`, `forbidden`, `not_the_author`,
`role_not_found`, `asset_not_found`, `account_not_found`, `grantee_not_found`,
`role_not_passed_review`, `temporarily_unavailable`, `file_too_large`, `upload_not_found`,
`size_mismatch`. Given their own: `insufficient_scope` (the token lacks a scope the site
needs — the user is told to sign in again and approve it), `unsupported_media_type`,
`invalid_cursor`, `quota_exceeded`, `asset_not_passed_review`.

## Capability levels

A provider does not have to implement everything at once. Each level unlocks a set of site features.

| Level | Purpose | What it unlocks |
|---|---|---|
| **0 — Identity** | OAuth 2.1 (authorization code + PKCE, dynamic client registration, resource indicators) and `GET /open/v1/me`. | Sign-in. Without it the site is a read-only board. |
| **1 — Read & list** | Public card detail and preview page, the author's own card list, wallet. | Authors can list their cards; the board, search and author pages work. |
| **2 — Review** | The author's token can read the author's own full settings: card, openings, bound worldbooks, author asset. | Community review. Nothing review-specific is asked of the provider; a deployment that turns review off falls back to "listing is publishing". |
| **3 — Authoring** | Create / patch / publish cards, welcome messages, author assets, worldbooks, the media library, canonical tags. | Authors can create and edit cards on the site instead of the provider's own UI. |
| **4 — Play** | The conversation endpoints used by the embedded stage. | Playing cards inside the site. |

### Level 0 — Identity

The authorization server must support:

- `POST /oauth/register` — dynamic client registration (RFC 7591). The site is a public client: `token_endpoint_auth_method: "none"`, `grant_types: ["authorization_code", "refresh_token"]`, and its callback page as the redirect URI.
- `GET /oauth/authorize` — authorization code flow with PKCE `S256` and `state`. The site also sends `resource` (RFC 8707) set to `<API_BASE>/open/v1`.
- `POST /oauth/token` — `authorization_code` (with `code_verifier`) and `refresh_token` grants. Refresh tokens may be single-use; the site always stores the newest one and never runs two refreshes concurrently.
- `POST /oauth/revoke` — revokes a token family when authorization is stopped or superseded. Managed-mode sign-out ends only the current site session; the legacy browser-only mode also revokes its local grants.
- `GET /.well-known/oauth-protected-resource/open/v1` — optional protected-resource metadata (RFC 9728).

A user token carries exactly the scopes the user granted. Optional managed authorization (`AUTH_ENABLED=true`) encrypts access and refresh credentials in D1, with the keyring held separately as a Worker secret. The browser keeps only access tokens in memory and an HttpOnly site session cookie. Tokens are never written to logs or public caches. See [authorization custody and operations](account-authorization.md) for privacy boundaries, configuration and rollback. Without managed mode, self-hosted deployments retain the legacy browser credential flow.

`GET /open/v1/me` returns the caller's public identity. The site has its own member id (an 8-letter handle shown on author pages); the provider's `accountNumId` is only the mapping key inside the site's identity table, so one member can later be linked to more than one provider.

Sign-in starts on the site's own `/login` page, where the user picks a provider; only then is the browser sent to that provider's `/oauth/authorize`.

### Level 1 — Read & list

Public read: `GET /open/v1/role/detail`, `GET /open/v1/role/preview-page`. Authenticated: `GET /open/v1/role/mine` (with a `creationMethod` filter so the site can show only cards created through it), `GET /open/v1/role/author-asset/serve`, `GET /open/v1/me/wallet`, `GET /open/v1/me/score/records`.

Fields the site reads from `role/detail` are listed in the reference; extra fields are ignored. Language codes map to board zones: `zh*` → Chinese, `en`/`ja`/`ko` → their own zone, anything else → "all zones".

### Level 2 — Review

Review is the community's own service; the provider is not asked for a sharing API, a service account or a content hash.

When an author submits a card, the site uses the author's token, inside that one request, to read the author's own full settings: `GET /open/v1/role/detail` (the owner view, which includes the private definition), `GET /open/v1/worldbook/bindings`, `GET /open/v1/worldbook/detail`, `GET /open/v1/worldbook/entry/list` and `GET /open/v1/role/author-asset`. It stores the result as the review copy of that submission. Reviewers read the copy, never the provider. The copy is deleted when the submission is decided (approved or rejected) or the author withdraws the card. The review copy never contains the token; managed OAuth credentials are stored separately as described above.

An approval is bound to a fingerprint of the card's **public** fields (names, summaries, cover, background, tags, opening). The hourly sync already reads those fields anonymously; when the fingerprint changes the card leaves the board and a re-review opens, showing the reviewer the current public content. Changes to private settings are invisible to the site and to the board; an author who wants reviewers to see a new version resubmits.

A deployment sets `REVIEW_ENABLED = "true"` to require review. Any other value means "listing is publishing".

### Level 3 — Authoring

Every authoring call is made **directly from the author's browser with the author's token**; the site's server is not involved and has no privileges of its own. The reference lists the card, worldbook, author-asset and media-library endpoints with their limits and error codes.

Cards created through the site must **not** carry a player name at card level; the site leaves that field empty. Placeholder words in that field (for example "you", "player") are treated as unset.

### Level 4 — Play

The embedded stage is the canonical consumer of this level; its endpoint table in the repository (`stage/src/config/request-url.js`) is checked against the spec by the drift test. Note that `POST /open/v1/conversation/start` only creates or resumes a conversation; sending a message, regenerating and continuing all happen over the WebSocket described under `POST /open/v1/conversation/ws-ticket` in the reference. Behaviour with a partially implemented level 4 is currently unspecified: the stage assumes the whole group exists.

### Sandbox cards (new-style chat page)

A card whose author asset has `pageMode: "sandbox"` renders its whole chat area inside an author-controlled shell that runs in a cross-origin iframe. The site serves that shell from a per-card subdomain, `https://c<roleId>.hearthroom.club/sandbox/`, with a strict CSP and `frame-ancestors` limited to the site; the shell makes no requests of its own — messages, rules and the player's persona are fed by the site page over `postMessage`. Author scripts persist progress through `sdk.save.*`, which the site stores per member and per card: `GET /v1/me/cards/{roleId}/saves` returns `{ saves: { key: value } }`, `PUT /v1/me/cards/{roleId}/saves/{key}` with `{ value }` writes one entry, `DELETE /v1/me/cards/{roleId}/saves/{key}` removes it. Keys match `[A-Za-z0-9_-]{1,64}`, a value is at most 64 KB of JSON and a card holds at most 10 keys (`400` `key_invalid`, `value_too_large`, `saves_full`). The shell, its protocol and the SDK contract are documented upstream in `stage/docs/sandbox-chat-page.md`; the author-facing version, covering both chat pages, is the card authoring guide at `/guide`.

## How-to: choosing a model

There is no "select model" endpoint. Selection is a value you store or send:

1. **List the catalog.** `GET /open/v1/models` returns an array of *groups* → *families* → *variants*. A variant is one concrete model on one channel; its `value` is the identifier you use everywhere else. Each variant also tells you what it supports: `contextBudgetOptions` (context tiers), `thinkingDepthOptions` (only for reasoning models with selectable depth), `isMember` (requires a membership), `status` (health) and `costScore`.
2. **Persist the choice for a card.** `POST /open/v1/player/role-settings/save` with `roleId` and `selectModel: <variant.value>`. Optionally add `context` (one of that variant's `contextBudgetOptions[].value`) and `thinkingDepth` (one of its `thinkingDepthOptions[].value`). This is what the stage reads for every later turn; `GET /open/v1/player/role-settings` shows the stored value and its display name.
3. **Override for one turn (optional).** The WebSocket chat frame (see `POST /open/v1/conversation/ws-ticket` → *websocket* in the reference) accepts `model` and `thinkingDepth` per message. Empty `model` means the server default, not the stored setting — send the stored value if you want it honoured on that frame.
4. **Health and uptime.** `GET /open/v1/models/uptime-history?model=<variant.value>` gives per-hour availability for the picker's status hints.

## Player persona and `{{user}}`

The provider must resolve `{{user}}` (and how the character addresses the player) in this order:

1. the per-conversation persona (`player/conversation-persona` with `personaMode = conversation`), falling back to the card-specific fields while that conversation has none;
2. the card-specific persona (`player/role-settings` with `personaMode = custom`);
3. the account-wide persona (`player/persona`; `personaMode = global`, or when the card has never been configured);
4. the account nickname only (`personaMode = name_only`, or when the fields above are empty);
5. a language-dependent generic address ("you") when even the nickname is empty.

`personaMode` is one of `name_only`, `global`, `custom`, `conversation`. When absent: `custom` if any card-specific field is set, otherwise `global`. `conversation` exists for world cards where each chat save plays a different race or look: the persona is keyed by conversation, so switching saves switches personas; a fresh save starts from the card-specific fields until the player edits it. Limits: nickname ≤ 20 characters, self-description ≤ 1000 characters; both go through the provider's content moderation, and a rejection carries the reason in `message`.

## Adult content

Content rating is the **site's own** decision and is never read from the provider. Authors declare a rating when they submit; reviewers compare it with the content and reject mismatches; cards marked adult are hidden from everyone who has not opted in and confirmed their age. None of this is part of the provider contract.

## Plugging in a provider

Today a second provider is configuration plus a small code change, not a runtime plug-in.

| Where | Setting |
|---|---|
| Web build | `VITE_PROVIDER_API_BASE` — the `<API_BASE>` the browser talks to; the OAuth `resource` is `<API_BASE>/open/v1`. |
| Site server (Worker) | `PROVIDER_API_BASE` — the `<API_BASE>` used for sync, identity checks and review calls; `PROVIDER_API_GATEWAYS` — optional per-country gateways (`CC=url,…`) handed to browsers by `/v1/region`. |
| Review | `REVIEW_ENABLED` — `"true"` requires community review; any other value runs the site in "listing is publishing" mode. There is no provider-side key. |
| Code | `src/providers.ts` — the provider id union and the review switch. Members, identities, cards and review submissions all carry a provider column, so adding a provider needs no schema change. |

## Open items

- Semantics of a partially implemented level 4.
- No second provider has been integrated end to end yet; the section above describes the code as it is, not a verified port.

## Community identity and connected platforms

A HearthRoom member has one community handle, display name, bio and avatar. The name and avatar are seeded once from the first verified sign-in and can then be edited independently. Uploaded community avatars are processed and stored in HearthRoom's own R2 bucket. Changing the platform used for an action never changes that community profile.

Connect at most one account per provider. LunaTalk and HarperHarbor may be connected simultaneously. There is no global active-account choice. Credits, conversations and source assets remain on their respective platforms.

These are **HearthRoom community endpoints** under `/v1`, separate from the provider Open API:

Community card URLs use permanent numeric card numbers, for example `/cards/100001`.
Card responses return the same identity as `id: "100001"` and `num: 100001`.
Numbers are allocated independently of publication, including on an authenticated
draft save or inventory read. Unlisted cards can be shared by number: visitors may
read the host-authorized public presentation and play, but receive no authoring
permissions. They do not appear in boards or recommendations. Provider `roleId`
and `sourceRoleId` remain separate provider locators for playing and editing.

| Endpoint | Contract |
|---|---|
| `GET /v1/me` | Returns the community profile, including `displayName`, `bio`, `avatarUrl` and linked identities. |
| `PUT /v1/me/profile` | Authenticated multipart update: `displayName` (1–60 characters), `bio` (up to 500), optional `avatar` (JPEG/PNG/GIF/APNG/WebP, up to 10 MiB), or `removeAvatar=true`. Images are validated and stored in owned R2; still images are cropped to 512×512 WebP, while GIF, APNG (including `.png` files) and animated WebP retain their original bytes and animation, with cropping applied only by the avatar display; replacement schedules the old object for deletion. JSON supports name/bio only; `avatarUrl` input is rejected. |
| `GET /v1/avatars/:handle/:file` | Public current community avatar. Retired object URLs return 404. Author responses also include `bio`, including for authors without listed cards. |
| `POST /v1/me/connections/preview` | Current bearer plus `X-Provider`, or managed site cookie with same-origin `Origin` and `X-Hearthroom-Request: 1`; body `{provider, token}` proves the additional account. Read-only source/target community preview. |
| `POST /v1/me/connections` | Same proofs plus `{keepHandle, sourceHandle, targetHandle}` from preview. `keepHandle` must equal the current community's `sourceHandle`. An existing target must be provably empty and explicitly confirmed; its identity moves to the retained community and its empty community record is deleted atomically. SaaS accounts/assets are preserved. Managed-mode credential promotion commits in the same D1 transaction, guarded by the pending attempt, source session and credential generation. Stale previews fail closed. |
| `DELETE /v1/me/connections/:provider` | Always rejects with 409 `connection_permanent`; identity unlinking is unavailable. Stopping OAuth authorization is a separate action under `/v1/auth/disconnect`. |
| `GET /v1/me/cards` | List on the explicitly requested provider. Every item includes permanent `num` and numeric-string `detailId`, including private cards. Items also include provider, portrait `backgroundUrl`, `avatarUrl`, and, when synchronized, work/source identifiers. The client combines connected lists and groups copies. |
| `POST /v1/me/card-identities` | Bearer plus `X-Provider`; body `{roleId}`. Verifies source ownership and Hearthroom creation origin, then returns `{id, num, provider, sourceRoleId}`. Repeated calls keep the same number. Does not publish or consume publication quota. |
| `GET /v1/me/card-copies/:roleId` | Verifies ownership on the requested provider, then returns synchronization states. |
| `POST /v1/me/card-sync` | Body `{sourceProvider, sourceRoleId, sourceToken, targetProvider, targetToken, publish, updatePublished?, recreateMissing?}`. Both accounts must belong to the authenticated community; the source and existing destination must be owned by those accounts. Tokens are transient. `updatePublished: true` explicitly permits returning an unchanged published destination to draft before updating it; independently edited or pending-review copies remain protected. `recreateMissing: true` explicitly requests a new private copy only after the stored destination returns `404 role_not_found` on its card read. It requires `publish: false`, resets only the destination mapping, and never restores or deletes the old card or resources. Network, authorization and resource errors do not trigger replacement. |
| `GET /v1/cards/:cardId/comments?page=` | Public. Top-level comments of a listed card, newest first, 20 per page, each with up to three replies (most liked first). Adult cards need the same `?nsfw=1` plus token as the card page. |
| `GET /v1/cards/:cardId/comments/:rootId/replies?page=` | Public. Replies under one comment, oldest first. |
| `GET /v1/cards/:cardId/comments/count` | Public. Number of top-level comments. |
| `POST /v1/cards/:cardId/comments` | Member. Body `{content, rootId?, parentId?}`; 1–500 characters; six comments per member per minute (`429 comment_rate_limited`). The "replying to" name is resolved by the site. |
| `DELETE /v1/comments/:id` | The commenter, the card's author, or a site reviewer. Deleting a top-level comment removes its replies. |
| `PUT` / `DELETE /v1/comments/:id/like` | Member. One like per member per comment; repeats are no-ops. |
| `GET /v1/cards/:cardId/platforms` | Available copies of a numbered card, including unlisted cards, after community age gating, moderation and upstream accessibility checks. `playable` distinguishes storage from an actual runtime. |

A duplicate empty community is resolved by signing into the intended community and connecting the other verified SaaS account. Prior profile edits, preferences, community activity, publication history, owned works/copies, game saves or upstream cards prevent absorption. Older profiles without reliable edit history are conservatively protected by the migration. A different account on an already-connected provider is rejected. Populated-account merging and detaching identities are outside this release.

Community publication permits three distinct works per community per UTC week (Monday reset), shared across every connected provider. Copies map to the original work and do not add usage; registering a mapped copy separately fails with `publication_use_original`. Unlisting does not erase usage/history. The database enforces the limit within the publication transaction, including concurrent submissions. Existing listed cards may be refreshed without new usage.

Authors choose the initial platform when creating a card and select additional destinations per card. Synchronization preserves common text, instructions, examples, tags, identity settings, image references, bound Lorebooks, author assets, translated variants, alternate openings and metadata. Voice-specific content (`roleSpeech`) and incomplete paginated upstream documents are rejected before creation. Lorebooks are recreated as owned private resources on the destination; uncertain creates are retained for reconciliation instead of creating duplicates. This is an explicit transfer limitation, not a claim that the provider cannot store those features. Destination edits stop overwrite; uncertain creation results require reconciliation instead of blind retry. Publication requires an explicit action and follows each provider's review. Community content ratings are not sent to providers.

Card images retain the original SaaS URL. HarperHarbor stores owned references using `POST /open/v1/media/references`; card synchronization does not download or re-upload image bytes. An image reference remains subject to ownership, quota and media review. This is separate from uploaded community profile avatars.

Players select a published copy and its linked platform account for each play action. The destination contains both the provider and that platform's role ID. Balances and conversations never combine. HarperHarbor supports the core conversation flow listed below when its model runtime is configured. The browser uses the selected provider for both HTTP requests and WebSocket connections. Existing Harper authoring grants must approve the additional `chat.play` scope before playing; refreshing an older grant retains its original OAuth client.

MCP: not applicable to community identity/linking, which requires interactive OAuth proofs and has no community MCP transport. Card operations reuse the provider's existing authenticated service APIs; they do not add a second privileged authoring path. Observability uses existing HTTP outcomes, durable `work_copies` state and `card_sync` result events, with no tokens, account IDs or content in event fields.


### HarperHarbor conversation capability

| Capability | HarperHarbor implementation |
|---|---|
| Model catalog | `GET /models`; server-owned token rates in credits. The initial configured model is `deepseek-v4-flash`. |
| Start and resume | `POST /conversation/start`; one current conversation per account and agent, with an initial or selected alternate greeting. |
| Send | `POST /conversation/ws-ticket`, then `/conversation/ws?protocolVersion=2`; authenticate with a single-use ticket before sending a turn. |
| History and status | `GET /conversation/messages`, `GET /conversation/operations`, and `GET /conversation/operations/{operationId}`. |
| Stop and reconnect | `POST /conversation/stop`; durable chunks replay through `resumeStreamId` plus `lastEventId`, or `mode=tryResume` plus `conversationId`. |
| Player settings | Name-only/custom, global and per-conversation personas, response preferences, standing instructions and player notebook. |
| Prompt construction | Prompt V2 assembles agent instructions, examples, persona, history and matching bound Lorebook entries. Lorebook recall combines keywords, constant entries and semantic retrieval as described below. |
| Billing | Ordinary turns retain their existing settlement rules. Agent executions reserve incrementally and settle aggregate actual token usage once; stopped/upstream-failed executions pay for reported usage, while internal persistence failures are waived. Continuation bills only new work. |

A `clientOperationId` identifies one immutable send intent. Reusing it with different text or a different conversation is rejected. Reconnecting replays stored chunks rather than starting a new model request. Partial output and terminal state remain available in history. Provider balances and histories remain separate.

HarperHarbor supports regenerate/rewrite, conversation archives and forks, message editing/deletion, player notebook, AI notebook memory, reply suggestions and Agent mode. Continue-response and the LunaTalk MOD marketplace remain separate unsupported capabilities; they are not prerequisites for Agent preparation. Public play still requires provider access and review approval. An author may preview their own private agent and author asset; this does not publish it or approve it for another account.

The model relay must be configured before enabling Harper play on the community deployment. Local synthetic tests, live upstream verification and production deployment/readback are separate release checks.

### Agent mode on HarperHarbor

Agent mode runs the migrated LunaTalk preparation tool engine through the existing conversation API. It can list/search/read enabled Lorebook entries, original dialogue and chapter summaries; inspect requirements and the player's notebook; maintain AI notes and versioned state; establish sealed/random facts; fetch permitted public web content; and write, revise and deliver drafts. Role, response, persona and language requirements remain in the same prompt. State keeps a bounded 16 KiB version ring and follows rollback/fork boundaries.

Read `/player/agent-mode?roleId=...&model=...` for the saved setting, runtime availability and selected model capability. Send `agentMode` only to override one execution. Free and non-tool model lanes are excluded. Treat `prepStep` as preparation progress, never as answer text. `agentTurn=true` marks a live Agent execution, which has heartbeat and idle detection rather than a five-minute total wall limit.

History and operation-list `operations` arrays use chronological order within the latest 50-operation window. The last entry is the current continuation candidate; a completed continuation replaces its parent in that projection.

For `agent_progress_preserved`, show the saved preparation trace and Continue. Continue sends a new idempotency key, the original message/model and `resumeFromOperationId`; it reuses saved drafts and tool results without duplicating the USER message. Continuations expire after 30 days, and changed history/model invalidates them. Invalid sources fail closed on Harbor. A transport reconnect instead replays the same execution using its existing stream identity. Agent stop ACK waits for durable settlement before the player reloads history.

The Console ledger identifies these charges as Agent mode plus the actual model. Model-catalog estimates describe a single call and do not cap an Agent execution's total cost. Automatic memory jobs retain their separate billing lifecycle. Provider balances and data remain isolated. The OpenAI-compatible `/v1/chat/completions` endpoint still leaves tool execution to its caller; no Agent chat endpoint or implicit server tool execution is added there.

These are source capabilities, not evidence of deployment. Verify runtime capability flags on the target provider. Local validation uses synthetic models and isolated data; real-provider and production readback remain separate checks.

### Cross-platform authoring results

The editor starts with the content, then asks which connected platforms to save to. All connected platforms are selected initially. Later saves keep the source and update selected copies. The selection is remembered in the current browser; it is not an account-wide preference. Publication has a separate multi-platform confirmation.

Each platform returns its own result; a failed destination does not roll back a saved source. Retrying reuses the source and previously created copies. The combined card list opens the source editor for an existing distribution.

Sync errors may include `detail: {provider, step, upstreamStatus, upstreamCode}`. Only fixed step names and allowlisted upstream codes are exposed. Never include upstream prose, request bodies, tokens or private content in reports. Stored copy failures retain the same safe diagnostic envelope.

### Context usage for individual replies

HarperHarbor returns `hasContextUsage` with assistant history rows and operation
statuses. The player keeps a Context usage entry even when the model has no
published token capacity. It sends the selected row's `chatId` to
`/open/v1/conversation/prompt-diagnostics` and displays that reply's snapshot.
Input/cache usage is model-reported; composition buckets remain estimates.
Replies recorded before usage persistence may have composition data only.


### HarperHarbor Lorebook and memory behavior

`matchOptions` preserves `selective`, `scanDepth` (0–100), `order`, `groupId`, `groupOrder` and `extensions`. A zero scan depth uses the current input and latest assistant reply. Unknown extension fields are stored, not executed. Imported fragments share a book-scoped group ID; semantic recall admits eligible fragments together in fragment order. Keyword and regular-expression matches run first; semantic ranking supplements them without overriding secondary-key exclusions.

For stable context caching, admitted entries retain their original place across ordinary turns. Author ordering applies when entries first enter the context. Arbitrary insertion positions, timed removal, probability, recursive scanning and group scoring are not implemented by Harper. Source edits and deletion invalidate affected entries. A full memory checkpoint can release older dynamic retrieval; the Lorebook source remains available for later recall.

Automatic chapter summaries and hierarchical consolidation preserve original chat history. During preparation, clients handle `compacting`, `compactDone` and `compactFailed`, and keep Stop available. Phase events describe preparation, not final reply success. Use the terminal operation state to decide whether to retain an unsent draft. `context_capacity_exceeded` means the request cannot fit after safe preparation; changing the input or model capacity is required. Retry with unchanged input is not an automatic recovery.

## Website community integration

Discord account links, community growth, notifications and own-report access are website-owned services, separate from this provider API. See [the community integration contract](./community-integration.md) for routes, authorization, lifecycle, configuration and the MCP applicability decision.
