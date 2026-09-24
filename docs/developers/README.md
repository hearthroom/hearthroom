# Developer documentation translations

The public developer page has five editions: Simplified Chinese (China), Traditional Chinese (Taiwan), English (United States), Japanese and Korean. It uses the existing site locale codes `zh-Hans`, `zh-Hant`, `en`, `ja` and `ko`.

The English overview is `../developers.md`. The other editions are the Markdown files in this directory. The two canonical OpenAPI sources are `../community-openapi.json` and `../integration-openapi.json`; source-download links explicitly identify them as English.

`catalog.json` maps stable message IDs to English reference text. Each file under `locales/` maps those same IDs to a translation. IDs are opaque: preserve an existing ID when editing its English wording and update all translations in the same change. For new text, choose a unique ID. Identical English text shares one translation. The coverage test reports source text that has not been added to the catalog.

Only prose and displayed tag labels are localized. Do not translate paths, methods, field names, schema keys, scopes, enum values, defaults, operation IDs, code spans or examples. Keep numerical constraints, ownership rules, private-data access, permission limits and paid-action effects intact. Tag and endpoint anchors continue to use canonical names across languages.

The page loads the selected language on demand. Its controls use the site's existing `web/src/locales/*.json` dictionaries. A failed language download displays a translated error with a reload action. Changing language supersedes any earlier pending download.

Run the web trusted suite with `npm run test -w web`. The documentation tests check complete locale coverage, code spans, numerical constraints, unchanged wire contracts, both references, endpoint expansion and every contents link. Language-loading tests cover stale responses, failed downloads and deep links. These checks complement language review; they do not prove that every translation reads naturally.
