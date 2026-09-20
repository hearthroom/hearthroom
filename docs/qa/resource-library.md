# Provider resource library

需求：資源依資源託管商管理；單站自動選取，多站預設優先 HarperHarbor，明確網址或使用者上次選擇優先於初次預設。
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

- One identity: label only; multiple identities: automatic HarperHarbor default with direct switching; zero: link account.
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

## Resource hosting refinement

The provider switch uses visible buttons, ordered HarperHarbor first. The format disclosure groups readable extensions by media kind and shows the per-file limit separately. Panels, thumbnails and menus share the 16px radius; controls use pills and nested menu rows use the existing 8px token.

Harbor now accepts video (MP4, WebM) and audio (MP3, WAV, OGG), alongside its existing image and WOFF/WOFF2 formats. The shared media service validates actual byte signatures, category agreement, declared size, ownership and quota for multipart and direct uploads. The existing 10 MiB per-file, 2 GiB and 2000-item account limits remain unchanged; this does not claim every codec or container is supported. No migration or new permission is required.

Regression coverage: default provider and explicit URL precedence; stale responses during switching; keyboard selection, Escape, outside click and disabled custom menus; PostgreSQL upload/store/list/idempotent completion for media formats; rejection of HTML, malformed headers and mismatched declared media categories. Public HTTP tests assert returned kinds and the four advertised capabilities.

HTTP/MCP parity follows the shared media service; Harbor has no current MCP transport to extend. Existing `harbor_media_upload_total{result}` and `harbor_contract_authoring_total{op,result}` provide stored/rejected and API results without new labels.

Follow-up execution: the real page with synthetic provider data was checked on desktop and at 390px. Traditional Chinese/English dark and Korean/Simplified Chinese light screenshots were inspected; Japanese labels and 390px layout geometry were checked. Provider and select controls are 44px high, with no horizontal overflow or clipped control content in the measured layouts. Expanded menus/disclosures, provider switching and 24-item pagination passed; MP4 playback reached a decoded ready state and WAV metadata/controls loaded. Final browser console errors: none. Transient browser-control timeouts were recovered through the documented UI APIs. The full frontend suites pass (366 Worker tests, 384 web tests, the existing optional external-fixture probe skipped), as do typecheck and the pinned-stage/web build. Provider full tests and deployment checks pass locally; production acceptance still requires CI and live readback.

## Stable authored prefixes and directory uploads

需求：固定前綴加作者自訂的資料夾／檔名即可拼接網址；同路徑重傳更新內容、網址不變。
驗收：兩站前綴常駐顯示且複製含結尾斜線；Harbor 空庫也有公開 UID 前綴；保留原始相對路徑、中文與多層目錄；跨資料夾同名互不覆蓋；1000 個檔案的上傳清單與庫存分頁可用。
範圍：Harbor 固定 UID 命名空間、原子替換與公開網址解析，加上 Hearthroom 目錄上傳；不共用不同供應商的網域、不搬移既有檔案，也不更動 LunaTalk 的獨立後端。

Harbor advertises `relativePaths` and `overwrite`, and accepts an authored
`relativePath` at completion or multipart upload. The first selected folder name
prefixes the submitted path. The visible folder selector normalizes Harbor's `id`
and `itemCount` fields to the client contract. Directory selection sends the
browser's `webkitRelativePath` intact. Providers without the capability do not
show a directory-upload control. Upload progress is paged in groups of 24, with
whole-batch success/failure counts and failed-only retry; this avoids re-rendering
1000 file rows for every completion.

The stable prefix is `https://<API host>/u/<public UID>/`; the trailing slash is
identical on screen and in copied text. The backend's public route resolves the
current object with a non-cacheable redirect. Replacement preserves the original
asset ID and bindings, accounts only for current content, and safely handles old
completion retries. Existing unnamed links remain valid. Folder grouping changes
retain already-published URLs; new uploads use the selected folder's current name.
Uploads still reserve temporary space for the incoming file under existing quotas.

