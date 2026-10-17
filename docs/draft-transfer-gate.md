# Unpublished-draft transfer barrier

This is a privileged operational barrier for one configured card, not an author transfer API.
It complements the Provider unpublished-draft operator; it does not create a distributed transaction.
Keep Provider immutable revisions, snapshots, media quota and receipt guards enabled.

## Authority and identity

The internal POST `/internal/community/draft-transfer-gate` requires a dedicated bearer secret
`DRAFT_TRANSFER_CONTROL_SECRET` (at least 32 characters). Do not reuse bridge, author or hosting keys.
`DRAFT_TRANSFER_CONTROL_SCOPE` must identify this deployment AND D1 database; configure
`DRAFT_TRANSFER_CONTROL_CARD_NUM` for the one authorized permanent card number. No defaults enable it.
Never put the secret or private manifest in a command log, shared document or public guidance.
All control reads explicitly open `first-primary`; failure returns 503 without replica fallback.
The service still relies on deployment integrity and authorized database operators: D1 has no
per-route SQL role, and this guard does not defend against a database administrator changing schema.

Every request carries `scope`, `provider: harbor`, `sourceRoleId`, `cardNum`, `operation`,
`generation` and `action`. Mutations also carry unique `requestId`. Exact retries do not perform a
new transition; different payloads under the same request ID conflict. Status reports the current
phase, not the historical phase of a replay. Scope, card number and source pair cannot be rebound.
Only counts and digests leave the private operator route; no asset or card text is returned.

## Phases and evidence

1. `held`: closes D1 admission atomically by appending an immutable event. Generation starts at 1;
   a subsequent hold is only allowed after release and increments it. No TTL or crash auto-release.
2. `status`: inspect counts/digest AFTER hold, using the same operation/generation. For this task,
   only the permanent card-number row may exist. Any registry, work, version in ANY state, alias,
   review, registration, reward, moderation or originality row is a blocker. In particular a pending
   or unknown reward can already have an external financial effect: do not attempt transfer or erase it.
3. `prepared`: after independent Provider readback and dependency review, submit the status digest
   as `baselineDigest`. It records the frozen D1 baseline. This phase alone is NOT apply approval;
   the response's blockers must be empty, and the Provider's own plan must also be eligible.
4. Provider apply remains a separately authorized operation against the exact reviewed/pushed
   release, using the same private manifest and approved fingerprint. Maintain this D1 barrier.
   Seal winning first makes Provider apply reject retained lineage; apply winning first removes the
   former author's ability to create a new seal. Never delete an orphan seal to gain eligibility.
5. `released`: requires the unchanged baseline digest, `receiptHash`, `evidenceHash` (64 lowercase
   hex), and explicit `resolution`: `verified_forward`, `verified_recovery` or `verified_no_apply`.
   The receipt/evidence hashes are the dedicated operator's attestation of independently reviewed
   evidence, NOT automatic verification of a PostgreSQL receipt or a distributed commit proof.
   Release must remain forbidden operationally until the actual Provider receipt/outcome, double
   readback and authorized acceptance are known. A hash-shaped string is not such evidence.
   `verified_no_apply` is only for an independently confirmed abandoned plan, never an unknown apply.

An interrupted request is investigated by its original operation/request ID and durable events.
Do not issue a new generation, reverse transfer or release to guess an unknown outcome. If D1 is
unavailable, leave the gate held. Once source content, shared original resources or financial state
changes, the old Provider recovery fingerprint no longer authorizes restoration.

## Writer coverage and effects

Migration 0073 adds BEFORE INSERT/UPDATE/DELETE guards to 21 related tables. UPDATE checks
OLD and NEW. The bounded role/work/version/submission graph follows copies, replicas and transfer
aliases in both directions; permanent card-number identity is a separate seed. Snapshots, review
claims, originality, delivery jobs, registration history, rewards and moderation records are covered.
Existing immutable guards remain. Frozen cards also pause their comment projection; player
favorites, saves and conversation ownership are not migrated or globally frozen.

A held write aborts its D1 statement/batch, including quota/pack and originality side effects in the
same batch. A stale remote seal may already exist on Provider and cannot be rolled back by D1.
The hosting catch path preserves a held finalize error rather than overwriting it with cleanup.
This task requires no existing registry/work/version, so any newly detected relation stops apply.
A batch touching a held card can abort unrelated writes in that batch; do not run a mixed-card
maintenance mutation under this barrier or claim that a global job is fully drained.

Control events reject UPDATE, DELETE and INSERT OR REPLACE over existing receipts. Authorized
controller code can append events; ordinary authors/reviewers cannot invoke the secret route.
A schema rollback that removes guards while a gate is active is prohibited. Keep the additive
migration and events during application rollback; recover forward after inspecting exact state.

## Verification and observability

`test/draft-transfer-gate.test.ts` runs against real local workerd D1 and the complete migration
history. It covers scoped denial, reverse aliases, stale finalize, lost response, batch rollback,
CAS, replay, dedicated authority, primary failure and immutable receipts. PostgreSQL lock races
are separately tested in Provider; neither local class proves a live distributed deployment.

Durable counter `hearthroom_draft_transfer_gate_total{operation,outcome}` is exposed by `/metrics`.
Operations: `transition`, `admission`; outcomes: `success`, `denied`, `error`. A successful transition
increments in the event's D1 transaction; the request boundary records denial/error after rollback.
No scope, account, card, operation or digest is a label. Direct SQL rejection does not emit a
surviving counter inside an aborted statement: validate durable state as well as HTTP metrics.
Read back `sum by (operation,outcome) (increase(hearthroom_draft_transfer_gate_total[15m]))`, enabled
63 schema guards, latest gate event, original card identity and independent Provider ownership.

MCP/Moonloom: not applicable. No author capability or public discovery surface is added; exposing
this privileged maintenance control to external AI clients would violate this task's authority.
