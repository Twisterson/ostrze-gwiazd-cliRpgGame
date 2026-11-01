# Voided: na przekór gwiazdom

Terminalowe RPG po polsku, w mrocznym, słowiańskim fantasy. Jesteś jedynym, który przeżył rzeź delegacji ze szkoły ostrza. Cesarstwo uważa cię za martwego i szuka świadka. Ty szukasz odpowiedzi w Pogórzu, w Głuszcu i na Szklanych Wzgórzach, a na końcu stajesz przed trzema drogami: uległością, oporem albo ucieczką.

Gra działa w zwykłym terminalu, bez żadnych zależności. Zwykły tekst, ramki z bloków, ilustracje z półblokowych pikseli.

## Wymagania

- Node.js 22 lub nowszy
- terminal co najmniej 80×24 (przy mniejszym oknie gra przechodzi w prosty tryb liniowy)
- UTF-8 i najlepiej 256 kolorów

## Instalacja i uruchomienie

Po opublikowaniu w npm:

```
npx ostrze            # jednorazowo, bez instalacji
npm install -g ostrze # na stałe; potem polecenie: ostrze
```

Z paczki lokalnej (`ostrze-0.2.1.tgz`) lub z repozytorium:

```
npx --package=./ostrze-0.2.1.tgz ostrze
npm install -g ./ostrze-0.2.1.tgz
node bin/game.js     # bezpośrednio z katalogu projektu
```

Opcje:

| Opcja | Znaczenie |
|---|---|
| `--seed <liczba>` | ziarno losowości (te same wybory i te same rzuty dają ten sam przebieg) |
| `--scene <id>` | zacznij od wskazanej sceny (do testów i szukania błędów) |
| `--debug` | pokazuj stos błędów |
| `--validate` | sprawdź poprawność plików danych i wyjdź |
| `--art <id>` | pokaż grafikę z `data/art` i wyjdź |
| `--help` | pomoc |

Zapisy gry leżą w `~/.ostrze` (zmienna `OSTRZE_HOME` zmienia katalog).

## Sterowanie

- strzałki lub cyfry wybierają pozycję w menu, `Enter` albo `1` na ekranach „Dalej” idzie dalej;
- w ramce działają skróty z nawiasów kwadratowych, np. `[P]` Postać, `[E]` Ekwipunek, `[D]` Dziennik, `[Z]` Zapisz grę, `[M]` Menu główne;
- w walce `[A]` atak, `[T]` techniki, `[L]` dziennik walki; ciosy celowane (głowa, tułów, nogi, ogłuszenie) leżą tuż pod atakiem;
- pytania tak/nie i pole imienia pojawiają się w panelu wyboru, nie pod ramką.

## Co jest w grze

- **Prolog i akt I:** szkoła ostrza, kurier z cesarskim listem, marsz, noc upiorów, Istota.
- **Akt II:** pobojowisko, rozdroże, strażnica Wilczy Bród jako hub z mapą okolicy, zlecenia, wyprawa po wilki i eskorta kupca.
- **Akt III:** osada Głuszec i poziom poszukiwań cesarskich zwiadowców (`czujność → pościg → obława`), potem Obserwatorium na Szklanych Wzgórzach, zjawiska z gwiazd i sojusznicy.
- **Akt IV:** front nad Szarą i obóz na Wroniej Górze, Ulfgród w stanie wojennym, noc w pałacu cesarza i lochy pod nim.
- **Akt V i finał:** wyspa Jarnowo, hetman, Łysa Skała, Wir i rozmowa z Istotą; dwa zakończenia i epilog, który pamięta Twoje decyzje.
- ponad 70 zadań, z licznikiem zleceń pobocznych każdego huba w dzienniku; wybory wracają później w wieściach, przy ognisku i w rozmowach;
- walka turowa z punktami akcji, zasięgiem, ciosami celowanymi, parą broni, rzutami i biegłością w broniach; wojsko i panowie lochu rosną w siłę razem z bohaterem;
- mistyka: zjawiska nieba, artefakty, dług i wola jako dwie osie wyborów.

## Dane zamiast kodu

Cała treść leży w `data/` jako JSON, tekst i piksele:

- `story.json` fabuła; `dialogues/` rozmowy; `quests.json` zlecenia; `travel.json` lokacje, miejsca, goście i zdarzenia;
- `items.json`, `enemies.json`, `skills.json`, `classes.json`, `rules.json` mechanika;
- `art/*.pix` ilustracje (sceny 96×48 pikseli, portrety 48×48, wrogowie 64×48; dwa piksele na wiersz terminala), `maps/*.txt` mapy regionów;
- `ui.json` wszystkie napisy interfejsu.

Po zmianie danych uruchom `node bin/game.js --validate`. Walidacja sprawdza odwołania między plikami, warunki, akcje, sceny, zlecenia i grafiki.

## Licencja

Podwójna licencja, autor: Daniel Twiist Antonik (twisterson@gmail.com).

- **Kod** (`bin/`, `src/`): [MIT](LICENSE).
- **Treść gry** (`data/`: fabuła, dialogi, grafiki, mapy): [CC BY-NC-SA 4.0](LICENSE-TRESC.md). Wolno kopiować i przerabiać z podaniem autora, bez użycia komercyjnego, przeróbki na tej samej licencji.
