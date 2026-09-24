# Community developer documentation

The public `/developers` page now documents Hearthroom's browsing and member social API. It loads `docs/community-openapi.json` (19 paths, 25 operations) and a community-only overview. The five interface locales link to the same community specification; the technical reference retains its existing English language policy.

The integration contract remains in `docs/openapi.json`; its explanatory notes moved to `docs/provider-integration.md`. The upstream protocol coverage test follows that move. Neither integration document is imported by the public developer page. Existing service protocols and handlers are unchanged.

## Verification

- Base: Hearthroom `50ffe75`, with its pinned stage source `c698905` in an isolated worktree.
- Red: the new rendered-page test failed against the original page, which displayed the service contract instead of the community API.
- Green: rendered title, community endpoint expansion, pagination fields, source link and every table-of-contents target pass. A separate content check covers schemas and descriptions hidden in collapsed endpoints and resolves schema references.
- Contract inspection: all 19 documented paths exist in the community handlers, including library route loops. Path parameters match; schema references resolve. Checked request and response fields against the board, member, comment, library and notification handlers. Response schemas intentionally permit additional fields.
- Full Worker suite: 58 files, 570 tests passed. Initial sandbox run could not bind localhost (`listen EPERM`); the same suite passed with local test-service access.
- Full web suite: 95 files, 537 tests passed; one existing real-card probe suite skipped because its external fixture directory was not configured. The suite logs existing happy-dom localhost iframe connection errors without failing assertions.
- `npm run typecheck`: passed.
- Pinned stage build and `npm run build:web`: passed. Existing large-chunk, Sass deprecation and runtime font-path warnings remain.
- `git diff --check`: passed.
- Browser acceptance: blocked. The browser tool reports Chrome unavailable and an empty browser inventory. No screenshots, responsive geometry, live UI acceptance or deployment are claimed.

## Browser acceptance to complete

1. Open the site, follow the footer's Developer docs link, and verify the heading is Hearthroom Community API.
2. Check that the overview and table of contents describe community browsing and social features without service configuration, model/chat API or vendor-specific sections.
3. Expand `GET /v1/cards`; verify its filters, pagination and response fields. Expand a member mutation and verify its Bearer requirement, JSON request and errors.
4. Follow a table-of-contents link and the specification source link. Verify they reach the intended community endpoint and `docs/community-openapi.json`.
5. Repeat on a narrow viewport, opening the collapsed contents. Check for clipped text or horizontal page overflow. Check the source link in all five interface languages.

## Scope decisions

MCP parity: not applicable. This change documents existing HTTP operations and changes only the documentation displayed by the site; it introduces no new capability, permission or protocol.

Observability: not applicable. No handler, background job, billing, moderation or instrumentation behavior changes. No new metrics are needed for selecting and rendering documentation.

Release: prepared locally only. Pushing main triggers production deployment and requires explicit owner authorization under the repository working contract. Live verification remains outstanding.
