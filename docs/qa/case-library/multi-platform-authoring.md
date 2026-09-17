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

API suite: 298 passing tests. Web suite: 337 passing tests, one pre-existing skipped suite. Type checks and Stage/web build passed. Build retains existing large-chunk warnings; embedded player tests retain loopback fetch warnings.

Chrome with synthetic local upstreams confirmed initial multi-selection, a visible permission failure, retry without edits, exactly one source creation and matching source/target payloads after retry. All five locale dialogs fit the 390 px viewport without button text overflow. English modal button text centers differed by less than 1 px, with no overflow and unobstructed hit targets at 390 px. Live production sync still requires successful readback; local fixtures do not establish that result.

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
