# Voided: na przekór gwiazdom

[![npm version](https://img.shields.io/npm/v/ostrze)](https://www.npmjs.com/package/ostrze)
[![npm downloads](https://img.shields.io/npm/dm/ostrze)](https://www.npmjs.com/package/ostrze)

[Wersja polska](README.md)

A terminal RPG set in a grim Slavic fantasy world. You are the only survivor of the massacre of a delegation from a blade school. The Empire believes you are dead and is looking for a witness. You look for answers in Pogórze, in Głuszec and on the Glass Hills, and in the end you face three roads: submission, resistance or flight.

**The game's text is in Polish only.** There is no translation yet, so you need to read Polish to play. Names in menus below are given in Polish, as you will see them on screen.

It runs in an ordinary terminal with no dependencies: plain text, block-drawn frames and illustrations made of half-block pixels.

## Requirements

- Node.js 22 or newer
- a terminal of at least 80×24 (in a smaller window the game falls back to a simple line mode)
- UTF-8, and preferably 256 colours (the game works without them, but with no illustrations, see [Graphics](#graphics))

## Graphics

Illustrations are drawn with coloured half blocks. The **Grafiki** item in the main menu switches between three modes, and `Enter` changes them at once:

| Mode | What you see |
|---|---|
| kolorowe (colour, the default) | illustrations, title and end screens in colour |
| czarno-białe (black and white) | the same pictures in shades of grey |
| bez grafik (no graphics) | text only, using the full panel width; title and end screens as plain lettering |

Frames and text colours do not depend on this choice. The choice is remembered for later runs and shared by all saves (`~/.ostrze/config.json`).

**When there are no illustrations, or when to turn them off:**

- The game turns illustrations off by itself when the terminal reports fewer than 256 colours or `NO_COLOR` is set. The menu then shows "Grafiki: niedostępne". This applies, for example, to the Linux text console (`TERM=linux`), `TERM=xterm`, plain `screen` and `TERM=dumb`.
- If your terminal has 256 colours and the game does not detect them (for example Alacritty or foot after `sudo` or SSH), run `TERM=xterm-256color ostrze`.
- The game cannot check whether your font has block characters. If illustrations look like empty boxes or broken stripes, change the terminal font or choose "bez grafik".
- In a window too small for the frame, below 80×24, the game switches to line mode with no frames or illustrations, and the **Grafiki** item is not in the menu.

## Installation and running

```
npx ostrze            # once, without installing
npm install -g ostrze # permanently; then run: ostrze
```

From the project directory:

```
node bin/game.js
```

Options:

| Option | Meaning |
|---|---|
| `--seed <number>` | random seed (the same choices and the same rolls give the same run) |
| `--scene <id>` | start from the given scene (for testing and debugging) |
| `--debug` | show error stack traces |
| `--validate` | check the data files and exit |
| `--art <id>` | show a picture from `data/art` and exit |
| `--help` | help |

Saves are kept in `~/.ostrze` (the `OSTRZE_HOME` variable changes the directory).

## Controls

- arrow keys or digits pick a menu item; `Enter` or `1` moves on from "Dalej" screens;
- inside the frame, the keys shown in square brackets work: `[P]` character, `[E]` inventory, `[D]` journal, `[Z]` save, `[M]` main menu;
- in combat: `[A]` attack, `[T]` techniques, `[L]` combat log; aimed blows (head, torso, legs, stun) are listed right below the attack;
- yes/no questions and the name field appear in the choice panel, not below the frame.

## What is in the game

- **Prologue and Act I:** the blade school, a courier with an imperial letter, the march, a night of wraiths, the Being.
- **Act II:** a battlefield, a crossroads, the Wilczy Bród watchtower as a hub with a local map, jobs, a wolf hunt and a merchant escort.
- **Act III:** the settlement of Głuszec and a search level for imperial scouts (`czujność → pościg → obława`, or alert, pursuit, manhunt), then the Observatory on the Glass Hills, phenomena from the stars, and allies.
- **Act IV:** the front on the Szara river and the camp on Wronia Góra, Ulfgród under martial law, a night in the emperor's palace and the dungeons beneath it.
- **Act V and the finale:** the island of Jarnowo, the hetman, Łysa Skała, the Whirl and a talk with the Being; two endings and an epilogue that remembers your decisions.
- over 70 quests, with a count of each hub's side jobs in the journal; your choices come back later in news, at the campfire and in conversations;
- turn-based combat with action points, range, aimed blows, paired weapons, throwing and weapon mastery; soldiers and dungeon masters grow stronger along with the hero;
- mysticism: phenomena in the sky, artifacts, and debt and will as two axes of choice.

## Changes in version 0.2.2

**Graphics and terminals**

- Illustrations now work in `cmd` and PowerShell on Windows. The game used to show ASCII pictures there because it did not detect the colours.
- The main menu lets you choose colour graphics, black and white, or none. ASCII pictures are gone from the game: a terminal without 256 colours shows text only.

**Shop and inventory**

- The item card tells you where an item is worn and compares it in a table with what you are wearing.
- Three light armour pieces with no action point penalty, good against thrusts and blunt blows: Kaftan włócznika, Karwasze z rogu, Nagolenice skórzane. The bracers and greaves are sold at Kuźnia Zbycha, which no longer stocks plain bracers and Buty wędrowca; other merchants still have them.

**Combat**

- The ready stance (Gotowość do ciosu) works with any melee weapon, not only spears.
- A full armour set no longer makes the hero untouchable: armour above 5 and damage reduction above 40% count at half. Light gear loses nothing.
- The combat menu shows your chance to flee, and each enemy in melee lowers it by 5 points instead of 10.
- Thrown items get +30 to accuracy. A blast pot (Garnek huku) can stun even on a miss, and the game always says when an enemy is immune to what you threw.

**Hunger**

- The hunger gauge now has effects and runs everywhere, not only while travelling. It fills in 24 hours.
- From 85% you can eat before the automatic meal, and your stomach starts to get in the way: Siła (Strength) −1.
- At 100% the hero eats a meal automatically. With no food the hero goes hungry: Siła −1, Krzepa (Constitution) −1 and worse healing from sleep.
- From 150% you are starving: Zręczność (Dexterity) −2 and Bystrość (Perception) −1 on top of that.
- You start with 3 rations instead of 2.

**Character progress**

- Four new perks for heroes who put their points into strength or dexterity: Pewny chwyt, Wół roboczy, Unik, Szybkie nogi.
- A perk point with nothing to spend it on is no longer lost; it comes back at the next level-up. This includes old saves.

**Story**

- Ostromir's escort can be resumed after a lost fight, after fleeing or after the deadline passes: the wagon waits at the gate of Wilczy Bród. You no longer have to walk to the Trakt to get the job back.

Old saves load with their progress intact. No hero gets a hunger penalty at the moment of loading.

## Data instead of code

All content lives in `data/` as JSON, text and pixels:

- `story.json` the plot; `dialogues/` conversations; `quests.json` jobs; `travel.json` locations, places, visitors and events;
- `items.json`, `enemies.json`, `skills.json`, `classes.json`, `rules.json` mechanics;
- `art/*.pix` illustrations (scenes 96×48 pixels, portraits 48×48, enemies 64×48; two pixels per terminal row), `maps/*.txt` region maps;
- `ui.json` all interface text.

After changing the data, run `node bin/game.js --validate`. It checks references between files, conditions, actions, scenes, quests and pictures.

## License

Dual license, author: Daniel Twiist Antonik (twisterson@gmail.com).

- **Code** (`bin/`, `src/`): [MIT](LICENSE).
- **Game content** (`data/`: story, dialogue, pictures, maps): [CC BY-NC-SA 4.0](LICENSE-TRESC.md). You may copy and adapt it with credit to the author, not commercially, and adaptations must use the same license.
