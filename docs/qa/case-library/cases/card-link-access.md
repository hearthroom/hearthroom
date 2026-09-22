# Card links and explicit play platform

## Contract

Unreviewed cards, including never-submitted drafts, are readable and playable by link when their source platform exposes their public detail/player surface. Community review controls board/search/author-list inclusion; only approved cards enter those lists. Provider-private configuration/export and edit/write operations remain author-only. Provider-denied assets, sealed unpublished revisions and site-blocked cards must not become public through a work/copy alias. Declared adult content retains the adult gate.

`GET /v1/cards/:id` and `/platforms` resolve community ID, card number, work ID or legacy source ID independently of the viewer issuer. A registered identity takes precedence over colliding work aliases. Unknown source IDs are probed anonymously across configured providers; ambiguity returns 409, upstream outage 502, absent/denied assets 404. Link-only details use no-store; HTML returns 200 with noindex and no private metadata. Board APIs remain approved-only.

`sourceRoleId` identifies the editable source independently of an approved hosted revision. `/v1/me/cards` additionally returns `detailId` for a registered community card. My-card detail and share links omit provider. Play selection starts empty; only the selected destination receives `?provider=`. Owner editing/registration stays explicitly source-provider scoped, including credential retrieval.

## Natural journeys

1. Author: My cards → draft cover → neutral detail link. See intro, welcome, platform choices, Edit and Submit for review. No platform initially selected.
2. Open review confirmation: rating is unselected and Submit disabled. Cancel causes no registration. Editor link targets the source ID/provider.
3. Visitor: open the same link. Intro and platforms appear; editing/submission controls do not. Select a platform; Play appears and targets that platform's copy. Do not send paid chat during acceptance.
4. Repeat at 320 px in English and desktop Traditional Chinese. Controls remain readable, nonoverlapping and keyboard reachable; no horizontal overflow.
5. API regression: never submitted/pending/rejected/needs_review/unshared remain outside board; inaccessible/blocked return 404; adult aliases require adult gate; approved immutable revision remains authoritative.

## Delivery decisions

MCP/Moonloom: not applicable. This is the community HTTP detail/navigation surface; provider player/export/write contracts and existing MCP services are unchanged. No separate MCP authorization path is introduced.

Observability: reuse existing Worker Analytics Engine request outcomes (`api`, `page_html`, status/outcome/duration). Missing sources must record `not_found`, upstream failures `upstream_error`; covered in analytics tests. No new Prometheus series: this Worker has no Prometheus scrape endpoint and existing request telemetry distinguishes these outcomes without identifiers in labels. Production readback checks HTTP status/cache/robots and deployed asset identity.

## Local acceptance 2026-09-22

After rebasing onto 21551a7, API full suite: 538 passed. Web full suite: 481 passed; one pre-existing opt-in suite skipped. Native Chrome fixtures validate real Vue components; synthetic network data is not production-account acceptance. Production account session currently redirects to login; no OAuth renewal or user-state mutation performed. Test runner requires local sockets outside the filesystem sandbox. Node 26 happy-dom prints existing navigation connection warnings; assertions pass. CI runs Node 22.

Browser findings: desktop Traditional Chinese owner controls and rating-confirmation cancellation passed. 320 px English visitor page had scrollWidth=320, no author controls and no preselected platform. Selecting LunaTalk then Start a conversation navigated to `/play/copy-fixture?provider=lunatalk`. Platform choices occupy their own row above report/share, avoiding the old cramped sidebar. Existing comment/favorite functions remain available for listed cards only. My-card cover resolves to `/cards/work-fixture` without a query. Actual play generation and production owner-account acceptance were not run.
