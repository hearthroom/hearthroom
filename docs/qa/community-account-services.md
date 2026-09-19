# Community account services — implementation and local verification

The Me page separates community identity from card storage/play services. It provides community nickname, bio and avatar editing, external account/billing links, and service authorization status. Five locales are updated. Service connections are permanent; only a verified, explicitly confirmed empty duplicate community can be absorbed into the retained community. Provider accounts and assets are never deleted by that operation.

Publication retains the existing UTC Monday weekly cadence: three distinct works per community, shared across providers. Synchronized copies resolve to the same work; independently registering a mapped copy is rejected. Unlisting preserves publication history. Migration `0020_community_services.sql` adds the canonical usage view and transactional quota trigger, profile fields and durable avatar cleanup queue.

## Data and API boundaries

- Existing profiles without reliable edit history are marked edited conservatively and cannot be automatically absorbed. New accounts remain eligible only while all emptiness checks pass. Nonempty-account merging is not implemented.
- Avatar input is JPEG/PNG/WebP, at most 2 MiB and 40 million pixels. Cloudflare Images validates and converts to 512×512 WebP. R2 replacement uses a new key; failed storage preserves the prior profile. Deferred cleanup retries failed deletion and never collects a currently referenced object.
- Community JSON profile updates accept name/bio; arbitrary `avatarUrl` input is intentionally removed. Use multipart for avatar upload/removal. Updated contracts are in `docs/developers.md`.
- MCP parity: not applicable to these community identity/profile routes; HearthRoom has no community MCP transport and account linking requires interactive OAuth proofs. No provider API or provider MCP contract changes.
- Observability: existing HTTP route/status outcomes report rejected writes. D1 publication history and `avatar_cleanup` are durable readback sources; pending eligible cleanup rows can be counted without exposing keys. No new Prometheus process exists in this Worker, so no Prometheus metric is introduced. Do not emit account IDs, object keys, credentials or profile content in metrics/logs.

## Verification

- Policy behavior was first exercised with failing tests, then passed after implementation: shared quota, concurrent fourth publication, canonical copies, permanent connections, empty absorption, and preservation of prior activity/history.
- Avatar tests first failed against the old endpoint, then passed: storage/replacement, failed storage preservation, validation, removal, cleanup retry and zero-card public author profiles.
- Frontend edit tests cover file/bio controls, cancellation without mutation and preserving edits after failed save.
- Full repository test command: **341 Worker tests passed; 342 frontend tests passed**. The existing optional external-fixture `real-cards.probe` suite was skipped. Happy DOM emitted existing localhost navigation connection warnings; these were not test failures.
- Worker TypeScript and frontend Vue type checks passed. Stage, sandbox and web builds passed. Build output includes dependency deprecation and large-chunk warnings. `git diff --check` passed.
- Chrome local runtime: nickname/bio save and reload persistence, cancellation, zero-card author bio/date, service controls, Traditional Chinese/English desktop and 390×844 layouts were checked. Updated controls meet 44 px height. Standard geometry probe found no overlaps, clipped text/controls, raw translation keys or contrast failures; an intentional overlap control verified detection.
- Probe qualifications: existing header/footer links remain below the 44 px mobile target; the English footer has a text-box skew finding without overflow. The shared gradient save button has unknown computed contrast, not a measured pass. These preexisting shared surfaces were not redesigned.
- Local Worker API upload exercised actual image conversion, local R2 storage and browser avatar rendering. Browser file chooser upload could not complete because the Chrome extension lacks file URL access. It remains an explicit end-to-end verification gap. External account/billing destinations were checked against source routes, not exercised against real account settings.

## Release prerequisites

No production state was changed. Before release, provision/verify the `hearthroom-avatars` R2 bucket and Images binding, apply migration 0020, and deploy the exact reviewed/pushed source through the repository release workflow. Verify profile update/readback, avatar replacement cleanup and quota behavior on the deployed version. Resource creation, production migration and release require owner authorization under the repository AGENTS contract.
