# Developer documentation

Hearthroom's API lets you browse community cards, find authors, read and write comments, and manage your own favorites, follows and notifications.

This page contains two OpenAPI 3.1 references:

- **Hearthroom Community API** (`docs/community-openapi.json`): the site's `/v1` endpoints for community browsing and member social features.
- **Service integration API** (`docs/integration-openapi.json`): the interface used by the site and embedded chat client for identity, card authoring, media and conversations. These requests go to the connected service's API origin.

Paths, field names, scopes and operation identifiers remain compatible with the existing integration contract. A service can implement supported groups progressively; clients must check advertised capabilities before calling optional operations. The reference describes the integration interface, not the deployment configuration or commercial terms of a particular service.

## Quick start

Public browsing does not require sign-in:

```sh
curl 'https://hearthroom.club/v1/cards?zone=en&sort=new&limit=12'
curl 'https://hearthroom.club/v1/tags?zone=en&limit=12'
```

The card list returns `items`, `hasNext`, `limit` and `offset`. Use a card's `id` to read its detail and comments. Author links use the author's public `handle`.

## Community requests and authentication

| Topic | Convention |
|---|---|
| Base URL | `https://hearthroom.club`; documented paths begin with `/v1`. A self-hosted instance uses its own origin. |
| Public reads | Endpoints marked **no auth** accept anonymous requests. Optional authentication can affect visible content and viewer-specific fields. |
| Member requests | Send `Authorization: Bearer <access_token>` using the current access token from your authorized Hearthroom sign-in. A browser cookie alone does not authenticate these endpoints. This API does not issue standalone developer keys. |
| Request body | Send JSON with `Content-Type: application/json` when the endpoint defines a body. |
| Display language | Card and author browsing accept `lang`; card text falls back to the first `Accept-Language` value, then Chinese. |
| Content language | `zone` filters the board by `zh`, `en`, `ja`, `ko` or `all`. The default is `zh`; it is separate from the display language. |
| Identifiers | Card `id` and member `handle` are public identifiers. Treat identifiers as opaque and use the values returned by the API. |
| Timestamps | Numeric timestamps are Unix milliseconds. Comment `createTime` is an ISO 8601 string. |

Authenticated requests act as the signed-in member. A caller cannot select another member by adding an ID to the request. Private results must not be placed in a shared cache.

## Browsing and pagination

Card search and board filters use `GET /v1/cards`. Repeating `tag` requires all selected tag groups; `hide` is a comma-separated list of category keys. An explicitly selected tag takes precedence over a hidden category. An `author` filter uses a public handle and ignores `zone`.

Card, tag and author lists use `offset` and `limit`; `hasNext` tells you whether another page is available. Card `total` can be `null`, so do not use it as the only pagination signal. Favorites, follows and the followed-author feed return 24 entries per page. Comments and replies use `page`, starting at 1, with 20 entries per page.

Public board results contain listed cards. Direct card links can also return an available preview; access to a link does not imply that a card has passed community review. Hidden or unavailable cards are omitted or return 404. Adult content requires an authenticated member with the site's age and visibility settings enabled; a direct request without access returns 403 with `adult_content`.

## Comments and member collections

Comments belong to a community card. The API supports top-level comments and one reply thread beneath each comment. A comment contains 1–500 Unicode characters after trimming; each member can post up to six comments per minute.

The comment author, card author and authorized moderators can delete a comment. Deleting a top-level comment also hides its replies. Like and unlike operations are idempotent.

Favorites use a card's `id`; follows use an author's `handle`. `GET` reads the current state, `PUT` adds it and `DELETE` removes it. The feed contains works by followed authors. Notifications are visible only to their recipient; marking a notification read does not grant access to anyone else's notification.

## Community errors

Errors use a non-2xx HTTP status and a JSON `error` string, sometimes with an additional `detail` object. The string may be a code or a short sentence; clients should retain the HTTP status when handling it.

| Status | Meaning |
|---|---|
| 400 | Missing or invalid input, such as an empty comment or too many tags. |
| 401 | Authentication is missing or no longer valid. |
| 403 | The member cannot perform the action or access the requested content. |
| 404 | The requested resource is unavailable to the caller. |
| 429 | The request exceeded a rate limit, such as `comment_rate_limited`. |
| 5xx | The service could not complete the request. |

This reference covers browsing and member social features. Staff moderation, account recovery, publishing workflows and internal automation are outside this reference.


## Service integration

The service API uses a separately configured `<API_BASE>`. Its main resources are under `/open/v1`; OAuth and discovery use the paths shown in the reference. Community `/v1` routes and service `/open/v1` routes have different origins, authentication contexts and data ownership.

| Area | Client contract |
|---|---|
| Identity | OAuth authorization code flow with PKCE, token refresh/revocation, and `GET /open/v1/me`. |
| Card authoring | Card details, author-owned inventory, document updates, opening messages, presentation assets, Lorebooks and media. |
| Conversation | Start/resume, WebSocket messages, history, operation status, stop and reconnect. |
| Player data | Personas, response settings, archives, memory and notepad, subject to ownership and advertised support. |
| Hosting and review | Version and decision exchanges using the documented author and server-held issuer credentials. Community review and listing remain community decisions. |

### Authorization and private data

Clients register an allowed callback using `/oauth/register`, send PKCE `S256`, `state` and the intended resource to `/oauth/authorize`, and exchange the returned code at `/oauth/token`. The resource for service API access is `<API_BASE>/open/v1`. Refresh and revocation use the endpoints in the reference; a token is valid only for its granted scopes and resource.

User calls send `Authorization: Bearer <access_token>`. `role.read` can include the author's private card instructions and Lorebooks; `role.write` permits resource changes, including applicable media operations. `chat.play` permits conversation operations that can spend credits. An integration must present those effects during authorization and enforce ownership on every private operation.

Public card access does not grant editing or private export. A community member handle, card number and service resource ID identify different things; clients must use the identifier required by each endpoint. `X-Hosting-Key`, where required, is a server-held issuer credential and must never be sent to browser code. Personal API keys are optional; their format and issuance are outside this reference.

### Conversation lifecycle

1. `POST /open/v1/conversation/start` opens or resumes a conversation. It does not generate a model reply. When resuming, pass `firstPageSize` to receive the first history page in the same response (`firstPage`) instead of a separate history request.
2. `POST /open/v1/conversation/ws-ticket` obtains a short-lived, single-use ticket with the user's bearer token.
3. The client opens `/open/v1/conversation/ws` and sends the authentication frame, followed by the turn frame. The ticket endpoint's **WebSocket protocol** section documents frames, events, completion and replay fields.
4. History and operation-status endpoints provide the durable result. `POST /open/v1/conversation/stop` requests cancellation; clients use the final operation state to determine the outcome.

A reconnect must reuse the stream identity and replay position instead of submitting another paid turn. Optional Agent continuation uses `resumeFromOperationId` only when the service reports preserved progress. A rejected continuation must not silently become a fresh paid request.

### Optional capabilities and errors

Response preferences require `responseSettingsVersion=1`. Media search, ordering and authored relative paths require the corresponding returned capabilities. Multiple reply suggestions and Agent preparation also depend on service support. A matching path alone does not prove a capability is enabled.

Prices, balances, model availability, storage limits and retention policies are determined by the connected service. Clients must use returned capabilities and cost information, obtain confirmation for paid actions where required, and preserve the distinction between a completed response, partial output, cancellation and failure.

Service errors and authentication failures follow the endpoint-specific schemas and the integration reference's Notes section. They are separate from the community error envelope above. Unknown optional features should remain unavailable rather than be inferred from a service name.
