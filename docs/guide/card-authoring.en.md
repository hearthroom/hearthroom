# Card authoring guide

For people who write character cards: what a card is made of, how to choose between the two chat pages, how rules and scripts work, and what to watch for when importing from other platforms. You do not need to know how to program to follow this.

## What a card contains

| Field | Purpose | Advice |
|---|---|---|
| Name, avatar, background | What shows on the board and in the chat | Use a square avatar; a bright background makes text hard to read |
| Summary | One or two lines on the board card | Say what it plays like, not the lore |
| Persona | Who the character is, how they speak, the world's rules | Be concrete; also say what the character never does |
| Opening | The first message (alternates are allowed) | Give the player something to reply to |
| Worldbook | Extra lore triggered by keywords | Many short entries beat one long one |
| Rules (regex) | Turn specific text in replies into layout, status bars, buttons | See "Rules" below |
| Chat page | Which chat page this card runs on: sandbox or classic | New cards default to sandbox |

Once saved, the "Chat test" panel on the right plays the card directly. On wide screens, drag the handle on its left edge to change the preview width and see how the card looks at different sizes.

## Two chat pages: sandbox and classic

Both use the same chat screen (same header, message bubbles, composer, panels). The only difference is **where your rules and scripts run**.

- **Sandbox (default, recommended)**: the card's page and scripts run in an isolated page, separate from the site itself. Your styles and scripts may freely reshape the whole chat screen; at the same time the card cannot touch the player's login and cannot act on the player's behalf (sending, regenerating and other actions that cost credits only respond to the player's own clicks).
- **Classic**: rules are applied directly onto the site's chat page, the way it used to work. Only switch back if an older card misbehaves in the sandbox.

How to choose: new cards use the sandbox. For an existing card, switch and open it once. Most cards need no change; if an effect is missing, read "Moving from classic to sandbox" below, and fall back to classic only if it cannot be moved.

## Rules (regex)

A rule is "what to find" plus "what to replace it with". Every reply passes through all rules before it is drawn.

- **Find**: a fixed string (e.g. `《status》`) or a regular expression (`/<status>([\s\S]*?)<\/status>/g`). With a regular expression, `$1`, `$2` in the replacement stand for the captured groups.
- **Replace**: any HTML. It may contain `<style>` and `<script>`; styles from all rules are combined into one sheet, and each script runs once per card.
- **Status bar trigger**: the "status bar" field in the rules editor is persistent content placed above the message list; you usually put a few trigger words there (e.g. `【status】【theme】`) and let rules replace them with the real panels.
- **Macros**: `{{user}}` is the player's name, `{{char}}` the character's.
- **Limits**: 128 KB per rule; the whole rule set is measured in MB, and the editor tells you by how much you are over.

The rules editor has a "test" box: paste text the model might reply with and see the result immediately.

## Author tools on the sandbox page

The sandbox page gives authors a fixed set of node names and an `sdk` object, identical to the new-style sandbox on Meimo Island (MMD); the same script runs on both.

Fixed nodes (find them by `data-chat` attributes, not class names):

| Node | Meaning |
|---|---|
| `[data-chat="root"]` | Root of the chat screen; `data-theme` is dark/light, `data-composer` whether the composer is shown |
| `[data-chat="message"]` | One message; `data-from` is `ai`/`user`, `data-state` is `pending`/`streaming`/`done`, `data-msg-id` the server's message id |
| `[data-chat="message-body"]` | Message body (the HTML after rules) |
| `[data-slot="statusbar"]` | Status bar |
| `[data-chat="author-stage"]` | Author stage: `sdk.stage.open('content')` covers the messages, `open('full')` the whole page |
| `[data-chat="input"]`, `[data-chat="composer"]` | Input box and composer |

Colours and sizes come from `--chat-*` variables (e.g. `--chat-bg`, `--chat-text`, `--chat-accent`, `--chat-bubble-ai-bg`); override them on the root to retheme everything.

