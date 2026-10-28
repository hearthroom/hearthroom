# Card authoring guide

This guide covers what a character card consists of, the difference between the two chat pages, how rules and scripts work, and what to check when importing cards from other platforms.

## Card fields

| Field | Description |
|---|---|
| Name, portrait, optional landscape background | The portrait is also used for PNG export and the chat avatar. |
| Summary | Short description shown on the board card. |
| Persona | Who the character is, how they speak, and the rules of the world. |
| Opening | The first message of a conversation. Multiple alternates can be defined. |
| Lorebook | Additional lore triggered by keywords. |
| Rules | Regular-expression rules that turn specific text in replies into layout, status bars or buttons. |
| Chat page | The chat page the card runs on: sandbox or classic. New cards default to sandbox. |

Once the card is saved, the "Try it out" panel on the right of the editor opens the card directly. On wide screens, drag the handle on the panel's left edge to change the preview width.

## Chat pages

Both chat pages share the same interface (header, messages, composer, panels). They differ in where the card's rules and scripts run.

### Sandbox

The card's page and scripts run in an isolated page, separate from the site.

- Styles and scripts can modify the whole chat screen.
- Scripts cannot access the player's login state.
- Actions that cost credits, such as sending or regenerating, respond only to the player's own clicks.

### Classic

Rules are applied directly onto the site's chat page. Use it only when an existing card misbehaves in the sandbox.

### Switching

Use the "Chat page" option in the "Basics" section of the editor. After switching an existing card to the sandbox, open "Try it out" and check that the function bar, panels inside the opening, floating buttons, menus and panels look the same as before. Most cards need no changes; if an effect is missing, see "Migrating from classic".

### Sidebars

When a fixed button bar pinned to the left or right edge overlaps the messages, the chat page moves the message column inward so nothing is covered. This applies to both sandbox and classic chat pages.

Automatic detection only handles bars flush with the screen edge and about 48px wide or less. Full-screen dialogs, floating panels in the middle, and wider bars are left alone. Set the CSS variable `--lt-dock` on the sidebar's outermost element to override detection. Setting it in the element's `style` attribute works for every card format:

| Value | Effect |
|---|---|
| `left` / `right` | Treated as a sidebar docked on that side. It need not touch the edge, and the width limit rises to 30% of the message column. |
| `none` | No space is made for this element. Set it on `:root` to turn off the adjustment for the whole card (SillyTavern-format card styles apply only inside messages, so `:root` has no effect there). |

```html
<div id="my-sidebar" style="position: fixed; left: 0; top: 30%; --lt-dock: left;">…</div>
```

If making room would leave the column narrower than 75% of its original width, nothing is adjusted. The space actually reserved is exposed on `<html>` as `--lt-canvas-dock-left` and `--lt-canvas-dock-right` (absent when no adjustment is made), so the card can align its own elements to it.

## Rules

A rule consists of a "find" part and a "replace" part. Reply text passes through all rules, in order, before it is displayed.

### Find

A fixed string (for example `《status》`) or a regular expression (for example `/<status>([\s\S]*?)<\/status>/g`). With a regular expression, `$1`, `$2` in the replacement refer to capture groups.

### Replace

Any HTML, including `<style>` and `<script>`. The `<style>` blocks from all rules are merged into one stylesheet; each `<script>` runs once per card.

### Function bar

The "Function bar" field in the rules editor is content pinned above the message list. It is visible to the player and never sent to the model. The usual pattern is to place trigger words there (for example `【status】【theme】`) and let rules expand them into the actual panels.

### Macros

| Macro | Value |
|---|---|
| `{{user}}` | The player's name |
| `{{char}}` | The character's name |

### Limits

- A single rule is limited to 256 KB.
- When the whole rule set exceeds its limit, the editor shows by how much.

The "Test" box in the rules editor takes a sample reply and shows the result of applying the rules.

## Sandbox author API

The sandbox page exposes a fixed set of node attributes and an `sdk` object. They are identical to the new-style sandbox on Meimo Island (MMD), so the same script runs on both platforms.

