# Community developer documentation

The public `/developers` page documents Hearthroom's community API (19 paths, 25 operations) and the neutral service integration API (104 paths, 111 operations). Identity, card authoring, media, chat, operation status and hosting remain documented. Vendor setup, branding and implementation-specific extension notes are excluded from the public reference.

The original integration contract remains in `docs/openapi.json`. The public `docs/integration-openapi.json` preserves its paths, methods, operation IDs, fields, scopes, security declarations and schemas. Existing protocol identifiers remain unchanged even when they contain a historical name. This update changes documentation and its presentation, not API behavior.

## Five language editions

The overview, both API references, schema explanations, WebSocket notes, tag labels and reference controls now follow the site's selected language: Simplified Chinese (China), Traditional Chinese (Taiwan), English (United States), Japanese or Korean. The existing URL locale codes remain unchanged. Canonical downloadable OpenAPI JSON remains English; the source links identify that language.

Each translated reference contains all 1621 catalog entries. Only prose is translated. Paths, keys, examples, enum values, scopes, operation IDs and endpoint anchors retain their original values. Dictionaries and overviews load on demand. Failed loads show a localized error; a stale language request cannot replace the user's latest selection. A deep link expands and scrolls to its endpoint after loading.

The translation pass also repaired two truncated public 403 descriptions and normalized English prose to US spelling. The original machine contract was not edited. Translation preserves endpoint-specific behavior and does not claim a fresh runtime audit of every legacy service operation.

## Verification on 2026-09-24

- Focused documentation suite: 5 files, 25 tests passed. All five editions render both references, all 136 operation headings, expanded schema and WebSocket details, and valid unique contents links.
- Catalog checks: every language has the complete ID set, nonempty values, unchanged code spans, preserved numeric constraints and technical identifiers, and no vendor prose. Overview inline code and curl commands remain intact. Source-classified comparisons confirm that translated references preserve the wire contract.
- UI Red/Green: localized reference labels initially rendered English; the translated controls now pass. A delayed locale initially failed to scroll to the linked endpoint; post-load navigation now passes. Loading tests also cover language request races and recovery after a failed download.
- Test-development failures: the first loading fixture incorrectly accessed flat locale keys as nested objects; the first integrity matcher treated Markdown fences as inline code and classified translated CJK text using English whitespace. These were test errors, corrected before the final run.
- Full trusted suite: 3 script tests, 570 Worker tests across 58 files, and 557 web tests across 98 files passed. The existing real-card probe suite remains skipped because `REAL_CARDS_DIR` is unset. Existing happy-dom localhost iframe connection errors are logged without failing assertions.
- Full typecheck, pinned stage/sandbox builds and web production build passed. Validation used stage `ac73d03` from current main. Existing Sass/API deprecation, font-path and large-chunk warnings remain. Build and Worker tests ran sequentially to avoid deleting Worker assets during startup.
- Language reviews: Traditional Chinese 37/45, Simplified Chinese 36/45, Japanese 38/45, Korean 37/45; confidence `LLM-approximation`. The independent language passes checked ownership, private data, costs, negation, retries and limits. Long legacy descriptions retain their original density to preserve contract details; these scores are not native-human acceptance.
- Browser acceptance remains blocked: the native browser integration exposes no available browser, and Chrome DevTools reports an existing profile session. No process was stopped to bypass that boundary. DOM tests and deployed-asset readback are not responsive visual or real-browser acceptance.

## Browser acceptance to complete

Follow the footer's Developer docs link. Switch among all five languages and verify the overview, tag labels and expanded reference explanations change together. Open community card browsing and the integration WebSocket ticket endpoint, then follow their contents/deep links. Repeat on a narrow viewport, checking the folded contents and table overflow. Both source links should clearly identify their English JSON source.

## Scope and release

MCP parity is not applicable: this is localization of existing documented operations and does not add capabilities, permissions or protocols. New observability metrics are not applicable: no handler, job, billing, moderation or instrumentation behavior changes.

The owner authorized publication. Release uses committed, synchronized and pushed source through CI, followed by live route and language-asset readback. Deployment receipts are separate from the local test results above.
