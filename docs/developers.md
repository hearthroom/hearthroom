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
| Error codes | The site translates these for end users: `invalid_arguments`, `role_in_review`, `visibility_requires_review`, `public_role_requires_clone`, `permission_denied`, `not_found`, `validate_reject` (when a `detail` with `reason`/`index`/`name`/`max`/`actual` is attached, the sentence names the rule and the sizes). Others pass through; a `message` that is not a code is shown verbatim (for example a moderation reason). |
| Timestamps | Each field says whether it is Unix milliseconds, seconds or an RFC 3339 string; the server is not uniform. |
| Identifiers | Users are identified by `accountNumId`, a public numeric id. Internal UUIDs never appear on the wire. |
| Macros | `{{user}}` and `{{char}}` inside card text are substituted by the provider before the text reaches the model, case-insensitively. `{{char}}` becomes the character name; `{{user}}` follows the persona precedence below. |
| User-Agent | The site's server-side and scheduled requests carry a fixed `User-Agent`. Providers should not treat it as browser traffic to be challenged. |

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

## How-to: choosing a model

There is no "select model" endpoint. Selection is a value you store or send:

1. **List the catalog.** `GET /open/v1/models` returns an array of *groups* → *families* → *variants*. A variant is one concrete model on one channel; its `value` is the identifier you use everywhere else. Each variant also tells you what it supports: `contextBudgetOptions` (context tiers), `thinkingDepthOptions` (only for reasoning models with selectable depth), `isMember` (requires a membership), `status` (health) and `costScore`.
2. **Persist the choice for a card.** `POST /open/v1/player/role-settings/save` with `roleId` and `selectModel: <variant.value>`. Optionally add `context` (one of that variant's `contextBudgetOptions[].value`) and `thinkingDepth` (one of its `thinkingDepthOptions[].value`). This is what the stage reads for every later turn; `GET /open/v1/player/role-settings` shows the stored value and its display name.
3. **Override for one turn (optional).** The WebSocket chat frame (see `POST /open/v1/conversation/ws-ticket` → *websocket* in the reference) accepts `model` and `thinkingDepth` per message. Empty `model` means the server default, not the stored setting — send the stored value if you want it honoured on that frame.
4. **Health and uptime.** `GET /open/v1/models/uptime-history?model=<variant.value>` gives per-hour availability for the picker's status hints.

## Player persona and `{{user}}`

The provider must resolve `{{user}}` (and how the character addresses the player) in this order:

1. the card-specific persona (`player/role-settings` with `personaMode = custom`);
2. the account-wide persona (`player/persona`; `personaMode = global`, or when the card has never been configured);
3. the account nickname only (`personaMode = name_only`, or when the fields above are empty);
4. a language-dependent generic address ("you") when even the nickname is empty.

`personaMode` is one of `name_only`, `global`, `custom`. When absent: `custom` if any card-specific field is set, otherwise `global`. Limits: nickname ≤ 20 characters, self-description ≤ 1000 characters; both go through the provider's content moderation, and a rejection carries the reason in `message`.

## Adult content

Content rating is the **site's own** decision and is never read from the provider. Authors declare a rating when they submit; reviewers compare it with the content and reject mismatches; cards marked adult are hidden from everyone who has not opted in and confirmed their age. None of this is part of the provider contract.

## Plugging in a provider

Today a second provider is configuration plus a small code change, not a runtime plug-in.

| Where | Setting |
|---|---|
| Web build | `VITE_LUNATALK_API_BASE` — the `<API_BASE>` the browser talks to; the OAuth `resource` is `<API_BASE>/open/v1`. |
| Site server (Worker) | `LUNATALK_API_BASE` — the `<API_BASE>` used for sync, identity checks and review calls; an optional regional alternate. |
| Review bot | `REVIEW_BOT_KEY` (secret) and `REVIEW_BOT_ACCOUNT_NUM_ID`; with either missing the site runs in "listing is publishing" mode. |
| Code | `src/providers.ts` — the provider id union and the review-bot lookup. Members, identities, cards and review submissions all carry a provider column, so adding a provider needs no schema change. |

## Open items

- Semantics of a partially implemented level 4.
- No second provider has been integrated end to end yet; the section above describes the code as it is, not a verified port.
