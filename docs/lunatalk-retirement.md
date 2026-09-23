# Permanent LunaTalk retirement

Owner decision: migrate eligible Hearthroom cards to their authors' existing linked
HarperHarbor accounts, then permanently retire all LunaTalk sign-in, hosting,
synchronization and play wiring. An unavailable migration is recorded as a failure;
it is never treated as permission to publish a different draft.

Existing images remain at their Luna CDN URLs by owner decision (2026-09-24).
Retain image display, export and installation-icon reads; do not force image
migration or author re-uploads. Future uploads use Harper.

## Source changes

Harper is the sole configured and advertised provider. Old explicit provider requests
and play URLs fail closed. Old Luna site sessions and OAuth callbacks cannot become
Harper credentials. Browser cleanup preserves correctly scoped Harper credentials.
The editor no longer offers destination selection or cross-service saves. Linking and
sync write endpoints return 410. Unmigrated cards are absent from boards, author/tag
aggregates and sync jobs; their public card and installation URLs return 404.
Board cache keys and public snapshot namespaces invalidate pre-retirement projections.

Preserve inert historical identity, review, moderation and registration records where
needed for community ownership, audit and quota. Removing a provider is not deleting
members, comments, favorites or review history. The provider identity union permits
historical database rows; active requests and network routing accept only Harper.

## Ordered operational cutover

1. Publish the migration-only release and verify its exact CI source and live route.
2. Inventory authored works, including unlisted drafts, using effective
   `member_connections` ownership before `member_identities` fallback. Mere viewed
   card-number records are not author inventory.
3. Attempt current approved versions and editable drafts independently. Use saved
   grants through the fenced refresh service. Confirm both upstream accounts;
   immutable copies require content and media-byte readback. Reuse reachable,
   author-matched ready replicas. Keep private per-work receipts outside git.
4. Re-read mappings after attempts. Choose an actually verified Harper draft, not an
   unverified operation ID from an old transfer receipt. Check that it belongs to the
   linked author and is not separately registered or numbered. A conflict blocks that
   work's cutover; do not delete someone else's identity or assign a new public number.
5. In a guarded transaction per work, retain work ID, community member, card number,
   comments, favorites, rating, review/version identity and moderation restrictions.
   Rehome canonical work/card/number locators to Harper; replace the current hosted
   locator and public projection only from the verified equivalent version. Carry
   registration timestamps and moderation mappings forward. Remove the Harper
   `work_copies` row once that draft becomes canonical. Supersede pending Luna reviews
   without promoting their edited content. Read the resulting cards back.
6. Only after every eligible attempt has a receipt, deploy this removal release and
   remove the temporary migration route. Remove retired grants, site sessions,
   OAuth clients/attempts and the Luna issuer secret through the authorized operator
   path. Preserve necessary identity history. No conversation-body or wallet transfer
   is included. Verify the public board, old-card denial, Harper authoring and play.

Do not deploy the removal source before the migration/canonical-source cutover.
Do not automatically delete audit tables or historical migration files.

## Verification and applicability

Red/Green covers sole-provider routing, retired token/callback rejection, legacy
credential cleanup, unavailable-card listing/installation, cross-service endpoint
retirement and stale board-cache isolation. Existing Harper ownership, review,
moderation, quota, editor, resources and player tests remain in the full trusted set.
Tests specific to deleted linking, transfer and destination-selection capabilities
are retired with those capabilities, replaced by denial/Harper behavior tests.

Local typecheck and build are distinct from browser evidence. At preparation time,
the runtime exposed no browser surfaces; both Chrome and in-app browser creation
returned unavailable. UI acceptance is BLOCKED, not passed. Required journey when
available: anonymous login has only Harper; existing Harper sign-in retains community
identity; save/edit has no destination chooser; migrated numeric URLs play through
Harper; old Luna URLs fail; check Traditional Chinese and English at narrow width.

MCP is not applicable: no community MCP transport exists, and retirement adds no
public authoring workflow. Existing auth, HTTP, review and library counters remain
useful; no new high-cardinality metric is introduced. Migration-only metrics use
`hearthroom_auth_operations_total{operation="retirement",provider="harbor"}`.
Post-deploy readback must include `/v1/providers`, public board and representative
card URLs, rejected Luna requests, and durable migration receipts. No production
migration or deployment is implied by local test results.
