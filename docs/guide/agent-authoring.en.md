## What your agent can do

Your agent works from Hearthroom's card-writing skills: it works out what you want (asking only when different readings would produce different cards), writes the card as a folder, pushes it as a trial card, checks and plays it, then tells you what could be better. Each item comes with a prompt you can enter as it is.

### Write a whole card from an idea

> "A cultivation card: I'm the disciple the sect expelled, my senior sister helps me in secret, and the tension is that she will be caught the moment she acts. Track my cultivation only. Make it a trial card first and tell me the weakest layer."

A vague idea is fine. It works out the setting, the characters, the relationship and the opening with you before it writes.

### Fix a card you already have

> "Import this SillyTavern card, tell me why it runs out of things to say after three turns, and fix it."

SillyTavern PNG, JSON and CHARX cards and MMD three-file sets import directly.

### Build status bars, themes or a full custom page

> "Add a status bar that shows affection and location, and render the opening for me."

When the screen matters it uses the toolkit's own sandbox kit (a status panel drawn from a block the model writes, choice buttons, a theme), checks the folder with `hearthroom card check`, and looks at the result with `hearthroom card preview` and `card render`. With no rule at all, the page itself draws a reply's closing [status] and [choices] blocks as a panel and buttons; the kit is for a look, theme or pinned bar of your own.

The chat page itself is open source (`hearthroom/moonstage`, the `stage` submodule of this site): the skills' sandbox contract is generated from its `src/sandbox/`, and the facts sheet names the files to read when something is undocumented.

### Playtest and find problems

> "Play ten turns with the second opening and tell me at which turn a player would lose interest, and why."

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

Your agent works from the official skills, so you do not need to explain how a card is written. What it needs from you is what the skills cannot contain: the player's situation, the character's voice, the screen you want, what counts as done, and what the agent may decide on its own. This section is organised by situation. Each part explains why the agent behaves as it does, what to write, and gives a prompt you can copy and adapt. Start with the section that matches what you see:

