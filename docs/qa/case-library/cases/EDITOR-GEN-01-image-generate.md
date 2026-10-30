---
id: EDITOR-GEN-01
page: /cards/:roleId/edit, /create
platforms: [desktop, mobile]
states: [hidden, reauth, ready, running, background, saved-and-filled, saved-not-found, unnamed-card]
critical_payloads: [size, prompt, directory, roleBackground, roleBackgroundLandscape]
mutating: true
---

# Generate the portrait and wide background inside the card editor

Signed-in generation (`media.generate`, purchased credits only) from the editor's
image fields. The dialog is the resources page's `GenerateImageDialog`; entry state
and re-authorization come from `web/src/lib/use-image-generation.ts`, shared with
the resources page. Real generation spends purchased credits: use synthetic mocks
locally, and a live run needs the owner's go-ahead.

1. Without Harbor's generation endpoints (models 404) the fields show only Choose
   image and Pick from library. With them, the vertical background (portrait) and
   wide background show Generate; the share image does not.
2. With an empty card name, Generate opens nothing and the status line says to
   add a name first, because the image goes into a folder named after the card.
3. Generate next to the vertical background: the dialog preselects the size
   closest to 9:16 (e.g. 1024x1536). For the wide background it picks the size
   closest to 16:9 (1536x1024). The description starts from the card name and
   summary with the orientation, and the author can rewrite it.
4. Submit: one `POST /open/v1/generations/images` with an Idempotency-Key,
   polling while running, then `POST …/{id}/save` with `{directory: <card name>}`
   (`/` in the name becomes `-`). The library URL is found by
   `GET /open/v1/image/list?q=<first 8 chars of the task id>`, matched by asset id.
5. The dialog closes, the frame shows the new image, and the status line says it
   is in the folder and filled the field. If no URL matches, the image is still in
   the folder and the status line says to pick it from the library.
6. Save the card: `POST /open/v1/role/{id}/document` carries the generated URLs as
   `roleBackground` (plus its `roleAvatar` alias) and `roleBackgroundLandscape`.
7. 403 on models: the dialog asks to sign in again and allow generation, once;
   after returning, a second 403 says generation is not available here yet.
8. Close while running: generation continues. That field's button reads
   Generating… and reopens the same dialog; the result still fills that field.
9. Check desktop 1440px and phone 390×844, light and dark, all five languages:
   the phone dialog is a bottom sheet with full-width actions, there is no
   horizontal overflow, and the dialog audits clean. Screenshot after the backdrop
   fade-in, because mid-animation captures show the page through the panel.

## Execution record — 2026-10-30

Real `CardEditorPage` through Vite dev in Chrome (Playwright, `channel: chrome`),
with sign-in (`/v1/auth/*`), card endpoints and Harbor `/open/v1/*` answered by
synthetic mocks. No real generation, credits or accounts were used. The test card
was `LT_TEST 灯塔守望者`.

| Run | Steps 3–6 | Save | Dialog audit (overlaps / clipped / contrast / small targets) | Console errors |
| --- | --- | --- | --- | --- |
| desktop light zh-Hans | PASS | 已保存。 | 0 / 0 / 0 / 0 | none |
| desktop dark en | PASS | Saved. | 0 / 0 / 0 / 0 | none |
| desktop light ko | PASS | 저장했습니다. | 0 / 0 / 0 / 0 | none |
| phone light ja | PASS | 保存しました。 | 0 / 0 / 0 / 0 | none |
| phone light en | PASS | Saved. | 0 / 0 / 0 / 0 | none |
| phone dark zh-Hant | PASS | 已儲存。 | 0 / 0 / 0 / 0 | none |
| phone dark ko | PASS | 저장했습니다. | 0 / 0 / 0 / 0 | none |

Probe v3 (touch 44 / desktop 24 CSS px). Positive control: a planted raw key and
two overlapping buttons were both flagged. Whole-page audits after saving report
pre-existing items: the sticky section tabs overlapping controls scrolled under them,
and on phones every `btn--sm` image-field action at 30px, including the new Generate
button. Steps 2 and 7 are covered by `web/test/editor.test.ts` and
`web/test/resources-generate.test.ts`. Step 8 (desktop en): after Keep going in
background, the portrait button read Generating… and the wide one Generate. The
wide button reopened the running portrait dialog (1024x1536), whose result filled
only the portrait.

HTTP/MCP: no server or schema change. The editor calls the existing
`/open/v1/generations` and library list endpoints, and agents already have
`hearthroom media generate --dir`. Observability: web-only change; Harbor's existing
media generation metrics cover the requests.
