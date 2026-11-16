# Card authoring guide

This guide walks through each section of the web editor, Lorebooks and card variables, public review requirements, and the display-rule and sandbox scripting reference (`/en/guide.md`).

## Your first playable card in minutes

The left sidebar lists eight sections, yet only four fields are required before you can save and start chatting. If you already have a card exported from another platform, you can drop the file straight in to fill everything automatically.

### The four required fields for a new card

To get a character talking right away, fill in these four items:

1. **Basics → Character name**: the character's name.
2. **Basics → Images → Background (portrait)**: a 9:16 portrait image used for the board tile, the chat avatar, and PNG exports. Keep faces and key details inside the dashed safe zone so nothing gets cropped across screen ratios, or click generate to create an image on the spot using purchased credits.
3. **Character → Character definition**: who the character is, how they speak, their relationship to the player, and the rules of their world.
4. **Opening → Opening message**: the first message the character sends when a chat begins.

Once you save those four fields, the **Try it out** panel on the right unlocks so you can chat without leaving the editor. On wide screens, drag the handle along the left edge of **Try it out** to resize the preview; whenever you edit fields on the left, click **Save and reload** in the test panel so your chat uses the latest saved version.

### Importing an existing card from another platform

When creating a new card, the import box at the top of **Basics** accepts exports from other tools:

| Source | How it imports |
|---|---|
| SillyTavern | Drop a PNG, JSON, or CHARX card into the import area. Character definition, opening message, Lorebook, and regex scripts fill into their matching sections automatically; the PNG's embedded portrait becomes the portrait background unless a separate main background is included, which takes priority. |
| MMD three-file set | Import the rules file (with `chatVersion`), opening file, and persona file. Rules marked for the new sandbox automatically select the **Sandbox** chat page. |
| AI Fengyue / RiliAI | Import the card or settings JSON to bring over the definition, opening page, Lorebook, built-in styles, and card variables. |

After importing, save once and check the opening, status panels, and text formatting in **Try it out** before choosing visibility or submitting for review.

## What each editor section does

The eight sections on the left follow the path from first draft to publication. Some fields are store-page copy seen only by visitors browsing your card, while others enter the model prompt on every turn. Knowing which is which keeps you from burning context on showcase text.

| Section | Fields inside | Who sees it & when to use it |
|---|---|---|
| **Basics** | **Character name**, **What the character calls itself** (replaces `{{char}}` in your text; defaults to the character name when blank), **Primary language**. **Images**: **Background (portrait)**, plus **Landscape & share images** for an optional 16:9 **Landscape background** on wide screens and a 1200×630 **Share image (optional)** for Discord, LINE, and X previews. **Card showcase**: **One-line summary** (clamped to two lines on board tiles and three lines under the card page title), **About** (Markdown store page with Write / Preview tabs for mechanics, character rosters, images, and changelogs; **shown only to visitors, never sent to the AI**), and **Tags**. | Fill name, language, and portrait first; come back for the summary, About page, and preset tags before sharing or publishing. |
| **Character** | **Character definition** (private core persona, relationship, and world rules sent only to the model) and **Example dialogue** (two or three user/character exchanges that lock in voice and sentence length without over-constraining replies). Expand **Reply format & reminder** for **Reply format** (paragraph shape or action notation) and **Standing reminder** (a short note attached near the end of every turn for the one or two rules models forget most easily). | The heart of every card. A concrete definition plus two or three sharp example turns beats filling every advanced box. |
| **World** (Experimental) | **Enable world mode**: turns one card into a multi-character world. Put shared world rules in **Character definition** and add individual cast members here, each with a public **Profile**, a private **Full definition**, and an optional **Private lorebook**; each turn the world arbitrates who is present before characters speak. | Experimental and intended for personal testing; not yet recommended for cards you plan to publish publicly. |
| **Opening** | Pick one **Opening style**: 1. **Opening message**: the character speaks first, with optional alternate openings for players to choose from and **Suggested first lines** below the greeting (tapping one fills the input box). 2. **Opening page**: custom HTML, CSS, and scripts rendered at the top of every new chat alongside **First-line choices** (shown only to the player, never sent to the model). | Required on every card. Use **Opening message** for standard character and story cards; use **Opening page** (or display rules on the greeting) for title screens, route pickers, or character creation. |
| **Lorebook** | **Create one** or **Import lorebook file**, then manage entry keywords, always-on flags, and semantic recall. | Use once world lore, cast bios, or locations outgrow a few thousand characters so they load only when relevant. |
| **Display** | **Chat page** (**Sandbox (recommended)** or **Classic**) and **Display rules** (open **Regex rules** to manage find/replace rules and the pinned **Function bar**). | Leave untouched for plain-text cards; open when turning reply markers into status panels, buttons, or custom layouts. |
| **Advanced** | **Card styles** (pick bubble, input, button, and background colors and fonts, or paste card-wide **Custom CSS**) and **Variables** (exact turn-by-turn tracking for affection, gold, inventory, or quests with a custom panel). | Open when restyling the chat screen or building RPG, stat-raising, or management mechanics with exact numbers. |
| **Publish** | **Visibility** (**Only me**, **Anyone with the link**, **Public**), **Player polls and counters**, **Enable Workshop** (**Author DLC** and **Player extensions**), the **Still missing** checklist, and **Rate content**. | Control who can open the card, opt into community extensions, and verify review requirements before going public. |

