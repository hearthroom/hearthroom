# Community moderation API

Reference for staff tooling and the AI review account (driven by Codex or Claude Code through the Hearthroom CLI). It covers comment moderation, share-campaign review and share-campaign payout. It is not part of the public developer reference in `developers.md`.

All paths are under the API origin (`https://hearthroom.club` for the hosted site; a self-hosted instance uses its own origin). All bodies are JSON. Errors come back as `{ "error": "<code>", "field"?: "<name>", "version"?: <n> }`. Every `/v1/moderation/*` response is `Cache-Control: private, no-store`, and request bodies are capped at 16 KB (campaign settings routes accept up to 512 KB).

## Authentication and identity

- Send `Authorization: Bearer <Harbor access token>`. A browser cookie does not authenticate these routes.
- The token must belong to a reviewer member. A guest gets 401 `missing bearer token`; a member who is not a reviewer gets 403 `not a reviewer`.
- `X-Provider` selects the token's provider and may be omitted for the default one.
- The AI account is a reviewer that is also marked as a review agent. The server decides this from the token. Nothing in the request can claim it, and the audit record's `actor_kind` (`human` or `ai`) always comes from the server.
- "Community admin" means the provider reports the caller as an app admin for this site. If the provider cannot be asked, the caller is treated as not an admin.
- A reviewer cannot act on their own content: comment decisions give 403 `moderation_self_review`, campaign decisions give 403 `share_self_review`.

## Who can do what

| Capability | Human reviewer | Human community admin | AI account |
|---|---|---|---|
| Read comment queue and stats | yes | yes | yes |
| Comment `release` | yes | yes | yes |
| Comment `flag` (hold a visible comment for review) | no | no | yes |
| Comment `remove`, `dismiss` | yes | yes | no, 403 `agent_not_allowed` |
| Mutes, keywords | yes | yes | no |
| Read campaign queue, detail, settings list | yes | yes | yes |
| Campaign decision `approve`, `reject`, `needs_info` | yes | yes | yes |
| Approval pays automatically | no | yes | no |
| Payout routes (list, request, batch, retry, cancel, check, reconcile) and pool | no, 403 `community_admin_required` | yes | no, 403 `agent_not_allowed` |
| Campaign and community settings writes | no | yes | no |

The AI account can approve, reject or ask for more information on a share placement, but an AI approval only reaches "awaiting payout" and the AI can never pay. For comments it can release or flag. Removal needs a human.

## Operation ids and replay

Every write takes `operationId`, a string matching `^[a-zA-Z0-9-]{16,80}$` (a UUID works). A missing or malformed one gives 400 `invalid_arguments`. The id is unique per actor.

- **Campaign decision and payout routes replay.** Sending the same id again for the same action and the same placement, content or payout returns the current result and writes nothing. The same id used for a different action or target gives 409 `campaign_operation_repeated`.
- **Comment routes do not replay.** A repeated id writes nothing and gives 409 `moderation_conflict`.
- Retry after a timeout with the same id; use a new id for a new decision.

## Comment moderation

Cards' comments and blog post comments are in one queue. Your own comments never appear in it, and comments on adult-rated cards are hidden from reviewers without age verification.

### `GET /v1/moderation/comments?tab=held|reported|removed&page=1`

20 per page. A missing or other `tab` gives 400 `invalid_arguments`.

```ts
{ total: number, items: {
    id: string,
    target: { kind: "card", id, title, cardNumber: number|null } | { kind: "post", id, title, column, slug },
    author: { handle, displayName },
    content: string,
    status: "visible"|"held"|"removed",
    holdReason: "keyword"|"new_account_link"|"too_many_links"|"duplicate"|"recent_removal"|"reports"|"ai"|null,
    reports: { total: number, byReason: Record<string, number> },
    createdAt: number, moderatedAt: number|null,
    moderationReason: string|null,   // the removal reason, or the AI's flag reason while held
    suggestedBy: "ai"|null           // "ai" when moderationReason is an AI flag
  }[] }
```

