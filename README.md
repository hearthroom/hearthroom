<p align="center">
  <img src="web/public/icons/icon-192.png" width="96" alt="">
</p>

<h1 align="center">Hearthroom</h1>

<p align="center">
  Open platform for AI character cards: a community board, an in-browser chat to play them, and community-reviewed distribution.<br>
  Runs as a single Cloudflare Worker.
</p>

<p align="center">
  <a href="https://hearthroom.club"><img src="https://img.shields.io/website?url=https%3A%2F%2Fhearthroom.club&label=hearthroom.club" alt="Website"></a>
  <a href="https://discord.gg/C7m85YPHmK"><img src="https://img.shields.io/badge/Discord-join%20the%20community-5865F2?logo=discord&logoColor=white" alt="Discord"></a>
  <a href="https://github.com/hearthroom/hearthroom/actions/workflows/deploy.yml"><img src="https://github.com/hearthroom/hearthroom/actions/workflows/deploy.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/hearthroom/hearthroom" alt="License: AGPL-3.0"></a>
  <a href="https://github.com/hearthroom/hearthroom/commits/main"><img src="https://img.shields.io/github/last-commit/hearthroom/hearthroom" alt="Last commit"></a>
  <a href="https://github.com/hearthroom/hearthroom/stargazers"><img src="https://img.shields.io/github/stars/hearthroom/hearthroom?style=social" alt="GitHub stars"></a>
</p>

<p align="center">
  <b>English</b> ·
  <a href="README.zh-Hant.md">繁體中文</a> ·
  <a href="README.zh-Hans.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p align="center">
  <img src="docs/screenshots/board-dark.png" width="800" alt="Hearthroom board, dark mode">
</p>

## Overview

Hearthroom is an open-source platform for AI character cards. It combines three parts:

- **Board** — authors register cards; readers browse daily, weekly and monthly rankings, search by name, summary or tag, and view author pages.
- **Chat** — every listed card can be played in the browser. The chat stage (a separate open-source project included as the `stage/` submodule) renders the conversation, the card's status bars and panels, and runs the card's scripts in a sandbox.
- **Distribution** — cards are reviewed by the community before listing and are opened with their rules, lorebook and images. SillyTavern PNG/JSON cards can be imported.

Hearthroom differs from SillyTavern in where things run. Nothing is installed locally and no API keys are configured by the user. Sign-in, card storage and text generation are handled by a **card provider**, a chat service with an open API. Hearthroom stores the registry (which cards are listed), the review state, the search index and site-level settings. Authors sign in through the provider and register a card by its ID; the site copies the card's public fields from the provider once an hour. Card content is never stored on the site.

Review works as follows: reviewers take submissions from a shared queue; a first review needs two approvals, a re-review needs one; a single rejection rejects; the review page does not show the author. When an author submits, the site reads the card's full settings once with the author's own sign-in and keeps a review copy; the copy is deleted when the review ends. An approval is bound to a fingerprint of the card's public fields (name, summary, cover, tags, opening). When those change, the card is removed from the board and queued again. Comments under a card are stored by the site itself.

## Features

- Rankings by day, week and month; "top" and "newest" sorts; tag filters; author ranking; language zones.
- Search over names, summaries and tags.
- Author pages listing an author's cards.
- Card editor: persona, openings, lorebook, regular-expression rules with a test box, image fields, and a resizable chat test panel. Imports SillyTavern PNG/JSON cards.
- Two chat pages: a sandboxed page that isolates the card's styles and scripts (default), and a classic page for older cards. The author-facing contract is documented in the [card authoring guide](docs/guide/card-authoring.en.md).
- Community review: blind, two approvals, version-bound listings.
- Age gate and per-tag hiding for adult content.
- Installable as a web app on desktop and mobile.
- Five UI languages: Traditional Chinese, Simplified Chinese, English, Japanese, Korean.

<p align="center">
  <img src="docs/screenshots/board-light.png" width="49%" alt="Board, light mode">
  <img src="docs/screenshots/guide.png" width="49%" alt="Card authoring guide">
</p>
<p align="center"><sub>Screenshots use demo cards.</sub></p>

## Usage

