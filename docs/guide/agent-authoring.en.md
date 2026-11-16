## Build a playable first draft

Once your agent is connected through the steps above, you don't need to learn any file formats. Hand it a character idea or an exported card file and you'll get a private playtest link back in a few minutes. Your agent follows the official card-writing skills and only stops to ask when two interpretations would produce genuinely different cards.

If you are running into a specific snag, jump straight to the matching section:

- Only have a vague genre so far: [Ask for directions before drafting when the idea is still loose](#ask-for-directions-before-drafting-when-the-idea-is-still-loose)
- Drafts come out generic and predictable: [Give the player's situation and the tension, not just a trope](#give-the-players-situation-and-the-tension-not-just-a-trope), [Give one real line of dialogue instead of a pile of adjectives](#give-one-real-line-of-dialogue-instead-of-a-pile-of-adjectives)
- Adapting canon material, lore notes, or a card you admire: [Hand over source notes and reference cards directly](#hand-over-source-notes-and-reference-cards-directly)
- Wrong dialect, register, or way of addressing the player: [Spell out language, register, and how the character addresses the player](#spell-out-language-register-and-how-the-character-addresses-the-player)
- Status bars and choice buttons get in the way of the story: [Say whether you want quiet prose or a stat-driven screen, and name the defaults to skip](#say-whether-you-want-quiet-prose-or-a-stat-driven-screen-and-name-the-defaults-to-skip)
- Agent stops to ask for permission at every tiny step: [Define what "done" looks like and what it can decide on its own](#define-what-done-looks-like-and-what-it-can-decide-on-its-own)
- Agent says it tested the card, yet it stalls by turn three: [Have the agent run 10 to 20 turns across models and check its work log](#have-the-agent-run-10-to-20-turns-across-models-and-check-its-work-log)
- Revisions make the card worse or touch things you liked: [Describe what happened in play instead of prescribing which paragraph to cut](#describe-what-happened-in-play-instead-of-prescribing-which-paragraph-to-cut), [Change one thing per revision](#change-one-thing-per-revision)
- Asked a question and the agent immediately rewrote your files: [Say up front when you only want advice](#say-up-front-when-you-only-want-advice)
- Picking up where you left off in a fresh session: [Resume in a new session or alongside the web editor](#resume-in-a-new-session-or-alongside-the-web-editor)

### Ask for directions before drafting when the idea is still loose

When all you have is a setting ("post-apocalyptic", "cultivation", "noir"), saying "surprise me" hands every creative choice to the model and gets you the most average version of the genre. Asking for a finished card right away also wastes a full draft if you don't like the angle. Have the agent pitch a few concrete setups before creating any files:

> I want to make a post-apocalyptic card, not sure what relationship dynamic to play yet. Don't build the card yet. Pitch me three distinct angles, one or two sentences each on who I am and what's unresolved between us, and let me pick one first.

### Give the player's situation and the tension, not just a trope

"Write a good maid card" only names a costume, so the agent falls back on stock setups and stock openings. What makes a card hold up past the greeting is who the player is right now and what unresolved problem sits between the two of you. Before writing files, the agent states how this trope usually plays out and how your card will depart from it. If that angle feels off, redirect it right there before a full draft is written:

> Build a manor housekeeper card. I'm a distant relative who just inherited an old country house, and she's the head housekeeper left behind by the late owner, the only person who knows the ugly things buried on the estate. The more she trusts me, the more she hands over what she's hiding, except every secret she gives up leaves her one fewer reason to stay. Before you write anything, tell me how maid and housekeeper cards usually go and how you plan to make this one play differently.

### Give one real line of dialogue instead of a pile of adjectives

Words like "natural dialogue", "sharp-tongued", or "aloof but caring" mean ten different voices to ten different people. One actual line the character would say pins down sentence length, formality, and how much she leaves unsaid far better than adjectives do. One or two sample lines are plenty; if you give three or more, the agent starts cloning sentence shapes instead of capturing voice:

> Anchor her voice on this line: "The key to the east landing, sir? I doubt you have any need of it tonight." Polite, clipped, never volunteers an explanation, stops talking as soon as she's made her point. Draft three sample lines in different situations for me to check before you write the rest of the card.

### Hand over source notes and reference cards directly

Canon details, your own worldbuilding notes, and cards whose pacing you love aren't things an agent should reconstruct from memory. Asking for "someone like that quiet senior from that anime" invites guesswork. Drop the notes file into the prompt and state what is locked versus what you are changing. If you attach another card as a reference, name the specific quality you want (opening rhythm, dialogue density) so the agent doesn't copy its setting too:

> I'm writing a Fern card from Frieren, and my character notes are in `notes/fern.md`. Keep her calling Stark "Mister Stark" and her habit of pouting in silence when she's mad, and set it in the days right after the First-Class Mage Exam wraps up. Also look at `sample.json` on my desktop. I like how its opening drops a small immediate problem in the player's lap right away, so borrow that pacing and ignore its setting.

### Spell out language, register, and how the character addresses the player

Your agent won't guess regional spelling, formality, or whether the player character already has a name unless you tell it. Putting those rules in the first prompt saves a round of cleanup across every file later:

> Write the whole card in natural American English, casual modern phrasing, no stiff purple prose. Have her call me "you" rather than a baked-in nickname, and leave the player's name open to the player's own persona instead of inventing one in the card.

### Import and fix an existing card

If you already have a SillyTavern card (PNG, JSON, or CHARX), an MMD three-file set, or an AI Fengyue or RiliAI export, hand the file path to your agent. It imports the card, flags any source-specific fields that need attention, and can diagnose why an older card runs out of steam after a few turns:

> Import `~/Downloads/silverwolf.png` for me. Right now conversations with her stall out after three or four turns and she just loops back to asking if I want to play arcade games. Figure out whether the definition or the greeting is boxing her in, fix it, and push a trial card so I can test it.

### What the agent runs behind the scenes

Once you give it a brief, the agent works through six steps between your machine and Hearthroom:

1. **Writes a local folder**: long prose lives in Markdown files while the Lorebook, display rules, and images sit in separate files you can open or edit yourself anytime.
2. **Pushes to a private trial card**: visible only to you, expiring 3 days after its last push, up to 5 active trial cards per account (you can evict the oldest when full).
3. **Validates and renders**: checks field character limits and syntax against platform rules, then runs your display rules over the opening to verify panels and markup.
4. **Playtests**: sends real turns to make sure the character stays in voice and gives the player something to push against.
5. **Iterates**: revises the files from those findings, pushes again, and re-tests.
6. **Saves as an owned card**: only when you ask to keep it does the card move into **My cards**; submitting for review and going public remain your call.

## Go deeper with Lorebooks, variables, sandbox screens, and art

Once the basic conversation feels right, you can ask your agent to layer in Hearthroom's native features for long-form memory, exact stat tracking, custom visual-novel layouts, or matching character art.

### Pack deep lore into a Lorebook without early spoilers

Stuffing seven suspects, a town map, and faction rules into the character definition eats context on every single turn. Ask your agent to split background knowledge into a **Lorebook**: Hearthroom matches keywords and also runs **semantic recall** by default to pull relevant entries into the turn within budget. For twists or late-game secrets that shouldn't surface just because a topic is vaguely related, tell the agent to turn semantic recall off on those entries so they fire strictly on exact keywords:

> The seven suspect profiles and the manor floor plan are getting way too long, so split them into a Lorebook. Turn off semantic recall on the butler's real cause of death and the cellar passage so the AI only sees them when the player actually mentions the pocket watch or searches the basement, with no accidental hints on turn two.

### Say whether you want quiet prose or a stat-driven screen, and name the defaults to skip

Cards generally fall into two shapes: story-first cards where clean reading comes first, and system-driven RPG, stat-raising, or survival cards where stats and choices are the game. Left unspecified, an agent will often reach for popular defaults such as an affection meter, two to four choice buttons under every reply, or moods turned into numbers. Saying "don't make it feel robotic" doesn't tell it which piece to cut; naming the exact defaults to skip does. Keep in mind too that Hearthroom natively renders trailing `[status]` and `[choices]` blocks as panels and buttons even with zero display rules, so whether you want UI panels and whether you need custom regex rules are separate choices.

For a quiet story or companion card, say it plainly:

> This is a slice-of-life companion card, and I want the focus on the conversation so it reads cleanly even as plain text. Skip affection bars, skip choice buttons at the end of replies, and don't turn her mood into a percentage. Just keep a single quiet line at the bottom of each reply with where she is and the time of night.

For a survival, management, or RPG card, every stat on screen should have a player action that can move it. When numbers like gold, rations, or inventory have to stay exact across long runs, ask the agent to use native **card variables**, which update automatically each turn and roll back cleanly whenever a player regenerates or rewinds a message:

> Set up card variables for this island survival card. Only track fresh water, rations, and stamina, and make sure every one of those three has player actions that raise or drain it, with no decorative stats the player can't affect. Put two or three action choices at the end of each turn and keep the status panel compact.

### Custom sandbox screens, opening pages, and cross-player features

When a card needs full-page styling, light and dark themes, or a pinned bar, new cards run inside Hearthroom's isolated sandbox chat page by default. Your agent builds interfaces with the skill's built-in sandbox kit (turning model status blocks into panels, choice buttons, drawers, pinned bars, and dark/light themes) and validates rules and markers locally with `hearthroom card check`. It then runs `hearthroom card preview` and `card render` against the site's real sandbox shell to capture dark- and light-mode screenshots at phone and desktop widths, checking font sizes and overflow on its own. The chat page itself is open source (`hearthroom/moonstage`, the site's `stage` submodule): the sandbox contract is generated straight from `src/sandbox/`, and the skill's reference docs point the agent to the exact source files for edge cases not covered in the guide.

Beyond themes and status panels, you can ask your agent for an **opening page** at the top of every new chat (like a title screen where players pick a background or route), multi-slot save/load menus, **shared polls and co-op counters** across everyone playing the card, or **context-carrying share links** so a friend opening your link picks up from the choice you made:

> Give this underground-idol management card a dark neon look. Put an opening page at the top of new chats where the player picks between starting as a rookie talent scout or a washed-up former producer. Also wire up a shared support counter across all players, and show me phone and desktop preview screenshots in both dark and light mode when it's ready.

### Generate banners and expression sprites from one reference portrait

If you have a single portrait you love and still need a widescreen banner or expression variants, your agent can call Hearthroom's image models and pass that portrait as a reference image so the face, hair, and outfit stay consistent across new scenes. Image generation spends purchased credits (blocked prompts and failed runs cost nothing), and your agent checks model pricing and asks before spending:

> Use the current portrait as a reference image to generate a 16:9 rainy neon street banner, plus two waist-up expression variants (one smirking, one looking away blushing) and wire them into the card's assets. Check model prices and tell me the purchased-credit cost before you run them.

## Let the agent finish the job without stopping at every step

When an agent pauses after every single file to ask "looks good?", it usually isn't stuck. Most of the time, it just doesn't know what counts as finished or how many credits it is allowed to spend testing.

### Define what "done" looks like and what it can decide on its own

Prompting "show me the setting first, then the persona, then the greeting" trains the agent to halt after every paragraph. To let it run end to end, tell it the finish line, give it a small credit ceiling for playtesting, and name the few decisions that still require your sign-off:

> Take this all the way to a pushed trial card, playtest ten turns yourself, and come back with what still feels stiff. Don't stop to ask before editing files or re-pushing the trial card, and you can spend up to 50 credits on playtest turns without asking first. Only check with me before saving an owned card, submitting for review, or making a change that turns it into a different story.

If you prefer tight back-and-forth check-ins instead, leave that last sentence out.

### Five quick checks before sending a big prompt

Before kicking off a new card or a revision pass, scan your message for five things:

- For a new card, did you include who the player is and what situation they're walking into, rather than just a genre label?
- For voice, did you give one or two actual lines of dialogue instead of abstract personality adjectives?
- Did you say whether the screen should stay clean text or carry stats and choice buttons, and name any default panels to leave out?
- Did you state what counts as done and what credit budget the agent can use for testing?
- If you're revising an existing draft, does this prompt focus on fixing one problem at a time?

## Playtest, fix pacing issues, and pick up across sessions

Two quick turns only prove the greeting renders. Real cracks usually show up around turn ten, when a character warms up way too fast, starts repeating phrases, or loses track of the premise.

### Have the agent run 10 to 20 turns across models and check its work log

Asking "did you test it?" almost always gets a "yes", even if the agent only sent two lines. Ask it to test a specific alternate opening across both a cheaper lightweight model (where weak cards break first) and a frontier model for 10 to 20 turns. Real turns spend credits, so it will quote the cost first. Afterward, alongside its summary, check `README.md` inside the card folder: that is the agent's local work log recording what changed in each revision, what approaches were ruled out, and the transcript evidence it saw (it is never uploaded to the server):

> Run 15 fresh turns on the second alternate opening, once on a budget model and once on a top-tier model. Tell me around which turn the conversation starts looping or runs out of momentum and why, log the findings in `README.md`, and tell me the estimated credit cost before you start.

### Describe what happened in play instead of prescribing which paragraph to cut

Telling the agent "shorten paragraph two of the definition" guesses at the fix from the outside; what looks like a persona bug is just as often caused by the greeting's tone, an example turn, or a reply-format rule. Report what you saw as a player, ask it to find the cause, and have it replay the same messages against the previous version so you can compare both replies side by side:

> I just played three turns and she was already confessing her feelings. I want a much slower burn where we're still wary of each other ten turns in. Track down what's making her fold so fast, fix it, and run the exact three lines I sent so I can compare the new replies against the old ones.

### Change one thing per revision

Bundling "the greeting is too long, she warms up too fast, the lore feels thin, and rename the sidekick" makes the agent touch every file at once. When something breaks, neither of you can tell which edit caused it, and good lines get collateral damage. Fix one issue per pass and have it list everything else without touching the files yet:

> For this pass, only fix how fast she warms up to the player. List any other issues you spot without editing files for them yet, and tell me which files you changed and what you changed in each one when you're done.

### Say up front when you only want advice

"Should this card be a branching mystery instead?" looks like a question, but agents often treat open-ended questions as instructions to start rewriting. Lead with "don't edit any files yet" whenever you just want trade-offs:

> Don't edit any files yet. Would this card hold up better as a slow-burn single route or split into three separate chapters? Walk me through the trade-offs of each and wait for my call.

### Resume in a new session or alongside the web editor

A fresh terminal session has no memory of yesterday's chat, so "keep working on that card" forces guesswork. Point the agent at the card folder's `README.md` first so it picks up the exact state and to-do list:

> Pick up `cards/night-diner`. Read `README.md` in that folder first, tell me where the last pass stopped and what's still open, then wait for my go-ahead.

If you tweaked prose or Lorebook entries in the web editor in the meantime, tell the agent to pull the latest remote version before making local edits; if you're actively editing persona text in the browser while asking the agent to add a few Lorebook entries, it can use single-entry Lorebook commands that stop on version conflicts instead of overwriting your browser saves.

## Keep the card, share a private link, or publish

Trial cards expire automatically 3 days after their last push. Once a card is worth keeping, sharing with friends, or publishing for creator rebates and leaderboard prizes, ask your agent to save it as an owned card or run a pre-review check.

### Save as an owned card and pick visibility

Ask your agent to save the trial card as an owned card and it moves into **My cards** with no expiration. New owned cards default to **Anyone with the link**: they stay out of the **Board**, rankings, and search and don't require review, while anyone you hand the link to can play your latest saved changes right away. If you want the card strictly for yourself, ask the agent to set visibility to **Only me**.

### Check review readiness before going public

Switching a card to **Public** lists it on the **Board** and in search, earns credit rebates when other players chat on it, and enters daily, weekly, and monthly leaderboard prize pools. To qualify, a card needs three things: at least one official preset category or play-style tag, more than **3,000 counted characters** combined across **Character definition** and enabled **Always on** Lorebook entries, and a completed content-rating questionnaire. Counted characters require at least 3,001 Unicode letters and digits (counted per character rather than per word, excluding spaces, punctuation, openings, example dialogue, standing reminders, and non-always-on Lorebook entries). Have your agent audit everything before submitting:

> Don't submit yet. Check whether this card is ready for public review right now, including the counted character total, preset tags, and any missing fields, and list anything left to fix.

After a card is public, later pushes update your draft (which you can test via the draft play link) while players stay on the approved version until you submit an update and it passes review. Updates publish silently by default; followers and bookmarkers are only notified when you ask to send an update notice with a changelog (at most once every 3 days per card).

### Credits and boundaries

- Drafting, editing files, local rule checks, offline sandbox previews, opening renders, and pushing cards spend zero platform credits.
- Only real conversation turns (`play -m` / `play --continue`) and image generation (`media generate`, paid from purchased credits only) spend credits; both require an explicit spend flag, and your agent always asks before spending.
- Your agent only edits trial cards and cards you ask it to work on. It never submits for review, sends update notifications, or makes a card public unless you ask.
