# Site maintenance mode

The switch lives in Cloudflare D1 (`community_settings.site_maintenance`), independently of Harbor. No Provider call, application redeploy, new resource, or schema migration is required to toggle it. An absent record means off. The estimate never disables the switch automatically.

If your Cloudflare login has multiple accounts, set `CLOUDFLARE_ACCOUNT_ID` to the account owning the configured D1 before running the commands.

Only an operator with Cloudflare D1 write access can change it. Obtain the owner's authorization before a production toggle. These commands must run from the exact released Hearthroom checkout:

```sh
# Enable, estimating ten minutes from now (or use --until 2026-10-26T12:10:00+08:00).
node scripts/maintenance-mode.mjs on --remote --minutes 10
# Read durable state, independently of the Provider.
node scripts/maintenance-mode.mjs status --remote
# After Provider health/readiness has recovered, explicitly disable.
node scripts/maintenance-mode.mjs off --remote
```

For local QA, replace `--remote` with `--local`; this targets Wrangler's local D1 in this worktree. Do not point local QA at the production database. Apply local migrations once with `npx wrangler d1 migrations apply DB --local`, build with `npm run build`, then serve with `npx wrangler dev --port 8796`. Stop the local Provider/mock to exercise the outage path. The mode does not require the mock to start. Use `/`, `/en/cards/123`, `/mine`, `/play/123` and the play/sandbox hosts to check entrypoints. Use the `lang` query parameter on card-app hosts.

The command requires an explicit environment. It writes the current state and an event record (`maintenance_event_<operation>`) with action, time and state, then reads current state back. A nonzero/unknown result requires `status` readback before another write. The estimate accepts a duration of 1–10080 minutes or a future ISO date containing an explicit timezone. Both cannot be specified together.

During maintenance, initial HTML documents are served a standalone SPA shell with 503, `Retry-After: 15`, `no-store` and `noindex`. Metadata and identity resolution are bypassed. `/v1/*`, `/hh-api/*`, and `/auth/*` return 503 before authentication, proxy upgrade or new Provider work. Static assets, `/v1/maintenance`, `/metrics` and internal operator endpoints remain reachable. Scheduled work is held. Requests already admitted before activation are not cancelled; allow them to settle before shutting down the Provider. This switch does not control Harbor clients outside Hearthroom or already established connections.

The web app checks before installing the router or restoring accounts. Existing pages check every 15 seconds while visible, and on focus/visibility return. A native modal in the browser's top layer blocks pointer and keyboard access to the site, teleported panels, stage and sandbox. Escape cannot close it. The check button only checks availability; it never repeats a chat/action. Existing page state remains mounted and is revealed when disabled. An initial direct sandbox document reloads its original URL after maintenance ends. A failed check retains an already active announcement; an estimate that has elapsed displays the unconfirmed-time text.

A page must load this release once to acquire polling. Tabs holding an older release cannot gain the new UI without a reload; their Worker requests are still rejected. Announce/reload before the maintenance window. Direct Harbor transport in an old tab is outside the Worker gate.

## Readback and observability

```sh
curl -fsS https://sukisuki.ai/v1/maintenance
curl -fsS https://sukisuki.ai/metrics | rg 'hearthroom_maintenance_'
```

- `hearthroom_maintenance_enabled`: gauge, 1 while active, 0 while inactive; emitted on `/metrics` from D1 state.
- `hearthroom_maintenance_requests_total{surface="page|api|status",outcome="blocked|error"}`: durable counter. Admission rejections emit `page/api,blocked`; state read/configuration failures emit `status,error`. No request paths, identities or free text are labels. Successful polls are measured by the gauge and do not create a D1 metrics write every 15 seconds per viewer.
- PromQL: `hearthroom_maintenance_enabled`; `sum by(surface,outcome)(increase(hearthroom_maintenance_requests_total[10m]))`.

Read `/v1/maintenance` on the primary host and each active alternate/play host after toggling. Verify the active announcement, hold with Provider unavailable, bring Provider back, verify its readiness, then disable and observe an existing tab recover. Local checks are not production readback.

MCP decision: not applicable. This is a Hearthroom availability/status surface and a Cloudflare operator command; it grants no new Harbor data or account capability and must remain controllable while Harbor/MCP is stopped.