MCP: no current Harbor MCP transport; the OpenAPI contract and shared HTTP service
are updated. Observability: existing contract counter adds `op=library_resolve`,
and the upload counter records `named`/`cleanup_error`, without identifiers or paths.

Validation: PostgreSQL tests upload 1000 authored resources and verify the last
page, account isolation, distinct same-name paths, replacement quota, old URL
compatibility, public redirect cache policy, traversal rejection and completion
retry behavior. Frontend tests exercise 1000 directory files after a single
explicit overwrite confirmation, as well as exact prefix copying and normalized
folder IDs. The initial bulk UI test exposed quadratic rendering; paging reduced
that focused batch from a timeout to a passing run.

Browser evidence: the real page with synthetic data shows both provider prefixes
without expanding a disclosure. Desktop dark and 390px Traditional Chinese dark /
English light layouts were inspected; document width stays 390px and prefix/action
buttons measure 44px with no clipped control text. Browser console errors: none.
Native directory-picker automation was attempted but `setFiles` was rejected by
the Chrome extension's file-URL permission; that OS entry step remains unverified,
while the file-input event, directory path transport and backend behavior are tested.
No production files were uploaded, replaced or deleted for validation.

Sealed-version regression: bind one named image as avatar/background/landscape,
seal, then overwrite and delete the mutable resource. All sealed slots still use
the old immutable URL and bytes. One retained snapshot is counted in existing
storage/item quotas, but omitted from resource and Console inventories. A legacy
sealed unnamed asset cannot be made mutable via a repeated upload completion.
Failed old-blob cleanup followed by deletion preserves retries on failure and
cleans pending bytes on success. These cases have concrete Red/Green evidence.

Release-review limitation: the light controller's Codex CLI review process failed
after bootstrap, leaving no valid receipt. One independent read-only advisory
review found the sealed-media interaction above; the same reviewer checks closure.
A PostgreSQL testcontainer connection failure occurred in the parallel full suite;
final closure uses the complete serial suite on the final committed source.

## Compact resource overview — 2026-09-20

The library takes priority over account metadata: provider choice and storage share
one desktop row; the complete copyable prefix and formats toggle share the next.
Format limits, authored-path help and connection management are disclosed on demand.
The redundant page description is removed. Mobile actions and type/manage controls
use compact spacing while keeping 44px touch targets. Existing five-language copy
and provider-specific behavior are retained.

Focused Red/Green covers the closed/open/closed details control and persistent
prefix access. Full verification: 393 Worker tests and 412 web tests pass, typecheck
and the complete pinned-stage/web build pass. One existing optional real-card
fixture suite is skipped; fixture network-abort logs and bundle-size warnings
remain baseline output. MCP parity and new metrics are not applicable: this change
only rearranges client presentation, without changing API or resource operations.

Native Chrome uses the real page/styles with synthetic provider data. At 1440px,
the overview shrank from 357.5px to 129px; the file grid moved from y=618.5 to y=357.
At 390px, the overview shrank from 476.3px to 252.8px and the grid moved from y=967.3
to y=648.8. Traditional Chinese dark and English light layouts, open details,
provider switching, prefix copy feedback and preview/Escape focus return pass.
The 1000-item library restores page 21 with items 961–1000 and Next disabled.
Final checked browser console errors: none. No production resources are mutated.

The stylesheet-walking diagnostic timed out in the browser bridge. Verification
used the documented fallback: explicit DOM enumeration and computed rect/font/
radius/overflow/text geometry for changed overview, header and type controls,
paired with screenshots. A deliberately shifted disposable button measured a
12px text-center error, confirming the fallback detects misalignment. Both checked languages had no clipped controls; button
text-center offsets stayed within 2px. This is a targeted layout recheck, not a
new full-page audit of unchanged file-operation controls.
