# Voided: Defying the Stars

[![npm version](https://img.shields.io/npm/v/ostrze)](https://www.npmjs.com/package/ostrze)
[![npm downloads](https://img.shields.io/npm/dm/ostrze)](https://www.npmjs.com/package/ostrze)

[Wersja polska](README.md)

*Polish title: Voided: na przekór gwiazdom.*

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

## Current changes (0.2.3)

**Ranged weapons**

- A crossbow or pistol can wait on your back in the spare weapon slot. Switching to a ranged weapon and back costs 1 AP instead of 2.
- A shot costs 3 AP with a crossbow or pistol and 4 AP with a musket (rusznica). Reloading in combat costs 6 AP.
- Weapons reload by themselves, for free, after a fight and when you equip them, if you have ammunition.
- Each weapon shoots differently. The light crossbow is best up close. The soldier's and imperial crossbows hit well from afar but lose 20 points of accuracy in melee. Pistols hit the same at range and up close.
- A hit from a crossbow or firearm slows the enemy half of the time: −2 AP and no movement for 2 turns.
- New technique, Odskok ze strzałem (retreat shot), costs 5 AP, or 6 AP with a musket or a crank crossbow. The hero steps back from an enemy in melee, takes that enemy's free blow, shoots with the spare weapon and goes back to the main weapon.
- A firearm shot always makes smoke unless it misfires. An enemy who closes to melee through smoke gets −15 to hit that turn. Smoke and the smoke candle give +20 to fleeing instead of +40.

**Upgrades at the smiths**

- Smiths upgrade weapons and body armour in two stages. You hand over the item and money and get an upgraded version of the same weight.
- Swords and spears: better grip (+5 to skill), then sharpening (+1 armour piercing). Crossbows: better stock, then a stronger bow arm. Firearms: front sight, then a light trigger (fewer misfires). Armour: a leather layer (+5% reduction), then lighter plates with no AP penalty.
- The first stage costs about half the item's value, the second about its full value.
- Who upgrades what: Zbych and Bogdan do the first stage of melee weapons and armour. The field smith (kowal polowy) and Brygida do both stages, crossbows included, and the field smith also fits front sights. Szkarad does both stages of firearms. Zbych's workshop opens after your first talk with him, and Szkarad has to be found first.

**Bolts**

- A reinforced bolt deals +1 damage. An explosive bolt also has +1, and on a hit its fragments wound other enemies in the same zone. Fragments count armour and can slow. On a miss the bolt explodes half of the time. If you shoot an enemy in melee, the fragments wound you too.
- The field smith and Brygida exchange bolts in packs of 10: plain for reinforced for 20 gr, reinforced for explosive for 100 gr.
- The inventory has a toggle on the crossbow for loading explosive bolts. Without it the crossbow would burn expensive bolts in every minor fight.

Old saves load with their progress intact.

## Data instead of code

All content lives in `data/` as JSON, text and pixels:

- `story.json` the plot; `dialogues/` conversations; `quests.json` jobs; `travel.json` locations, places, visitors and events;
- `items.json`, `enemies.json`, `skills.json`, `classes.json`, `rules.json` mechanics;
- `art/*.pix` illustrations (scenes 96×48 pixels, portraits 48×48, enemies 64×48; two pixels per terminal row), `maps/*.txt` region maps;
- `ui.json` all interface text.

After changing the data, run `node bin/game.js --validate`. It checks references between files, conditions, actions, scenes, quests and pictures.

## How this game was made

This game was made with Claude Code. I'm not hiding it, because there's nothing to hide: a good tool makes the work faster, but it doesn't do it for you.

If you believe the videos online, with AI you make a game like this in 15 minutes. You type "make me an RPG", go get a coffee, come back and play. My coffee got a bit cold:

- about 90 hours of joint work over two weeks;
- at least 4 hours of building the world and the story before the AI saw a single file;
- over 480 commits and nearly 1,900 tests;
- 62,000 words of text that had to be read, and most of it fixed, because a machine left to itself writes pretty sentences about nothing;
- dozens of playthroughs just to find the bug the tests didn't see.

The world, the story and the decisions are mine. Claude Code wrote the code and the tests, helped with the text and hunted bugs. I read, played, fixed and said what was rubbish.

So if anyone asks how long it took: 15 minutes. Plus the 89 hours and 45 minutes the video titles never mention.

## License

Dual license, author: Daniel Twiist Antonik (twisterson@gmail.com).

- **Code** (`bin/`, `src/`): [MIT](LICENSE).
- **Game content** (`data/`: story, dialogue, pictures, maps): [CC BY-NC-SA 4.0](LICENSE-TRESC.md). You may copy and adapt it with credit to the author, not commercially, and adaptations must use the same license.