### Nodes

Select nodes by their `data-chat` attributes, not by class names.

| Selector | Description |
|---|---|
| `[data-chat="root"]` | Root of the chat screen. `data-theme` is `dark` or `light`; `data-composer` indicates whether the composer is shown. |
| `[data-chat="message"]` | One message. `data-from` is `ai` or `user`; `data-state` is `pending`, `streaming` or `done`; `data-msg-id` is the server-side message ID. |
| `[data-chat="message-body"]` | Message body (the HTML after rules are applied). |
| `[data-slot="statusbar"]` | Function bar. |
| `[data-slot="left"]` / `[data-slot="right"]` | Left and right sidebar positions. Content placed here is treated as a sidebar docked on that side, and the message column makes room for it (see "Sidebars"). |
| `[data-chat="author-stage"]` | Author stage. `sdk.stage.open('content')` covers the message area; `open('full')` covers the whole page. |
| `[data-chat="input"]` | Input box. |
| `[data-chat="composer"]` | Composer. |

### CSS variables

Colours and sizes are defined by `--chat-*` variables (for example `--chat-bg`, `--chat-text`, `--chat-accent`, `--chat-bubble-ai-bg`). Override them on the root node to retheme the whole screen.

### sdk

| Method | Description |
|---|---|
| `sdk.input.get()` / `set(text)` / `add(text)` / `insert(text)` / `clear()` / `focus()` / `blur()` / `getCursor()` / `setCursor(pos)` | Read and write the input box. |
| `sdk.composer.show()` / `hide()` / `visible()` | Show or hide the composer. |
| `sdk.message.send(text)` | Send a message as the player. Unless called from the player's own click event, the player is asked to confirm first. |
| `sdk.message.edit(id, text)` | Rewrite a message and resend it. Also requires confirmation. |
| `sdk.save.get(key)` / `set(key, value)` / `remove(key)` / `keys()` | Saves. At most 10 keys per card per player; keys may contain letters, digits, `_` and `-`; a value is at most 64 KB; kept across devices. |
| `sdk.cache.get(key)` / `set(key, value)` / `remove(key)` | Scratch storage for the current page load only. |
| `sdk.stage.open(mode)` / `close()` / `el()` / `visible()` | Author stage. |
| `sdk.role.get()` | Character name and avatar. |
| `sdk.user.get()` | Player name, avatar and interface language (`locale`, such as `zh-Hans`). |
| `sdk.text.convert(text)` / `sdk.text.ready()` | Convert text your script draws to the player's Chinese script (Simplified or Traditional), the same way the page converts replies; when the card's language uses the player's script, it returns the text unchanged. `convert` returns the text unchanged until the dictionary has loaded; `ready()` resolves once it has, or at once when no conversion is needed. |
| `sdk.model.get()` | The model the player has chosen: `{name, cost}`. `name` is the model's display name (the "model · route" shown in the header); `cost` is the estimated credits for the next turn (a range for dynamic pricing, such as `127–251`). Both are empty strings until the page provides them. To open the model list, click the model button in the composer. |
| `sdk.generation.get()` | What this turn is waiting on: `{phase, since}`. `phase` is `idle`, `preparing` (just sent, nothing back yet), `summarizing` (the platform is summarising the story so far, before the first word; can take tens of seconds), `thinking` (the model is reasoning and the reply has not started; models that do not reason skip it) or `writing` (the reply is streaming); `since` is when the phase began (ms). Only the phase, never the reasoning text. Also `outcome`: when the last turn did not finish normally, the card the chat page draws under it, as `{kind, label, sub, actions}`; `null` after a normal end or while generating. `kind` is `model-error`, `network-error`, `server-error`, `rate-limit`, `quota` (too few credits), `filtered`, `length-cap`, `stopped`, `compact-retryable`, `outcome-unconfirmed` (the result is on its way; no buttons, it shows up by itself) or `interrupted` (an Agent turn that has not finished); `label` and `sub` are that card's text in the player's language; `actions` is `[{action, label}]` and `action` is only ever `retry`, `continue`, `switch-model`, `model-settings`, `capacity`, `refresh`, `retry-stream-off`, `edit-message`, `switch-lane` or `resend-traditional`. The last four appear only on a `filtered` card: `retry-stream-off` turns streaming off for this conversation and then retries, `edit-message` opens the blocked message for editing (sending it replaces that message), `switch-lane` opens the model menu on the current model's other lanes, and `resend-traditional` converts the blocked message, when it contains Simplified Chinese, to Traditional Chinese and sends it in its place (offered once per message). |
| `sdk.generation.act(action)` | Presses one of that card's buttons (an `action` from `outcome.actions`), exactly like the player tapping the platform's card: a retry reuses the same line and does not send it twice. Call it only while the player is clicking (otherwise `UNAUTHORIZED`, with no prompt); a button the card does not offer is `INVALID_ARGS`; while generating `BUSY`; 3 per minute. Returns a Promise. |
| `sdk.archive.list()` / `save(title?)` / `fork(messageId)` / `open(id)` / `start(opening?)` / `rename(id, title)` / `remove(id)` | The platform's conversation saves (up to 20 per card, the current one included, across devices). `open` loads a save (the current progress stays in the list as it is); `save` keeps a named copy of the current progress and returns `{id, current}`; `fork` starts a new save from one message (a bubble's `serverId`); `start` begins a new save (0 = the main opening, 1.. = alternates); `list` returns `{items, count, limit}` with `id, title, isCurrent, messageCount, lastMessage, createTime, lastUpdateTime`. Call the changing ones inside the player's click and confirm with your own screen; outside a click the page asks the player first. |
| `sdk.on(event, handler)` | Subscribe to an event. |
| `sdk.debug.log(...args)` | Write to the debug panel. Append `?sdkDebug=1` to the URL to show the panel. |

