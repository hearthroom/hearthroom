<p align="center">
  <img src="web/public/icons/icon-192.png" width="96" alt="">
</p>

<h1 align="center">Hearthroom</h1>

<p align="center">
  An open, community-run board for AI character cards.<br>
  Rankings, search, author pages, a card editor, and community review — on a single Cloudflare Worker.
</p>

<p align="center">
  <a href="https://hearthroom.club"><img src="https://img.shields.io/website?url=https%3A%2F%2Fhearthroom.club&label=hearthroom.club" alt="Website"></a>
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

## What is Hearthroom

Hearthroom is a public board where authors list their AI character cards and readers find them: rankings by day, week and month, search by name, summary or tag, author pages, and a card editor with a chat test panel.

Cards themselves are not stored here. They live with a **card provider** — a chat service that exposes an open API for sign-in, card data and conversations. Hearthroom owns only three things: which cards are listed, how they rank, and the search index. Authors sign in through the provider, register a card by ID, and the site pulls the public fields from the provider on an hourly sync. Removing the site would not remove a single card.

Listing goes through **community review**: reviewers claim submissions from a shared queue, two approvals are needed for a first review, one for a re-review, any rejection rejects, and the review page hides the author. An approval is tied to the card's content version; when the author changes the card, it leaves the board and queues again.

## Features

- **Board** — daily, weekly and monthly rankings, "hot" and "new" sorts, tag filters, author ranking, and language zones.
- **Search** across names, summaries and tags.
- **Author pages** with all of an author's listed cards.
- **Card editor** — persona, openings, lorebook, regular-expression rules with a live test box, image fields, and a resizable chat test panel. Imports SillyTavern PNG/JSON cards.
- **Two chat pages** — a sandboxed page that runs a card's styles and scripts in isolation (default), and a classic page for older cards. The author-facing contract is in the [card authoring guide](docs/guide/card-authoring.en.md).
- **Community review** with blind, two-stamp approval and version-bound listings.
- **Adult content gating** with an age gate and per-tag hiding.
- **Installable** as a web app on desktop and mobile.
- **Five languages** — Traditional Chinese, Simplified Chinese, English, Japanese, Korean.

<p align="center">
  <img src="docs/screenshots/board-light.png" width="49%" alt="Board, light mode">
  <img src="docs/screenshots/guide.png" width="49%" alt="Card authoring guide">
</p>

## Using the site

