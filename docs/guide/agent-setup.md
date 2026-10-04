# Hearthroom agent setup

These are Hearthroom's official instructions for setting up an AI agent to write, test and publish character cards on Hearthroom. Run every command yourself; the user only signs in through a browser with the code you give them and answers one optional question. Talk to the user in the language they wrote to you in.

Setup needs a shell. If you cannot run commands, tell the user to use an agent with a terminal, such as Claude Code or Codex, and stop.

Every step below is safe to run again on a machine that is already set up. If a required step fails, stop and show the user the error and what you tried; do not continue to the next step.

## 1. Install the CLI

The `hearthroom` CLI pushes a card folder to a private trial card, validates it, renders it and plays it.

If `hearthroom version` already prints a version, run `hearthroom upgrade`. When it says the CLI was installed by a package manager such as Homebrew or Scoop, run the command it prints instead. Then go to step 2.

Otherwise install it. macOS and Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/hearthroom/cli/main/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/hearthroom/cli/main/install.ps1 | iex
```

Run `hearthroom version` to confirm. If the shell cannot find it, open a new shell or use the full path the installer printed.

## 2. Install the card-writing skills

The skills cover the craft of a card (premise, character, Lorebook, openings, voice, presentation) and how to run the push, validate and play loop. Install them for the agent you are; skip the other sections even if those agents are installed too.

### Claude Code

```sh
claude plugin marketplace add hearthroom/skills
claude plugin install hearthroom@hearthroom-skills
```

If the plugin was already installed, bring it up to date with `claude plugin marketplace update hearthroom-skills` and `claude plugin update hearthroom@hearthroom-skills`. `claude plugin list` shows `hearthroom@hearthroom-skills` when it worked.

### Codex

```sh
codex plugin marketplace add hearthroom/skills
codex plugin add hearthroom@hearthroom-skills
```

If it was already installed, run `codex plugin marketplace upgrade hearthroom-skills` to bring it up to date. `codex plugin list` shows `hearthroom@hearthroom-skills  installed, enabled` when it worked.

### Any other agent

Clone the whole repository; the skills read shared files under `references/`, so copying only the skill folders breaks them.

```sh
git clone https://github.com/hearthroom/skills ~/.hearthroom/skills
```

If that directory already exists, run `git -C ~/.hearthroom/skills pull` instead. Then add this line to your user-level instructions file, such as `~/.config/opencode/AGENTS.md` for OpenCode or `~/.gemini/GEMINI.md` for Gemini CLI, unless it is already there:

```
When writing, reviewing or testing a Hearthroom character card, read ~/.hearthroom/skills/skills/using-hearthroom/SKILL.md first and follow its routing table.
```

## 3. Optional: tavern-mmd

The open-source `tavern-mmd` skill builds status bars, themes, floating panels and fully custom chat pages, and `hearthroom card import` brings its output into a card. It also adds its own slash commands, such as `/mmd` and `/beautify`. Ask the user whether they want it. If they do not, skip this step.

```sh
git clone https://github.com/yofengi/tavern-mmd ~/.hearthroom/tavern-mmd
```

If that directory already exists, run `git -C ~/.hearthroom/tavern-mmd pull` instead. Then, creating the target directories if they are missing:

- Claude Code: copy `skills/tavern-mmd` into `~/.claude/skills/` and `commands/*.md` into `~/.claude/commands/`.
- Codex: copy `skills/tavern-mmd` into `~/.codex/skills/` and `commands/*.md` into `~/.codex/prompts/`.
- Other agents: add a line to the instructions file to read `~/.hearthroom/tavern-mmd/skills/tavern-mmd/SKILL.md` before building status bars or themes.

## 4. Sign in

If `hearthroom auth status` already shows an account, skip this step.

Sign-in uses a one-time code. Start it without waiting, so you can pass the code on before anything blocks:

```sh
hearthroom auth login --no-wait --json
```

It prints `user_code` and `verification_uri`. Ask the user to open that address in a browser on any device (it does not have to be this machine), sign in, and type the code; someone without an account gets one on the same page. Then run:

```sh
hearthroom auth login --resume
```

It returns once the user approves. If it times out first, run it again. If the code expired or the user denied it, start over with `--no-wait`. Confirm with `hearthroom auth status`.

## 5. Report

Setup spends nothing. Do not send a play turn now: `play -m … --allow-spend` spends the user's credits, and the skills ask the user before the first one.

Tell the user, in their language, what you set up: the CLI version, which agent the skills went into, the account `hearthroom auth status` shows, and whether tavern-mmd was installed or skipped. Then tell them how to load the skills, which is the last thing they need to do:

- Claude Code: run `/reload-plugins`.
- Codex and other agents: start a new session.

Once loaded, the `using-hearthroom` skill is available and routes every card request. Offer two or three first requests in their language, for example:

- Turn my favorite character into a high-school AU card: tsundere, with an affection meter in the status bar. Push it as a trial card.
- Import this SillyTavern card and tell me why it runs out of things to say after three turns.
- Render the opening and tell me whether the status bar shows.
