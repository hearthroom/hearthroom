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
| Comment `flag` (put a visible comment in the pending queue) | no | no | yes |
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

Comments are published first and reviewed afterwards. A comment that matches a rule (keyword, links, recent removal), reaches the report threshold, or is flagged by the AI stays public; it only gets a `holdReason` and appears in the `held` (pending) tab. `release` clears that reason. Only `remove` takes a comment down, and a comment nobody handles stays public.

### `GET /v1/moderation/comments?tab=held|reported|removed&page=1&reason=`

20 per page. A missing or other `tab` gives 400 `invalid_arguments`. `reason` (one of the `holdReason` values) narrows the `held` tab to that reason; an unknown one gives 400 `invalid_arguments`, and other tabs ignore it.

```ts
{ total: number, items: {
    id: string,
    target: { kind: "card", id, title, cardNumber: number|null } | { kind: "post", id, title, column, slug },
    author: { handle, displayName },
    content: string,
    status: "visible"|"removed",
    holdReason: "keyword"|"new_account_link"|"too_many_links"|"recent_removal"|"reports"|"ai"|null,
    reports: { total: number, byReason: Record<string, number> },
    createdAt: number, moderatedAt: number|null,
    moderationReason: string|null,   // the removal reason, or the AI's flag reason while pending
    suggestedBy: "ai"|null           // "ai" when moderationReason is an AI flag
  }[] }
```

`held` is visible comments with a `holdReason`, newest first; `reported` is visible comments without a `holdReason` that have open reports, most reports first; `removed` is most recently removed first.

### `GET /v1/moderation/comments/stats`

```ts
{ held, openReports, removed7d: number, medianHandleMs7d: number|null,
  holdReasons7d: Record<"keyword"|"new_account_link"|"too_many_links"|"recent_removal"|"reports"|"ai", number>,
  holdRate7d: number|null, reports7d: number }
```

`held` is the number of pending (flagged) comments; `holdRate7d` is the share of the last 7 days' new comments that were ever flagged.

### `POST /v1/moderation/comments/:id/decision`

Body: `{ action: "release"|"remove"|"dismiss"|"flag", reason?: string, operationId }`. Response: `{ id, status: "visible"|"removed" }`.

| action | Who | Effect | `reason` |
|---|---|---|---|
| `release` | human, AI | clears a pending comment's `holdReason` and closes its open reports; 409 on a comment that is not pending | optional |
| `remove` | human | visible comment becomes removed; the author is notified with the reason | required |
| `dismiss` | human | closes the open reports; a comment pending because of reports also loses that `holdReason` | required |
| `flag` | AI only | a visible comment without a `holdReason` gets hold reason `ai` and stays public; on a comment that is already pending or removed it only records the AI's opinion and changes nothing else | required |

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

Each campaign carries `featured: boolean` (recommend on the home page). It is optional on writes and defaults to `false`; a non-boolean value gives 400 `campaign_invalid` with `field: "featured"`. Like the other settings it is part of the whole-object write, so omitting it on `PUT` clears it, and the change is recorded in the audit log. It does not affect activation. The public `GET /v1/campaigns` summaries (and `GET /v1/campaigns/:slug`) include `featured`; the home board shows featured campaigns that are open or upcoming in its carousel.

`posters` optionally maps an exact UI locale (`zh-Hant`, `zh-Hans`, `en`, `ja`, `ko`) to `{ key, alt }`. Upload images through the existing `POST .../banner` route, then save the returned `blog/<file>.webp` key together with a nonempty image description (at most 1,000 characters). Invalid locales, keys or descriptions give 400 `campaign_invalid` with `field: "posters"`. This is also a whole-object setting: omitting it clears the map; preserve other languages when editing one. The same admin, version, operation ID and audit rules apply.

Public activity responses expose only `posterUrls[locale] = { url, alt }`, omitting the map when empty. The home carousel and activity page select only the current locale's poster; a missing locale uses the original banner. A poster replaces the carousel's HTML overlay and its description becomes the image's accessible text. Open Graph previews continue using the original banner. Referenced posters are retained by image cleanup. Creator campaign posters use the same public shape; creator settings currently require an authorized configuration migration.

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

## Card review shadow suggestions (AI account)

