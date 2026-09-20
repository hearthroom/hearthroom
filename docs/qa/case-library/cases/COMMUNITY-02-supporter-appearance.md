---
id: COMMUNITY-02
priority: P1
platforms: [desktop, mobile]
page: /me
states: [default, unlinked, non-supporter, supporter, stale, error, saving, public, private]
critical_payloads: [supporterStatus, avatarSource, nameStyle, frame, publicAppearance, saveResult]
---

# Supporter appearance

Use a local synthetic fixture for entitlement changes; never fabricate live boosts.
Use the actual logged-in website for deployed entry/state readback without changing
another member's entitlement. Fixtures and production evidence must be distinguished.

1. Open My profile, find Discord community and Customize appearance.
2. Confirm non-supporters can select a Discord avatar after linking; supporter effects remain unavailable.
3. With a verified supporter fixture, select each name effect and site/Discord frame; check immediate preview before saving.
4. Cancel and reopen; saved choices remain unchanged. Save a change; read the saved status and rendered identity.
5. Simulate a failed save; check visible error, retained draft and available retry/cancel.
6. Toggle public appearance separately from public badges; public profiles/cards/comments must follow their respective consent.
7. Confirm missing guild avatar falls back to global; missing decoration to site frame; both failed avatar URLs finally show an initial.
8. Confirm boost loss disables perks while retaining choices; unlink removes synced avatar and allows switching back to site without resetting other preferences.
9. Repeat form on 390×844, English, light/dark and reduced-motion. Verify actual controls, name wrapping, no clipping and icon centering.
10. Upload a site avatar; confirm successful upload returns avatar source to site. Use Worker integration coverage when a production upload is not authorized.

Reachability assertions: the durable form displays current supporter status, all four saved settings, preview and error/saved feedback in DOM text. Form selections do not write until Save. Private data is absent from the public community response, and every member write requires their authenticated session. Live data or selected effects never contain Discord IDs/CDN paths in public URLs.

Evidence: full trusted Worker/web/Bot suites, focused Red/Green regressions, Chrome natural form journey, screenshots plus DOM/computed manifest, console and request readback. Persona checks cover purpose, next step, errors and reversibility. Five-language review is LLM approximation (en/zh higher confidence, ja/ko lower), not human native review.