### Events

| Event | When |
|---|---|
| `ready` | Fired once after all existing messages are mounted. |
| `message:new` | A message is created. |
| `message:mount` | A message node is mounted. |
| `message:stream` | Streaming output is updated. |
| `message:done` | A message is complete. |
| `message:unmount` | A message node is removed. |
| `input:change` | The input box content changes. |
| `conversation:switch` | The conversation changes (after a load, save, fork or new save). Payload `{ conversationId }`. |
| `theme:change` | The theme switches between dark and light. |
| `back` | The player presses back. |
| `stage:close` | The author stage closes. |
| `dispose` | The page is about to unload. |
| `model:change` | The player switched models, or the next turn's cost changed (context length, thinking depth). Same payload as `sdk.model.get()`. |
| `generation:phase` | The phase of the current wait changed. Payload is `{phase, since}`; not replayed, so a late script calls `get()`. |
| `generation:outcome` | The last turn's outcome changed (a failure card appeared, or went away after a retry). Payload as `sdk.generation.get().outcome`, possibly `null`; not replayed. |

### Execution model

- On open, each existing message fires `message:new`, `message:mount` and `message:done` in order; `ready` fires last.
- Handlers subscribed to `message:mount` or `message:done` after messages are already mounted receive a replay for those messages.
- Inside an event handler, `document.querySelector` searches only that message. Outside handlers it is the ordinary `document`.
- Scripts cannot make requests to external URLs. External `<script src="https://…">`, images and fonts load normally.

### Error codes

| Code | Description |
|---|---|
| `UNAUTHORIZED` | The player declined an action that required confirmation. |
| `RATE_LIMITED` | Too many calls. |
| `INVALID_ARGS` | Invalid arguments. |
| `HOST_DENIED` | The host page refused the action. |
| `BUSY` | A reply is being generated. |
| `LIMIT_REACHED` | The save list is full; `err.data` is `{ count, limit }`. Ask the player to delete one. |
| `NOT_SUPPORTED` | The feature is not available in the current environment. |

## Migrating from classic