A dedicated card-review identity can read card submissions and record an advisory suggestion. A suggestion by itself never changes the submission, and the identity cannot claim, stamp, hold or drop. The one exception is the AI fast track (below): a qualifying update of a live card is approved by a separate system identity right after the verdict is written.

The `/v1/review-ai/queue`, `/v1/review-ai/submissions/*` and `/v1/review-ai/cards/*` routes take only `X-Review-Agent-Key: <64 hex>` (no Harbor sign-in, no expiry). The server keeps only the key's SHA-256 in the `REVIEW_AGENT_CONFIG` secret (`{"memberId","keySha256"}`); requests carrying an `Origin` header are refused. A wrong key, a missing or empty config, or a revoked `review_agents` row gives 403 `review_agent_key_invalid`; a signed-in reviewer or other AI account without the key gives 403 `review_agent_only`. Revoke by clearing the secret or revoking the identity's `review_agents` row. The key works on no other route.

What the AI reads carries no human decision, stamp, note or drop state. Human reviewers see the AI suggestion as soon as they open a pending submission (AI-first review, below).

### `GET /v1/review-ai/queue?scope=pending|recent&unshadowed=1&criteria=v1&count=1&limit=50`

`pending` (default) lists submissions waiting for review; `recent` adds those decided within 7 days of submission (trial runs). `unshadowed=1` keeps only submissions this account has not yet given a verdict for, optionally for one criteria version. `count=1` returns `{ count }`. Otherwise `{ items: { id, cardId, kind: "first"|"re", reopen, submittedAt, rating }[] }`, oldest first.

### `GET /v1/review-ai/submissions/:id`

The sealed version the author submitted, without claiming it. Long text is cut and marked; `stats` are counted on the full text.

```ts
{ submission: { id, cardId, kind, published, reopen, submittedAt, rating, attempt, previous: { status } | null, phase: "shadow"|"backfill" },
  author: { tier, batchSuspected,            // tier and batchSuspected only while pending (null once decided)
            submissions7d, submissions24h, pendingAtSubmit, registrations7d, weeklyLimit, quotaFull,
            medianGapHours, minutesSincePrevious, recentChars, priorApproved, accountAgeDays, deviceAccounts } | null,  // counted up to submission time
  card: { name, summary, tags, originalWork: string|null, userName, setting, speech, instructions, examples,
          openings: { mode: "page"|"greeting", page, welcome, alternates, prologue /* opening choices the player taps */, welcomeRendered /* plain text after display rules, when they match the opening; only on this route, only rules that look safe to run (no nested quantifiers, backreferences or lookarounds; first 20 rules, first 2,000 characters) */ },
          lorebook: { entryCount, constantCount, recallCount, index: { name, chars, constant, keywords, mentionedInCard }[], entries: { name, content }[] },
          rules: { count, enabled, list: { name, findChars, replaceChars }[], hasCardCss } },
  originality: { available: false } | { available: true, similarity, earlierMax, sources },  // setting overlap with other authors' cards, numbers only
  update: null | { state: "no_base"|"unreadable"|"missing" } | { state: "ready", baseKind, summary, fields: { key, before, after }[], lorebook: { added, removed, modified } },
  stats: { settingChars, openingChars, openingPageChars, openingPageHtmlChars, openingPageElements, openingPageInteractive, openingPageScript, openingHtmlTags, openingOptions, openingRuleHits, lorebookConstantChars, alternateCount, lorebookEntries, lorebookChars, ellipsisPer1k, dashPer1k, openingQuestion, openingChoices },
  allowed: { verdicts, reasons, flags, handoffCauses } }
```

`phase` is `shadow` (pending), `backfill` (decided, submitted within the last 7 days) or `closed` (decided earlier). Closed submissions can still be read, for example to open an author's other cards, but suggestions and tags can only be written for `shadow` and `backfill` (410 `review_ai_window_closed` otherwise). A superseded or withdrawn submission gives 410 `review_ai_window_closed` for reads too. Content the host can no longer read gives 404 `content_unavailable`.

### Evidence for the AI reviewer

The same evidence a human reviewer has on the review page, for the AI key only (403 `review_agent_only` for signed-in reviewers, 401 without sign-in). Each route under `/submissions/:id` accepts the submissions the read route accepts (pending, or decided at any age). Responses never contain member ids, Harbor account numbers, handles, device hashes or reviewer identities. The AI side stays blind to the human decision: nothing here reveals the human decision on the submission being read.

