# Card image export regression

## Contract

PNG export can fetch images from the HTTPS apex domains `lunatalk.ai` and
`harperharbor.com`, and their subdomains. Lookalike domains remain blocked.
The image proxy preserves image bytes; it does not convert file formats.
JSON export does not require an image. A PNG failure falls back to JSON and
identifies the failed format without claiming the author omitted an avatar.

## Regression cases

- `test/image.test.ts`: product apex/subdomains, existing hosts, lookalikes,
  HTTP, malformed URLs, non-image responses, byte-preserving PNG response.
- `web/test/editor.test.ts`: export PNG and parse its embedded settings;
  failed image fetch produces JSON; direct JSON works without an avatar.
- `web/test/api.test.ts`: image uploads pass the original GIF File to storage.

## Verification (2026-09-22)

- Red: current asset hosts returned 403; broader apex/subdomain cases also
  failed before the domain-boundary predicate was implemented.
- Green: Worker 594 tests; web 509 tests, with one pre-existing skipped file.
- Web typecheck/build passed; the existing large-chunk warning remains.
- The web suite logs refused requests to a synthetic local preview iframe;
  assertions passed. Initial worktree failures from absent build assets and
  source symlinks were resolved before the final full run.
- Native Chrome, local synthetic card using the real editor: PNG and JSON
  download actions completed without alerts. Reading both files confirmed
  the same name, settings, opening and extensions (export timestamps differ).
- GIF selection rendered alternating frames; saving sent only `roleAvatar`,
  leaving both background fields unchanged. This verifies the editor path,
  not a production upload or the original reporter's animation.

## Contract decisions

MCP: not applicable to this fix; the existing browser download and image proxy
are repaired without introducing a new authoring operation or changing a
provider API. Existing `card_export` success/failure telemetry is retained;
no new Prometheus series is needed for this Worker host-validation correction.
No production writes or deployment were performed.

The independent-avatar behavior above records the first bugfix only. It is
superseded by [the portrait-only contract](card-portrait.md), which also records
the final test results and remaining browser acceptance.
