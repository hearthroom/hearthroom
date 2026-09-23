# LunaTalk retirement: migration release

Owner decision, 2026-09-23: permanently remove LunaTalk from Hearthroom after
attempting to move eligible existing cards to their authors' linked HarperHarbor
accounts. The subsequent release removes login, hosting, play and synchronization.

This intermediate release preserves both hosts while the operator migrates cards.
It does not delist cards, remove connections, change billing, or move conversations.

`POST /internal/retirement/migrate` accepts `{cardNumber, draft?: true}` and requires
the existing Harbor issuer secret in `X-Retirement-Key`. Credentials never appear
in responses. Accounts and the current approved version are resolved server-side;
the operator cannot nominate a recipient or supply arbitrary content. Both grants
use the same generation-fenced refresh as normal account recovery. Identity and
effective community connections are rechecked. Drafts use the existing conflict-safe
sync service. Approved versions use immutable transfer, image-byte/content readback,
and promotion; an already-ready replica is checked for reachability and ownership.

Run draft and approved-version attempts independently. Missing/revoked grants and
content conflicts are explicit failures, not successful migration. Retain private
operator receipts outside this public repository. Existing card numbers, community
authors, reviews, favorites and comments must survive the later ownership cutover.
Do not disconnect or delete credentials until all eligible attempts have receipts.

The internal route is temporary and must be removed in the retirement release.
HTTP/MCP parity is not applicable: this is a bounded operator migration, not a
new public authoring capability or HarperHarbor API.

Observability uses the existing counter `hearthroom_auth_operations_total` with
`operation="retirement"`, `provider="harbor"`, and outcome `ready`, `denied`, or
`unavailable`, emitted after authorized attempts. No identifiers or content are
labels. Query: `sum by (outcome) (hearthroom_auth_operations_total{operation="retirement"})`.
Durable transfer states remain in `hosting_transfers` and `work_copies`.

Validation: operator denial, approved-version selection, account mismatch rejection,
existing-copy idempotency, and unpublished draft synchronization; existing OAuth
and hosting suites plus the full Worker/web trusted sets. Deployment and actual
migration receipts are separate from local verification.