The public instance is at [hearthroom.club](https://hearthroom.club).

1. The board, search, card pages and author pages are public.
2. **Sign in** with a card provider account. The provider issues a token scoped to this site; the site does not receive the password.
3. **My cards** lists the account's cards at the provider. Select one and submit it for review, or create a new card in the editor. Each author has a weekly listing limit.
4. The [card authoring guide](https://hearthroom.club/guide) covers fields, rules, the sandbox author API and importing from other platforms.
5. The [developer documentation](https://hearthroom.club/developers) and the [OpenAPI description](docs/openapi.json) cover the HTTP API.

## Architecture

```
src/          Cloudflare Worker (Hono): community API, review, hourly sync, share previews
web/          Vue 3 + Vite single-page app, five locales
migrations/   D1 schema
stage/        Chat stage (git submodule, pinned): the conversation UI used by /play
docs/         Developer docs, OpenAPI description, card authoring guide, architecture notes
scripts/      Deploy preflight, asset archive, reviewer grants, mock provider for local development
```

The API and the web app are served by one Worker: `/v1/*` is handled by Hono, other paths fall through to the built SPA. Storage: D1 for registrations, members and review; KV for the response cache and for previous asset builds, so tabs opened before a deploy can still load their chunks; Analytics Engine (optional) for usage events. A cron trigger syncs card names, covers and popularity counters from the provider every hour.

The chat stage is built into the SPA at build time. Changes to the stage go to its own repository; this repository only updates the pinned commit.

Design notes and the reasoning behind individual decisions are in [docs/architecture.zh-Hant.md](docs/architecture.zh-Hant.md) (Traditional Chinese).

## Development

Node 22 and npm are required. The web tests do not run on Node 26 because of its built-in `localStorage` global.

```bash
git clone --recurse-submodules https://github.com/hearthroom/hearthroom.git
cd hearthroom
npm install                 # installs the Worker and the web workspace
npm run migrate:local       # applies D1 migrations to the local database
npm run build:stage         # builds the chat stage; required by the web build and tests
npm run dev                 # Worker on :8787
npm run dev:web             # Vite on :8850, proxies /v1 to :8787
```

| Command | Description |
|---|---|
| `npm test` | Worker tests (Vitest, Workers pool) and web tests |
| `npm run typecheck` | Generates Worker types and type-checks both packages |
| `npm run build` | Builds the stage and the web app into `web/dist` |
| `npm run i18n -w web` | Reports translation coverage per locale and lists untranslated strings in components |
| `npm run sync:stage` | Pulls the stage's upstream `main`, runs its tests, rebuilds, and updates the submodule pointer (not committed) |

### Editor without a provider account

The editor requires OAuth with the provider, which does not work against `localhost`. `scripts/mock-upstream.mjs` is an in-memory stand-in for the provider that accepts any bearer token:

```bash
node scripts/mock-upstream.mjs                                  # :8899
VITE_PROVIDER_API_BASE=http://127.0.0.1:8899 npm run dev:web
```

Set a token in the browser console:

```js
localStorage.setItem("hearthroom.oauth.access", JSON.stringify({ accessToken: "tok", expiresAt: Date.now() + 3600e3 }));
```

`/__log` on the mock lists received requests. Files under `scripts/fixtures/` (ignored by git) are served at `/fixtures/<name>` for import tests.

## Self-hosting

The site runs on a single Cloudflare account. The free tier is sufficient for a small community.

1. Create the resources and enter their IDs in `wrangler.toml`: a D1 database (`DB`), two KV namespaces (`CACHE`, `ASSET_ARCHIVE`) and, optionally, an Analytics Engine dataset (`EVENTS`; set `ANALYTICS_ENABLED = "false"` to disable).
2. Set the domain: `routes` in `wrangler.toml`, `HOST` in `src/site.ts`, and the site name in `web/src/lib/site.ts`. A custom domain cannot be attached to a hostname that already has a DNS record; delete any parking record first. Card apps live on `play.<host>` and sandbox shells on `c<id>.<host>`; both are served by the same wildcard route, so the zone needs a proxied wildcard DNS record.
3. Set the provider: `PROVIDER_API_BASE` in `[vars]`. If the provider's main domain is unreachable from some countries, list per-country gateways in `PROVIDER_API_GATEWAYS` (`CC=url,…`); `/v1/region` returns the matching gateway to browsers from that country.
4. Choose whether to review: `REVIEW_ENABLED = "true"` in `[vars]` requires community review; any other value lists submissions without review. Review needs no key or account at the provider. Reviewers are granted with `node scripts/grant-reviewer.mjs <provider account id>`.
5. Optionally set `wrangler secret put SHORTCUT_SECRET` (any random string). It signs the short-lived keys that let members who have enabled adult content add adult cards to their home screen; without it, adult cards simply have no such button.
6. Deploy:

```bash
npm run migrate:remote
npm run deploy              # runs preflight, typecheck, tests and the build first
```

The workflow in `.github/workflows/deploy.yml` type-checks, builds and tests every push and pull request. On `main`, if the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set, it also applies migrations and deploys. If they are not set, the deploy step is skipped and the run still passes.

## Community

Discussion, card sharing and development coordination take place on [Discord](https://discord.gg/C7m85YPHmK). Bug reports and feature requests go to [GitHub issues](https://github.com/hearthroom/hearthroom/issues).

## Contributing

- **Issues** — for bugs, include the page, the browser and the expected behaviour.
- **Pull requests** — CI runs typecheck, build and tests on every PR. Keep a PR to one change, add or update tests next to the code (`test/` for the Worker, `web/test/` for the web app), and run `npm test` before pushing.
- **Translations** — UI strings are in `web/src/locales/<locale>.json`, one file per language. `npm run i18n -w web` reports missing keys per locale. New strings must be added to all five files; the test step fails if a component contains untranslated text. The authoring guide has one file per language under `docs/guide/`.
- **Chat stage** — changes to the conversation UI go to the stage repository, not here.
- **License** — contributions are accepted under AGPL-3.0, the same license as the project.

## License

[GNU Affero General Public License v3.0](LICENSE). Anyone who runs a modified version as a network service must make the modified source available to its users.
