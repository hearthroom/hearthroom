---
id: ME-01
page: /me
platforms: [desktop, mobile]
states: [default, checking, ready, disconnected, editing, saved]
critical_payloads: [communityIdentity, serviceStatus, permanentConnection, profileSaveResult]
mutating: true
---

# Personal profile layout and service status

Use an isolated local community account and simulated provider, never a real account. The fixture needs a nickname, bio, owned avatar, one connected service and one available unconnected service.

1. Open Me; verify the connected provider appears before the unconnected provider.
2. Confirm service status leaves checking after the community profile arrives. Reload to exercise the late-profile path.
3. Check desktop and 390×844 layouts in dark and light modes. Inspect profile, navigation tiles, service rows and editor individually.
4. Switch among Traditional Chinese, English, Japanese, Korean and Simplified Chinese. Read the actual labels and run the standard geometry probe after each layout settles.
5. Open Edit profile. Confirm nickname, bio and file input have accessible labels; no URL input appears.
6. Cancel; confirm original profile remains. Reopen and save the unchanged fixture profile; verify the saved status and return to the profile summary.
7. Confirm public profile, creations, resources, settings and external service links retain their correct destinations. Do not mutate external accounts.
8. Run the probe's deliberate overlap control and require a detection. Restore viewport and original appearance mode.

Pass: no clipped text/control, overlapping actionable controls, missing translation keys or measured contrast failures in the affected area; all affected actions at least 44 px high. The icon+label group may be centered while text alone is offset; inspect those reports visually. Existing header/footer target-size findings remain separately recorded. The save result, permanent-connection policy and service authorization state must be visible DOM text, not screenshot-only claims.

File chooser upload requires the browser extension's local-file permission. If unavailable, record that gap and do not claim upload end-to-end coverage. Failed save/expired service states also have component regression coverage; explicitly distinguish that from browser coverage.