- `GET /v1/review-ai/submissions/:id/originality` → `{ available: false, reason: "no_snapshot"|"too_short" }` or `{ available: true, similarity, units, comparedCards, sources: { cardId, name, status: "approved"|"pending"|"removed", earlier, firstSeenAt, similarity, overlapChars, overlap: string[], clipped }[] }`. It is the review page's report (up to 5 sources; the author's own cards are excluded). `overlap` holds the passages of this card's setting that match that source. They are taken from this submission's own text, so they stay readable when the other card is pending or removed. The overlap text across all sources is capped at 4,000 characters, split evenly; `overlapChars` is the uncut length.
- `GET /v1/review-ai/submissions/:id/author` → `{ asOf, accountAgeDays, prior: { approved, rejected, rejectReasons: { [code]: n } }, submissions: { last7d: { newCard, update }, last30d: { newCard, update }, newCardLast24h }, deviceAccounts, tier, batchSuspected, marks: { kind: "tier"|"batch", value, reason, note, at, expiresAt }[], authorNote: { note, updatedAt } | null }`. Counts run up to `asOf`: now for a pending submission, the submission time for a decided one. `prior` counts the author's decided submissions before `asOf`, excluding this one and reviewer-opened re-reviews. `newCard` means the card had no approved version when it was submitted, and `update` means a new version of a live card; this submission is included. `deviceAccounts` is the number of accounts on the device that registered the card. `tier`, `batchSuspected` and `marks` (the reviewers' current author marks with their reason and note) are given only while the submission is pending; once it is decided they are `null`, `null` and `[]`. 404 `author_unknown` for legacy submissions without a hosted version.
- `GET /v1/review-ai/submissions/:id/author-cards` → `{ total, similarityAvailable, items: { cardId, name, status, live, latest: { id, kind, reopen, status, submittedAt, decidedAt, chars } | null, settingSimilarity }[] }`, newest registration first, at most 100. This card is left out, because its status is the decision being judged. `latest.id` opens with the read route. `settingSimilarity` is the share of this submission's setting that also appears in that card, measured with the same fingerprints as originality but counting the author's own cards. A high value means one setting template reused across cards. It is computed for the 30 most recently registered cards in the list and is `null` for the rest, and for cards with no indexed text (rejected and superseded versions leave the index). `similarityAvailable` is false, with every value `null`, when this setting is too short or unreadable, or when the comparison is too large to finish.
- `GET /v1/review-ai/cards/:cardId` → `{ cardId, card, stats }` for the version of the card that is live now, in the read route's `card`/`stats` shape. 404 `card_not_live` when the card is not approved, is blocked from public view, or its approved version is blocked; 404 `card_not_found`; 404 `content_unavailable` when there is no hosted version or the host cannot read it. This route has no submission context, so asking for the card of a decided trial submission shows whether it went live. Use it for the author's other cards.
- `GET /v1/review-ai/submissions/:id/author-note` → `{ note, updatedAt }` (`""`/`null` when none) and `PUT` with `{ note }` (≤2,000 characters, trimmed; an empty note deletes it) → the stored `{ note, updatedAt }`. One note per author, resolved from the submission and shared across all of that author's submissions; a new PUT overwrites it. Too long or not text gives 400 `invalid_arguments` with `field: "note"`. Notes are stored in `review_ai_author_notes` and are never shown to authors or on any author-facing or public route.

### `PUT /v1/review-ai/submissions/:id/suggestion` and `PUT /v1/review-ai/submissions/:id/tags`

Body: `{ criteriaVersion: "v<n>", model, verdict: "pass"|"reject"|"handoff", reasons?: string[], flags?: string[], confidence?: 0..1, note?: string (≤400), handoffCause?, inputTokens?, outputTokens?, costUsd?, latencyMs? }`. Codes must come from `allowed`; `reject` needs at least one reason or flag; `pass` takes no reasons; `handoff` defaults its cause to `unsure`. One record per account, criteria version and submission: sending again overwrites it. The `tags` route takes `{ criteriaVersion, model, flags }` and keeps any verdict already written. Response: `{ id, verdict, phase, criteriaVersion }`.

### AI fast track (2026-11-25)

