# Social sharing metadata

The Worker rewrites the initial HTML head for `/download`, `/cards/:id`, and
`/authors/:handle`, including supported locale prefixes and a trailing slash.
Open Graph and Twitter cards do not depend on the Vue app running JavaScript.
The rest of the SPA shell is preserved.

Download pages have five-language titles and descriptions, an absolute app icon
URL, and a canonical URL without query parameters or a trailing slash. Both
`/download` and `/download/` must remain in `assets.run_worker_first`; localized
routes are already covered by the locale patterns.

Approved public cards use the card's localized name, summary and avatar. Their
canonical/og:url uses the community-wide card ID, including when the visitor
arrives using a card number or a legacy provider-local ID. This prevents two
providers with the same upstream ID from sharing the wrong preview URL.
Existing adult, moderation and non-public preview restrictions remain in force.
All canonical URLs continue using the site's existing primary-domain policy.

Validation uses real Worker HTML responses, the deployed assets binding, five
locales, all three site hosts, escaped card text, trailing slashes, colliding
provider IDs, and restricted-card negative controls. The previous card-number
test now expects the global ID instead of the ambiguous upstream ID; this is
an intentional canonical contract correction.

MCP/Moonloom: not applicable. This changes public HTML metadata, not a new
service API, permission or AI-client workflow.

Observability: reuse the existing `page_html` event with low-cardinality
`detail=download` for the new route and CI/live HTML readback. No new Prometheus
metric or identifiers are introduced. Check HTTP status, title, description,
canonical, og:* and twitter:* directly with a sharing-crawler user agent.
Discord and other services can retain their own cached previews; a correct
fresh HTML response does not prove an already-posted message has refreshed.
