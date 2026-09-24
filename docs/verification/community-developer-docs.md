# Community developer documentation

The public `/developers` page has two references: Hearthroom's community API (19 paths, 25 operations) and the neutral service integration API (104 paths, 111 operations). Identity, card authoring, media, chat, operation status and hosting contracts remain publicly documented. Vendor setup, branding and implementation-specific extension notes are excluded from the public reference.

The source integration contract remains unchanged in `docs/openapi.json`; implementation notes remain in `docs/provider-integration.md`. The neutral `docs/integration-openapi.json` preserves all source paths, methods, operation IDs, fields, scopes, security declarations and schemas. Tests compare the protocol structure while allowing editorial descriptions and omission of vendor-specific extension notes. Existing protocol identifiers remain unchanged even when they contain a historical name.

The five interface locales link to both specifications. The technical reference retains its existing English policy. Separate anchor prefixes prevent collisions between references; HEAD operations are now rendered alongside the other HTTP methods.

## Verification

- Base: Hearthroom `50ffe75`, with its pinned stage source `c698905` in an isolated worktree.
- Red: the original page lacked the community reference. After scope clarification, the community-only page failed the dual-reference test; the renderer also failed the prefixed HEAD deep-link test. The first implementation exposed a prefix/open-state mismatch, fixed before Green.
- Green: both references, all 136 operation headings, community pagination, WebSocket frame details, both source links and every table-of-contents target pass. Unique anchors and HEAD deep links are covered. A protocol-structure comparison prevents losing integration paths or fields; content checks cover collapsed descriptions and schema references.
- Contract inspection: all 19 documented paths exist in the community handlers, including library route loops. Path parameters match; schema references resolve. Checked request and response fields against the board, member, comment, library and notification handlers. Response schemas intentionally permit additional fields.
- Full Worker suite: 58 files, 570 tests passed. Initial sandbox run could not bind localhost (`listen EPERM`); the same suite passed with local test-service access.
- Initial community-only web suite: 95 files, 537 tests passed; one existing real-card probe suite skipped because its external fixture directory was not configured. The suite logs existing happy-dom localhost iframe connection errors without failing assertions.
- Release-check sequencing: a Worker could not start when the concurrent web build briefly removed `web/dist/assets` (`ENOENT`). The build and Worker suite must run sequentially; this failed attempt is not a pass. Final rerun results are part of the release receipt.
- `npm run typecheck`: passed.
- Pinned stage build and `npm run build:web`: passed. Existing large-chunk, Sass deprecation and runtime font-path warnings remain.
- `git diff --check`: passed.
- Browser acceptance: blocked. The browser tool reports Chrome unavailable and an empty browser inventory. No screenshots, responsive geometry, live UI acceptance or deployment are claimed.

## Browser acceptance to complete

1. Open the site, follow the footer's Developer docs link, and verify both Hearthroom Community API and Service integration API sections are present.
2. Check that both community and service integration references are available, including chat, without vendor configuration or branded implementation sections.
3. Expand `GET /v1/cards`; verify its filters, pagination and response fields. Expand a member mutation and verify its Bearer requirement, JSON request and errors.
4. Follow table-of-contents links in both references and both source links. Verify they reach the intended endpoints and `docs/community-openapi.json` / `docs/integration-openapi.json`. Confirm the WebSocket ticket endpoint shows frame details and HEAD links expand correctly.
5. Repeat on a narrow viewport, opening the collapsed contents. Check for clipped text or horizontal page overflow. Check the source link in all five interface languages.

## Scope decisions

MCP parity: not applicable. This change documents existing HTTP operations and changes only the documentation displayed by the site; it introduces no new capability, permission or protocol.

Observability: not applicable. No handler, background job, billing, moderation or instrumentation behavior changes. No new metrics are needed for selecting and rendering documentation.

Release: owner authorized publication and then confirmed the dual-reference scope. Deployment uses the pushed source through CI; results and live readback are recorded separately. Browser acceptance remains blocked as described above.