`held` is newest first; `reported` is visible comments with open reports, most reports first; `removed` is most recently removed first.

### `GET /v1/moderation/comments/stats`

```ts
{ held, openReports, removed7d: number, medianHandleMs7d: number|null,
  holdReasons7d: Record<"keyword"|"new_account_link"|"too_many_links"|"duplicate"|"recent_removal"|"reports"|"ai", number> }
```

### `POST /v1/moderation/comments/:id/decision`

Body: `{ action: "release"|"remove"|"dismiss"|"flag", reason?: string, operationId }`. Response: `{ id, status: "visible"|"held"|"removed" }`.

| action | Who | Effect | `reason` |
|---|---|---|---|
| `release` | human, AI | held comment becomes visible and its open reports close | optional |
| `remove` | human | visible or held comment becomes removed; the author is notified with the reason | required |
| `dismiss` | human | closes the open reports; a comment folded because of reports is also made visible | required |
| `flag` | AI only | a visible comment becomes held with hold reason `ai`; on a comment that is already held or removed it only records the AI's opinion and changes nothing else | required |

`reason` is trimmed and cut to 2000 characters. Errors:

| Status | Code | When |
|---|---|---|
| 400 | `invalid_arguments` | Unknown `action`, a human sending `flag`, or a bad `operationId`. |
| 400 | `moderation_reason_required` | `reason` is empty where it is required. |
| 403 | `agent_not_allowed` | The AI sent `remove` or `dismiss`. |
| 403 | `moderation_self_review` | The comment is the reviewer's own. |
| 403 | `age_verification_required` | Adult-rated card comment and the reviewer is not age verified. |
| 404 | `comment not found` | Unknown or deleted comment. |
| 409 | `moderation_conflict` | The comment is not in a state this action accepts (for example `release` on a visible comment), someone decided first, or the `operationId` was already used. |

### Human-only comment tools

All of these return 403 `agent_not_allowed` for the AI account. Each takes `operationId` in the body.

- `PUT /v1/moderation/members/:handle/comment-mute`: body `{ days: 7|30|null, reason, operationId }` (`null` is permanent). Returns `{ until: number|null }`. Unknown handle gives 404 `community_member_missing`.
- `DELETE /v1/moderation/members/:handle/comment-mute`: body `{ reason, operationId }`. Returns 204.
- `GET /v1/moderation/comment-keywords` returns `{ items: { id, pattern, createdAt }[] }`. `POST` takes `{ pattern, operationId }` (1 to 100 characters) and `DELETE /v1/moderation/comment-keywords/:id` takes `{ operationId }`. Both return the updated list.
- `GET /v1/moderation/settings` returns `{ settings, canEdit }` for any reviewer. `PUT` takes `{ settings: <partial>, operationId }` and needs a human community admin (403 `community_admin_required` otherwise).

## Share campaign review

A placement is one place where a member shared a card, submitted as part of a piece of content. Reviewers decide each placement. Review state (`reviewStatus`) and payout state are separate.

### `GET /v1/moderation/campaign/placements?status=&campaign=&page=1`

`status` is one of `submitted|resubmitted|needs_info|approved|rejected`; without it the queue merges `submitted` and `resubmitted`. `campaign` is a campaign slug (an unknown slug gives an empty list). Oldest first, 20 per page. An unknown `status` gives 400 `share_invalid` with `field: "status"`.

```ts
{ total: number, items: {
    id, contentId, contentTitle, campaignSlug, applicant: { handle }, platform, location, url: string|null, publishedAt,
    requestedTier, approvedTier: Tier|null, reviewStatus, version: number, createdAt, evidenceCount: number,
    flags: { duplicateLocation: boolean, duplicateImage: boolean, burst: boolean }
  }[] }
```

Flags are hints for the reviewer, not decisions: `duplicateLocation` means another placement in the same content has the same location, `duplicateImage` means a screenshot matches one on another placement, and `burst` means the applicant filed more placements in 24 hours than the campaign's threshold.