On the classic page, rules are applied onto the site's chat page. The selectors authors commonly use are `.mes` (message), `.mes_text` (body), `.mes.Ai` / `.mes.User` (speaker), `#msglistview` (list) and `.chat-scope-box` (chat area). All of them also exist on the sandbox page.

- Cards that only use styles and text replacement need no changes.
- Booting scripts through `<img onerror="…">` works in the sandbox. Engine fragments placed in the function bar or the opening are executed.
- Scripts that read or write other parts of the site page should use `sdk` instead.
- `localStorage` works in the sandbox, but the data lives only under the card's own origin. Use `sdk.save.*` to keep it across devices.

## Importing

| Source | How |
|---|---|
| SillyTavern | Drop a PNG or JSON character card into the "Basics" section. Persona, opening, lorebook and regex scripts are filled in; the embedded image becomes the portrait background; an explicit main background takes precedence. |
| Meimo Island (MMD) three-file set | Import the rules file (with `chatVersion`), the opening and the persona separately. A rules file marked for the new sandbox selects the sandbox chat page automatically. |

After importing, check the result in "Try it out", then save and publish.

## Troubleshooting

| Symptom | What to do |
|---|---|
| Blank screen for ten-odd seconds after opening the card | The sandbox page's resources load slowly the first time; later opens are served from cache. If it stays blank past 20 seconds a notice appears; reload the page. |
| The card's tour or overlay covers the screen and blocks scrolling | This is the card's own tutorial layer. Press its skip button. |
| Scripts do nothing | Append `?sdkDebug=1` to the URL to open the debug panel, which shows script errors and `sdk.debug.log` output. |
| Saves fail | Check that keys contain only letters, digits, `_` and `-`, that the value is under 64 KB, and that the card has fewer than 10 keys. |
| Messages are narrower than expected | An element flush with the screen edge was detected as a sidebar. Add `--lt-dock: none` to that element. |

## Sharing images and text

Card scripts can offer image and text sharing from a player’s button click. In HTTPS card frames, the host delegates `web-share` and `clipboard-write`: `navigator.share` can receive a prepared image `File` plus text; `navigator.clipboard.write` with `ClipboardItem` can write a PNG, and `navigator.clipboard.writeText` can write a caption. These are browser APIs, not new `sdk` methods or HTTP endpoints.

Prepare the file before the click, then call the action directly in the click handler to retain user activation. Check `navigator.share`, `navigator.canShare({ files: [file] })`, `navigator.clipboard.write` and `ClipboardItem` before offering the corresponding action. Browser, operating system, permissions and receiving app determine support; image and text may not both survive sharing. Catch rejection and cancellation; offer image download and selectable caption text when unavailable or denied, and do not automatically reopen a cancelled share sheet. The host does not delegate `clipboard-read`. Opaque-origin local previews can still reject these APIs; verify the real cross-origin card on the target device.

## Share links with a context

Card scripts can create a share link that carries a context code: a friend who opens it gets the same code back, so the card can show “your friend picked this, your turn”. `sdk.share.link(code)` (classic cards: `window.stage.share.link`) returns this card's share link synchronously: the card page `/cards/<number>` with the signed-in player's referral code, plus `?share=<code>` when a code is given. Build the link before the click and pass it to `navigator.share` inside the click handler.

On the friend's side, `sdk.share.context` holds the code; it is `null` when there is none or while the player views a past conversation. A code is 1–64 ASCII letters, digits, `.`, `_` or `-`, starting with a letter or digit; otherwise sandbox cards throw `SHARE_CONTEXT_INVALID` and classic cards get `null`. The platform only delivers the code: it never reaches the model and carries no player data, and anyone can type one, so accept only codes your card defines. Whether the friend already has a save is the card's call (for example `sdk.archive.list()`; a guest has none).

`sdk.share.audience` says who can open the link: `author` (a private card, a new friend cannot), `link` or `public`. With the platform switch off, `sdk.share.enabled` is false, `context` is `null` and `link()` returns the plain card link. `sdk.share.qr(text)` returns `{ size, path }` (an SVG path on a `size` × `size` grid) for your share image. `share:change` fires when the referral code arrives late. Authors can test on the draft with `?mode=source&share=<code>`.


