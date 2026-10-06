## What your agent can do

Your agent works from Hearthroom's card-writing skills: it asks what you want, writes the card as a folder, pushes it as a trial card, checks and plays it, then tells you what could be better. Each item comes with a line you can say to it.

### Write a whole card from an idea

> "A cultivation story: I'm the outer-sect disciple everyone wrote off, and my senior sister helps me in secret. Track my cultivation and her affection. Make it a trial card first."

A vague idea is fine. It works out the setting, the characters, the relationship and the opening with you before it writes.

### Fix a card you already have

> "Import this SillyTavern card, tell me why it runs out of things to say after three turns, and fix it."

SillyTavern PNG, JSON and CHARX cards and MMD three-file sets import directly.

### Build status bars, themes or a full custom page

> "Add a status bar that shows affection and location, and render the opening for me."

When the screen matters it uses the toolkit's own sandbox kit (a status panel drawn from a block the model writes, choice buttons, a theme), checks the folder with `hearthroom card check`, and looks at the result with `hearthroom card preview` and `card render`.

The chat page itself is open source (`hearthroom/moonstage`, the `stage` submodule of this site): the skills' sandbox contract is generated from its `src/sandbox/`, and the facts sheet names the files to read when something is undocumented.

### Playtest and find problems

> "Play two turns with the second opening and tell me where a player would lose interest."

### Check before you publish

> "Check whether this card is ready for review and list what still needs fixing."

## How your agent writes a card

1. **A folder of files**: long text in Markdown files, and the Lorebook, rules and images in their own files. You can open and edit them too.
2. **A trial card**: only you can see it. It expires three days after the last update, and you can have five at a time.
3. **Checks and renders**: lengths and content are checked against the platform's rules, and the opening is rendered with the rules applied to confirm the status bar and layout.
4. **A real turn**: it chats with the character once to see whether the replies hold up and a player can keep going.
5. **Revisions**: it changes what didn't work, then pushes and plays again until you're happy.
6. **Keeping it**: once you're happy it saves a private card that appears in My cards. Submitting for review and publishing stay with you on the site.

## Getting better cards from your agent

- **Say what kind of play you want**: a companion, a story, a game and a character generator are written very differently.
- **Give it material**: for fan works, name the series and the character, then add your setting notes and cards you like.
- **Ask it to playtest**: a card that was only written usually stalls after a few turns, so ask for two real turns before it hands the card back.
- **Change one thing at a time**: "the opening is too long and she warms up too fast" works better than "make it better".
- **Read its reports**: the check results and renders after each push are more reliable than its own summary.

## Credits and boundaries

- Drafting, pushing, checking and rendering cost no credits.
- A playtest turn spends your credits, and your agent asks before it starts.
- It only touches trial cards and your own private cards, and never submits or publishes for you.