After a `suggestion` write on a pending submission (`phase: "shadow"`; never on `tags` writes or `backfill`), the server checks the fast track once. When every condition holds the submission is approved through the ordinary stamp path; otherwise nothing happens and it stays in the human queue (an AI error, timeout or missing verdict leaves it there too). The agent's response does not change. Conditions, checked in this order:

1. Nobody has handled it: still `pending`, no stamp, no recorded managed-work decision, no live human claim (else `skipped_decided`).
2. Live-card update (else `ineligible_status`): not a correction review (`flip_of`) or re-review (`reopen_of`); no hold; not dropped, no open not-accepted case for the card, not a resubmission after a drop; the card's previous decided author submission was approved (a resubmission after a rejected update goes to humans); the card is `approved` with a published version whose submission is still approved and version state `approved`; not delisted, blocked or suspended (`board_hidden`, `public_blocked`, `moderation_blocked_versions`, an open `moderation_cases` row, managed-work access not `public`/restriction not `none`/sync not complete); no correction in flight on the published submission.
3. Same rating (else `ineligible_rating`): the submission's `rating` equals the card's current rating (manager corrections and the rating floor included) and its `rating_descriptors` equal the card's as a set.
4. AI verdict `pass` under the current criteria version, which must be set or derivable (else `ineligible_verdict`; `reject`, `handoff` and older criteria versions included).
5. No review flags (`ai_unedited`, `copied_text`, `mass_produced`; else `ineligible_flags`).

Approval: the system identity `system:ai-fast-track` (not a member or reviewer row, cannot sign in) claims the submission like a reviewer, then stamps `approve` with that claim, so the claim, hold and drop guards apply in the same write; a human claim taken in between makes it skip. This one stamp is enough whatever `STAMPS_REQUIRED` says. Publication, the author's approval notification, follower update notices, card rewards and the rating floor run exactly as for a human approval. The stamp's review event has `actor_kind = 'system'` (not counted as reviewer work), `final_source = 'ai_fast_track'` and the suggestion id; an `audit_log` row (`subject_kind = 'review_submission'`, `actor_kind = 'ai'`, action `review_fast_track_approve`) carries `criteriaVersion`, `reasons`, `flags`, `suggestionId` and `model`. Every check also writes a `fast_track_check` review event whose `source` is the outcome. Human reviewers cannot send `finalSource: "ai_fast_track"` (400 `invalid_arguments`).

Revoke: a manager uses the ordinary correction, `POST /v1/review/:id/correction` with `{ operationId, note }` (the note is the rejection explanation the author sees). The update becomes rejected, the public version falls back to the previous approved version, and the author gets the correction's rejection notice ("corrected from approved to rejected", with the note). Only managers can correct a fast-track approval, since no reviewer stamped it.

Records: `GET /v1/review/decisions?source=ai_fast_track` (managers; 403 otherwise, any other `source` is 400) lists fast-track stamps instead of the caller's own, with `finalSource: "ai_fast_track"` and `canCorrect` (no 24-hour limit). `GET /v1/review/:id/detail` marks the system stamp with `finalSource: "ai_fast_track"`. The report adds `fastTrack: { approved, eligible, rate, revoked }` per criteria version (`eligible` = submissions with at least one check that passed conditions 1–3, `rate = approved / eligible`, `revoked` = fast-track approvals later corrected) and counts `ai_fast_track` under `finalSource`; fast-track decisions are left out of the human-versus-AI matrix.

