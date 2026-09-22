# Animated community avatars

## Scope and acceptance

The `/me` profile editor accepts GIF and APNG, including APNG files named `.png`,
and preserves animation after saving and public delivery. Animated WebP uses the
same preservation path. Existing JPEG/static PNG/static WebP processing remains.
The upload limit is 2 MiB; decoded image area remains limited to 40 megapixels.
This change does not alter provider media uploads, Discord avatars or permissions.

After Images.info validates format and dimensions, animation detection uses GIF
signatures, PNG chunk boundaries (acTL before IDAT), or the WebP VP8X animation
flag. Animated originals are stored byte-for-byte in owned R2. Their public
content types match the stored format. Existing CSS object-fit supplies the
avatar crop. Static images still become 512×512 WebP. Existing ownership,
optimistic update, cleanup and current-avatar-only delivery checks remain.

Cloudflare documents animation support for GIF/WebP, but does not promise APNG
animation transformations. Retaining APNG bytes avoids depending on that behavior.
References: [supported formats](https://developers.cloudflare.com/images/get-started/limits/)
and [Images binding](https://developers.cloudflare.com/images/optimization/binding/).

HTTP/MCP/Moonloom: this is Hearthroom-owned community profile media, not a
Provider configuration asset or chat capability. The existing authenticated HTTP
profile endpoint is extended; no Provider MCP or Moonloom capability applies.

Observability: no new Prometheus metric is added. This bounded image-format
extension adds no new asynchronous state or retry path; upload status and durable
byte/header readback directly verify the behavior. No identities or image data
are added to logs or labels.

## Automated verification

- Red reproduced: GIF/APNG rejected; PNG-named APNG converted; animated WebP converted.
- Worker regression: GIF, APNG, PNG-named APNG and animated WebP preserve every
  byte through save/public GET; types, replacement cleanup, removal and retired
  URLs are checked. Oversized files and decoder failure preserve the old profile.
- Real local Cloudflare Images binding accepts synthetic two-frame GIF/APNG/WebP.
  The image fixtures contain only generated red/blue pixels.
- Frontend regression: accepted picker types, object-URL preview, unchanged File
  submission, URL revocation, failed save retention, cancellation and invalid files.
- Full `npm test`: Worker 49 files / 528 tests; web 86 files / 477 tests passed.
  One optional real-cards probe skipped because REAL_CARDS_DIR was not supplied.
  Existing test output includes expected fixture errors and happy-dom localhost
  preload connection refusals; the test runner reports no failed tests.
- `npm run typecheck`, pinned stage `npm run build:stage`, `npm run build:web`
  and `git diff --check` passed. Existing build warnings include large chunks,
  legacy Sass/Vite APIs and stage font references.

## Browser case and remaining evidence

Use a non-production test account, with desktop and 390×844 mobile viewports:

1. Open `/me`, choose Edit profile and verify the format/size hint in zh-Hant and en.
2. Select a two-frame GIF; confirm the preview animates, save, and confirm the
   profile avatar still animates after reload.
3. Repeat with `.apng`, APNG named `.png`, and animated WebP.
4. Confirm a file above 2 MiB is rejected, cancellation preserves the current
   avatar, and replacing/removing an avatar updates the profile.
5. Read the saved public image and compare bytes and content type with the input.

A visible Chrome run on the actual MePage/CommunityProfile components with local
synthetic API fixtures verified edit entry, updated hint, cancellation, and the
390px English layout (44px controls, no horizontal overflow). The local fixture
API is not a live Worker acceptance result.

**BLOCKED:** Chrome extension fileChooser.setFiles returned `Not allowed`.
Enable the extension's Allow access to file URLs, then rerun steps 2–5.
No browser end-to-end upload, production upload, deployment or live readback is
claimed. Release requires the repository's explicit production authorization.
