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

1. With one linked provider, open Resources and require automatic selection and a hosting label. With multiple providers and no prior choice, require HarperHarbor to load automatically; honor an explicit provider URL or a valid saved choice; switching must clear old resources and ignore a late response from the previous provider.
2. Check provider quota, prefix and supported upload rules. Missing metadata must remain unknown, not fabricated as zero or a shared limit. Unauthorized access must offer reconnection instead of an empty library.
3. With 120+ files, select 24/48/96 items per page. Navigate, reload and restore URL filters/sort. Fail the next request: keep the current page and retry the same target. Search must include matches beyond the current page.
4. Open an image, zoom and pan, navigate across the page boundary, then close using Escape. Require the original grid page, scroll position and focused tile. Check media-specific preview controls for supported kinds.
5. Select items in Manage mode. Page/provider changes clear selection. Folder assignment/removal and deletion must use the selected provider and show operation failures. Deleting the final page's items must return to a valid page.
6. Upload two disposable files with one injected failure. Show the fixed target provider/folder and per-file status. Retry only the failed entry; completed storage writes must not be duplicated when completion is retried.
7. Inspect desktop and 390×844 light/dark layouts, Traditional Chinese and English, keyboard focus and dialog containment. Validate all five locale dictionaries. Require no overflowing controls or clipped labels.
8. After CI release, check the real signed-in resources page and Provider capability/metric readback without mutating production inventory.

See [contract and execution record](../../resource-library.md) for API parity, observability and environment limitations.

9. Expand upload rules: require readable format groups for image/video/audio/font and a separate size limit. Test the sort/folder/page-size menus with pointer, arrows, Enter, Escape and outside click; labels and focus must follow the committed selection. Inspect the open menu and open disclosure at 390px in English and Traditional Chinese, light and dark.
10. With disposable valid MP4 and WAV resources, open each preview through its tile and verify native media controls, decoded duration and playback. File bytes and private content are never copied to public QA records.
11. With an empty Harbor library, require its fixed public-UID prefix. Switch to LunaTalk and require its own returned prefix; each remains visible without a disclosure. Copy and compare exactly, including one trailing slash.
12. Select a disposable directory containing two subdirectories with the same filename. Require an overwrite confirmation before sending files, authored relative paths throughout the queue/request/result, and two distinct URLs. Repeat one path: URL/asset ID remain stable and public read returns new bytes. Replaying an older completion must not restore old content. Folder IDs from either provider's response shape must round-trip.
13. With 1000 synthetic directory files, require all paths retained, bounded upload-row rendering, whole-batch counts, upload-list paging and failed-only retries. With 1000 stored files, the last library page contains the correct remainder. Reject traversal/absolute/empty path segments and cross-owner/tenant replacement; existing unnamed URLs remain valid.