## Authoritative message history

The page author API provides `sdk.history` (sandbox) and `stage.history` (classic). Check `capabilities().available` first; old hosts and previews may not support it. `list({cursor,revision,content:true})` reads only the current player, configuration and conversation. Use the first page's revision for every continuation page. Accumulate all pages and use the full collection only after the last page returns `complete:true`.

`onChange(callback)` returns an unsubscribe function and reports committed changes even for messages never mounted or already hollow; viewport unmount is not deletion. Invalidate derived state as soon as the first event part arrives, then rebuild it from a complete list. A stale cursor, reset or unavailable result is unknown state, never an empty history.

Only terminal visible original bodies are optional; thinking, streaming body and moderation-withheld text are excluded. `item.complete` excludes partial or failed replies. Revisions and opaque IDs are not player identities.

Cross-device changes are checked every 15 seconds in the foreground and on return to the page. Dispose subscriptions when the card exits.

## Polls, co-op counters and share responses

The polls and counters declared in `rules.json` under `sharedState` are shared by everyone who plays the card. `sdk.shared` (classic cards: `window.stage.shared`) reads and writes them:

- `read(keys)` takes one key or up to 16 and returns `{ [key]: { kind: 'poll', counts, total, mine? } | { kind: 'counter', total, mine?, goal?, reachedAt?, previous? } }`. Undeclared keys are left out. `mine` is the player's own vote or contribution and is missing for guests; `previous` is the previous period's total.
- `vote(key, option)` returns `{ mine }`. Each player can vote or change their vote at most 10 times a day per poll, the first vote included; voting for the same option again does not count.
- `add(key, delta)` adds a whole number from 1 to the counter's `maxStep` and returns `{ total, mine, reachedAt }`.
- `leaderboard(key, { limit })` returns `{ items: [{ rank, name, value }], mine? }`: this period's top contributors (10 by default, at most 50) under their public nickname. Test accounts are never listed. A counter's `total`, `mine` and leaderboard all start again each period.

Anyone can read; writing needs a signed-in player who has played this card (opening a conversation is enough). Nothing is pushed to the card: read again on your own schedule, at most once every 10 seconds. You can try all of this on any card you author, including a new private card and a CLI trial card: your numbers are kept apart from the players'.

Share responses build on share links. `sdk.share.tallyLink(code, pollKey)` creates a link with a platform token (`?share=~XXXXXXXX`) for a poll declared with `share: true`. It is asynchronous, so create it before the click; the same code and poll give back the same link, a player can make 20 a day, and a link works for 90 days. A friend who opens it reads the code as `sdk.share.context` and the question as `sdk.share.poll` (`{ key, options }`, otherwise `null`), and answers with `sdk.share.respond(option)`. These answers are kept per link, apart from the poll's own votes. The sharer reads `sdk.share.results()`, a list of `{ context, pollKey, total, counts, updatedAt }` for the links they made: `total` is live, while `counts` appears once 3 friends have answered and updates once a day. The card never learns who shared or who answered. A card may unlock its own content from these numbers; they never grant platform credits.

Both page modes use the same error codes: `SHARED_DISABLED` (the platform or the author paused it), `NOT_DECLARED`, `OPTION_INVALID`, `NOT_ELIGIBLE` (not played yet, or answering your own link), `UNAUTHORIZED` (signed out), `RATE_LIMITED` (wait and retry), `LIMIT_REACHED` (`err.data.reason` is `goal` or `limit`) and `HOST_DENIED` (an older player page; while viewing a past conversation or a review playtest, only reads work; `tallyLink` on a card that was never submitted or given a visibility, such as a trial card, because nobody else can open it). Author playtests (`?mode=source`) and test accounts keep their own numbers, apart from the players'. See, pause and reset them under “Player polls and counters” in the editor or with `hearthroom card state`.
