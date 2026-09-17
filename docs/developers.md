# Developer documentation

Hearthroom is a community-maintained, open-source character-card board. The site itself stores **no cards, runs no models and keeps no passwords**: accounts, card content and conversations live with a *provider*; the site only owns "who listed which card, how far it got in review, and who stamped it". Today the only provider is the LunaTalk Open API (`/open/v1`).

This page has two parts:

1. **The provider contract** — what a provider must implement, grouped by capability level, so that this site (or any fork of it) can run against it.
2. **The API reference** — every endpoint the site and the embedded conversation stage call, with parameters, request and response schemas, and error codes. The reference is generated from `docs/openapi.json` in the repository; the machine-readable spec is the source of truth and can be fed to any OpenAPI 3.1 tool.

The documentation lives next to the code. A test in the repository (`web/test/protocol-doc.test.ts`) fails whenever the site's code calls an upstream path that is missing from the spec, so the two cannot drift apart silently.

## Conventions

| Topic | Rule |
|---|---|
| Base URL | Every resource lives under `<API_BASE>/open/v1/...`. `<API_BASE>` is configured per deployment (see *Plugging in a provider*). |
| Authentication | `Authorization: Bearer <token>`. The token is either a user access token obtained through OAuth, or a service-account key (see *Review*). |
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
| **1 — Read & list** | Public card detail and preview page, the author's own card list, comments, wallet. | Authors can list their cards; the board, search and author pages work. |
| **2 — Review** | Service accounts and per-card sharing grants, plus a content hash. | Community review with the site's review bot. Without it the site falls back to "listing is publishing". |
| **3 — Authoring** | Create / patch / publish cards, welcome messages, author assets, worldbooks, the media library, canonical tags. | Authors can create and edit cards on the site instead of the provider's own UI. |
| **4 — Play** | The conversation endpoints used by the embedded stage. | Playing cards inside the site. |

### Level 0 — Identity

The authorization server must support:

- `POST /oauth/register` — dynamic client registration (RFC 7591). The site is a public client: `token_endpoint_auth_method: "none"`, `grant_types: ["authorization_code", "refresh_token"]`, and its callback page as the redirect URI.
- `GET /oauth/authorize` — authorization code flow with PKCE `S256` and `state`. The site also sends `resource` (RFC 8707) set to `<API_BASE>/open/v1`.
- `POST /oauth/token` — `authorization_code` (with `code_verifier`) and `refresh_token` grants. Refresh tokens may be single-use; the site always stores the newest one and never runs two refreshes concurrently.
- `POST /oauth/revoke` — called on sign-out; failure does not block local sign-out.
- `GET /.well-known/oauth-protected-resource/open/v1` — optional protected-resource metadata (RFC 9728).

A user token carries exactly the scopes the user granted. The site forwards it inside single requests and never stores it server-side, logs it or caches it.

`GET /open/v1/me` returns the caller's public identity. The site has its own member id (an 8-letter handle shown on author pages); the provider's `accountNumId` is only the mapping key inside the site's identity table, so one member can later be linked to more than one provider.

Sign-in starts on the site's own `/login` page, where the user picks a provider; only then is the browser sent to that provider's `/oauth/authorize`.

### Level 1 — Read & list

Public read: `GET /open/v1/role/detail`, `GET /open/v1/role/preview-page`, comment listing. Authenticated: `GET /open/v1/role/mine` (with a `creationMethod` filter so the site can show only cards created through it), `GET /open/v1/role/author-asset/serve`, comment writes, `GET /open/v1/me/wallet`, `GET /open/v1/me/score/records`.

Fields the site reads from `role/detail` are listed in the reference; extra fields are ignored. Language codes map to board zones: `zh*` → Chinese, `en`/`ja`/`ko` → their own zone, anything else → "all zones".

### Level 2 — Review

The site holds one **service account** at the provider (the "review bot"). Its key is a deployment secret; its public numeric id is ordinary configuration. A service key may only call an allow-list of routes — `GET /open/v1/me`, `GET /open/v1/share/role/detail`, `GET /open/v1/share/role/content-hash` — and receives `service_account_forbidden` elsewhere. That boundary is the provider's to enforce.

