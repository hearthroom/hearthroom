---
id: CHAT-ASSIST-01
page: /play
platforms: [desktop, mobile]
states: [confirmation, generating, choices, refresh-confirmation, failure, new-round]
mutating: true
---

# Paid assist produces editable drafts

Use the complete built MoonStage with an isolated synthetic HTTP service. Never charge
or send a real user message as a probe. Count suggest-reply calls separately from sends.

1. Open assist: the cost confirmation appears and request count remains zero. Cancel.
2. Open again and confirm: exactly one request returns three choices.
3. Pick a choice: the composer expands with that editable text; no chat message is sent.
4. Open, dismiss and reopen: the same choices remain, with no additional request.
5. Refresh: require cost confirmation again. Cancel without making a request; then confirm
   once. On failure preserve the old choices. A fresh successful result replaces them.
6. Advance the round or switch conversations while generation is pending. Do not fill the
   new conversation with the old result. Repeated clicks must not duplicate a request.
7. Inspect 390 px layout, labels and focus. In sandbox mode synthetic clicks cannot
   approve spending; the actual user confirmation must still work.

Evidence: full built MoonStage boot, confirmation request-count zero, selected composer
text and reopening request-count one were checked in Chrome with synthetic HTTP. Mobile
confirmation and three-choice panel are checked at 390 px. Session tests exercise stale
completion, duplicate confirmation and failed refresh; sandbox shell tests cover scripted
confirmation denial. Provider tests use real PostgreSQL to verify concurrent reuse,
three choices at one 10-credit charge, failed refresh and new-round invalidation.

The stage suite requires NODE_OPTIONS=--no-experimental-webstorage with local Node 26
because its native localStorage conflicts with the existing jsdom tests. Linux deployment
script tests are run in a Linux container because macOS lacks flock. No real account
was charged in these checks. Older hosting services may return a single reply; the
client must not make three paid requests to manufacture three choices.
