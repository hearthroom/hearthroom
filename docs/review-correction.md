# Review correction and personal decisions

Human reviewers use `GET /v1/review/decisions` (50 rows, optional numeric `before`
cursor) for their own stamp history. Public metadata is pinned to the reviewed version.
The original stamp and the final submission result are distinct.

`POST /v1/review/:id/correction` takes a UUID `operationId` and a 1–2000 character
`note`. Only final approvals can become rejected. The original approving reviewer has
24 hours from `decided_at`; manager/owner reviewers can correct another person's or
expired approval. Reviewer-agent accounts remain prohibited. Original stamps and
decision timestamps are retained in addition to the correction audit.

An idempotent intent fences the work before Provider correction. Legacy work is enrolled
from issuer approval history, not guessed from draft visibility. Unknown replies retain
the fence and recover using the same intent. Only Provider receipt/current-state agreement
allows the atomic D1 projection, correction notice and completed counter. Scheduled
reconciliation uses the same service. Restoring a previous version does not announce a new
follower publication. A newer approved version is preserved.

Success returns `status`, `operationId`, `replayed`, `publicVersionId`, and `publicState`
(`previous_version`, `unpublished`, or `unchanged`). Rejection reasons remain available
in `GET /v1/mine/reviews/:id`, restricted to the owning member. Correction notifications
link to `/mine/reviews/:id`; push and Discord follow existing opt-in delivery rules.
A queued notification does not prove device delivery or that the author read it.

Paid reward receipts are retained. Only the existing paid retention receipt IDs sent to
Provider are waived; unissued rewards and future awards are not granted by correction.
The award badge/history is retained; no new reward payout is invoked.

MCP/CLI: no reviewer MCP or CLI entry point exists. This site-internal human moderation
workflow is not exposed as an author tool; Provider uses a private issuer command with
the same lineage, epoch and idempotency enforcement.

`hearthroom_review_corrections_total{operation="correct",outcome}` uses fixed
`success/replay/denied/conflict/pending/error` labels. Success increments in the same D1
batch as finalization; replay does not increment it. Read `/metrics` or
`sum by (outcome) (hearthroom_review_corrections_total)` after authorized operations.
No user, card, review, operation or reason is a metric label.

Deploy Provider additive migration/command before the Hearthroom migration and Worker.
Do not use direct SQL state changes or moderation delist/suspend to perform correction.
