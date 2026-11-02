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
npx ostrze            # jednorazowo, bez instalacji
npm install -g ostrze # na stałe; potem polecenie: ostrze
```

Z paczki lokalnej (`ostrze-0.2.2.tgz`) lub z repozytorium:

```
npx --package=./ostrze-0.2.2.tgz ostrze
npm install -g ./ostrze-0.2.2.tgz
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

## Zmiany w wersji 0.2.2

**Grafiki i terminale**

- Ilustracje działają w `cmd` i PowerShellu na Windowsie. Wcześniej gra pokazywała tam obrazki ze znaków ASCII, bo nie wykrywała kolorów.
- W menu głównym można wybrać grafiki kolorowe, czarno-białe albo ich brak. Znaki ASCII zniknęły z gry: terminal bez 256 kolorów pokazuje sam tekst.

**Sklep i ekwipunek**

- Karta przedmiotu mówi, na co się go zakłada, i porównuje go w tabeli z tym, co masz założone.
- Trzy lekkie pancerze bez kary do punktów akcji, dobre przeciw pchnięciom i obuchowi: Kaftan włócznika, Karwasze z rogu, Nagolenice skórzane. Karwasze i nagolenice są już w Kuźni Zbycha, więc zniknęły z niej zwykłe karwasze i Buty wędrowca, dostępne u innych kupców.

**Walka**

- Gotowość do ciosu działa z każdą bronią do zwarcia, nie tylko z włóczniami.
- Pełny komplet pancerza nie robi już z bohatera nietykalnego: pancerz powyżej 5 i redukcje powyżej 40% liczą się w połowie. Lekki strój nic nie traci.
- Menu walki pokazuje szansę ucieczki, a każdy wróg w zwarciu obniża ją o 5 punktów zamiast 10.
- Rzucane przedmioty mają +30 do celności. Garnek huku może ogłuszyć także po chybieniu, a gra zawsze mówi, gdy wróg jest odporny na rzucony przedmiot.

**Głód**

- Licznik głodu ma teraz skutki i działa wszędzie, nie tylko w podróży. Pełen jest po 24 godzinach.
- Od 85% można się najeść, zanim zrobi to automat, a brzuch zaczyna przeszkadzać: Siła −1.
- Przy 100% bohater sam zjada posiłek. Bez jedzenia jest głodny: Siła −1, Krzepa −1 i gorsze leczenie snem.
- Od 150% konasz z głodu: dochodzą Zręczność −2 i Bystrość −1.
- Na start dostajesz 3 prowianty zamiast 2.

**Rozwój postaci**

- Cztery nowe perki dla bohaterów z punktami w sile albo zręczności: Pewny chwyt, Wół roboczy, Unik, Szybkie nogi.
- Punkt perka, którego nie ma na co wydać, nie przepada, tylko wraca przy następnym awansie. Dotyczy to także starych zapisów.

**Fabuła**

- Eskortę Ostromira można wznowić po przegranej walce, ucieczce albo po upływie terminu: wóz czeka przy bramie Wilczego Brodu. Nie trzeba już iść po to zlecenie na Trakt.

Stare zapisy wczytują się bez zmian w postępie. Żaden bohater nie dostaje kary za głód w chwili wczytania.

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