The public instance is at **[hearthroom.club](https://hearthroom.club)**.

1. **Browse** without an account: the board, search, card pages and author pages are public.
2. **Sign in** with your card provider account from the *Sign in* button. Hearthroom never sees your password; the provider issues a token scoped to this site.
3. **List a card** from *My cards*: your cards at the provider appear there; pick one and submit it for review, or create a new one in the editor. There is a weekly listing limit per author.
4. **Write cards** with the [card authoring guide](https://hearthroom.club/guide): fields, rules, the sandbox author API, and importing from other platforms.
5. **Integrate** with the [developer documentation](https://hearthroom.club/developers) and the [OpenAPI description](docs/openapi.json).

## How it works

```
src/          Cloudflare Worker (Hono): community API, review, hourly sync, share previews
web/          Vue 3 + Vite single-page app, five locales
migrations/   D1 schema
stage/        Chat stage (git submodule, pinned): the conversation UI used by /play
docs/         Developer docs, OpenAPI description, card authoring guide, architecture notes
scripts/      Deploy preflight, asset archive, reviewer grants, mock upstream for local dev
```

The API and the front end run on **one Worker**: `/v1/*` is handled by Hono, everything else falls through to the built SPA. Storage is **D1** (registrations, members, review), **KV** (response cache and an archive of previous asset builds so stale tabs keep working after a deploy), and optionally **Analytics Engine** for usage events. A cron trigger syncs card names, covers and popularity signals from the provider every hour.

The chat stage is a separate open-source project pulled in as the `stage/` submodule and built into the SPA at build time. Changes to it go upstream; this repository only moves the pinned commit.

Design decisions and the reasoning behind them are collected in [docs/architecture.zh-Hant.md](docs/architecture.zh-Hant.md) (Traditional Chinese).

## Development

Requirements: Node 22 and npm. The front-end tests fail on Node 26 because of its built-in `localStorage` global.

```bash
git clone --recurse-submodules https://github.com/hearthroom/hearthroom.git
cd hearthroom
npm install                 # workspaces: Worker and web in one go
npm run migrate:local       # apply D1 migrations to the local database
npm run build:stage         # build the chat stage once (needed by the web build and tests)
npm run dev                 # Worker on :8787
npm run dev:web             # Vite on :8850, proxies /v1 to :8787
```

Useful commands:

| Command | What it does |
|---|---|
| `npm test` | Worker tests (Vitest with the Workers pool) and web tests |
| `npm run typecheck` | Generates Worker types, then type-checks both packages |
| `npm run build` | Builds the stage and the web app into `web/dist` |
| `npm run i18n -w web` | Reports translation coverage per locale and flags untranslated strings in components |
| `npm run sync:stage` | Pulls the stage's upstream `main`, runs its tests, rebuilds, and leaves the submodule pointer for you to commit |

### Working on the editor locally

The editor sits behind the provider's OAuth, which cannot complete against `localhost`. A mock provider keeps cards in memory and accepts any bearer token:

```bash
node scripts/mock-upstream.mjs                                  # :8899
VITE_LUNATALK_API_BASE=http://127.0.0.1:8899 npm run dev:web
```

Then, in the browser console, plant a token:

```js
localStorage.setItem("hearthroom.oauth.access", JSON.stringify({ accessToken: "tok", expiresAt: Date.now() + 3600e3 }));
```

`/__log` on the mock shows the requests it received; files placed in `scripts/fixtures/` (git-ignored) are served at `/fixtures/<name>` for testing imports.

## Self-hosting

Everything runs on a Cloudflare account; the free tier is enough for a small community.

1. Create the resources and put their IDs in `wrangler.toml`: a **D1** database (`DB`), two **KV** namespaces (`CACHE`, `ASSET_ARCHIVE`), and optionally an **Analytics Engine** dataset (`EVENTS`; set `ANALYTICS_ENABLED = "false"` to skip it).
2. Point the site at your domain: `routes` in `wrangler.toml`, `HOST` in `src/site.ts`, and the site name in `web/src/lib/site.ts`. Custom domains cannot be attached to a hostname that already has a DNS record; delete the parking record first.
3. Configure the provider: `LUNATALK_API_BASE` (and the regional fallback `LUNATALK_API_BASE_CN`) in `[vars]`. The variable names reflect the first provider wired in; the site treats it as a generic provider.
4. Optional review bot: `REVIEW_BOT_ACCOUNT_NUM_ID` in `[vars]` and `wrangler secret put REVIEW_BOT_KEY`. Without both, submissions list immediately instead of going through review. Grant reviewers with `node scripts/grant-reviewer.mjs <provider account id>`.
5. Deploy:

```bash
npm run migrate:remote
npm run deploy              # runs preflight, typecheck, tests and the build first
```

**Continuous deployment.** The included workflow (`.github/workflows/deploy.yml`) type-checks, builds and tests every push and pull request. On `main`, if the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set, it applies migrations and deploys; otherwise it reports that deployment was skipped and stays green.

## Contributing

Issues and pull requests are welcome.

- **Bugs and ideas** — open an [issue](https://github.com/hearthroom/hearthroom/issues). For bugs, include the page, the browser, and what you expected to see.
- **Pull requests** — CI runs typecheck, build and tests on every PR. Please keep a PR to one change, add or update tests next to the code it touches (`test/` for the Worker, `web/test/` for the front end), and run `npm test` before pushing.
- **Translations** — UI strings live in `web/src/locales/<locale>.json`, one file per language. `npm run i18n -w web` shows what each locale is missing. New strings must be added to all five files; the test step fails if a component contains untranslated text. The authoring guide has one file per language under `docs/guide/`.
- **Chat stage** — changes to the conversation UI belong in the stage project, not here.
- **License** — contributions are accepted under the same AGPL-3.0 license as the project.

## License

[GNU Affero General Public License v3.0](LICENSE). If you run a modified version as a network service, you must offer its source to your users.
