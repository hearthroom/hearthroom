# HearthRoom hosting version contract v1

Decision accepted by the owner on 2026-09-19. **Implementation candidate; deployment evidence is recorded separately.** This supersedes the proposed portable SHA standard. The normative
source is this file in HearthRoom; HarperHarbor keeps an identical contract copy.

## Implemented rollout boundary

The initial compatible host is HarperHarbor. `POST /open/v1/hosting/seal` requires a
backend `X-Hosting-Key` and author OAuth `role.read` + `role.write`. It clones the complete
configuration and dependencies into an immutable role in one PostgreSQL transaction.
The sealed role is hidden from authoring lists and protected by database triggers.
External mutable media must be replaced with a retained upload before sealing.

HearthRoom registration uses an `operationId`, seals the source, and reads that exact
revision for its temporary review snapshot. It keeps the previously approved projection
while updates wait or fail review. Private review reads require the reviewer's live claim.
The decision route is `/v1/hosting/versions/{versionId}/decision`; its public metadata is
trusted only through the host's fixed HTTPS authority, with redirects rejected. Each
public read and new generation checks it again, without an approval cache. Existing
conversations pin their sealed role; an approved older version remains authorized while
the work remains published. Withdrawal revokes every old version of that registration.

See [OpenAPI](hosting-versions-v1.openapi.json) for implemented wire operations.
Cross-provider immutable import is not implemented in this rollout. Both existing hosts
can store and synchronize editable drafts, but an unsealed copy is never advertised as
a ready public copy of a reviewed version. LunaTalk keeps its legacy review path; no
legacy approval is promoted into a v1 approval.

Runtime configuration: both backends receive the same backend-only
`HOSTING_SERVICE_KEY`; HarperHarbor also receives `HOSTING_AUTHORITY_URL` pointing to the
HearthRoom origin. Never place the key in frontend assets. Missing configuration fails
closed. Activate the host before deploying the new issuer/client workflow.

## Outcome and scope

HearthRoom owns works, version issuance, community review and publication. SaaS providers
store immutable versions and supply execution and credits. A work stored on three hosts
is still one work and consumes one distinct-work publication slot. Connecting another
SaaS account does not increase the community account's publication allowance.

Acceptance: one submitted version receives one HearthRoom review; every available host
serves that exact version; changing a draft cannot change the approved version. The
community's existing three-work allowance remains community-account scoped. This contract
does not change its time window or increase it per host.

Not included: removing providers, migrating accounts, billing changes, declaring existing
cards approved under the new model, or deployment. Existing local content hashes may
remain for edit conflict detection, deduplication and transport checks; none are review
authority and no common cross-host hash algorithm is required.

## Identity

| Field | Meaning and authority |
| --- | --- |
| `issuer` | Configured HearthRoom authority. A caller-supplied URL never establishes trust. |
| `workId` | Opaque, stable HearthRoom work identifier; bound to its community author. |
| `versionId` | Opaque ID minted by HearthRoom for a frozen version. It is not a hash, a sequential revision number, or a user/account identifier. |
| `hostedRevisionId` | Host-issued receipt identifying the immutable stored revision. It is distinct from a mutable draft's `roleId`. |
| `decisionRevision` | Reserved for a future signed-lease protocol; live decision lookups in this implementation carry no cached approval or asynchronous decision messages. |

The identity of a version is `(issuer, versionId)`, permanently bound to one `workId`.
The identity of a hosted copy includes its provider and owning account. Local role,
Lorebook and media IDs may differ between hosts without creating a new work or version.
Do not expose internal account UUIDs in receipts or public responses.

Possession of `versionId` is not authorization. A record that says `approved` is only
authoritative when obtained from the configured issuer through authenticated service
communication, or through an equivalent issuer-authenticated, audience-bound assertion.
The browser, author token, editable metadata and arbitrary external issuers cannot
approve a version.

## Save, seal, review and synchronize