Metrics: `hearthroom_review_fast_track_total{operation="evaluate",outcome="approved|ineligible_status|ineligible_rating|ineligible_flags|ineligible_verdict|skipped_decided|error"}` and `hearthroom_review_fast_track_revokes_total{operation="revoke",outcome="success"}` (counted in the correction's completing write). Example: `sum by (outcome) (increase(hearthroom_review_fast_track_total[1d]))`.

### Finalizing with the AI suggestion (human reviewers)

The review page finalizes in one step through `POST /v1/review/:id/stamp`. Drops, holds and re-reviews are unchanged.

- `finalSource`: `ai` (stamp the AI verdict and its reason codes; 409 `ai_choice_unavailable` when the AI has not decided or has no reason code; send the shown suggestion's `aiSuggestionId` and `aiSuggestionAt` to get 409 `ai_changed` if the AI re-judged in between; `verdict` is optional and only needed to send `marks`), `modified` (stamp the decision in this body), or `human_no_ai` (no AI suggestion to compare; stamp the decision in this body; recorded as `modified` if the AI verdict arrived meanwhile). `modified` and `human_no_ai` need `verdict` (400 otherwise). Any other value, including the retired `blind`, is 400 `invalid_arguments` with `field: "finalSource"`. Without `finalSource` the route stamps as before (older pages).
- Optional `aiNoteTypes` (any of `card_content`, `author_relation`, `author_history`, `criteria_issue`, `other`, `ai_inaccurate`) and `aiNote` (≤500 characters) go into the same review event; they are for review tuning only and never reach the author. The stamp response returns the recorded `finalSource`, and the detail route's `submission.stamps[]` row with `mine: true` carries it too (older decisions may show `blind`).
- The comparison report uses the final decision as the human side, and adds `finalSource` counts (the share of changed AI calls is `modified / (ai + modified)`) and `inaccurate`.
- `GET /v1/review-ai/notes?type=&from=&to=&limit=100` (managers) lists the notes and reason types written at finalization and arbitration, newest first, without reviewer identities.

The double-blind step (`POST /v1/review/:id/blind`, the detail route's `myBlind`) is removed. Earlier blind judgments stay in the database as history and are no longer read.

### Rating correction (managers)

`POST /v1/moderation/cards/:id/rating` with `{ rating, reason, operationId }` (`rating` one of `G`, `P`, `PG12`, `PG15`, `R`; reason 1–500 characters; operationId a UUID). Managers and owners only; not on your own cards; setting `R` needs age verification. Applies directly (no proposal or vote): the card, its published version and any pending submission get the new rating; an `audit_log` row (`rating_correction`) and a card history event (`moderation_events.action = 'rating'`) are written; and the rating becomes the card's rating floor. Raising and lowering are both allowed; the floor follows. Returns `{ cardId, before: { rating, versionRating }, rating, floor }`; `409 rating_unchanged` only when both the card's rating and its floor already equal `rating`. When the rating already matches but the floor differs (or there is none), the call only locks the floor (`lockOnly: true`, history event `rating_floor`); the card's rating is unchanged. Any older version of the card rated below the floor is raised too. The author is not notified.

When the author submits again, a questionnaire rating below the floor is raised to the floor (server-enforced). Pending submissions are raised to the floor (never lowered), a re-review opened later takes the higher of the original rating and the floor, and a database trigger keeps `cards.rating` at or above the floor on every write (approval, rollback to an older version). Replaying the same `operationId` returns the stored result; reusing it for a different card or rating is `409 moderation_conflict`. `GET /v1/moderation/cards/:id` returns `card.rating`, `card.cardNumber` and `card.ratingFloor`, and the author's `GET /v1/cards/:roleId/rating-draft` and begin-edit response (`POST /v1/cards/:roleId/edit`) include `ratingFloor` when set (author only), so the editor can disable lower ratings. Metric: `hearthroom_rating_correction_total{operation="correct",outcome="applied|unchanged"}` and `{operation="floor",outcome="raised"}`.

### Change a rejection to approved (managers)

`POST /v1/review/:id/flip` with `{ operationId, reason }` (operationId a UUID; reason 1–500 characters, required). Managers and owners only (`403 review_flip_manager_required`). The target must be a rejected author submission (not a re-review) whose sealed version is still rejected (`409 review_flip_not_rejected` / `review_flip_unavailable`; for a managed work the version's publication permit must still be `prepared`). The call never approves directly: it opens a **correction review** — a new pending submission on the same sealed version (same content hash, kind and rating, raised to the card's rating floor), with the review snapshot copied (rebuilt from the sealed revision if the original's retention has expired), originality fingerprints re-indexed with the original submission time, and the update diff copied. Returns `201 { id, flipOf, replayed: false }`. Replaying the same `operationId` returns `200` with the stored `id` and `replayed: true`; reusing it for another submission is `409 moderation_conflict`. An open correction review for the same submission is `409 review_flip_exists` with `flipId`. If the author has submitted again since (any newer author submission, whatever its result) the call is `409 review_flip_superseded` with `latestSubmissionId` and `latestSubmittedAt`. An `audit_log` row (`review_flip_approve`, subject `review_submission` = the original id) records the reason.

The correction review is claimed by the manager who opened it and only that manager can work it: others cannot claim it (`409 review_flip_initiator_only`), the queue shows it as `claim: "other"` to everyone else, and the 45-minute claim timeout does not apply. Hold and not-accepted (drop) do not apply (`409 review_flip_no_hold`, `review_drop_flip`). Its decision is either approve through `/stamp` (the review page sends `finalSource: "human_no_ai"` with `verdict: "approve"`, since the AI never judges correction reviews) or `POST /v1/review/:id/flip/withdraw` (initiating manager only, no claim needed) which rejects the correction review, keeps the original rejection and sends the author nothing. A reject verdict through `/stamp` is `409 review_flip_use_withdraw`. If the author submits again while the correction review is pending, it is retired (`superseded`) and the author's submission goes through normally.

Author side: until approval nothing changes — the sealed version stays linked to the original rejected submission, so the card status, "my cards", the review result page and review status keep showing the rejection, and a pending or withdrawn correction review is never returned to the author. On approval the version moves to the correction review in the same write, the card is published as for any approval, and the author gets the ordinary approval notification (followers get the usual new-work or update notice). The original rejection page stays readable.

Reviewer views: queue items carry `flip: { by, at, rejectedAt, mine, reason? }` (`reason` for managers only); `GET /v1/review/:id/detail` adds `submission.flip` on a correction review (`of`, `by`, `mine`, `at`, `rejectedAt`, original `reasons` and `note`, `reason` for managers; other managers may open it read-only) and `submission.flipState` on every submission (`pendingId`, `approvedId`, `canStart`, `supersededBy`); `GET /v1/review/decisions` items and `GET /v1/moderation/cards/:id` reviews carry `flip: { pendingId, approvedId, canStart }`. Correction reviews are excluded from the AI queue (`/v1/review-ai/queue`, `409 review_flip_not_for_ai` on suggestion writes) and therefore from AI-versus-human statistics; a withdrawn correction review is not counted as a decision in review statistics. Metric: `hearthroom_review_flip_total{operation="start|approve|withdraw|retire",outcome="success|replay|denied|conflict|superseded"}`.

### Author activity (human reviewers)

`GET /v1/review/:id/author-activity` (same gate as the review detail) returns the author's recent behaviour as numbers only: `weekly: { used, limit, deviceShared }` (this UTC week's free registrations and the actual limit), `submissions7d`, `submissions24h`, `pendingNow`, `avgGapHours`, `minutesSincePrevious` (this submission vs the author's previous one), `recent: { at, chars, status, kind, current }[]` (last 7 days, newest first), `deviceAccounts`, `priorApproved`, `accountAgeDays`, and `anomalies: { code, value }[]` with codes `burst_long` (3+ submissions of 1,500+ effective characters within 12 hours), `quota_full`, `quick_gap` (under 30 minutes after the previous one and 1,000+ characters), `device` (3+ accounts on the registering device) and `device_heavy` (5+). Anomalies are hints only; nothing is decided automatically.

Metric: `hearthroom_review_author_activity_total{operation="read",outcome="success"|"denied"|"error"}` (counter; `denied` covers every 4xx such as no live claim, not a reviewer or unknown author). Check with `curl -s .../metrics | grep hearthroom_review_author_activity_total` or PromQL `sum by (outcome) (increase(hearthroom_review_author_activity_total[1d]))`.

### Current criteria version

The AI review block, the finalize and the disagreement list compare against one criteria version at a time. `GET /v1/review-ai/criteria` (AI identity key or any reviewer) returns `{ current }`; `PUT /v1/review-ai/criteria` with `{ version: "v<n>" }` sets it (AI identity key or managers). Without a setting, the newest version the AI used in the last 7 days counts. Suggestions from other versions are kept but not used for comparison; when the current version has not judged a card yet, the AI state is `pending`. `GET /v1/review/:id/ai` returns `current` next to `suggestions`; `GET /v1/review-ai/disagreements` defaults to the current version (`criteria=all` lists every version) and echoes the `criteria` it used.

### Retention after a decision

The review snapshot (originality text) is kept for 7 days after a decision so reviewers can re-check and arbitrate; when the final decision differs from the AI it is kept up to 14 days, shortened back to 7 days once arbitrated. A scheduled job deletes expired snapshots. During retention the detail route returns the full sealed version to the stamping reviewer and managers, with `retainUntil`; afterwards `retainUntil` is null and only public data remains.

### AI suggestion and the inaccurate mark (human reviewers)

- `GET /v1/review/:id/ai` → `{ suggestions: { id, criteriaVersion, model, verdict, reasons, flags, confidence, handoffCause, note, authorNote, phase, at }[], current, inaccurate }`. Any reviewer while the submission is pending; once decided, the reviewers who stamped it, the reviewer whose drop is still active, and managers; otherwise 403 `ai_hidden_until_decided`. `inaccurate` is the "AI judgment inaccurate" mark recorded on the latest final decision (false when there is none).
- `PUT /v1/review/:id/ai-inaccurate` with `{ inaccurate: boolean }` → `{ inaccurate }` sets or clears that mark after the decision. Allowed for a reviewer who stamped the submission and for managers (403 `ai_inaccurate_not_allowed` otherwise); the submission must be approved or rejected (409 `review_not_decided`; before the decision send `aiInaccurate: true` with the stamp) and its latest final decision must have an AI pass or reject to compare with (409 `ai_inaccurate_unavailable`). It updates the `ai_inaccurate` reason type on that final decision's review event, so the report's `inaccurate` counts each submission once; resending the same value writes nothing. A non-boolean value is 400 `invalid_arguments` (`field: "inaccurate"`).
- The double-blind feedback route (`POST /v1/review/:id/ai-feedback`) is removed. Feedback recorded earlier still appears in the report's `feedback` and in the disagreement detail.

### `GET /v1/review-ai/report?from=&to=&criteria=` (managers)

Human vs AI by criteria version for submissions sent in the window (default the last 7 days, at most 120) that a human has already decided or dropped; pending ones are left out so the report never shows an AI verdict before a decision. It returns totals, the decision matrix (approved / rejected / dropped × pass / reject / handoff), `agreement` over submissions both sides decided, `aiStricter` (human approved, AI rejected), `humanStricter`, per-reason agreement on rejections, flag counts, handoff and refusal rates, reviewer feedback, average latency and cost.

### Disagreement arbitration (reviewers)

Any human reviewer can arbitrate; the report and the reference export stay manager-only. Reviewers review only the submissions where the human decision and the AI verdict point opposite ways: `ai_stricter` (human approved, AI rejected) or `human_stricter` (human rejected or dropped, AI passed). Handoffs and undecided submissions are not disagreements. Arbitration never changes the decision and never notifies the author.

- `GET /v1/review-ai/disagreements?state=open|done|all&direction=&criteria=&reason=&limit=20&offset=0` (excludes the caller's own cards) → `{ total, items: { suggestionId, submissionId, cardId, name, direction, criteriaVersion, human: { decision, reasons, at }, ai: { verdict, reasons, flags, confidence, at }, arbitration }[], persuasion: { weekStart, convinced, rated, suppressed } }`, oldest first; `open` (default) means never arbitrated; `reason` matches either side. `persuasion` is this UTC week (Monday 00:00 UTC, by when each rating was last changed) across all disagreements regardless of the filters: one rating per reviewer per disagreement, `suppressed` when `rated` is under 10 (show counts, not a ratio).
- `GET /v1/review-ai/disagreements/:suggestionId` → `{ submission, direction, human: { decision, reasons, note, at, stamps: { verdict, at, reviewer }[], feedback }, ai: { …, note, model }, arbitrations, myPersuasion: "convinced"|"not_convinced"|null, content: { state: "ready", card, stats } | { state: "unavailable" }, update }`. `myPersuasion` is the caller's own latest rating; other reviewers' ratings are never returned. Reviewer and arbiter names are returned only to managers (`null` for other reviewers) and never appear in reports or exports. A reviewer never sees their own cards here (404 on detail and arbitration). `content` is the same sealed version the AI read.
- `POST /v1/review-ai/disagreements/:suggestionId/arbitration` with `{ value: "human_right"|"ai_right"|"both_ok"|"both_wrong", addToReference?: boolean, note?: string (≤500), noteTypes?: string[], operationId }` → `{ id, value, referencePool: "pass"|"reject"|null }`. Only `human_right` and `ai_right` can add a reference (400 `reference_needs_a_winner` otherwise); the pool is the winning side's verdict. Re-arbitrating adds a new record; the latest counts. Resending the same `operationId` returns the stored record; reusing it for another value gives 409 `arbitration_operation_repeated`. A suggestion that is not a disagreement gives 404 `disagreement_not_found`.
- `PUT /v1/review-ai/disagreements/:suggestionId/persuasion` with `{ value: "convinced"|"not_convinced" }` → `{ value, updatedAt }`: whether the AI's reasoning convinced the caller, separate from who was right; it does not touch arbitrations, review events or snapshot retention. Any reviewer who can open the disagreement may rate it (404 `disagreement_not_found` for their own cards and non-disagreements, 400 `invalid_arguments` for another value). One rating per reviewer per disagreement: changing it overwrites the previous choice, and resending the same choice only refreshes `updatedAt`.
- `GET /v1/review-ai/reference-candidates?criteria=&limit=30` → `{ items, skipped }`: suggestions whose latest arbitration added them to a pool, shaped like a criteria `references` entry (`verdict`, `reasons`, `flags`, empty `why`, `originalWork`, `tags`, `excerpt: { opening, setting }` of at most 600 characters each). No accounts or ids. `skipped` counts candidates whose content the host could no longer read.
- The report's version rows gain `arbitration: { values: { human_right, ai_right, both_ok, both_wrong }, reasons: { [code]: { humanWrong, aiWrong } } } | null` and `persuasion: { convinced, rated }` (latest rating per reviewer per disagreement, same submission window as the rest of the report; present even without arbitrations).

Metrics: `hearthroom_review_two_stage_total{operation="final",outcome="ai"|"modified"|"human_no_ai"}`, `hearthroom_review_retention_purged_total`, `hearthroom_review_ai_operations_total{operation,outcome}` (ratings use `operation="persuade"`, the inaccurate mark after a decision `operation="inaccurate"`, e.g. `sum by (outcome) (hearthroom_review_ai_operations_total{operation="persuade"})`; the evidence routes use `operation` = `originality`, `author`, `author_cards`, `card`, `author_note_read`, `author_note_write`), `hearthroom_review_ai_verdicts_total{verdict,outcome="shadow"|"backfill"}` and `hearthroom_review_agent_key_admissions_total{operation="admission",outcome}`.

### AI author note (two columns)

A suggestion may carry `authorNote` (up to 1,500 characters): a draft of the detailed explanation shown to the card's author, about the card itself only. `note` stays the reviewers-only explanation and may cite author signals. The server rejects an `authorNote` that mentions internal signals (submission quota, submission count or pace, devices, accounts, scores or confidence, author tier) with `400 author_note_internal` and `{ field: "authorNote", terms, hint }`. Reveal (`GET /v1/review/:id/ai`) returns `authorNote` on each suggestion. Finalising with `finalSource: "ai"` uses the AI's `authorNote` as the note to the author for a rejection; send `authorNote` to use an edited version. The same check applies to that edited text and to the note in a `modified` final decision (`400 author_note_internal` with `terms`).

### AI-first review (2026-11-24)

The double-blind step is removed. `GET /v1/review/:id/ai` returns the AI suggestion to any human reviewer while the submission is pending. Finalising via the stamp route with `finalSource`: `ai` takes the AI decision (reasons and its `authorNote`, or an edited `authorNote`); `modified` sends the normal decision body when the reviewer changed anything; `human_no_ai` sends the normal decision body when there is no AI suggestion (recorded as `modified` if a suggestion exists by then). Optional `aiInaccurate: true` marks "the AI's call was inaccurate" (stored as the `ai_inaccurate` note type; it can be changed after the decision with `PUT /v1/review/:id/ai-inaccurate`). Every AI `reject` must carry `authorNote` (`400 author_note_required` otherwise). Reject reasons gain `decline.burst_similar` and `decline.not_ready` (reason version 3), also allowed for the AI. The report's version rows add `inaccurate`; with `finalSource` counts, the share of changed AI calls is `modified / (ai + modified)`. Seeing the AI before deciding is the normal flow, so no decision is excluded from the report or the disagreement list for it.

Approve with suggestions: when an approval carries `suggestions`, its `note` is delivered to the author (stored on the submission and shown on the author's result page `GET /v1/mine/reviews/:id` as the reviewer's note) and goes through the same internal-term check as rejection notes (`400 author_note_internal`); a suggestion of `other` needs a non-empty note (`400 review_other_needs_note`). An approval without suggestions keeps its note on the stamp only.
