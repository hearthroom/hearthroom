# Develop the public Hearthroom site

You can run the site and local Worker with the public checkout. This build supports browsing, search and card details. The full build with Moon Stage provides play, play-dependent previews, author editing and the sandbox. The public build shows card text in its original script.

With Node.js 22 installed:

```sh
git clone https://github.com/hearthroom/hearthroom.git
cd hearthroom
npm ci
npm run build:public
npm run test:public
npm run migrate:local
npm run dev:public
```

Open the local URL that Wrangler prints. The local database starts empty. The public assets are in `web/dist-public`, which the local Worker uses for this command. The full build uses `web/dist` and its own Stage installation.

The author SDK contract is available in `web/public/contracts/sandbox-contract.json`. It records the exact Stage revision used to generate the public fields and includes its [Moon Stage license notice](../web/public/contracts/LICENSE-Moon-Stage.md). The full build's maintainers can check the snapshot with `node scripts/public-sandbox-contract.mjs --check` after checking out the pinned Stage.
