# Official domain integration

Hearthroom serves `hearthroom.club`, `sukisuki.ai` and `sukisuki.chat` directly.
The new domains keep their own origin and browser session. Search canonical URLs
continue to use `hearthroom.club`. The hostname contract is `shared/site-hosts.ts`.

For each root:

- Root and `www` are Hearthroom custom domains; `www` redirects to its own root.
- A proxied wildcard `AAAA 100::` and `*.<root>/*` Worker route serve isolated
  `c<roleId>.<root>` sandboxes and `play.<root>` installed card apps.
- `playground.<root>` is a Moonstage custom domain with a more specific zone
  route. It must take precedence over Hearthroom's wildcard route.
- Sandbox hosts serve only the three shell assets. Their CSP allows embedding
  only by the explicit official community and card-app origins.
- Provider OAuth registers the callback from the actual browser origin.
  Discord keeps its registered canonical callback and binds the return origin
  into the server-stored state digest before returning the one-time receipt.

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
