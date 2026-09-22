# Card detail sidebar spacing

## Scope

Keep the public card sidebar's content and controls inside symmetric padding on desktop and mobile. Keep platform selection and the primary play action on their own row; reporting and sharing are secondary actions. No copy, API, payment or authorization behavior changes.

## Evidence

The original desktop sidebar measured 300 CSS px with 16 px padding on each side, but its implicit grid column expanded to 288 px instead of 268 px. The cover, identity section, statistics, tags, action row and favorite control exceeded the right content boundary by 20 px. This is the failing rendering checkpoint and positive control for the geometry assertion.

The fixed grid uses `minmax(0, 1fr)` and the platform component sits outside the secondary flex action row. The action row can wrap. The mobile platform selector spans both columns. Long titles can wrap inside their grid item.

Native Chrome verification on the local frontend:

- Desktop: sidebar column 268 px; 16 px inset on both sides; no cover, link, button, radio or platform container outside its content boundary.
- 390 x 844 viewport: content bounds 32..358 px; no affected control outside those bounds.
- Switch language through the visible menu to English at the narrow viewport: no affected control overflow.
- Screens inspected for cover/title alignment and platform controls. No conversation, favorite, report submission, or account connection was created.
- Original production reproduction included a linked session; local fixed rendering used a guest session. Linked balance error text on the fixed version was not separately exercised.

Verification commands: `npm test -w web` and `npm run build:web` passed. The initial test run printed Node 26 localStorage and sandbox network warnings. The complete repository suite is rerun with experimental web storage disabled and local Worker networking available; its result is recorded separately below.

No new API or MCP surface; MCP/Moonloom parity is not applicable. No server, job, billing or authorization change; new Prometheus metrics are not applicable. This is local evidence, not a deployment receipt.

Complete repository suite: Worker 49 files / 520 tests passed; web 86 files / 471 tests passed, one opt-in suite skipped. Exit status 0. Happy DOM still printed refused/aborted iframe fetches for fixture URLs at localhost:3000; no assertion failed. These messages are retained in the local test log and are not production/network acceptance. The stage source was unchanged; its pinned build artifacts were reused, and its separate full suite was not run. Web typecheck and production build passed, with existing bundle-size warnings.