## Manage deep lore with a Lorebook

When locations, side characters, and faction rules pile up, keeping all of them inside **Character definition** crowds every single turn. Moving background entries into a **Lorebook** keeps the active prompt lean so the model remembers the ongoing story longer.

Open **Lorebook** and click **Create one** (or **Import lorebook file** for a SillyTavern or RiliAI JSON book) to add entries. Entries enter a conversation in two ways:

- **Always on (every turn)**: included in the cached prefix of every turn regardless of keywords (and counted toward the 3,000-character public review minimum). Keep always-on entries short and reserved for rules that must never drop out; if they exceed the context budget, earlier entries in the list take priority.
- **Keywords and semantic recall (default)**: when **Always on** is unchecked, add **Keywords** (plain phrases or `/pattern/flags` regular expressions; if **Secondary keywords** are also set, both sides must match). Whenever a player or reply hits a keyword, the entry loads. Because **Semantic recall** is also on by default, relevant entries can be pulled in by meaning within the turn's budget even without an exact keyword match.

For murder-mystery culprits, late-story twists, or hidden routes that shouldn't surface early just because a topic is adjacent, toggle **Semantic recall** off on those specific entries so they wait strictly for their keywords. Aim for roughly 500 characters and one topic per entry, and give entries descriptive titles ("Old Chen, Black-Market Apothecary" rather than "NPC 03") so characters in Agent preparation mode can also look them up by name.

## Add status bars, choice buttons, and card variables

You don't need regular expressions just to show current location, stats, or action buttons under replies. When your card needs exact arithmetic for gold, affection, or inventory, **Variables** tracks them natively.

### Built-in `[status]` and `[choices]` blocks (no regex needed)

