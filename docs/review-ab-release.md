# Review A/B release — 2026-09-20

## Outcome

HarperHarbor stores immutable submitted configurations and their dependencies;
HearthRoom publishes the approved revision while the author edits a separate draft.
A pending or rejected update leaves the last approved revision playable. Approval
atomically changes the listing, rating, search text and selected hosted revision.
Existing conversations retain their approved revision; new public play selects the
current published revision. Old approved card links continue to resolve to the work.

This increment is based on HearthRoom `5724bcf` and Provider `4383ccf` (immutable
hosting implementation `0c69a62`). The isolated feature branch is `feat/card-review-ab`
in both repositories. It does not replace other worktrees or their uncommitted work.

## Editing during review

Before writing a Harbor draft, the editor retires its pending review through the
owner-authorized `POST /v1/cards/{roleId}/edit` endpoint. The old submission becomes
`superseded`, loses its claim and private review snapshot, and database guards reject
stale stamps or attempts to approve it. After the complete draft save, a new frozen
version starts review using the author's existing content rating. A partial save
never submits partial content; retry retains the review obligation and draft input.

Saving a draft whose latest version is approved does not submit automatically.
Direct API clients must follow the same begin-edit / complete-save / submit contract;
provider-only draft edits do not change the immutable submitted version. Provider
mutation webhooks and arbitrary external-editor auto-resubmission are not included.

The editor, failure/retry hints and personal-card status cover all five locales.
No historical-version browser or garbage collector is added. Retained revisions are
still needed by pinned conversations and review-authority records.

## LunaTalk decision

LunaTalk keeps its existing flow. Its current card writer requires public cards to
become private before patching (`public_role_requires_clone`) and keeps review as
`waitReview` on the mutable role. Its own comments explain that a review job writes
visibility back by role ID. Supporting A/B safely would require changes to that
backend's review writeback and gameplay reads, not just removing the editor's
unpublish call. Given the planned retirement, that is outside this increment.
No existing LunaTalk approval is treated as a sealed HarperHarbor approval.

## Verification

- Added failing D1 tests, then implemented: pending edit retirement, retained A,
  new B approval, owner denial, stale stamp/decision refusal, old-link continuity,
  immediate search projection switch, and delayed A sync after B approval.
- Added failing editor tests, then implemented: retire before writes, resubmit only
  after successful saving, private editable sources without changing the sealed live revision, and no
  submission after save failure.
- Final Worker suite: **35 files, 354 tests passed** using local workerd and D1.
- Final web suite: **61 files, 366 tests passed**; one existing opt-in real-card probe
  suite skipped. Existing iframe localhost:3000 connection warnings remain in tests.
- Worker TypeScript, web typecheck, web production build and diff whitespace checks
  passed. The release was synchronized with main `97b004b` and its pinned stage
  `2c7fa50`; typecheck, full build and both full suites passed again. No other lane's
  dirty stage was used.
  Build retains existing large-bundle, Sass deprecation and unresolved-font warnings.
- Provider: full `go test -p 2 ./...` passed with real PostgreSQL 18 testcontainers;
  layering, file size, migration manifest, sqlc and shared-contract checks passed,
  including their negative fixtures. Existing hosting tests cover sealing,
  immutability, owner/issuer denials and model generation from the frozen revision.
- Unchanged root harness: **793/803 main tests passed, 10 failed**. Two failures
  reference missing retired frontend/Moonloom files; six require a local listener
  denied by the sandbox; two SSH-process cleanup fixtures did not pass. Additional
  QA-index and absent desktop/mobile asset checks fail, and the missing Moonloom
  consistency check explicitly skips. These are cross-fork/environment evidence
  limits, not changed harness behavior; no harness source was modified.
- Legacy parent `server/scripts/test-offline.sh`: steps 1–25 passed; step 26 fails
  because its legacy route table lacks `/conversation/ws` and `/hosting/seal` from
  the new Provider contract. Registered as existing cross-module test debt; no
  legacy executable was changed and no checker was weakened or skipped as green.
- Visible Chrome, synthetic local API: edit → save → new review; injected save
  failure → retained input and retry hint → successful retry. Readback confirmed
  begin-edit precedes document writes and submission follows successful writes.
  All five locale notices were checked at 390px without horizontal overflow; English
  success and failure/retry states were exercised. UI evidence is not a
  production/real-provider review or chat receipt.
- Initial environment failures were corrected: Colima socket discovery, missing
  built HTML assets, and Vite's raw-CSS denial for a symlinked stage. Browser fixture
  errors from incomplete copy data were fixed and the journey rerun. A new test
  initially used `visibility` instead of the actual `roleVisibility` wire field,
  and a search assertion referenced a field absent from the public TypeScript
  projection; both test-authoring errors were corrected before the final full run. The unconfigured
  embedded player was collapsed; full embedded gameplay was not tested in Chrome.

## Parity and observability

The HTTP owner endpoint uses the same issuer service and D1 guards as review decisions.
HarperHarbor has no deployed authoring MCP transport, so no inherited LunaTalk MCP
wiring or Moonloom change is claimed. Backend issuer operations are not general tools.
The normative hosting Markdown/OpenAPI copies are identical in both repositories.

Resubmission uses the existing Prometheus counter
`harbor_contract_authoring_total{op="hosting_seal",result="ok|rejected|error"}`;
its existing HTTP emission tests passed. Post-release query:
`sum by (result) (increase(harbor_contract_authoring_total{op="hosting_seal"}[10m]))`.
HearthRoom retains its Analytics Engine request telemetry, with fixed `register`
details `review_superseded` and `draft_edit`, emitted after the durable edit result;
HTTP outcomes cover denials. No IDs, content or hashes are added to these events.
A new in-memory Prometheus counter on an ephemeral Worker would not provide durable
aggregate counts, so that addition is not applicable to the Worker. Use the existing
request analytics together with version/submission readback.

## Release authorization and checklist

The owner advanced the planned 2026-09-27 release to 2026-09-20 and explicitly
authorized deployment. Production Provider migration 45, the hosting service key
and the fixed HearthRoom authority were verified before releasing this increment.
Deployment completion and exact source receipts belong in the release handoff;
this checklist by itself is not evidence that a deployment succeeded.

1. Reconcile the candidate with the chosen release branches, commit only intended
   paths, synchronize, run the affected trusted checks and push that exact source.
2. Verify the host's immutable-revision migration and configured issuer trust are
   active before enabling the HearthRoom workflow. Apply HearthRoom migration 0022
   after its 0021 hosting migration. Backend service secrets stay off the frontend.
3. Deploy the issuer/editor together. Do not route Harbor cards back through legacy
   registration if immutable hosting is unavailable. Existing legacy cards remain
   legacy until explicitly submitted and reviewed as a complete sealed version.
4. With authorized release test accounts, approve A, submit B and confirm public A
   read/play; edit B during review and confirm old-review refusal; approve the new B
   and confirm current public play and search, old-card links and pinned A history.
   Repeat rejection, failed-save retry and explicit withdrawal, then read metrics.
5. An application rollback must preserve immutable revisions and approved pointers;
   reverting to a client that unpublishes or overwrites live drafts is not a safe
   rollback. Keep schema/data intact and disable new submissions if necessary.