### `GET /v1/moderation/campaign/contents/:id`

Unknown id gives 404 `share_content_not_found`.

```ts
{ content: { id, campaignSlug, title, cardId: number|null, shareCode, applicant: { handle }, createdAt },
  placements: { id, platform, location, locationKey, url, publishedAt, note, requestedTier, approvedTier, reviewStatus, reviewReason,
    reviewedKind: "human"|"ai"|null, reviewedAt, countsAsPlacement: boolean, version, createdAt,
    evidence: { id, purged: boolean }[], flags,
    duplicates: { location: string[], image: { contentId, handle }[] } }[],
  payout: { tier: Tier|null, target: number, due: number },
  paidTotal: number,
  payouts: { id, amount, targetTotal, status, attempts, error: string|null, createdAt, settledAt }[],
  history: { id, title, createdAt, paidTotal }[] }
```

The response carries no member ids, account numbers or Provider entry ids.

### `POST /v1/moderation/campaign/placements/:id/decision`

Body: `{ decision: "approve"|"reject"|"needs_info", tier?: Tier, countsAsPlacement?: boolean, reason?: string, expectedVersion: number, operationId }`.

- `expectedVersion` is the placement's `version` from the queue or detail. A stale one gives 409 `share_version_conflict` with the current `version`; re-read and decide again.
- `reason` is required for `reject` and `needs_info` (at most 500 characters after trimming) and optional for `approve`. The applicant is told the outcome in plain words; the reason is shown on their page.
- `tier` and `countsAsPlacement` apply to `approve` only. Without `tier`, the placement keeps its current approved tier, else the requested one.
- Allowed from: `approve` on submitted, resubmitted, needs_info or approved (re-grading); `reject` on submitted, resubmitted or needs_info; `needs_info` on submitted or resubmitted.

Response: `{ placement: { id, reviewStatus, approvedTier, countsAsPlacement, reviewReason, reviewedKind, reviewedAt, version }, payout: PayoutView|null, payoutError?: string }`.

`payout` is `null` unless the caller is a human community admin and the decision is an approval. In that case the server tries to pay immediately, using the derived operation id `<operationId>:payout`. If that attempt is refused, the approval still stands and `payoutError` carries the code. An AI approval, or a human reviewer's approval without admin rights, stays at "awaiting payout" until a human admin pays it.

| Status | Code | When |
|---|---|---|
| 400 | `share_invalid` + `field` | `decision`, `expectedVersion`, `reason`, `tier` or `countsAsPlacement` is missing or invalid. |
| 400 | `invalid_arguments` | Bad `operationId`. |
| 403 | `share_self_review` | The reviewer is the applicant. |
| 404 | `share_placement_not_found` | Unknown placement. |
| 409 | `share_version_conflict` | Stale `expectedVersion`; includes `version`. |
| 409 | `share_already_decided` | The current status does not allow this decision. |
| 409 | `campaign_submit_closed` | `needs_info` after the campaign's submit deadline. Approve and reject still work. |
| 409 | `campaign_operation_repeated` | The `operationId` was used for something else. |

Replaying an `operationId` returns the same body without a second write; if that decision was an approval by a human community admin, the replay also completes its payout attempt. Approving again with the same tier and count changes nothing and does not pay: `version` stays the same and `payout` is `null`. Use the payout routes below to pay an approval that is still awaiting payout.

### Campaign settings (read)

`GET /v1/moderation/campaigns` lists all campaigns including drafts, with `canEdit`. The AI account can read it (`canEdit: false`). Writes (`POST /v1/moderation/campaigns`, `PUT /v1/moderation/campaigns/:id`, `POST .../:id/status`, `POST .../banner`) need a human community admin.

## Share campaign payout

Every payout route requires a human community admin. Check order: reviewer (401/403), then not an AI account (403 `agent_not_allowed`), then admin (403 `community_admin_required`). The caller's bearer token is forwarded only to the provider, which makes the final authorization decision. Money moves from a campaign pool; amounts come from the approved tier and what the content was already paid.