Ask the AI in **Character definition** or **Reply format** to end each reply with `[status]` and `[choices]` blocks, and the chat page automatically renders them as a styled status panel and tappable choice buttons (tapping a choice fills the player's input box):

```text
[status]
Location: Old Quarter Clocktower
Time: 23:40
Alert: 35/100
[/status]

[choices]
Push open the trapdoor and head down
Hold still and listen to the footsteps
[/choices]
```

Ratios like `35/100` and percentages render automatically as progress bars. You only need custom display rules when you want a bespoke visual skin.

### Exact tracking with Variables

Asking a language model to remember "130 gold and two potions" in plain prose eventually drifts over long chats, and regenerating or rewinding a turn throws the numbers off. Open **Advanced** and click **Add variables** to let the platform maintain exact state:

1. **Define the JSON skeleton**: declare your initial fields and starting values (or click **Insert example** to start from the built-in Affection, Inventory, or Quests template). Current values travel with every turn, so keeping the schema compact saves context and speeds up replies.
2. **Write Variable rules**: explain in plain language when each field changes and by how much (for example, "Increase affection only on a meaningful gift or milestone, at most +5 per turn; deduct gold when buying items"). The model appends a hidden update block at the end of each reply, and regenerating or rolling back a message automatically rewinds variables to match that turn.
3. **Design a Panel skin (optional)**: write HTML and CSS with Handlebars syntax (`{{affection}}`, `{{#each bag}}`) so players can open a live state panel in chat, and check your layout right away in **Panel preview**.

## Customize chat styles, display rules, and the chat page

To change bubble colors, backgrounds, or fonts across the whole card, use **Card styles** under **Advanced**; to turn markers in replies into custom HTML panels or interactive scripts, configure the chat page and **Regex rules** under **Display**.

### Restyle colors and fonts with Card styles

Open **Advanced → Card styles** to pick colors and fonts for bubbles, the input box, the send button, and the chat background, or paste page-wide rules into **Custom CSS** (plain CSS with no `<style>` wrapper and no match pattern, applied once when the chat opens, up to 512 KB). Card-wide stylesheets written for AI Fengyue automatically map their chat selectors when pasted here.

### Common style variables

These CSS variables work on both the **Sandbox** and **Classic** chat pages when set on `.canvas-root` inside **Card styles**:

| Appearance | Variable |
|---|---|
| AI bubble background | `--lt-canvas-bubble-ai-bg` |
| Bubble text (shared by AI and player) | `--lt-canvas-bubble-fg` |
| Player bubble background | `--lt-canvas-bubble-user-bg` |
| Input field background | `--lt-canvas-composer-field-bg` |
| Send button background | `--lt-canvas-send-bg` |
| Accent color | `--lt-canvas-accent` |
| Font family (full CSS `font-family` list) | `--lt-canvas-font` |
| Chat background | `--lt-canvas-bg` |

```css
.canvas-root {
  --lt-canvas-bubble-ai-bg: #243447;
  --lt-canvas-bubble-fg: #f2f2f5;
  --lt-canvas-bubble-user-bg: #37465b;
  --lt-canvas-composer-field-bg: #1e2938;
  --lt-canvas-send-bg: #355a7c;
  --lt-canvas-accent: #8fc9ff;
  --lt-canvas-font: system-ui, sans-serif;
  --lt-canvas-bg: #121b28;
}
```

Legacy MMD variables (`--background-color`, `--primary-font-color`, and `--input-background-color`) continue to work as well. Variables apply to elements that consume them; hardcoded colors on specific selectors take priority, and styles inside **Display rules** sit above **Card styles**.

### Transform reply markers with Display rules

Click **Regex rules** under **Display** to build ordered find/replace rules. Every message passes through all enabled rules in order before display, and the model never sees the resulting HTML:

- **Applies to**: choose **AI replies**, **Player messages**, or **System messages** per rule. New rules default to AI replies only; older rules without a target setting apply to all three; SillyTavern imports map their original player/AI flags automatically. Saving a rule with all three unchecked skips message text while still expanding the **Function bar**.
- **Find**: a fixed literal string (such as `[HUD]`) or a `/pattern/flags` regular expression (such as `/<status>([\s\S]*?)<\/status>/g`). Capture groups are available in replacements as `$1`, `$2`, and Chinese characters in patterns automatically match both Traditional and Simplified forms.
- **Replace with**: any HTML, including `<style>` and `<script>`. All `<style>` blocks across enabled rules merge into one stylesheet on load, and each `<script>` runs once per card load.
- **Function bar**: content pinned above the message list, shown only to the player and never sent to the model. A common pattern is placing short trigger tokens (such as `[HUD][Theme]`) in the bar and letting your rules expand them into persistent panels or menus.
- **Macros**: replacements support `{{user}}` (the player's display name) and `{{char}}` (the character's name or self-reference).
- **Limits and live testing**: a single replacement can be up to 512 KB (replacements above 256 KB show a non-blocking performance warning), and the whole rule set up to 32 MB (the editor shows any overage). Paste a sample reply into the **Test** pane on the right of the rule editor to preview one rule or the full stack live.

### Sandbox chat page vs. Classic chat page

Under **Display → Chat page**, both modes draw the same interface (header, messages, composer, panels) and differ in where your styles and scripts run:

- **Sandbox (recommended, default for new cards)**: runs the card's styles and scripts inside an isolated frame. Scripts can restyle the entire chat screen (compatible with MMD's new sandbox API) while keeping the player's sign-in session unreachable, and credit-spending actions respond only to real clicks from the player.
- **Classic**: applies rules directly on the host chat page with no sandbox `sdk`. Use it only when an older imported card behaves unexpectedly in the sandbox.

