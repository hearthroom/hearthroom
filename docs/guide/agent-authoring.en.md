## What your agent can do

Your agent works from Hearthroom's card-writing skills: it works out what you want (asking only when different readings would produce different cards), writes the card as a folder, pushes it as a trial card, checks and plays it, then tells you what could be better. Each item comes with a prompt you can enter as it is.

### Write a whole card from an idea

> "A cultivation story: I'm the outer-sect disciple everyone wrote off, and my senior sister helps me in secret. Track my cultivation and her affection. Make it a trial card first."

A vague idea is fine. It works out the setting, the characters, the relationship and the opening with you before it writes.

### Fix a card you already have

> "Import this SillyTavern card, tell me why it runs out of things to say after three turns, and fix it."

SillyTavern PNG, JSON and CHARX cards and MMD three-file sets import directly.

### Build status bars, themes or a full custom page

> "Add a status bar that shows affection and location, and render the opening for me."

When the screen matters it uses the toolkit's own sandbox kit (a status panel drawn from a block the model writes, choice buttons, a theme), checks the folder with `hearthroom card check`, and looks at the result with `hearthroom card preview` and `card render`. With no rule at all, the page itself draws a reply's closing [status] and [choices] blocks as a panel and buttons; the kit is for a look, theme or pinned bar of your own.

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

## Prompting guide

Your agent works from the official skills, so you do not need to explain how a card is written. What it needs from you is what the skills cannot contain: the kind of play you want, the purpose, reference material, and what it may decide on its own. The sections below are organised by situation, each with a less effective and a more effective way to phrase the request.

### The output is generic

Given only a genre, the agent writes the most common card in that genre. The player's fantasy and the central tension, a card you like, or a line of dialogue in the voice you want are more effective than descriptions such as "natural" or "with personality". Before writing, the agent states how the genre is usually written and how this card will differ; raise objections at that step.

> Less effective: "Write a cultivation card. Make the dialogue natural and give her personality."

> More effective: "A cultivation card. The player is a washout expelled from the sect; the senior sister helps him in secret, and the tension is that she will be caught if she acts. Her voice follows this line: 'Not taking that one. Next song.' Short, dry, no explanations. First describe how you intend to differ from the usual cultivation card."

### The agent asks often and waits for confirmation at every step

The agent stops to ask when the completion criteria are unclear or when it does not know which actions need no confirmation. State what counts as done and what it may decide on its own, then leave the rest to it.

> Less effective: "Show me the setting first, then the characters, then the opening."

> More effective: "Done means: pushed as a trial card, played by you, and the weakest layer reported to me. Pushing needs no confirmation. Spend up to 50 credits at your discretion; ask before exceeding that."

### The agent changed content you did not ask about

"Improve it overall" leads to several changes at once, and afterwards it is not possible to tell which one helped. Specify one item per version and ask the agent to record the rest.

> Less effective: "The opening is too long, she warms up too fast, the world is thin, and change her name."

> More effective: "This version addresses only 'she warms up too fast'. List the other points and leave them unchanged. When done, tell me which files you modified."

### The agent reports that it tested the card, but the conversation runs dry after three turns

Two turns played by the agent only confirm that the opening works; whether a card holds up shows after ten turns, and weaker models fail first. A full playtest consumes credits, and the agent states the cost in advance. After the playtest, read the `README.md` in the card folder as well as the summary: it is the agent's working record, with the decisions, rejected directions and evidence for each version.

> Less effective: "Did you test it?"

> More effective: "Play 10–20 turns on a weaker model and on a stronger one, each in a fresh conversation, and report at which turn the card stops holding up and why. State the credit cost before starting."

### The status bar and buttons overshadow the story

A card's screen is one of two kinds: the story leads and the screen assists, or the play is bound to values and the screen is central. State which kind you want, then name the default patterns you do not want. "Not too AI-like" does not map to a specific pattern. Note that even without display rules, the platform draws the [status] and [choices] blocks at the end of a reply as a panel and buttons; whether you want a screen and whether you need rules are separate questions.

> Less effective: "Add a status bar, make it look nice, not too AI-like."

> More effective: "This is a companion card. The story leads, and it must remain readable with the screen off. No affection meter and no three buttons after every reply; keep one line with her current location and the time."

### A change made the card worse

Describe what you observed rather than prescribing the edit. The agent can see the structure of the whole card; you can judge how it plays. Both are needed to find the cause. Ask for a comparison with the previous version rather than a report that the issue is fixed.

> Less effective: "Shorten the second paragraph of the definition."

> More effective: "By turn three she is already making advances; I want this much slower. Find the cause, then compare the revised version with the previous one using the same conversation."

### You asked a question and the agent made changes

When you only want an opinion, say so explicitly. The agent can distinguish a question from a request, but when the two are combined it chooses to act.

> Less effective: "Should this card take the story route?"

> More effective: "Do not change anything yet. What are the trade-offs of the story route versus the companion route for this card? Explain, then wait for my decision."

## Credits and boundaries

- Drafting, pushing, checking and rendering cost no credits.
- A playtest turn spends your credits, and your agent asks before it starts.
- It only touches trial cards and your own private cards, and never submits or publishes for you.
