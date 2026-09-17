# Multi-platform authoring and retry

## Contract

Write before choosing a platform. At save, all connected destinations are initially selected. Existing source saves remain selected. Each destination reports its own result. A failed destination must not duplicate or discard the saved source. An independently edited destination must not be overwritten. Publishing remains a separate explicit action.

## Repeatable checks

- Connect two synthetic provider accounts, open Create, and enter a name before any platform dialog appears.
- Save, confirm both destinations, and inject a destination permission error. Verify the source is saved once and the error shows the provider, operation and safe error code.
- Restore permission and save again without changing content. Verify retry is enabled, the source is not recreated, and both payloads match.
- Edit the source and save to both. Verify the copy updates. Modify the destination separately and verify conflict protection.
- Cancel the dialog and press Escape: no remote write occurs.
- Submit for review only after an explicit platform choice and publication confirmation.
- At 390 px, inspect all five locales, keyboard focus, button text overflow and modal hit targets.

## Evidence for this change

API suite: 302 passing tests. Web suite: 337 passing tests, one pre-existing skipped suite. Type checks and Stage/web build passed. Build retains existing large-chunk warnings; embedded player tests retain loopback fetch warnings.

Chrome with synthetic local upstreams confirmed initial multi-selection, a visible permission failure, retry without edits, exactly one source creation and matching source/target payloads after retry. All five locale dialogs fit the 390 px viewport without button text overflow. English modal button text centers differed by less than 1 px, with no overflow and unobstructed hit targets at 390 px. Live production validation subsequently passed after the runtime and asset-host corrections described below.

## Surface and observability decisions

MCP: not applicable. This change orchestrates existing provider APIs inside the community authoring UI; it introduces no provider capability or new model-facing tool.

Observability: reuse the Worker event outcome and emit `card_sync_failed` with a bounded error code and safe provider/step/status details. No Prometheus endpoint is introduced for the Worker. Verify the authenticated response and durable copy status; never use private card content or identifiers as metric labels.

## Workers runtime regression

The production sync failed before reading the source because the request used `redirect: "error"`. A real Workers `Request` constructor rejects this mode; mock-only fetch tests did not construct the request. Transfer fixtures now construct a Workers request before returning responses. Both card transfer and image-reference registration use `manual` and reject non-success responses. A redirect regression verifies there is exactly one request and no credential forwarding.

## Current SaaS image references and tag preservation

Source APIs may return tags as strings or objects with `text` / `tagName`.
Normalize the documented names rather than coercing an object to a string.
The transfer-only reference allowlist includes the current `assets.lunatalk.ai`
and `assets.harperharbor.com` hosts; the image proxy allowlist is unchanged.
Harper's `MEDIA_REFERENCE_HOSTS` must include the actual source SaaS asset host.
This registers public URLs only and never copies image bytes.

## Production readback

The deployed change was verified with an owner-authorized synthetic private card. The natural My cards sync action returned “copy saved” without requesting publication. A read-only D1 lookup limited to that test work confirmed one Harper copy, `status=synced`, matching non-empty source/target hashes and an empty error. The transfer service only records success after reading the destination content back. No real user card was overwritten or submitted for public review during this verification.

Release sequence: `1f6f46d` (authoring and diagnostics), `2619f5a` (Workers request compatibility), `fa8969a` (current SaaS images and structured tags). All three exact sources passed CI and deployed. Harper image-reference configuration was updated separately; the API readiness check passed.

## Lorebook transfer contract regression

Two adapter defects can produce `sync_upstream_rejected` / `invalid_arguments`:
normalized hash entries use empty strings for default category and trigger region,
but Harper's document API requires explicit valid enums; and a whole-book replacement
can exceed its 200-operation limit. Restore `custom` / `both` on API writes and send
at most 100 operations per document, including deletion operations on re-sync.

Read back the target after each acknowledged document and order change. Retrying a
known partial result reuses the mapped book and replaces its actual current entries.
An unknown write result still uses the existing target-version conflict protection.
Harper's reorder moves listed entries to the front, so bounded chunks are prepended
from last to first. LunaTalk assigns absolute positions and receives the complete
order in one request within its 2,000-entry limit. Never truncate a book to meet a limit.

Regression cases use synthetic entries: default enum validation, 475-entry creation
and replacement, failure after two successful chunks followed by retry, both ordering
contracts, and clearing a large book. The enum and oversized-document tests were
observed failing before their respective fixes. This change uses the existing sync
endpoint, safe error envelope, and durable readback; the surface and observability
decisions above remain applicable. Prior production success with a smaller synthetic
card did not cover these larger Lorebook cases.

Local validation for the Lorebook correction: type checks passed; 306 API tests and
337 web tests passed, with the same pre-existing skipped web suite and embedded-player
loopback warnings. Production deployment and live readback are separate checks.

## Explicit recovery of a missing destination

A deleted destination can leave a valid community mapping pointing at an upstream
`role_not_found`. Ordinary retry must not silently recreate a deliberately removed
copy. The platform panel offers “Create a new private copy” only for the destination
card-read 404, from either the immediate response or its persisted error envelope.
The authenticated recovery request rechecks both linked identities, the source owner,
the stored destination account and the missing-card response before replacing the
mapping. It clears old resource mappings, uses a distinct creation key and retains
the existing unknown-create and external-edit protections. It never restores or deletes
old resources, and cannot submit the replacement for review in the same request.

Red/Green: missing-target recovery, private-only enforcement, and uncertain replacement
creation failed before implementation. Network errors, authorization failures, source
404s and Lorebook 404s preserve the old mapping. The browser's synthetic natural path
confirmed one recovery request with `publish:false` even when review was checked;
success removes the error and recovery action. All five locales fit at 390 px; the
new action has a 44 px hit target and no horizontal overflow. English text centering
was within 1 px. Type checks, 312 API tests, 338 web tests and the web build passed;
the existing skipped web suite and build/embedded-player warnings remain unchanged.

MCP is not applicable: this is an authenticated community orchestration recovery,
using existing provider create/read/write APIs, not a new provider/model tool.
Observability reuses the bounded `card_sync` outcome and existing safe failure
envelope. Durable verification reads the resulting mapping and final hash comparison;
no card content, account IDs or credentials are added to logs or metrics.