When an author submits a card, the site forwards the author's token to `POST /open/v1/share/role/grant` so the bot may read the card's full settings, and records the content hash from `GET /open/v1/share/role/content-hash`. The hourly sync re-checks the hash; a change sends the card back to review. The provider should notify the author when a grant is created or revoked.

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
| Review bot | `REVIEW_BOT_KEY` (secret) and `REVIEW_BOT_ACCOUNT_NUM_ID`; with either missing the site runs in "listing is publishing" mode. |
| Code | `src/providers.ts` — the provider id union and the review-bot lookup. Members, identities, cards and review submissions all carry a provider column, so adding a provider needs no schema change. |

## Open items

- Semantics of a partially implemented level 4.
- No second provider has been integrated end to end yet; the section above describes the code as it is, not a verified port.

## Community identity and connected platforms

A HearthRoom member has one community handle, display name and avatar. The name and avatar are seeded once from the first verified sign-in and can then be edited independently. Changing the platform used for an action never changes that community profile.

Connect at most one account per provider. LunaTalk and HarperHarbor may be connected simultaneously. There is no global active-account choice. Credits, conversations and source assets remain on their respective platforms.

These are **HearthRoom community endpoints** under `/v1`, separate from the provider Open API:

| Endpoint | Contract |
|---|---|
| `GET /v1/me` | Returns the community profile, including `displayName`, `avatarUrl` and linked identities. |
| `PUT /v1/me/profile` | Authenticated update `{displayName, avatarUrl}`. Name is 1–60 characters; avatar is empty or an HTTPS URL. Images remain hosted externally, including on the user's SaaS. |
| `POST /v1/me/connections/preview` | Current bearer plus `X-Provider`; body `{provider, token}` proves the additional account. Read-only source/target community preview. |
| `POST /v1/me/connections` | Same proofs plus `{keepHandle, sourceHandle, targetHandle}` from preview. `keepHandle` must equal the current community's `sourceHandle`; it is retained for request compatibility, not an account-selection UI. Existing target communities require explicit confirmation. Stale previews fail closed. |
| `DELETE /v1/me/connections/:provider` | Disconnects an additional platform without deleting accounts or assets. The founding login remains protected. To remove the sign-in provider, the client uses another verified linked provider's proof, then resumes through that provider. |
| `GET /v1/me/cards` | List on the explicitly requested provider. Items include provider and, when synchronized, canonical work/source identifiers. The client combines connected lists and groups copies. |
| `GET /v1/me/card-copies/:roleId` | Verifies ownership on the requested provider, then returns synchronization states. |
| `POST /v1/me/card-sync` | Body `{sourceProvider, sourceRoleId, sourceToken, targetProvider, targetToken, publish}`. Both accounts must belong to the authenticated community; the source and existing destination must be owned by those accounts. Tokens are transient. |
| `GET /v1/cards/:roleId/platforms` | Public copies of an approved community card, after community age gating and upstream accessibility checks. `playable` distinguishes storage from an actual runtime. |

A mistaken connection is resolved from the intended community account: disconnect the additional platform from the wrong community, then connect it to the intended one. No community accounts or history are merged or deleted. A different account on an already-connected provider is rejected. Independent HearthRoom login and detaching a founding login are outside this release.

Authors choose the initial platform when creating a card and select additional destinations per card. Synchronization currently preserves common text, instructions, examples, tags, identity settings and images. Rich content outside this transfer contract (worldbooks, author scripts, translated variants, alternate openings and metadata) is rejected before creation. This is an explicit transfer limitation, not a claim that the provider cannot store those features. Destination edits stop overwrite; uncertain creation results require reconciliation instead of blind retry. Publication requires an explicit action and follows each provider's review. Community content ratings are not sent to providers.

Images retain the original SaaS URL. HarperHarbor stores owned references using `POST /open/v1/media/references`; HearthRoom does not download or re-upload image bytes. An image reference remains subject to ownership, quota and media review.

Players select a published copy and its linked platform account for each play action. The destination contains both the provider and that platform's role ID. Balances and conversations never combine. HarperHarbor's current provider deployment exposes card hosting but no model/chat runtime; stored copies therefore have no play action until a real runtime is connected.

MCP: not applicable to community identity/linking, which requires interactive OAuth proofs and has no community MCP transport. Card operations reuse the provider's existing authenticated service APIs; they do not add a second privileged authoring path. Observability uses existing HTTP outcomes, durable `work_copies` state and `card_sync` result events, with no tokens, account IDs or content in event fields.
