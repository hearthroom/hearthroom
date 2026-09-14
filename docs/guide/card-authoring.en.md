# Card authoring guide

This guide covers what a character card consists of, the difference between the two chat pages, how rules and scripts work, and what to check when importing cards from other platforms.

## Card fields

| Field | Description |
|---|---|
| Name, avatar, background | Shown on the board and in the chat. Use a square image for the avatar. |
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

- A single rule is limited to 128 KB.
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
| `sdk.user.get()` | Player name and avatar. |
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
| `conversation:switch` | The conversation changes. |
| `theme:change` | The theme switches between dark and light. |
| `back` | The player presses back. |
| `stage:close` | The author stage closes. |
| `dispose` | The page is about to unload. |

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
| SillyTavern | Drop a PNG or JSON character card into the "Basics" section. Persona, opening, lorebook and regex scripts are filled in; the portrait inside a PNG is uploaded as the avatar. |
| Meimo Island (MMD) three-file set | Import the rules file (with `chatVersion`), the opening and the persona separately. A rules file marked for the new sandbox selects the sandbox chat page automatically. |

After importing, check the result in "Try it out", then save and publish.

## Troubleshooting

| Symptom | What to do |
|---|---|
| Blank screen for ten-odd seconds after opening the card | The sandbox page's resources load slowly the first time; later opens are served from cache. If it stays blank past 20 seconds a notice appears; reload the page. |
| The card's tour or overlay covers the screen and blocks scrolling | This is the card's own tutorial layer. Press its skip button. |
| Scripts do nothing | Append `?sdkDebug=1` to the URL to open the debug panel, which shows script errors and `sdk.debug.log` output. |
| Saves fail | Check that keys contain only letters, digits, `_` and `-`, that the value is under 64 KB, and that the card has fewer than 10 keys. |
