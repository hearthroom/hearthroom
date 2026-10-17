# Official domain integration

Hearthroom serves `hearthroom.club`, `sukisuki.ai`, `sukisuki.chat` and `sukisuki.pro` directly.
The new domains keep their own origin and browser session. Search canonical URLs
continue to use `hearthroom.club`. The hostname contract is `shared/site-hosts.ts`.

For each root:

- `hearthroom.club` and `sukisuki.ai` root and `www` use Custom Domains.
  `sukisuki.chat` and `sukisuki.pro` instead use root and wildcard Worker Routes,
  with DNS-only CNAMEs for root, `www` and `*` pointing to `nova51.cf.090227.xyz` for `.chat` and
  `spark83.cf.090227.xyz` for `.pro`.
  Use this selected wildcard-prefixed ingress: the provider root currently has
  a different DNS chain, despite the website describing the names as equivalent.
  The former preferred target was `cf-cname.xingpingcn.top`; changing only these
  three CNAME targets back provides a provider-only rollback.
  This preferred-ingress setup is experimental: official Routes documentation
  requires proxied DNS. Do not replace these CNAMEs with managed Custom Domains
  during deployment. Every `www` redirects to its own root.
- The wildcard DNS record and `*.<root>/*` Worker route serve isolated
  `c<roleId>.<root>` sandboxes and `play.<root>` installed card apps.
- `playground.<root>` is a Moonstage custom domain with a more specific zone
  route. It must take precedence over Hearthroom's wildcard route.
- Sandbox hosts serve only the three shell assets. Their CSP allows embedding
  only by the explicit official community and card-app origins.
- Provider OAuth registers the callback from the actual browser origin.
  Discord keeps its registered canonical callback and binds the return origin
  into the server-stored state digest before returning the one-time receipt.

`AUTH_ALLOWED_ORIGINS` remains the existing encrypted allowlist.
`AUTH_ADDITIONAL_ORIGINS` adds only `https://sukisuki.pro`,
`https://www.sukisuki.pro` and `https://play.sukisuki.pro`; exact matching,
same-origin CSRF checks and private/no-store responses remain in force. Add the
three corresponding `/auth/callback` URLs to the existing Harbor OAuth client;
do not create a replacement client or move existing grants.

For `.chat` and `.pro`, `cli` also uses a DNS-only CNAME to its root family's
preferred target. Roll back CLI alone by replacing that CNAME with proxied
AAAA 100::, while retaining its exact Worker route.

Keep `cli.<root>/*` on hearthroom-cli-site, `playground.<root>/*` on
moonstage-playground, and `downloads.<root>/*` without a Worker (R2). The new
`.pro` zone needs these precise exceptions before exposing those hostnames.
Quick preferred-ingress rollback: change root, www and wildcard to proxied
AAAA 100:: while retaining the root and wildcard Routes. No database migration
or Worker code rollback is needed for a DNS-only rollback.

`harperharbor-assets-cors.json` is the R2 CORS contract for the HarperHarbor
media bucket. Apply through the Cloudflare API using existing operator credentials;
read the current rules first and preserve unrelated concurrent changes. No secrets
belong in this repository. GET/HEAD/PUT and the existing request headers remain
unchanged; PUT still requires a signed upload URL. The retired `sukisuki.club`
entry is replaced by the owner-confirmed `sukisuki.chat`.

HarperHarbor Bearer API CORS already permits these origins without cookies. Do
not widen session-cookie endpoints or enable credentialed wildcard CORS.

Verification: full Worker/web tests, typecheck/build, Moonstage tests and builds,
including copying the sandbox into the Playground assets in both standalone and
combined deployment workflows, then HTTPS/readback of each root, card app, sandbox and Playground. Verify media
OPTIONS for permitted origins and rejection of an unrelated origin. Browser
verification must include sandbox loading and OAuth navigation; homepage loading
alone does not establish complete integration.

MCP: not applicable; this changes browser origins and deployment routing, with no
new public API operations or authorization scopes. Observability reuses
`sandbox_shell`, `host_redirect` and community request outcomes plus Cloudflare
HTTP/error metrics; no new private or high-cardinality labels.
