# Community library — acceptance scope

2026-09-20. Case: [LIBRARY-01](case-library/cases/LIBRARY-01.md). Implementation and API boundaries: [community-library](../community-library.md).

## Runtime evidence

Chrome exercised a disposable local Provider through the normal OAuth state/PKCE flow and the real local Worker/D1 implementation. No production user preferences were mutated. Desktop and 390×844 phone layouts were visually inspected in Traditional Chinese and English, in light and dark appearance. Screenshots are present in the runtime review transcript; they are not published as repository assets.

| Check | Result |
| --- | --- |
| Guest library → login → return | Passed |
| Empty saved list with discover action | Passed |
| Card → save → unsave → save, updated count | Passed |
| Re-login → saved card remains | Passed |
| Author → follow → homepage Following feed | Passed |
| Manage following → unfollow → follow again | Passed |
| Block local favorites request → visible error → restore network → retry | Passed; recovered request returned HTTP 200 |
| Recent chat → existing stage route | Passed for navigation; see Provider fixture limit below |
| Keyboard tab navigation | Saved cards receives a visible 2px focus outline |
| New controls, mobile layout and labels | At least 44px height; initial followed-author row overflow fixed with a constrained grid and min-width |

The shared geometry probe reported no new overlaps, clipped controls/text, contrast issues, off-center icons, text-box skew or raw locale keys on the inspected library state. Its positive-control suite passed 26 tests. Existing header/footer targets remain below 44px (header controls 34px; footer text links 20px); this is not a claim that the entire site passes every HIG criterion.

Persona review found no confirmed privacy, ownership, or navigation blocker. Reversible controls expose pressed state and an accessible cancel label; failures preserve existing values. Five-language key checks are automated. Wording review is LLM-approximation in all languages, relatively higher confidence for en/zh than ja/ko.

## Verification boundaries

- The local Provider fixture supplies conversation summaries, not a complete chat runtime. Entering the stage exposed expected missing-fixture warnings for models, play settings, author assets and agent status. No paid generation, real message send, or full Provider chat recovery is claimed by this local test.
- Worker tests cover ownership, unauthenticated rejection, visibility, cross-provider favorites, idempotence, durable counters and protection from empty-account absorption. Frontend tests cover failed mutations and duplicate clicks.
- The optional external-fixture `real-cards.probe` suite remains skipped. Existing Happy DOM iframe requests to localhost:3000 report connection errors without failing maintained tests. They are unrelated to the new library components.
- Build warnings include inherited stage font references and large chunks. No new deployment/runtime authority is implied by a green subset; release must use full typecheck/build/test and live readback.

## Case library

| Path | Change |
| --- | --- |
| `docs/qa/case-library/cases/LIBRARY-01.md` | Added reusable authenticated library journey and failure recovery checks |
