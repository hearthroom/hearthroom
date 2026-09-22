# Animated community avatars

## Scope and acceptance

The `/me` profile editor accepts GIF and APNG, including APNG files named `.png`,
and preserves animation after saving and public delivery. Animated WebP uses the
same preservation path. Existing JPEG/static PNG/static WebP processing remains.
The upload limit is 10 MiB; decoded image area remains limited to 40 megapixels.
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

## Browser case and evidence

Use a non-production test account, with desktop and 390×844 mobile viewports:

1. Open `/me`, choose Edit profile and verify the format/size hint in zh-Hant and en.
2. Select a two-frame GIF; confirm the preview animates, save, and confirm the
   profile avatar still animates after reload.
3. Repeat with `.apng`, APNG named `.png`, and animated WebP.
4. Confirm a file above 10 MiB is rejected, cancellation preserves the current
   avatar, and replacing/removing an avatar updates the profile.
5. Read the saved public image and compare bytes and content type with the input.

A visible Chrome run on the actual MePage/CommunityProfile components with local
synthetic API fixtures verified edit entry, updated hint, cancellation, and the
390px English layout (44px controls, no horizontal overflow). The local fixture
API is not a live Worker acceptance result.

The initial Chrome file-access block was resolved by the user enabling the
extension permission. A follow-up visible Chrome run completed:

- Desktop/en: GIF and `.apng` selection through the native file chooser, blob
  preview, save confirmation, reload, and visibly different red/blue frames.
- Mobile/zh-Hant at 390×844: APNG named `.png` and animated WebP selection,
  preview, save and reload; animated WebP showed different red/blue frames.
- APNG and WebP read back from the local fixture API matched their input bytes
  exactly, with `image/apng` and `image/webp` types respectively. Production
  APNG normalization to `image/png` remains covered by the Worker tests above.
- Selecting a GIF above 2 MiB displayed the format/size error. Reselecting a valid
  WebP cleared the error and saved normally.
- Cancelling a selected replacement preserved the prior saved avatar URL.
- Removing an avatar and cancelling preserved it; removing and saving persisted
  through reload and returned to the initial-letter fallback.
- No console errors were recorded during the follow-up browser run.

These browser checks use the real page and editor components with a local
synthetic API fixture. Combined with the independent real-Images/Worker tests,
they cover client behavior and server preservation separately; they are not a
browser-through-deployed-Worker or production acceptance claim. At this initial
verification checkpoint, no production upload, push or deployment was performed.
The original animation support was subsequently released with owner authorization
in [CI run 35705000054](https://github.com/hearthroom/hearthroom/actions/runs/35705000054).


## Larger animation upload limit

The avatar limit was raised from 2 MiB to 10 MiB after author feedback that
animated files commonly exceed the original static-image limit. The picker,
profile validator and multipart body guard now import one shared limit; the body
guard retains 16 KiB for form fields and multipart headers. Five-language hints
interpolate the same size. Animated image preservation, decoded-area validation,
ownership and cleanup retain their existing behavior.

Regression cases cover 10 MiB GIF/APNG/WebP requests and exact output hashes,
a file one byte over the limit, the multipart envelope limit, and frontend
preview/submission at the boundary. The HTTP limit tests use padded animation
fixtures with a mocked decoder; the real Images tests remain separate.

MCP/Moonloom and observability decisions above remain applicable: this changes
only the accepted size in the existing community-owned upload flow.

Follow-up validation: typecheck and web build passed. The full Worker and web
suites passed; the optional external-card probe remains skipped without its
fixture directory. An initial run overlapped asset rebuilding and failed Worker
startup; rerunning after the build resolved it. Large frontend fixtures also
exposed slow deep comparisons of happy-dom File internals; the assertion now
checks the original file identity after unwrapping Vue's test-environment proxy.
The focused nine-case editor suite completes without increasing timeouts.

Visible Chrome checks against the same local synthetic API fixture passed for
GIF (2,141,728 bytes), APNG (4,726,148 bytes), and WebP (4,720,238 bytes).
APNG and WebP saved and survived reload with exact original-byte readback.
The picker displays the 10 MB hint, rejects a 10,485,766-byte GIF with the
10 MB error, and allows cancellation. These are local client checks; the HTTP
Worker boundary tests independently verify the server limit and preservation.
