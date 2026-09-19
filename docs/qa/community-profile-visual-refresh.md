# Community profile visual refresh

The previous Me page gave identity, shortcuts and service management the same stacked-panel treatment. This revision emphasizes the member's avatar, name and bio; desktop separates the profile from creation/service controls, while mobile reads in the same logical DOM and visual order. Secondary metadata is quieter, controls use compact rounded rectangles, creation links include consistent line icons and explanatory copy, and service management uses text links instead of competing outlined buttons.

References inspected visually: [GitHub profile](https://github.com/sindresorhus) for profile/content separation and restrained metadata; [Discourse profile](https://meta.discourse.org/u/sam/summary) for prominent community identity and grouped secondary navigation. These informed the hierarchy; no imagery, statistics or functionality was copied. Existing Hearthroom color, spacing and radius tokens remain in use. HarperHarbor uses its official yellow-backed Fraunces italic H, matching its website wordmark; the single-glyph font is bundled locally with its OFL license. The LunaTalk initial remains a placeholder.

## Behavior preserved and corrected

The community quota, permanent service connections, empty-account absorption and avatar storage contracts are unchanged. Connected services now precede available services (regression asserted Red then Green). Browser checking also exposed a late-profile bug: authorization checks ran only at mount, before identities arrived, leaving a permanent checking state. A failing component test reproduced it; watching the identity list fixes it. Browser reload now reaches the authorized state.

MCP/observability: no new API or privileged workflow; this is browser presentation plus reactive status loading using existing endpoints. No new MCP surface or server metric is applicable.

## Local verification

- Full Hearthroom suite: 341 Worker tests and 343 frontend tests passed; one existing optional external-card fixture suite skipped.
- Frontend type check, five-language translation check, and production build passed. Existing Vite deprecation/large-chunk and Happy DOM localhost navigation warnings remain.
- Chrome checked Traditional Chinese desktop light and dark layouts, five-language 390×844 mobile layouts plus Traditional Chinese mobile dark mode, profile editor, cancellation and save-result DOM text. Connected status, disconnected service, permanent-connection note and destinations are present.
- The standard geometry probe (v3, 44 px floor) detected an English checking-state title squeeze; increasing the provider text's flex basis fixed it. Final affected controls had no clipping/overlap, raw translation keys, off-center icons, or measured contrast failures/unknowns. The deliberate overlap control reported ratio 1, confirming detection.
- Text-box skew reports for the centered icon+edit-label group and intentionally left-aligned logout row were visually reviewed; no text overflow exists. Some translated footer text and existing header/footer touch targets remain preexisting shared-shell findings.
- Browser console error readback was empty. The viewport screenshot provider occasionally scaled the whole native frame; explicit viewport clipping provided readable mobile component screenshots. Screenshots were inspected through the browser tool, not stored with private fixtures in the repository.
- File upload through the browser remains unverified because the extension's file permission is unavailable, as recorded in the previous implementation report. This revision verified file-input labeling and presentation; it does not claim a new upload end-to-end pass. Expired/error responses have component coverage, not a new browser run.

| Changed component | Radius/spacing/tokens | Icon alignment and contrast | States inspected | Result |
|---|---|---|---|---|
| Me profile and navigation | Existing tokens; profile is unboxed | Avatar/name hierarchy, copy control and links checked | Default, saved; desktop/mobile | Pass for inspected scope |
| Connected services | One bordered list; linked service first | Text links, provider initials, status dot with text | Checking, ready, disconnected | Pass for inspected scope |
| Profile editor | Consistent inputs and 44 px buttons | Custom file label, solid save button | Editing, cancellation, saved | Pass; upload permission gap remains |

Case library: added `docs/qa/case-library/cases/ME-01-profile-layout.md`.

## Independent root harness failure

An additional root harness run exited 1. No root harness, desktop, mobile or server files were changed by this revision. Failures were attributed to the current root checkout/environment: missing desktop/mobile vendored copy linters and generated token drift; missing desktop display-rule engine and Moonloom reference document; missing `zod` for email/payment tests; six local-listener tests denied by sandbox `EPERM`; and two SSH-process cleanup assertions failed. The cleanup assertions remain unresolved outside this UI scope. Expected negative-test diagnostics for model snapshot gates are not treated as actual suite failures. Do not describe the root harness as green or broaden this page change to repair those independent files.

No production deploy or production data change occurred.
