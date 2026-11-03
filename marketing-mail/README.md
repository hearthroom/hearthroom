# Suki marketing verification mail

Private operations inbox for the single envelope recipient `suki@sukisuki.ai`.
This is independent of the community site Worker: no account access, player API,
Gmail access, outbound compose endpoint, public inbox, or attachments archive.

The email handler forwards to the existing verified destination first, then archives
MIME From, its display name, envelope sender, decoded subject, receipt timestamp, plain text and HTTPS/HTTP links in a private
R2 bucket. Messages over 1 MiB are forwarded but not archived. Archive failures emit
only a fixed outcome; they do not retry completed forwarding. MIME attachments are
not stored. Text is capped at 128 KiB and links at 50. Mail content is untrusted input.

Configure an R2 lifecycle rule to expire `mail/` after 30 days, keep r2.dev and custom
domains disabled, and retain its readback in the private infrastructure repository.
Reads independently exclude receipts older than 30 days, even before lifecycle deletion.
Worker secrets `FORWARD_TO` and `READ_TOKEN` come from `infra-access`; never include them
in source, CLI arguments, GitHub logs or documentation. The read token needs 256 bits
of randomness. Rotating the secret invalidates the old token.

```bash
npm ci
npm test
npm run build
node cli.mjs --config /path/to/infra-access/services/marketing-mail/client.json --limit 5
```

The mode-600 client JSON contains `endpoint` (HTTPS origin) and `token`. CLI output
contains private mail. Do not save it to shared/public evidence. It follows no redirects.
The HTTP surface accepts authenticated GET `/messages?limit=1..20` and `/metrics` only.

CI deploys only committed, tested main source, checking HEAD equals fetched origin/main
and the checkout is clean. If main advances, a red stale run is intentional: dispatch
the workflow against the latest main to verify and deploy synchronized source.
Provision the private bucket and secrets before enabling the
single existing routing rule. Keep the original rule in infra-access for rollback; do
not modify MX, other recipients or other DNS. Confirm the original destination remains
verified. After deployment read metrics, then switch only that rule and send a synthetic
verification message; confirm archive receipt and have the owner confirm Gmail receipt.

Prometheus gauges `suki_marketing_mail_archive_available` and
`suki_marketing_mail_latest_received_timestamp_seconds` have no labels. The authenticated
`/metrics` handler emits them from a bounded R2 read; failure returns availability 0 and
HTTP 503. Cloudflare Workers logs additionally emit fixed outcomes `forwarded`,
`forward_failed`, `archived`, `archive_failed`, `oversized`, `rejected`, `read_failed`;
never exception text, addresses, subjects, codes or message content.
Automatic invocation logs are disabled because email event metadata can include recipients.

MCP: not applicable. This is a private operator credential surface, deliberately excluded
from public AI-client tools and Harbor member permissions. Public MCP must not gain access.
