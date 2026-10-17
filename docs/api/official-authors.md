# Official author identity

Official identity belongs to a Hearthroom member. New and existing members default to
`false`. A provider nickname, profile edit, reviewer role, subscription or Discord badge
cannot grant it. No member is automatically marked by this migration.

`POST /v1/me/community/official/manage` requires a normal authenticated human member
and a provider token whose current application team role is owner or admin. Reviewers
and review managers alone cannot use it. Every request checks upstream authority; an
unavailable upstream returns 503 and does not write.

Send JSON with `handle` (public eight-letter member handle), `official` (boolean),
`reason` (nonempty text, at most 300 characters) and `requestId` (16–100 ASCII letters,
digits, hyphens or underscores). Example payload:

```json
{"handle":"abcdefgh","official":true,"reason":"Verified official organization","requestId":"official-grant-example-001"}
```

Use `official:false` with a new request ID to revoke. Response is the current durable
`{handle, official}` state. The same request ID and payload is idempotent, including
concurrent retries; conflicting reuse returns 409. Replaying an old grant after a later
revocation returns the current false state and never grants again.

The state write and `official_author_audit` record commit atomically. Audit stores the
actor, target, decision, reason, payload and time inside D1. Public responses expose no
internal member UUID. Operators can inspect the audit through their existing authorized
read-only D1 management path; there is no new public audit endpoint.

Public card authors (including previews), author lists and author profiles expose
`official:boolean`. Card identity follows the current member connection owner. Changing
official state invalidates card/author shared caches through their authoritative revision.
Self-profile input cannot change this state.

The request counter is
`hearthroom_community_requests_total{operation="official_admin",outcome="success|denied|error"}`.
Verify `/metrics` after an authorized operation; labels never contain handles or member
IDs. HTTP is the existing Hearthroom management transport; MCP and Moonloom are not
applicable because they do not expose Hearthroom application administration. Provider
MCP is a different product and must not inherit this authority.

Deployment installs the column/audit schema only. Enabling an actual official member
requires verified account ownership and a separately authorized data operation.