- The card reads like every other card: [Give the situation and the tension, not only a genre](#give-the-situation-and-the-tension-not-only-a-genre), [Use one line of dialogue instead of adjectives](#use-one-line-of-dialogue-instead-of-adjectives)
- The status bar and buttons overshadow the story: [Say which kind of screen you want and which defaults you do not](#say-which-kind-of-screen-you-want-and-which-defaults-you-do-not)
- The agent asks often and waits for confirmation at every step: [State what counts as done and what the agent may decide](#state-what-counts-as-done-and-what-the-agent-may-decide)
- The idea is not clear yet: [Ask for directions before a card](#ask-for-directions-before-a-card)
- You have a source, setting notes or a card you like: [Hand over the material](#hand-over-the-material)
- The language, register or forms of address are wrong: [State the language and forms of address](#state-the-language-and-forms-of-address)
- The agent changed content you did not ask about: [One change per version](#one-change-per-version)
- The agent reports a test, but the card runs dry after three turns: [Ask for a full playtest and read the working record](#ask-for-a-full-playtest-and-read-the-working-record)
- A change made the card worse: [Report what you saw, not the edit](#report-what-you-saw-not-the-edit)
- You asked a question and the agent made changes: [Say when you only want an opinion](#say-when-you-only-want-an-opinion)
- A new conversation should continue earlier work: [Continue earlier work](#continue-earlier-work)

### Give the situation and the tension, not only a genre

A prompt such as "write me a fun maid card" gives the agent a genre and nothing else, so it writes the most common card in that genre: the usual setting, the usual relationship, the usual opening. The skills guarantee the card's structure; they cannot decide what makes this card worth playing. That comes from two things: who the player is and what they face (the situation), and what is left unresolved (the tension). Before writing, the agent states how the genre is usually written and how this card will differ; object at that step rather than after the card is written.

Write something like:

```text
A maid card. The player has just inherited an old house; she is the housekeeper the previous owner left behind and knows every secret the house keeps. Tension: she hands those secrets over one at a time as the player earns her trust, and each one she gives up is one less reason for her to stay. First tell me how you intend to differ from the usual maid card, then start.
```

The last sentence does the work: it makes the agent state the usual version first, so you can change direction before anything is written.

### Use one line of dialogue instead of adjectives

Descriptions such as "natural dialogue", "with personality" or "tsundere" mean different things to different people, and the agent can only apply the most common reading. One line of dialogue in the voice you want defines the register, sentence length, forms of address and how much the character withholds, more precisely than any adjective.

Write something like:

```text
Her voice follows this line: "The key to that door, sir, I believe you do not need yet." Short sentences, formal address, no explanations, and she stops when she has said it. Write three lines in this voice for three different moments and show me before writing the card.
```

One sample line is enough; with three or more, the agent starts copying sentence shapes instead of the voice.

### Say which kind of screen you want and which defaults you do not

A card's screen is one of two kinds: the story leads and the screen assists, or the play is bound to values and the screen is central. Without a statement, the agent applies the genre's common pattern: an affection meter, two to four buttons after every reply, feelings turned into numbers. "Not too AI-like" does not map to any specific pattern, so the agent cannot tell which one you mean; naming the defaults you do not want is what works. Note that even without display rules, the platform draws the [status] and [choices] blocks at the end of a reply as a panel and buttons; whether you want a screen and whether you need rules are separate questions.

Write something like:

```text
This is a companion card. The story leads, and it must remain readable with the screen off. No affection meter, no option buttons after every reply, no feelings as numbers. Keep one line at the end of each reply: where she is and what time it is.
```

For a card whose play is bound to values, state the opposite:

```text
This is a survival card and the screen is central. Show only three values: water level, food, fuel, each of which the player can change by an action. End every turn with two to four options. Do not show any value the player cannot change.
```

### State what counts as done and what the agent may decide

The agent stops to ask not because the task is hard but because it does not know what finished looks like or which actions need no confirmation. "Show me the setting first, then the characters, then the opening" makes it stop at every step. State the completion criteria and what it may decide on its own, including a credit limit, and leave the rest to it.

Write something like:

```text
Done means: pushed as a trial card, played by you for ten turns, and the weakest layer reported to me. Pushing and editing the trial card need no confirmation. Spend up to 50 credits at your discretion; ask before going over. Ask me only about submitting for review, publishing, or a choice that would produce a completely different card.
```

This also makes the agent less likely to ask about ambiguous requests; if you want more check-ins, remove the last sentence.

### Ask for directions before a card

When the idea is not clear yet, "use your judgement" hands every decision over, and what comes back is usually the genre's most common version; asking for a finished card before you have seen a direction wastes a whole draft. Ask the agent for a few directions, each in one sentence on what the player does and where the tension is, and choose one.

Write something like:

```text
Post-apocalyptic. Give me three directions first, one sentence each on what the player does and where the tension is. Do not write the card. I will pick one, then you start.
```

### Hand over the material

The source of a fan work, your own setting notes and cards you like are information the agent cannot produce. "Like that cold senior girl from that anime" asks it to rebuild the character from impressions, and the result drifts; hand over the material and say what must be kept and what may change. When you attach a card you like, say which part you want (the pacing, the opening, the density of dialogue); otherwise the agent imitates the subject as well.

Write something like:

```text
The source is [character] from [title]; the setting notes follow. Must keep: how she addresses her juniors, her habit of acting first. May change: move the timeline to the first year after graduation. A card I like is attached; what I want from it is the pacing of its opening, not its subject.
```

### State the language and forms of address

The card's language, its register and how the character addresses the player are not something the agent knows on its own; "write it in English" says nothing about spelling, formality or names. State them at the start and save field-by-field corrections later.

Write something like:

```text
The whole card in English, British spelling. The character addresses the player by first name, never "sir" or "ma'am". The player's name is theirs to fill in; do not preset one.
```

### One change per version

"The opening is too long, she warms up too fast, the world is thin, and change her name" makes the agent change several things at once; afterwards it is not possible to tell which change helped, and content you did not mention tends to move too. Specify one item per version and ask the agent to list the rest without touching it.

Write something like:

```text
This version addresses only "she warms up too fast". List the other problems you notice and leave them unchanged. When done, tell me which files you modified and what changed in each.
```

### Ask for a full playtest and read the working record

"Did you test it?" is usually answered with "yes", and two turns played by the agent only confirm that the opening works; whether a card holds up shows after ten turns, and weaker models fail first. A full playtest consumes credits, and the agent states the cost in advance. Afterwards, read the `README.md` in the card folder as well as the summary: it is the agent's working record, with the decisions, rejected directions and evidence for each version.

Write something like:

```text
Play 10–20 turns on a weaker model and on a stronger one, each in a fresh conversation. Report at which turn the card stops holding up and why, and record the results in README.md. State the credit cost before starting.
```

### Report what you saw, not the edit

"Shorten the second paragraph of the definition" prescribes the edit. You see the effect in play; the agent sees the structure of the whole card, and the cause is often not in the paragraph you suspect. Describe what you observed, ask it to find the cause, and ask for a comparison with the previous version using the same conversation rather than a report that the issue is fixed.

Write something like:

```text
By turn three she is already making advances; I want this much slower. Find the cause before changing anything, then compare the revised version with the previous one using the same conversation.
```

### Say when you only want an opinion

"Should this card take the story route?" looks like a question, but the agent cannot tell whether you are asking or requesting a change; when the two are combined it chooses to act. When you only want an opinion, say so explicitly.

Write something like:

```text
Do not change any file yet. What are the trade-offs of the story route versus the companion route for this card? Explain, then wait for my decision.
```

### Continue earlier work

In a new conversation the agent does not remember the last one; "keep working on that card" makes it guess from scratch. The `README.md` in the card folder is its working record; ask it to read that before changing anything.

Write something like:

```text
Continue the card in cards/maid. Read the folder's README.md first, tell me where the last version stopped and what is still open, then start.
```

### A check before you send

- Does the prompt say who the player is and what they face, or only name a genre?
- Is the character's voice given as a sample line, or only as adjectives?
- Does it say which kind of screen you want and which defaults you do not?
- Does it state what counts as done and what the agent may decide, including a credit limit?
- Does this prompt ask for one thing?

## Credits and boundaries

- Drafting, pushing, checking and rendering cost no credits.
- A playtest turn spends your credits, and your agent asks before it starts.
- It only touches trial cards and your own private cards, and never submits or publishes for you.