```ts
PayoutView = { id, contentId, amount, targetTotal, status: "pending"|"paid"|"blocked_insufficient"|"failed"|"cancelled",
  error: string|null, attempts: number, providerEntryId: string|null, checkedAbsentAt: number|null,
  createdAt, updatedAt, settledAt: number|null }
```

| Route | Body | Response |
|---|---|---|
| `GET /v1/moderation/campaign/payouts?status=&campaign=&page=1` | none | `{ total, items }`, newest first, 20 per page. Each item has the `PayoutView` fields plus `contentTitle`, `campaignSlug` and `applicant: { handle }`. |
| `POST /v1/moderation/campaign/contents/:id/payout` | `{ operationId }` | `PayoutView` |
| `POST /v1/moderation/campaign/payouts/batch` | `{ contentIds: string[1..20, unique], operationId }` | `{ items: ({ contentId, payout } \| { contentId, error })[] }` in request order |
| `POST /v1/moderation/campaign/payouts/:id/retry` | `{ operationId }` | `PayoutView` |
| `POST /v1/moderation/campaign/payouts/:id/cancel` | `{ reason (1..500 chars), operationId }` | `PayoutView` |
| `POST /v1/moderation/campaign/payouts/:id/check` | none | `{ result: "paid"\|"absent"\|"unknown", payout }` |
| `POST /v1/moderation/campaign/payouts/reconcile` | none | `{ items: { result, payout }[] }` |
| `GET /v1/moderation/campaign-pool` | none | The provider's pool figures, or `{ configured: false }` |

How a payout behaves:

- A request pays the amount currently due. Retry reuses the stored amount and recipient and never recomputes them.
- `pending` means a send happened and its outcome is unknown. Use `check`, or `retry` with the same record; do not open a second payout. A `pending` payout can be cancelled only when it is at least 10 minutes old and a `check` has recorded that the provider has no such payment.
- `blocked_insufficient` means the pool was short. Top up the pool, then `retry`, or `cancel` it. If the content's grade or a tier amount changed while it was queued, so the stored amount is now more than is owed, `retry` gives 409 `share_payout_stale`: `cancel` it and request again, which pays the amount currently due. A queued payout smaller than what is now owed retries as is, and the next request pays the rest.
- `failed` means the provider refused the send, with its code in `error`. A new payout request opens a new record.
- `reconcile` checks up to 20 `pending` payouts older than 10 minutes. `check` and `reconcile` take no `operationId`.
- A paid or queued payout sends the applicant a notice.

| Status | Code | When |
|---|---|---|
| 400 | `invalid_arguments` | Bad `operationId`. |
| 400 | `share_invalid` + `field` | `contentIds` not 1 to 20 unique ids, bad `reason`, or unknown list `status`. |
| 403 | `share_self_payout` | The payer owns the content or the recipient account. |
| 404 | `share_content_not_found`, `share_payout_not_found` | Unknown content or payout. |
| 409 | `campaign_not_payable` | The campaign is a draft or incomplete. |
| 409 | `campaign_payout_closed` | Past the payout deadline (request, batch, retry). Check, reconcile and cancel still work. |
| 409 | `share_nothing_due` | Nothing is owed. |
| 409 | `share_payout_in_progress` | The content already has an open payout. |
| 409 | `share_payout_not_retryable` | Retry on anything other than `pending` or `blocked_insufficient`. |
| 409 | `share_payout_stale` | Retry of a `blocked_insufficient` payout whose stored amount is more than is now owed. Cancel and request again. |
| 409 | `share_payout_not_cancellable` | Cancel outside the rules above. |
| 409 | `share_payout_not_pending` | Check on a payout that is not `pending`. |
| 409 | `campaign_operation_repeated` | The `operationId` was used for something else. |

A batch reports per-item failures as `{ contentId, error: "<code>" }` with the same codes; the request itself still returns 200.
