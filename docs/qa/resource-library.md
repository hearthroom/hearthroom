# Provider resource library

需求：資源依使用者明確選取的託管商管理；單站自動選取，多站記住使用者上次選擇。
驗收：供應商與授權綁定、分頁失敗不跳頁、晚回應不覆蓋、預覽與批次管理、五語、桌面與手機、逐檔上傳與原站重試。
範圍：Hearthroom 資源頁與 Harbor 公開圖片契約；不搬移不同供應商的檔案，不改全站登入供應商。

## Contract

`GET /open/v1/image/list` retains `scope`, `folderId`, `kind`, `pageNum`, `pageSize`.
Harbor additionally supports literal filename `q` (up to 200 characters) and `sort=newest|oldest|name|size`.
The response includes `capabilities: {kinds, formats, maxFileBytes, search, sorts, overwrite}`.
Search, ordering and total apply to the whole selected collection, before pagination; queries remain tenant/owner scoped. Referenced external assets are not hosted inventory.

Providers that do not return capability metadata retain their existing resource listing and upload API, but the page does not invent format/size limits or advertise unsupported search/order controls. LunaTalk's deployed contract currently has no capability metadata; extending its independently operated service is outside this Harbor deployment. Its capacity and prefix are still read from its API.

A client captures provider + token when created. It never changes the community session or global upstream. Numeric LunaTalk IDs and string Harbor IDs remain intact; Harbor deletes use `imageId` and LunaTalk uses `imageIds`.

## Parity and observability

No new MCP transport exists on Harbor. HTTP discovery is documented here; future MCP must reuse the media service. The resource page itself is a browser interaction, so Moonloom changes do not apply.

Harbor reuses `harbor_contract_authoring_total` (counter, `op=list|upload_complete|upload_multipart`, `result=ok|rejected|error`) at the existing handler completion points. No identifiers or search text are metric labels. Verification: `sum by (op,result) (increase(harbor_contract_authoring_total{op="list"}[10m]))` and `/metrics` readback. The web UI adds no server job or metric.

## QA matrix

- One identity: label only; multiple identities: explicit selection; zero: link account.
- Slow first-provider response after switching is discarded; every read/write uses the selected issuer token.
- 120+ files: 24/48/96 page sizes, successful page persisted, failed next page retry does not skip; filters start at page one; unknown quota is not zero.
- Click preview, arrow navigation including page boundary, close restores focus; zoom/pan, unavailable preview, font/audio/video controls.
- Batch operations only affect selected page; pagination and provider switch clear selection. Partial failure retains its error after refreshed readback.
- Multi-file upload, fixed provider/folder, per-file progress, failure-only retry, overwrite notice, provider quota failure.
- zh-Hant/en at desktop and 390px; all five locale dictionaries validated; keyboard dialog focus containment and Escape.

## Execution evidence — 2026-09-20

- Component regression tests exercise single/multiple providers, stale responses, failed pagination, URL sort restoration, server search, page selection reset, expired auth and failed-only upload retry. Client tests cover issuer isolation, unknown quota and resuming completion without duplicating the upload.
- Browser checks use the real page and shared styles with disposable synthetic providers (121 and 54 files): desktop preview/zoom, 48-to-49 preview boundary, focus restoration, next-page results, provider switching, 24-item pages, collection search and single-provider automatic selection. At 390×844, Traditional Chinese and English light/dark layouts have no horizontal overflow; controls were visually inspected and text-bound geometry checked. Final console errors: none.
- A synthetic two-file upload exercised intent, PUT, completion, one injected failure and failed-only retry through the page. Native file chooser automation was blocked by the browser extension's file URL permission; that OS entry step is not claimed as verified. No private or production files were uploaded or deleted.
- Hearthroom typecheck, full Worker/web suites and complete pinned-stage/web build pass. The optional external real-card probe remains skipped because its fixture is unavailable. Existing build warnings concern font resolution and bundle size.
- Provider query/contract tests use real PostgreSQL, including ownership, literal search, sorting, totals, pagination, filename preservation and metrics. The full Provider suite and layering, line-count, append-only migration and sqlc gates pass. Deployment-script tests pass in Linux; macOS lacks `flock`.
- The unchanged legacy server offline suite passes with `LC_ALL=C`; its standalone checkout skips the sibling-spec checker. Running that checker explicitly reports the same three baseline Harbor-only route gaps (`/conversation/ws`, `/hosting/seal`, `/media/references`) on both origin/main and this change. This is existing legacy-router coverage debt, not a new route introduced here. The Provider's own contract tests and exact OpenAPI-copy comparison cover the deployed service.

Release acceptance additionally requires successful CI deployment of the pushed source and independent live page/API readback; local and synthetic results alone are not production proof.
