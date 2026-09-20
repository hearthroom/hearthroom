# Community integration validation

2026-09-20. Implementation and local verification are complete. Production activation and real Discord account/role delivery are not verified by this report.

## Automated evidence

- Website, Node 22: web build, 392 backend tests, 391 frontend tests and both TypeScript checks pass after rebasing onto the community moderation release.
- One existing optional suite, `web/test/real-cards.probe.test.ts`, is skipped because its private `REAL_CARDS_DIR` fixture is absent. It is unrelated to Discord. Existing test-environment network warnings and dependency build warnings remain; no test failures are suppressed.
- Hearthkeeper 0.6: the full 69-test suite, typecheck and build pass on Node 24.21.0 and local Node 26.
- Authorization coverage includes one-use same-member OAuth receipts, exclusive binding and cleanup acknowledgement, expired/replayed signatures, XP cooldown/caps/deduplication, badge privacy, revoked case consent/leases, safe role ownership and case operation replay.
- Regression checks first failed for suspended-card Discord previews and follower notifications, then passed after applying the existing moderation restrictions. Both community and moderation metrics remain on the original metrics endpoint.
- The approved-work test initially assumed one review stamp; the real contract requires two different reviewers. The corrected test verifies no award after the first and one award after the final decision.
- A failed XP ingestion call first blocked cleanup in the Bot test; independent lane handling now passes that regression.

## Browser and review evidence

Chrome exercised the real Vue components with a local fictional-account API fixture, at 1280px desktop and 390px mobile. The website D1 and Bot CaseStore tests above supply authorization evidence; the fixture does not emulate Discord authorization or actual role changes.

Verified linked progression, collapsed/expanded privacy settings, report form submission and returned own-case details, public-badge opt-in followed by the author-page badge, unlink cancellation, and confirmed unlink with cleanup state and immediate removal of case access. Reviewed desktop/mobile screenshots, accessibility snapshots, successful local API requests and console output. The post-rebase page had no console errors or warnings.

The shared visual probe passed its 26 positive controls. Final desktop/mobile and unlink-dialog probes found no raw localization keys, control/text clipping, overlap, icon-centering or contrast failures. Report-only small-target findings are existing header/footer controls; new community actions meet the 44px target. No horizontal overflow occurred at 390px. Five locale dictionaries passed validation. Language persona review is an LLM approximation, especially Japanese and Korean, not native-speaker acceptance.

Independent UI review identified callback context lost during router initialization, retry identifiers lost after reload, and editable pending report inputs. The implementation now captures the callback before importing the router, persists input-hash request identifiers scoped to a stable public member handle, and disables pending inputs. A separate read-only verifier confirmed those fixes. Runtime browser evidence covers the stated fixture journeys only.

## Remaining release evidence

Source publication is not deployment. The paired release still needs the additive migration, private OAuth/bridge configuration, actual guild XP channels and display-role mappings, command registration, and live metrics/readback. Verify real binding, one chat event, role delivery, a website-created Discord case and unlink cleanup using designated test accounts before announcing availability. Follow [the integration contract](../community-integration.md) and Hearthkeeper's operations document.