1. Saving writes editable drafts to the selected hosting services. Saving is not
   publication or a review request. Draft playback remains owner-authorized.
2. Submitting to HearthRoom verifies community membership, linked account ownership,
   work ownership and the community quota. HearthRoom allocates a `versionId` for the
   submitted content. Retrying the same submission uses the same operation identity;
   changing the submitted content requires a new operation and version.
3. The source host seals a coherent snapshot, including all dependencies, and returns
   `hostedRevisionId`. HearthRoom binds this receipt to the issued version and obtains
   **that stored snapshot** for review. Do not review a pre-save document while freezing
   a later read of a mutable draft.
4. HearthRoom records `pending`, then `approved` or `rejected` for the exact version.
   Author-declared content rating belongs to that review submission. Review snapshots
   may be temporarily retained by HearthRoom and removed at the end of review; the
   durable content stays on the SaaS. Author credentials must not be persisted merely
   to support this workflow.
5. Adding a host transfers the sealed version, using an authenticated HearthRoom
   operation plus the author's authorization for the target account. The host stores
   a new immutable revision and returns a durable receipt. HearthRoom validates and
   records that receipt before advertising the copy as ready. It does not ask the host
   to perform another community review or call its legacy `/publish` workflow.
6. Public play selects a ready copy of the approved version. Editing a draft creates
   neither a replacement of that revision nor automatic approval of the next version.
   A pending or rejected update leaves the older approved version available unless it
   was explicitly withdrawn, revoked, or taken down.

The issuer must bind the content to the version as part of the trusted write, not sign
an arbitrary author-provided `(roleId, versionId)` pair. A host must not relabel a mutable
role as a reviewed version. Any conversion that changes executable/reviewable meaning
must fail as unsupported or return for a new version; it cannot silently drop fields.

## Required API operations

These are semantic requirements; the implemented subset is identified above. Existing `/role`, `/publish` and conversation endpoints retain their wire
contracts until the implementation and client migration are delivered together.

| Operation | Required behavior |
| --- | --- |
| Issue version | HearthRoom-only allocation; owner and quota checks; idempotent submission identity; version starts unapproved. |
| Seal/import hosted revision | Authenticated issuer plus target-owner authorization; atomically store the complete snapshot; return issuer/work/version/hosted-revision receipt only after durable commit. |
| Read hosted revision | Exact immutable snapshot for an authorized author or review/sync operation; public projections omit private instructions and Lorebook contents. |
| Read version decision | Configured issuer is the source of review status and decision sequence; response binds issuer, work and version. Unknown, unavailable or untrusted decisions do not authorize play. |
| Resolve public play | Resolve the approved version to a ready hosted revision; enforce authorizations, takedowns and credits; never fall back to the draft or an unrelated revision. |
| Revoke/withdraw | Deny new use of the affected approved version and remove it from public-play choices; stale approval messages cannot undo the decision. |

Service credentials stay on backends. A user's OAuth token alone cannot assert issuer
authority; a service credential alone does not grant arbitrary access to an author's
private drafts or authorize spending a player's credits. Reject redirects when sending
credentials. Do not accept a request-supplied authority URL as a destination to contact.

## Immutability and retries

A sealed snapshot includes all supported locales, instructions, example conversations,
opening messages and alternatives, suggested user prompts, Lorebook entries and behavior,
presentation rules/scripts, metadata that changes behavior, and media revisions. Shared
Lorebooks must be snapshotted rather than followed through mutable bindings. Media must
use immutable retained objects/revisions; keeping an externally mutable URL is insufficient.
The snapshot's dependency order and user-authored text are preserved.

The same operation retried with the same version returns the existing receipt without
writing new content. A reused operation/version with conflicting ownership, work or
content returns a conflict; it must not overwrite. Hosts may implement local integrity
checks without making their locally computed hash the community review identity.

Concurrency must be enforced by transactional persistence, not a read-before-write check.
A receipt is not ready before all required content and assets are durably stored. Partial
failure leaves successful hosts usable and failed hosts retryable. Losing the HTTP reply
after commit must be recoverable through an idempotent retry or receipt readback.

