# HearthRoom works, reviewed versions, and hosting copies

Owner clarification: 2026-09-19. This supersedes the earlier per-platform publication
proposal. The UI uses hosting terminology throughout.

Accepted direction: HearthRoom issues authoritative version IDs instead of requiring
every host to calculate matching content hashes. See
[Hosting version contract v1](contracts/hosting-versions-v1.md). The earlier cross-host
hash experiment has been retired. This document records the accepted design and the implementation boundary below.

## Product definitions

| Concept | Responsibility |
|---|---|
| Work | One HearthRoom work, with one author and one community listing, regardless of the number of hosting copies. |
| Version | A frozen set of reviewable content identified by an opaque ID issued by HearthRoom. Provider-local IDs, timestamps and counters are not its identity. |
| Review | HearthRoom reviews a work version. Approval applies to that exact version, not all future contents under the same role ID. |
| Hosting service | Stores card content and serves gameplay using the selected account's credits. It is not a second publication or review destination in the HearthRoom workflow. |
| Hosting copy | A mapping from work/version to a service account and stored role. It is usable for public HearthRoom play only when it is proven to serve the approved version. |
| Publication | HearthRoom makes an approved work version available in its community. Adding a hosting copy neither creates a second listing nor consumes another distinct-work publication slot. |

## Creator workflow

1. Create/edit the work, then choose **hosting services** when saving. Select one or more.
2. Submit **once to HearthRoom review**, with the work version and content rating.
3. On approval, publish that version in HearthRoom.
4. Add another host by synchronizing the same approved content, reading it back and
   verifying its version. No second editorial review is required for identical content.
5. If content changes, it is a new version. Approval of the old version does not approve
   it. A stale, changed, missing or unverified copy must not be offered as the current
   approved version.

Author-only playtesting may use a saved draft without community approval. Public play
requires the approved version. Selecting an account affects storage/access and billing,
not the work's review result.

`/mine` remains a work grid: cover, name, summary, HearthRoom review state, edit,
submit-review and playtest actions. Hosting details show synchronization/version health:
**synced / not synchronized / version mismatch / synchronization failed**. No host-review
or host-publication actions belong in this surface.

Saving says **choose hosting services**, not "publish to platforms". The host list is
secondary to the work. Partial failures retain successful copies and offer targeted retry.
An independently edited target is never silently overwritten. Missing-copy recovery is
still a distinct, private-only recovery path.

## Implementation and compatibility

The card grid, hosting selector, account-specific playtest choices and private draft
synchronization are implemented. HarperHarbor submissions use the immutable version
contract. Pending/rejected updates preserve an already approved sealed revision; legacy
approvals are never silently migrated. See the contract's rollout boundary for the exact
implemented operations. An unsupported host can retain an editable copy but cannot be
a public hosted copy of the approved revision. This release does not implement immutable
cross-provider imports or remove LunaTalk's legacy integration.

Verification covers real PostgreSQL cloning/immutability/authorization/generation,
Workers D1 review and withdrawal, full frontend tests/build, and Chrome UI journeys with
synthetic data. Production release and readback are separate evidence.

## Authoritative version IDs (accepted contract)

HearthRoom is the issuer and review authority. `workId` identifies a work;
`versionId` identifies a frozen content version; the review record identifies whether
that exact version is approved, rejected or revoked. Possessing or copying a version ID
is not itself approval.

A trusted synchronization flow writes the issued version and its content to a hosting
service. The host returns a durable mapping to its immutable hosted revision. Clients
cannot make arbitrary content approved by supplying an existing version ID. Repeated
writes of the same version are idempotent; replacing its content is forbidden.

Immutability must include referenced Lorebook entries, presentation rules and media.
A mutable draft remains editable, but it cannot alter an already approved version.
A meaningful edit creates a new version and requires a new HearthRoom decision.
Public play must resolve the approved version's hosted revision, not a role's latest
mutable contents. Unverified or failed host synchronization is not advertised as ready.

Hosts may rely on the authoritative version contract instead of independent hash
implementations. This is an explicit trust model: the ID names a version; enforcement
and write acknowledgements establish its binding to stored content. If a host cannot
provide immutable revisions, a writable metadata field alone cannot implement this
contract. The existing mutable role API therefore still needs an agreed revision/access
contract before this model can be claimed complete.

## Implementation boundary

The unified grid, original-account routing and hosting destination chooser can be retained
from the current WIP. The per-platform review proposal and its passing tests are obsolete
acceptance criteria. Do not release it or relabel provider review as community review.

The local UI now includes the unified grid, account-specific play choices, per-service
hosting state, save destination selection, and one explicit HearthRoom review action.
UI regression evidence is recorded in
[WORKSPACE-01](qa/case-library/cases/WORKSPACE-01-hosting-and-review.md).
It is not a release receipt or proof of immutable-version/public-play support.

Before release, align the review-version record, immutable content storage, host
readback and public-play authorization. The SaaS must enforce the approved version at
use time; a badge or a last-known hash alone cannot prevent post-verification mutation.
If immutable versions are supported, new drafts can coexist with the old approved version.
Without that capability, remove an unverifiable copy from public play instead of silently
serving its latest mutable contents under an old approval.

Cross-provider publication permission changes require real service contracts and denial
coverage. Do not bypass provider moderation/visibility checks in a browser or mark a
provider review approved locally. Production schema, permission and content mutations are
not authorized by this design document.

MCP parity: the grid itself is private web presentation. New review-version/hosting
contracts require a separate explicit HTTP/MCP applicability decision using shared service
logic. Observability must distinguish synchronization, version mismatch and public-play
eligibility without identifiers or content hashes in metric labels.

Design reference: Buffer's [post groups](https://support.buffer.com/en-us/articles/using-post-groups-in-buffer-bUZAamv7kk)
are a useful shared-work presentation pattern, but their channel-publication model does
not define HearthRoom's hosting or review responsibilities.
