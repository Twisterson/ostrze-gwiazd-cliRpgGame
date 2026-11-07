# Voided: Defying the Stars

[![npm version](https://img.shields.io/npm/v/ostrze)](https://www.npmjs.com/package/ostrze)
[![npm downloads](https://img.shields.io/npm/dm/ostrze)](https://www.npmjs.com/package/ostrze)

[Wersja polska](README.md)

*Polish title: Voided: na przekór gwiazdom.*

A terminal RPG set in a grim Slavic fantasy world. You are the only survivor of the massacre of a delegation from a blade school. The Empire believes you are dead and is looking for a witness. You look for answers in the Foothills, in Głuszec and on the Glass Hills, and in the end someone from the stars comes to collect a debt.

The game is playable in English and in Polish; see [Language](#language). Names below are the English ones, as you see them on screen.

It runs in an ordinary terminal with no dependencies: plain text, block-drawn frames and illustrations made of half-block pixels.

## Requirements

- Node.js 22 or newer
- a terminal of at least 80×24 (in a smaller window the game falls back to a simple line mode)
- UTF-8, and preferably 256 colours (the game works without them, but with no illustrations, see [Graphics](#graphics))

## Graphics

Illustrations are drawn with coloured half blocks. The **Graphics** item in the main menu switches between three modes, and `Enter` changes them at once:

| Mode | What you see |
|---|---|
| colour (the default) | illustrations, title and end screens in colour |
| black and white | the same pictures in shades of grey |
| no graphics | text only, using the full panel width; title and end screens as plain lettering |

Frames and text colours do not depend on this choice. The choice is remembered for later runs and shared by all saves (`~/.ostrze/config.json`).

**When there are no illustrations, or when to turn them off:**

- The game turns illustrations off by itself when the terminal reports fewer than 256 colours or `NO_COLOR` is set. The menu then shows "Graphics: unavailable". This applies, for example, to the Linux text console (`TERM=linux`), `TERM=xterm`, plain `screen` and `TERM=dumb`.
- If your terminal has 256 colours and the game does not detect them (for example Alacritty or foot after `sudo` or SSH), run `TERM=xterm-256color ostrze`.
- The game cannot check whether your font has block characters. If illustrations look like empty boxes or broken stripes, change the terminal font or choose "no graphics".
- In a window too small for the frame, below 80×24, the game switches to line mode with no frames or illustrations, and the **Graphics** item is not in the menu.

## Installation and running

```
npx ostrze@latest            # once, without installing
npm install -g ostrze@latest # permanently or to update; then run: ostrze
```

A plain `npm install ostrze`, without `-g`, installs the game only in the current directory. If you have an older version installed globally, the `ostrze` command keeps running it. `npm ls -g ostrze` shows the installed version.

From the project directory:

```
node bin/game.js
```

Options:

| Option | Meaning |
|---|---|
| `--seed <number>` | random seed (the same choices and the same rolls give the same run) |
| `--scene <id>` | start from the given scene (for testing and debugging) |
| `--lang <pl|en>` | game language for this one run only; the setting is not saved |
| `--debug` | show error stack traces |
| `--validate` | check the data files and exit (add `--lang en` to check the English texts, and `--strict` to make missing translations errors) |
| `--art <id>` | show a picture from `data/art` and exit |
| `--help` | help |

Saves are kept in `~/.ostrze` (the `OSTRZE_HOME` variable changes the directory).

## Language

The game has an English and a Polish version.

- On the first run in a terminal the game asks which language you want (both options are shown in both languages) and remembers the answer in `~/.ostrze/config.json`, as `"language": "en"` or `"language": "pl"`. You can edit that file by hand.
- Later you change the language with the **Language** item in the main menu; the change is saved.
- `--lang en` or `--lang pl` overrides the saved language for that one run. The game asks nothing then, and switching the language in the menu is not saved either.
- With no saved language and no `--lang` (for example when the input is not a terminal) the game starts in Polish.
- `--validate` checks the Polish data by default; `node bin/game.js --validate --lang en --strict` checks the English texts. They live in `data/lang/en/`.
- Character names and invented place names stay Polish in the English version (Zbych, Bratosław, Głuszec, Ulfgród, Jarnowo).

## Controls

- arrow keys or digits pick a menu item; `Enter` or `1` moves on from "Continue" screens;
- inside the frame, the keys shown in square brackets work: `[C]` character, `[I]` inventory, `[J]` journal, `[S]` save, `[M]` main menu (the Polish version uses `[P]`, `[E]`, `[D]`, `[Z]`, `[M]`);
- in combat: `[A]` attack, `[T]` techniques, `[L]` combat log; aimed blows (head, torso, legs, stun) are listed right below the attack;
- yes/no questions and the name field appear in the choice panel, not below the frame.

## What is in the game

- **Prologue and Act I:** the blade school, a courier with an imperial letter, the march, a night of wraiths, the Being.
- **Act II:** a battlefield, a crossroads, the Wolf's Ford Watchtower as a hub with a local map, jobs, a wolf hunt and a merchant escort.
- **Act III:** the settlement of Głuszec and a search level for imperial scouts (alert, pursuit, manhunt), then Starwatch on Glass Hill, phenomena from the stars, and allies.
- **Act IV:** the front on the Grey and the camp on Crow Mountain, Ulfgród under martial law, a night in the emperor's palace and the dungeons beneath it.
- **Act V and the finale:** the island of Jarnowo, the hetman, Bald Rock, the Whirl and a talk with the Being; two endings and an epilogue that remembers your decisions.
- over 70 quests, with a count of each hub's side jobs in the journal; your choices come back later in news, at the campfire and in conversations;
- turn-based combat with action points, range, aimed blows, paired weapons, throwing and weapon mastery; soldiers and dungeon masters grow stronger along with the hero;
- mysticism: phenomena in the sky, artifacts, and debt and will as two axes of choice.

## Current changes (0.3.0)

**English version**

- The whole game can now be played in English: story, dialogue, quests, items, interface and maps. Character names and invented place names stay Polish.
- On the first run the game asks which language you want. You can change it later in the main menu, or for a single run with `--lang` (see [Language](#language)).
- Old saves load in either language with no change to your progress.

## Data instead of code

All content lives in `data/` as JSON, text and pixels:

- `story.json` the plot; `dialogues/` conversations; `quests.json` jobs; `travel.json` locations, places, visitors and events;
- `items.json`, `enemies.json`, `skills.json`, `classes.json`, `rules.json` mechanics;
- `art/*.pix` illustrations (scenes 96×48 pixels, portraits 48×48, enemies 64×48; two pixels per terminal row), `maps/*.txt` region maps;
- `ui.json` all interface text;
- `lang/en/` the English version: an overlay of translated texts keyed to the Polish originals.

After changing the data, run `node bin/game.js --validate`. It checks references between files, conditions, actions, scenes, quests and pictures.

## How this game was made

I made this game together with Claude Code. I came up with the world, the plot and who cheats whom. Claude wrote the code, the tests and the first drafts of the text, then listened patiently while I explained why they were rubbish.

The division of labour was simple: the machine writes three pages of dialogue in a minute, and I spend fifteen minutes cutting everything except two lines and a joke about a mule. The mule always stayed.

The bill:

- over 110 hours of work in under three weeks, a few days of it on the English translation;
- 4 hours of building the world before the AI saw a single file, the calmest stage, since nothing could break yet;
- over 570 commits and over 2,000 tests, which still didn't catch everything;
- dozens of playthroughs just to check that sleeping at the inn didn't wipe your quests (it did);
- over 60,000 words in Polish and nearly 90,000 in English. The English came out longer because there even the mule needs an article.

The most common sentence in this project: "done, it works" (the AI). The second most common: "it doesn't" (me).

Will AI make a game for you? It will. The trouble starts when you want to play it.

## License

Dual license, author: Daniel Twiist Antonik (twisterson@gmail.com).

- **Code** (`bin/`, `src/`): [MIT](LICENSE).
- **Game content** (`data/`: story, dialogue, pictures, maps): [CC BY-NC-SA 4.0](LICENSE-TRESC.md). You may copy and adapt it with credit to the author, not commercially, and adaptations must use the same license.
