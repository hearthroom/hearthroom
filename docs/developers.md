# Hearthroom Community API

Hearthroom's API lets you browse community cards, find authors, read and write comments, and manage your own favorites, follows and notifications.

The reference below describes these community endpoints. Each endpoint includes its authentication requirements, parameters and response fields. The machine-readable specification is `docs/community-openapi.json`, in OpenAPI 3.1 format.

## Quick start

Public browsing does not require sign-in:

```sh
curl 'https://hearthroom.club/v1/cards?zone=en&sort=new&limit=12'
curl 'https://hearthroom.club/v1/tags?zone=en&limit=12'
```

The card list returns `items`, `hasNext`, `limit` and `offset`. Use a card's `id` to read its detail and comments. Author links use the author's public `handle`.

## Requests and authentication

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

## Errors

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
