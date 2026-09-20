---
id: RESOURCES-01
page: /resources
platforms: [desktop, mobile]
states: [single-provider, provider-choice, loading, error, empty, paged, preview, uploading]
critical_payloads: [provider, page, pageSize, folder, kind, q, sort]
mutating: true
---

# Provider resource library

Use disposable fixture files/accounts for mutations. Production readback is read-only.

1. With one linked provider, open Resources and require automatic selection and a hosting label. With multiple providers, require a choice; switching must clear old resources and ignore a late response from the previous provider.
2. Check provider quota, prefix and supported upload rules. Missing metadata must remain unknown, not fabricated as zero or a shared limit. Unauthorized access must offer reconnection instead of an empty library.
3. With 120+ files, select 24/48/96 items per page. Navigate, reload and restore URL filters/sort. Fail the next request: keep the current page and retry the same target. Search must include matches beyond the current page.
4. Open an image, zoom and pan, navigate across the page boundary, then close using Escape. Require the original grid page, scroll position and focused tile. Check media-specific preview controls for supported kinds.
5. Select items in Manage mode. Page/provider changes clear selection. Folder assignment/removal and deletion must use the selected provider and show operation failures. Deleting the final page's items must return to a valid page.
6. Upload two disposable files with one injected failure. Show the fixed target provider/folder and per-file status. Retry only the failed entry; completed storage writes must not be duplicated when completion is retried.
7. Inspect desktop and 390×844 light/dark layouts, Traditional Chinese and English, keyboard focus and dialog containment. Validate all five locale dictionaries. Require no overflowing controls or clipped labels.
8. After CI release, check the real signed-in resources page and Provider capability/metric readback without mutating production inventory.

See [contract and execution record](../../resource-library.md) for API parity, observability and environment limitations.