`sdk` capabilities (all present):

| Capability | What it does |
|---|---|
| `sdk.input.get/set/add/insert/clear/focus/blur/getCursor/setCursor` | Read and write the input box |
| `sdk.composer.show/hide/visible` | Show or hide the composer |
| `sdk.message.send(text)` | Send a message for the player. Unless called during the player's own click, a confirmation dialog is shown first |
| `sdk.message.edit(id, text)` | Rewrite a message and resend (also confirmed) |
| `sdk.save.get/set/remove/keys` | Saves: at most 10 keys per card per player, keys limited to letters, digits, `_`, `-`, 64 KB per value; kept across devices |
| `sdk.cache.get/set/remove` | Scratch storage for this page load only |
| `sdk.stage.open/close/el/visible` | Author stage |
| `sdk.role.get()`, `sdk.user.get()` | Character name and avatar; player name and avatar |
| `sdk.on(event, fn)` | Subscribe to events |
| `sdk.debug.log(...)` | Write to the debug panel (add `?sdkDebug=1` to the URL to see it) |

Events: `ready`, `message:new`, `message:mount`, `message:stream`, `message:done`, `message:unmount`, `input:change`, `conversation:switch`, `theme:change`, `back`, `stage:close`, `dispose`.

Rules that shape how you write:

- On open, every existing message fires `message:new → message:mount → message:done` in order, then `ready` fires once. Late subscribers to `message:mount`/`message:done` receive replays for messages already mounted.
- Inside an event callback, `document.querySelector` sees only **that message**; outside callbacks it is the ordinary page.
- Scripts cannot reach external URLs from the sandbox (only external `<script src="https://…">` loads). Images and fonts may use external URLs.
- Error codes: `UNAUTHORIZED` (player declined), `RATE_LIMITED`, `INVALID_ARGS`, `HOST_DENIED`, `BUSY` (generating), `NOT_SUPPORTED`.

## Classic page conventions (and moving to the sandbox)

On the classic page, rules are applied onto the site's chat page; the hooks authors use are the message class names: `.mes` (a message), `.mes_text` (body), `.mes.Ai`/`.mes.User` (speaker), `#msglistview` (list), `.chat-scope-box` (the chat area). All of these **also exist** on the sandbox page, so:

- Cards that only restyle and replace text need no change.
- Cards that boot scripts through a broken image (`<img onerror="…">`) work in the sandbox too; engine fragments in the status bar or the opening are found.
- Scripts that reach into other parts of the site page (beyond header and composer) should use `sdk` instead.
- Whatever the card keeps in `localStorage` still works in the sandbox, but only under the card's own origin; use `sdk.save.*` to keep it across devices.

After switching, run "Chat test" once and compare: status bar, panels inside the opening, floating buttons, the three-dot menu and the panels (model, persona, notepad…) should look the same on both pages.

## Importing from other platforms

- **SillyTavern**: drop a PNG or JSON card into the "Basics" section; persona, opening, worldbook and regex scripts are filled in, and the portrait inside a PNG is uploaded as the avatar.
- **Meimo Island (MMD) three-file set**: import the rules file (with `chatVersion`), the opening and the persona separately; a rules file marked for the new sandbox selects the sandbox page automatically.
- Run "Chat test" once after importing, then save and publish.

## Troubleshooting

- **Blank screen for ten-odd seconds after opening**: the sandbox page's files load slowly the first time; later opens are fast. If it stays blank past twenty seconds a notice appears; reload.
- **The card's own tour or overlay covers the screen and blocks scrolling**: that is the card's tutorial layer; press its skip button.
- **Scripts do nothing**: add `?sdkDebug=1` to the URL to open the debug panel; script errors and `sdk.debug.log` output show there.
- **Saves fail**: check that keys use only letters, digits, `_`, `-`, that a value is under 64 KB, and that the card does not already have 10 keys.