An independently edited draft on a target still produces `sync_target_changed` rather
than silent replacement. A missing destination remains a distinct recovery case. An
immutable revision must never be repaired by attaching its old ID to a different document.

## Playback and review lifecycle

Each public conversation pins the immutable hosted revision; each new generation checks
that its authority approval is still valid and that the host has not taken it down.
Decision lookup failure denies new generation rather than trusting an unbounded cached
approval. A later deployment may define a bounded signed lease only with an explicit
revocation-latency contract. Retrieving the user's existing conversation history remains
subject to its existing ownership rules and is not a new generation.

A new draft, new pending version, or rejected update does not overwrite the published
version. Revocation is distinct from a normal draft edit. Hosts may refuse storage or
execution and enforce their own abuse/takedown controls; those controls do not represent
a second HearthRoom editorial review. The community cannot override a host takedown.

## Compatibility and rollout

Existing approvals use public-field fingerprints and do not prove a complete immutable
snapshot. Do not backfill them into approved `versionId` records automatically. Legacy
cards remain explicitly legacy until a coherent snapshot is submitted and reviewed under
the new model. Enable the new path only for hosts that implement this contract end to end;
unsupported hosts cannot be shown as synchronized or ready for a reviewed version.

Roll out persistence and authenticated host APIs before switching submission and player
clients. Keep protocol availability distinguishable from a connected account. Removing
the legacy provider-publish call alone is not a migration: today's private-role access
checks would still prevent community playback.

## Verification and observability

The implementation must demonstrate these through real persistence and HTTP callers:

- Repeated and concurrent submissions resolve to one version/receipt; conflicting input
  cannot replace the stored content or change its author/work binding.
- One work stored on multiple hosts consumes one community quota slot and has one review.
- Copying an approved ID with modified content, using another author's token, spoofing
  an issuer, or replaying an older decision cannot approve or expose a revision.
- Editing a draft, a referenced Lorebook, an author script or media after sealing cannot
  change what review and public generation consume. New content requires a new version.
- Review reads the sealed snapshot; public play and subsequent generations read that
  same revision. Pending/rejected updates preserve the previous approved version.
- Missing/failed copies, unsupported fields, incomplete assets, authority unavailability
  and takedowns fail closed; partial synchronization never lies about readiness.
- Private content is absent from anonymous summaries, error responses, metrics and logs.
- Legacy approvals are not silently promoted into this version model.

Future counters for expanded multi-host import: `hearthroom_hosting_operations_total` and
`harbor_hosting_operations_total`, with fixed `operation` values `seal`, `import`,
`decision`, `resolve` and fixed `result` values `ok`, `denied`, `conflict`, `unavailable`,
`unsupported`. Emit after committed success or final refusal/failure. Never label by
version, work, account, email, URL, token or content. Verify using
`sum by (operation, result) (increase(harbor_hosting_operations_total[10m]))` and the
equivalent HearthRoom counter. These dedicated counters are specified, not currently emitted. This rollout uses the existing `harbor_contract_authoring_total{op="hosting_seal",result="ok|rejected|error"}` counter, emitted at final HTTP response, plus the existing HTTP response metrics for play/read denials. Verify `sum by (result) (increase(harbor_contract_authoring_total{op="hosting_seal"}[10m]))`. HearthRoom retains the existing fixed `register` / `submitted` event and HTTP outcome telemetry; it adds no identifiers to metric labels.

MCP decision: issuer-only sealing/decision operations are backend trust operations and
must not become general AI-client tools. Author-facing save, submit and synchronize
actions should reuse the same owner/quota/review services if exposed by a provider MCP
transport. HarperHarbor currently has no such transport; do not route the feature through
the inherited LunaTalk gateway or claim delivered MCP parity. Moonloom guidance changes
with the usable author-facing workflow, not before the API is implemented.