After switching an existing card to **Sandbox**, open **Try it out** and check the function bar, greeting panels, floating buttons, and menus (narrow fixed button strips flush with the left or right screen edge also make the message column step inward automatically so bubbles aren't covered). Most cards work without edits; if scripts touch host DOM nodes, see [Migrating from the classic page](#migrating-from-the-classic-page) below.

## Visibility, public review, and Workshop extensions

You can keep a card private or share it quietly by link for as long as you like; when you're ready to list it publicly, earn credit rebates from player chats, and enter leaderboard prize pools, finish the checklist under **Publish**.

### Three visibility options

Switch **Visibility** under **Publish** at any time:

| Visibility | Who can open the card | When to use it |
|---|---|---|
| **Only me** | Only you and previous players who already started a chat on this card can continue; new visitors cannot open it and it stays out of all public listings. | Personal play or closing the card to new visitors. |
| **Anyone with the link** | Hidden from the **Board**, rankings, and search, with no review required. Anyone you give the link to can play your latest saved version and leave comments. | Playtesting with friends or sharing inside a small group before review. |
| **Public** | Listed on the **Board**, categories, and search once approved; players get the approved version, you earn credit rebates on chats, and new releases enter daily, weekly, and monthly leaderboard prize pools. | Releasing a finished card to the community. |

### Three requirements for public review

The **Still missing** panel under **Publish** tracks everything needed before submitting:

1. **At least one preset category or play-style tag**: pick at least one official tag from the catalog picker under **Basics → Tags** (custom free-form tags are welcome alongside it, though they don't count toward this requirement).
2. **Over 3,000 counted characters**: **Character definition** plus enabled **Always on** Lorebook entries must total at least **3,001** Unicode letters and digits combined (for English too, counted by character rather than word; spaces, punctuation, emoji, HTML/style/script markup, template variables, openings, example dialogue, standing reminders, and non-always-on Lorebook entries are excluded).
3. **Content rating questionnaire**: click **Rate content** and answer for the strongest material your card's text, art, and framing can produce (displayed on the card page per Taiwan's game software rating; Adults-only cards are hidden unless a viewer enables adult content, and romance/dating or marriage themes rate at least 12+).

Once a card is public, saving edits in the editor updates only your draft while players continue on the approved version until your next submission passes review. Submissions update silently by default; check notify and include an update note only when you want bookmarkers and followers notified after approval (at most once every 3 days per card).

### Enabling Workshop (Author DLC and Player extensions)

Turning on **Enable Workshop** under **Publish** (off by default) adds a **Workshop** tab to your card page: you can publish **Author DLC** (extra openings, display rules, and Lorebook entries), and players can publish **Player extensions** (Lorebook entries only, capped at 1,500 characters of enabled always-on content per item, with zero read access to your card's private definition, Lorebook, or regex rules).

## Sandbox scripting and compatibility reference

When writing JavaScript inside display rules to drive the input box, save cross-device state, run community-wide polls, or migrate an older classic-page card, use the node selectors, `sdk` methods, events, and error codes below.

### DOM selectors and sandbox CSS variables

The sandbox page exposes stable `data-chat` and `data-slot` attributes matching MMD's new sandbox contract so one script runs on both platforms. Query these attributes rather than internal class names:

| Selector | Purpose |
|---|---|
| `[data-chat="root"]` | Root node of the chat screen. `data-theme` is `dark` or `light`; `data-composer` reflects whether the input bar is shown. |
| `[data-chat="message"]` | One message wrapper. `data-from` is `ai` or `user`; `data-state` is `pending`, `streaming`, or `done`; `data-msg-id` holds the server-side message ID. |
| `[data-chat="message-body"]` | Rendered message body HTML after display rules run. |
| `[data-slot="statusbar"]` | Pinned function bar container above messages. |
| `[data-slot="left"]` / `[data-slot="right"]` | Left and right docked sidebar slots; placing content here automatically narrows the message column to make room. |
| `[data-chat="author-stage"]` | Author stage overlay: `sdk.stage.open('content')` covers the message area, `open('full')` covers the full page. |
| `[data-chat="input"]` | Composer text input element. |
| `[data-chat="composer"]` | Full bottom composer container. |

Alongside the cross-page [Common style variables](#common-style-variables), the sandbox shell defines colors and sizing with `--chat-*` CSS variables (such as `--chat-bg`, `--chat-text`, `--chat-accent`, and `--chat-bubble-ai-bg`); override them on the root node to retheme the whole sandbox page.

### `sdk` methods

| Method | Description |
|---|---|
| `sdk.input.get()` / `set(text)` / `add(text)` / `insert(text)` / `clear()` / `focus()` / `blur()` / `getCursor()` / `setCursor(pos)` | Read, modify, focus, and move the cursor inside the message input box. |
| `sdk.composer.show()` / `hide()` / `visible()` | Show, hide, or check visibility of the bottom composer bar. |
| `sdk.message.send(text)` | Send a message as the player. Prompts the player for confirmation unless called synchronously inside the player's own click handler. |
| `sdk.message.edit(id, text)` | Edit the specified message (`data-msg-id`) and resend; follows the same player-confirmation rule. |
| `sdk.save.get(key)` / `set(key, value)` / `remove(key)` / `keys()` | Cross-device persistent storage: up to 10 keys per card per player, keys matching `[A-Za-z0-9_-]`, up to 64 KB UTF-8 JSON per value. |
| `sdk.cache.get(key)` / `set(key, value)` / `remove(key)` | Ephemeral in-page cache cleared on reload or navigation. |
| `sdk.stage.open(mode)` / `close()` / `el()` / `visible()` | Open, close, inspect, or retrieve the author stage (`'content'` or `'full'`). |
| `sdk.role.get()` | Returns the card's `{ name, avatarUrl }`. |
| `sdk.user.get()` | Returns the player's `{ nickname, avatarUrl, locale }` (for example `zh-Hans`). |
| `sdk.text.convert(text)` / `sdk.text.ready()` | Converts script-drawn Chinese text into the player's Traditional or Simplified script using the same rules as reply text (returns input unchanged when scripts match or before the dictionary finishes loading; `ready()` resolves once loaded or immediately when no conversion is needed). |
| `sdk.model.get()` | Returns `{ name, cost }` for the player's active model (`name` matches the header's `Model · Lane` label; `cost` is the estimated credits for the next turn, such as `127–251` on dynamic-pricing lanes, or empty strings before initialization). Direct players to the composer's model button to switch models. |
| `sdk.generation.get()` | Returns `{ phase, since, outcome }` for the current turn. `phase` is `idle`, `preparing` (just sent, before output), `summarizing` (story compaction before the first token, which can take tens of seconds), `thinking` (model reasoning before visible prose; absent on non-reasoning models), or `writing` (streaming prose); `since` is the millisecond timestamp when that phase began (never includes reasoning text). `outcome` is `null` while generating or after a normal finish; when the last turn stopped abnormally, it mirrors the status card drawn below the message: `{ kind, label, sub, actions }`. `kind` is one of `model-error`, `network-error`, `server-error`, `rate-limit`, `quota`, `filtered`, `length-cap`, `stopped`, `compact-retryable`, `outcome-unconfirmed` (still settling, no buttons, resolves automatically), or `interrupted` (Agent preparation incomplete); `label` and `sub` are localized strings; `actions` is `[{ action, label }]` with `action` in `retry`, `continue`, `switch-model`, `model-settings`, `capacity`, `refresh`, `retry-stream-off`, `edit-message`, `switch-lane`, `resend-traditional`. The last four appear only on `filtered` cards: `retry-stream-off` disables streaming for this chat and retries, `edit-message` opens the blocked player message for editing and replacement, `switch-lane` opens the model sheet focused on alternate lanes of the current model, and `resend-traditional` converts a blocked Simplified-Chinese message to Traditional Chinese and replaces it once. |
| `sdk.generation.act(action)` | Triggers one of the actions offered in `outcome.actions`, matching a tap on the platform's status card (for example, `retry` reuses the existing player turn without sending a duplicate). Must be called inside a player click handler (otherwise rejects with `UNAUTHORIZED` without prompting); rejects with `INVALID_ARGS` if unavailable, `BUSY` while generating, rate-limited to 3 calls per minute; returns a Promise. |
| `sdk.archive.list()` / `save(title?)` / `fork(messageId)` / `open(id)` / `start(opening?)` / `rename(id, title)` / `remove(id)` | Manages the platform's cross-device conversation saves (up to 20 per card including the active conversation). `open` switches to a save while keeping your previous progress in the list; `save` snapshots the current progress under `title` and continues play in the new copy, returning `{ id, current }` (`id` is the preserved snapshot); `fork` branches from a bubble's `serverId`; `start` starts a fresh save (`0` for the main greeting, `1+` for alternate openings); `list` returns `{ items, count, limit }` with `{ id, title, isCurrent, messageCount, lastMessage, createTime, lastUpdateTime }`. Call mutating methods inside a player click with your own confirmation UI; outside a click, the shell prompts the player. |
| `sdk.on(event, handler)` | Subscribe to sandbox lifecycle and chat events. |
| `sdk.debug.log(...args)` | Write to the debug panel (append `?sdkDebug=1` to the chat URL to display it). |

### Events, execution rules, and error codes

| Event | When it fires |
|---|---|
| `ready` | Fires once after initial messages finish mounting on page load (not replayed). |
| `message:new` | A new message record is created. |
| `message:mount` | A message node mounts into the DOM (replayed to late subscribers for mounted messages). |
| `message:stream` | Streaming reply text updates. |
| `message:done` | A message finishes (replayed to late subscribers for completed messages). |
| `message:unmount` | A message node is removed from the DOM. |
| `input:change` | Composer input text changes. |
| `conversation:switch` | Active conversation changes after load, save, fork, or new chat; payload `{ conversationId }`. |
| `theme:change` | Light/dark theme switches. |
| `back` | Player presses the header back button. |
| `stage:close` | Author stage closes. |
| `dispose` | Page is about to unload. |
| `model:change` | Player changes models or estimated next-turn cost changes (context tier, thinking depth); payload matches `sdk.model.get()`. |
| `generation:phase` | Turn generation phase changes; payload `{ phase, since }` (not replayed; call `sdk.generation.get()` on late init). |
| `generation:outcome` | Abnormal turn status card appears or clears; payload matches `sdk.generation.get().outcome`, possibly `null` (not replayed). |
| `share:change` | Share availability or referral code finishes loading after initial script execution (no payload; re-read `sdk.share`). |

Execution rules and standard error codes:

- On cold start, each existing message emits `message:new`, `message:mount`, and `message:done` in order, followed once by `ready`.
- Inside message event handlers (and click/input handlers inside a message bubble), `document.querySelector` and sibling DOM queries are scoped to **that message bubble only**; outside those handlers they query the whole sandbox `document`.
- Sandbox scripts cannot make network requests to external origins (`fetch`, etc.), while external `<script src="https://…">`, images, and fonts load normally.
- Error codes: `UNAUTHORIZED` (player declined confirmation or restricted call made outside a click), `RATE_LIMITED` (called too frequently), `INVALID_ARGS` (bad arguments or size/key limit exceeded), `HOST_DENIED` (host page refused the operation), `BUSY` (reply currently generating), `LIMIT_REACHED` (save slots full; `err.data` is `{ count, limit }`, prompt the player to delete an old save), and `NOT_SUPPORTED` (capability unavailable in current environment).

### Authoritative message history (`sdk.history`)

When rebuilding game state from the full conversation rather than virtualized DOM bubbles, use `sdk.history` on sandbox cards (`stage.history` on classic cards):

- **Probing and paginated reads**: check `history?.capabilities().available` first (older hosts and offline previews may not provide it). `list({ cursor, revision, content: true })` reads only the current player's active conversation on this card; pass the first page's `revision` on every continuation page and accumulate until receiving the final page with `complete: true` (discard the partial chain and restart on `HISTORY_STALE`).
- **Turn links (`replyTo`) and completion**: every item carries `replyTo: string | null`. On an `ai` item, `replyTo` holds the conversation-scoped history `id` of the player message that triggered it (possibly on an earlier page); player messages, greetings, and older or forked rows without a verifiable link carry `null` (older hosts may omit the field, so treat it as unknown rather than guessing by adjacency). Regenerating creates new player and AI IDs pointing to the new player ID; manually editing an AI reply preserves its ID and `replyTo`; rewinding removes discarded messages; deleting a player message while keeping the AI reply sets `replyTo` to `null`. Appending text to an existing reply (`contine` / `continue_response`) is unsupported; continuing saved Agent preparation reuses the original player message ID. When `content: true` is requested, bodies include only finalized visible text (excluding reasoning, in-flight stream text, and moderation-hidden text); always check `item.complete` before treating an AI reply as a valid checkpoint.
- **Change subscriptions (`onChange`)**: `onChange(callback)` returns an unsubscribe function. Each change entry carries `{ op, id, replyTo, replacementId? }` (`replyTo` on `add`/`update` reflects the link verifiable at read time; `remove` is always `null`, firing for true deletions even on unmounted/hollow messages, whereas viewport `message:unmount` is not a deletion). On the first part of a change batch, mark derived state pending and recompute from a fresh complete `list()` read (even a player-only deletion can turn an AI reply's `replyTo` to `null`). Stale cursors, `reset`, and `unavailable` mean unknown state, never an empty conversation. Foreground tabs poll cross-device changes every 15 seconds and on focus; unsubscribe on teardown. Neither `revision` nor history IDs identify a player account.

### Polls, co-op counters, and share tallies (`sdk.shared`)

Polls and counters declared under `sharedState` in `rules.json` share totals across everyone playing the card via `sdk.shared` (`window.stage.shared` on classic cards):

- **`read(keys)`**: accepts one key or up to 16 keys, returning `{ [key]: { kind: 'poll', counts, total, mine? } | { kind: 'counter', total, mine?, goal?, reachedAt?, previous? } }`. Undeclared keys are omitted; `mine` is the signed-in player's own choice or contribution (absent for guests); counter `total`, `mine`, and leaderboards reset each period while `previous` holds the prior period's total.
- **`vote(key, option)`**: records a vote and returns `{ mine }` (up to 10 votes or changes per poll per player per day, first vote included; re-picking the same option is free).
- **`add(key, delta)`**: adds an integer from `1` to `maxStep` and returns `{ total, mine, reachedAt }`.
- **`leaderboard(key, { limit })`**: returns `{ items: [{ rank, name, value }], mine? }` for the current period (default 10, max 50, public nicknames only, excluding test accounts).

Anyone can read; writing requires a signed-in player who has opened a conversation on the card. Totals are not pushed, so poll no faster than once every 10 seconds. Authors can test on any card they own (including fresh private cards and CLI trial cards): the author's numbers stay separate from players', and draft playtests (`?mode=source`) and test accounts each keep separate buckets as well. View, pause, or reset state in **Publish → Player polls and counters** or via `hearthroom card state`.

For "send a question to friends and unlock content from their answers", call `await sdk.share.tallyLink(code, pollKey)` on a poll declared with `share: true` (prepare the link before the click; the same context code and poll return the same `?share=~XXXXXXXX` link, up to 20 per player per day, valid for 90 days). Friends opening the link read `sdk.share.context` and `sdk.share.poll` (`{ key, options }` or `null`) and answer with `sdk.share.respond(option)` (tallied per link, separate from the card's main poll). The sharer reads `sdk.share.results()` (`[{ context, pollKey, total, counts, updatedAt }]`: `total` updates live; per-option `counts` appear once 3 friends answer and refresh daily). Neither side sees the other's identity; cards may unlock in-card content from tallies, never platform credits. Both chat page modes share error codes: `SHARED_DISABLED` (paused by platform or author), `NOT_DECLARED`, `OPTION_INVALID`, `NOT_ELIGIBLE` (haven't played this card, or opening your own link), `UNAUTHORIZED` (signed out), `RATE_LIMITED`, `LIMIT_REACHED` (`err.data.reason` is `goal` or `limit`), and `HOST_DENIED` (older host page, read-only while viewing past chats or review playtests, or calling `tallyLink` on a never-submitted card with no visibility such as a trial card).

### Image sharing, clipboard writes, and context share links

- **Sharing images and copying text (native browser APIs)**: HTTPS card frames receive delegated `web-share` and `clipboard-write` permissions from the host (never `clipboard-read`). Inside a player click handler, scripts can call `navigator.share` (with a pre-built image `File` and text), `navigator.clipboard.write` with `ClipboardItem` (PNG), or `navigator.clipboard.writeText`; these are standard browser APIs, not new `sdk` methods or HTTP endpoints. Feature-detect `navigator.share`, `navigator.canShare({ files: [file] })`, `navigator.clipboard.write`, and `ClipboardItem` before offering buttons, and construct files before the click to preserve user activation. Support varies by OS, browser, permissions, and target app, and receiving apps may drop either the image or the caption; catch rejections/cancellations, fall back to image download plus selectable text, and never auto-reopen a dismissed share sheet. Opaque-origin local previews may reject these calls, so verify on a real cross-origin card page on your target device.
- **Context-carrying share links (`sdk.share`)**: `sdk.share.link(code)` (`window.stage.share.link` on classic cards) synchronously returns `/cards/<number>` with the signed-in player's referral code plus `?share=<code>` when given (build it before the click and pass it to `navigator.share`; listen for `share:change` to refresh if the referral code arrives after initial load). A friend opening the link reads the code from `sdk.share.context` (`null` when absent or viewing a past chat) so your card can react to what the sender picked. Codes take 1 to 64 ASCII letters, digits, `.`, `_`, or `-`, starting with a letter or digit (invalid codes throw `SHARE_CONTEXT_INVALID` in sandbox and return `null` in classic); the platform only delivers the string without sending it to the model or attaching player data, and anyone can type one into the URL, so accept only codes your card defines and check `sdk.archive.list()` to tell whether the friend already has a save (guests have none). `sdk.share.audience` reports who can open the link: `author` (private card that new friends cannot open), `link`, or `public`. When platform sharing is off, `sdk.share.enabled` is `false`, `context` is `null`, and `link()` returns the plain card URL. `sdk.share.qr(text)` returns `{ size, path }` (an SVG path on a `size`×`size` grid) for drawing QR codes on share cards. Test on drafts with `?mode=source&share=<code>`.

### Sidebar auto-docking (`--lt-dock`) and style compatibility

- **Docked sidebars**: fixed button strips flush with the left or right edge and roughly 48px wide or narrower automatically inset the message column on both sandbox and classic pages (full-screen modals, centered panels, and wider bars are ignored). Override detection by setting `--lt-dock` in the outer element's inline `style` attribute (works across all card formats):

| `--lt-dock` value | Effect |
|---|---|
| `left` / `right` | Treats the element as a docked sidebar on that side even if not flush with the edge, widening the cap up to 30% of the message column. |
| `none` | Never insets the message column for this element. Setting it on `:root` disables auto-docking card-wide (ineffective in SillyTavern-format display-rule styles, which are scoped inside messages). |

```html
<div id="my-sidebar" style="position: fixed; left: 0; top: 30%; --lt-dock: left;">…</div>
```

If docking would leave less than 75% of the original message column width, no inset is applied; applied insets publish `--lt-canvas-dock-left` and `--lt-canvas-dock-right` on `<html>` (absent otherwise) so your own overlays can align with the column.

- **Card styles vs. display-rule CSS compatibility**: CSS placed in **Advanced → Card styles** (`card.css` in the CLI, up to 512 KiB UTF-8) automatically maps known AI Fengyue selectors (`#customized-answer-content`, `#ai-chat-input`, `#ai-send-button`) to Hearthroom's bubbles, input, and send button with no source toggle needed, and can freely mix Fengyue and native selectors (`.mes` is not treated as a SillyTavern scope marker; re-import older Fengyue cards to pick up the latest mapping). `<style>` tags inside **Display rules** keep their saved `cssDialect` and compiled markers, falling back to `cardFormat` scoping (`tavern` scopes inside `.mes_text`, other formats apply as written) with no automatic Fengyue mapping. Precedence runs from platform defaults and theme, up to **Card styles**, up to enabled **Display rules**; existing imported cards preserve their stored dialect and precedence on save.

### Migrating from the classic page

Common selectors from the classic page (`.mes` message wrapper, `.mes_text` body, `.mes.Ai` / `.mes.User` speaker, `#msglistview` list, and `.chat-scope-box` container) are all present inside the sandbox page:

- Cards that only style elements or replace text/HTML need zero changes.
- Booting scripts via `<img onerror="…">` works in the sandbox whether placed in the **Function bar** or in an **Opening message**.
- Replace scripts that reached into host headers or inputs outside the chat area with the `sdk` methods above.
- `localStorage` works inside the sandbox under the card's isolated origin; switch to `sdk.save.*` when state needs to follow the player across devices.

### Troubleshooting

| Symptom | Cause & fix |
|---|---|
| Edited fields or rules, yet **Try it out** didn't change | **Try it out** runs the last saved version. Click **Save and reload** at the top of the test pane. |
| Blank screen for 10+ seconds the first time a card opens | Cold-loading sandbox assets takes longer on first visit and caches afterward; if it stays blank past 20 seconds, a reload prompt appears. Refresh the page. |
| An overlay blocks scrolling when opening a card | That is the card's own onboarding or tutorial layer. Click its **Skip** or close button. |
| Display-rule scripts do nothing | Append `?sdkDebug=1` to the chat URL to open the debug panel and inspect script errors and `sdk.debug.log` output. |
| `sdk.save` writes fail | Check that keys use only `[A-Za-z0-9_-]`, each JSON value is within 64 KB, and the card hasn't exceeded 10 keys. |
| Message bubbles look narrower than expected on both sides | A decorative edge element was detected as a docked sidebar. Add `--lt-dock: none` to its inline `style`. |
