# Voided: na przekór gwiazdom

[![npm version](https://img.shields.io/npm/v/ostrze)](https://www.npmjs.com/package/ostrze)
[![npm downloads](https://img.shields.io/npm/dm/ostrze)](https://www.npmjs.com/package/ostrze)

[English version](README.en.md)

Terminalowe RPG po polsku, w mrocznym, słowiańskim fantasy. Jesteś jedynym, który przeżył rzeź delegacji ze szkoły ostrza. Cesarstwo uważa cię za martwego i szuka świadka. Ty szukasz odpowiedzi w Pogórzu, w Głuszcu i na Szklanych Wzgórzach, a na końcu stajesz przed trzema drogami: uległością, oporem albo ucieczką.

Gra działa w zwykłym terminalu, bez żadnych zależności. Zwykły tekst, ramki z bloków, ilustracje z półblokowych pikseli.

## Wymagania

- Node.js 22 lub nowszy
- terminal co najmniej 80×24 (przy mniejszym oknie gra przechodzi w prosty tryb liniowy)
- UTF-8 i najlepiej 256 kolorów (bez nich gra działa, ale bez ilustracji, patrz [Grafiki](#grafiki))

## Grafiki

Ilustracje są rysowane z kolorowych półbloków. W menu głównym pozycja **Grafiki** przełącza trzy warianty, a `Enter` zmienia je od razu:

| Wariant | Co widać |
|---|---|
| kolorowe (domyślnie) | ilustracje, ekran startowy i końcowy w kolorze |
| czarno-białe | te same obrazy w odcieniach szarości |
| bez grafik | sam tekst na całą szerokość panelu, ekran startowy i końcowy jako napis |

Ramki i kolory tekstu nie zależą od tego wyboru. Wybór zostaje na następne uruchomienia i jest wspólny dla wszystkich zapisów (`~/.ostrze/config.json`).

**Kiedy ilustracji nie ma albo warto je wyłączyć:**

- Gra sama wyłącza ilustracje, gdy terminal zgłasza mniej niż 256 kolorów albo ustawiono `NO_COLOR`. W menu widać wtedy „Grafiki: niedostępne”. Dotyczy to np. konsoli tekstowej Linuksa (`TERM=linux`), `TERM=xterm`, zwykłego `screen` i `TERM=dumb`.
- Jeśli wiesz, że Twój terminal ma 256 kolorów, a gra ich nie wykrywa (np. Alacritty albo foot po `sudo` lub SSH), uruchom ją z `TERM=xterm-256color ostrze`.
- Gra nie sprawdzi, czy czcionka ma znaki blokowe. Gdy ilustracje wyglądają jak puste prostokąty albo rozjeżdżone paski, zmień czcionkę terminala albo wybierz „bez grafik”.
- Przy oknie za małym na ramkę, poniżej 80×24, gra przechodzi w tryb liniowy bez ramek i ilustracji, a pozycji **Grafiki** nie ma w menu.

## Instalacja i uruchomienie

Z npm:

```
npx ostrze@latest            # jednorazowo, bez instalacji
npm install -g ostrze@latest # na stałe albo aktualizacja; potem polecenie: ostrze
```

Samo `npm install ostrze`, bez `-g`, instaluje grę tylko w bieżącym katalogu. Jeśli masz starszą wersję zainstalowaną globalnie, polecenie `ostrze` dalej ją uruchamia. Zainstalowaną wersję pokaże `npm ls -g ostrze`.

Z paczki lokalnej (`ostrze-0.2.3.tgz`) lub z repozytorium:

```
npx --package=./ostrze-0.2.3.tgz ostrze
npm install -g ./ostrze-0.2.3.tgz
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

## Bieżące zmiany (0.2.3)

**Broń dystansowa**

- Kusza albo pistolet mogą czekać na plecach, w slocie broni zapasowej. Zmiana na broń dystansową i z powrotem kosztuje 1 PA, a nie 2.
- Strzał z kuszy i pistoletu kosztuje 3 PA, z rusznicy 4 PA. Ładowanie w walce kosztuje 6 PA.
- Broń ładuje się sama, za darmo, po walce i przy zakładaniu, jeśli masz amunicję.
- Każda broń strzela inaczej. Lekka kusza jest najlepsza z bliska. Kusze żołnierska i cesarska biją celnie z daleka, ale w zwarciu tracą 20 punktów celności. Pistolety trafiają tak samo z daleka i z bliska.
- Trafienie z kuszy albo broni palnej w połowie przypadków spowalnia wroga: −2 PA i brak ruchu przez 2 tury.
- Nowa technika „Odskok ze strzałem” (5 PA, rusznica i kusze z korbą 6 PA). Bohater odskakuje od wroga w zwarciu, przyjmuje jego darmowy cios, strzela z broni zapasowej i wraca do broni głównej.
- Strzał z broni palnej zawsze daje dym, chyba że był niewypał. Wróg, który wchodzi w zwarcie przez dym, ma −15 do trafienia w tej turze. Dym i świeca dymna dają przy ucieczce +20 zamiast +40.

**Ulepszanie u kowali**

- Kowale ulepszają broń i pancerz na tułów w dwóch stopniach. Oddajesz przedmiot i pieniądze, dostajesz ulepszoną wersję o tej samej wadze.
- Miecze i włócznie: lepszy uchwyt (+5 do umiejętności), potem ostrzenie (+1 przebicia pancerza). Kusze: lepsze łoże, potem mocniejsze ramię. Broń palna: muszka, potem lekki spust (mniej niewypałów). Pancerz: warstwa skóry (+5% redukcji), potem lżejsze płyty bez kary do PA.
- Pierwszy stopień kosztuje około połowy wartości przedmiotu, drugi około całej.
- Ulepszają: Zbych i Bogdan (pierwszy stopień broni białej i pancerza), kowal polowy i Brygida (oba stopnie, także kusze; u kowala polowego także muszka), Szkarad (broń palna, oba stopnie). Warsztat Zbycha otwiera się po pierwszej rozmowie z nim, a Szkarada trzeba najpierw znaleźć.

**Bełty**

- Bełt wzmocniony zadaje +1 do obrażeń. Bełt wybuchowy też ma +1, a przy trafieniu rani odłamkami innych wrogów w tej samej strefie. Odłamki liczą pancerz i mogą spowolnić. Przy pudle bełt wybucha w połowie przypadków. Gdy strzelasz do wroga w zwarciu, odłamki ranią też ciebie.
- Kowal polowy i Brygida wymieniają bełty paczkami po 10: zwykłe na wzmocnione za 20 gr, wzmocnione na wybuchowe za 100 gr.
- W ekwipunku, przy kuszy, jest przełącznik ładowania bełtów wybuchowych. Bez niego kusza nie bierze drogich bełtów do każdej drobnej walki.

Stare zapisy wczytują się bez zmian w postępie.

## Dane zamiast kodu

Cała treść leży w `data/` jako JSON, tekst i piksele:

- `story.json` fabuła; `dialogues/` rozmowy; `quests.json` zlecenia; `travel.json` lokacje, miejsca, goście i zdarzenia;
- `items.json`, `enemies.json`, `skills.json`, `classes.json`, `rules.json` mechanika;
- `art/*.pix` ilustracje (sceny 96×48 pikseli, portrety 48×48, wrogowie 64×48; dwa piksele na wiersz terminala), `maps/*.txt` mapy regionów;
- `ui.json` wszystkie napisy interfejsu.

Po zmianie danych uruchom `node bin/game.js --validate`. Walidacja sprawdza odwołania między plikami, warunki, akcje, sceny, zlecenia i grafiki.

## Licencja

Podwójna licencja, autor: Daniel Twiist Antonik (twisterson@gmail.com).

- **Kod** (`bin/`, `src/`, `test/`): [MIT](LICENSE).
- **Treść gry** (`data/`: fabuła, dialogi, grafiki, mapy): [CC BY-NC-SA 4.0](LICENSE-TRESC.md). Wolno kopiować i przerabiać z podaniem autora, bez użycia komercyjnego, przeróbki na tej samej licencji.
