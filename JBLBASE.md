# JBLBase: Anleitung

Eigenes Schachprogramm, aufgebaut auf
[En Croissant](https://github.com/franciscoBSalgueiro/en-croissant) (GPL-3.0).
Dieses Projekt steht deshalb ebenfalls unter GPL-3.0.

## Positionsspeicher

Jede Stellung, die eine lokale Engine bewertet, landet in
`eval_cache.sqlite3` im App-Datenordner:

- Windows: `%APPDATA%\de.jammelwab.jblbase\eval_cache.sqlite3`
- macOS: `~/Library/Application Support/de.jammelwab.jblbase/eval_cache.sqlite3`

Gespeichert werden je Stellung, Engine und Linienanzahl (MultiPV): Tiefe,
Knoten, Bewertung (Centipawn, Matt, WDL) und die kompletten Hauptvarianten.

So wird der Speicher genutzt:

1. **Schlüssel ist die Stellung, nicht der Zugweg.** Die FEN ohne Zugzähler,
   ein En-passant-Feld zählt nur, wenn der Schlag wirklich möglich ist.
   `1.Sf3 d5 2.d4` und `1.d4 d5 2.Sf3` teilen sich also einen Eintrag.
2. **Getrennt pro Engine.** Stockfish und Patricia haben eigene Einträge
   (erkannt am `id name` der Engine), damit sich ihre Bewertungen nicht mischen.
3. **Getrennt pro Linienanzahl.** Eine Suche mit 3 Linien kann eine Anfrage mit
   1, 2 oder 3 Linien bedienen, aber nicht eine mit 5.
4. **Nur tiefer überschreibt.** Ein flacheres Ergebnis ersetzt nie ein tieferes.

Beim Analysieren:

- **Live-Analyse:** Gibt es einen Eintrag, wird er sofort angezeigt. Ist bei
  „Tiefe N“ der Eintrag schon mindestens N tief, startet die Engine gar nicht.
  Sonst rechnet die Engine weiter, und ihre Ausgabe ersetzt die gespeicherte
  Anzeige erst, wenn sie mindestens genauso tief ist. Unendliche Analyse läuft
  also ab der gespeicherten Tiefe sichtbar weiter.
- **Partieanalyse:** Stellungen, die schon tief genug im Speicher sind, werden
  übersprungen. Bei Zeit- oder Knotenlimit wird das tiefere von Speicher und
  neuer Rechnung genommen.

Eine Grenze: Die Engine selbst fängt intern bei einer neuen Suche von vorne an
(ihr Hash lebt nur im Arbeitsspeicher). Der Gewinn ist, dass du gespeicherte
Ergebnisse sofort siehst und tief genug bewertete Stellungen gar nicht mehr
gerechnet werden müssen.

Unter **Einstellungen → Positionsspeicher** siehst du Anzahl Stellungen,
Dateigröße und maximale Tiefe pro Engine und kannst den Speicher leeren.

Für spätere Phasen (Repertoire, Vergleich der Eröffnungsbäume) gibt es schon
den Befehl `getCachedEvals(fen)`, der alle gespeicherten Bewertungen einer
Stellung liefert.

## Repertoires

In der Seitenleiste gibt es **Repertoires** (Bücher-Symbol). Dort legst du mit
einem Klick deine zwei Standard-Repertoires für Weiß und Schwarz an. Sie
stehen unter dem Namen, den du in den Einstellungen unter **Repertoire → Dein
Name** einträgst (nur lokal gespeichert, ohne Eintrag „Ich“). Weitere
Repertoires, etwa für einen Freund, gehen über **Neues Repertoire** (Name, für
wen, Farbe). Ein Repertoire ist eine normale
PGN-Datei im Dokumente-Ordner, die Varianten bilden den Baum, ohne
Tiefenlimit.

**Eine Stellung ins Repertoire aufnehmen:**

1. In irgendeiner Partie oder Analyse zur gewünschten Stellung gehen.
2. In der Leiste links neben dem Brett, direkt unter „Brett drehen“:
   - **Zu Repertoire hinzufügen** (Lesezeichen): nimmt die Linie vom Start
     bis zum aktuellen Zug auf.
   - **Zu Repertoire mit Nebenvarianten hinzufügen** (Baum-Symbol): nimmt
     zusätzlich alle Varianten mit, die von dieser Linie abzweigen oder ihr
     folgen, z. B. eine ganze vorbereitete Analyse.
3. Repertoire auswählen und **Aufnehmen**. Züge, die schon drin sind, werden
   wiederverwendet, eine neue Linie zweigt dort ab, wo sie abweicht.

Der Tab **Repertoire** neben dem Brett zeigt für jede Stellung, ob sie in
deinen Repertoires steht und was du dort spielst bzw. gegen welche Züge du
vorbereitet bist. Zugumstellungen werden erkannt. Ein Klick auf einen Zug
spielt ihn auf dem Brett.

### Baumdiagramm

Auf der Repertoire-Seite öffnet **Baum** das Repertoire als gezeichnetes
Baumdiagramm, das sich von links („Start“) nach rechts verzweigt. Weiße Züge
sind helle Kästchen, schwarze Züge dunkle, deine eigenen Züge haben einen
blauen Rahmen. Ein Klick auf einen Zug zeigt die Stellung unten rechts auf
einem kleinen Brett, darunter die Zugfolge (weiße Züge hell, schwarze dunkel)
und den Knopf **Auf dem Brett öffnen**. Mit gedrückter Maus verschiebst du
den Baum, das Mausrad zoomt, die Knöpfe oben rechts zoomen oder zeigen alles.
Der Kreis mit + oder − rechts an einem Zug klappt die Folgezüge auf und zu
(die Zahl daneben sagt, wie viele Züge darunter liegen). Ein Klick auf einen
Mit der Maus über einem Zug siehst du die Prozente. Jeder Zug hat zwei kleine Leisten:

- **Blau, Lichess-Datenbank:** wie oft der Zug aus dieser Stellung auf
  Lichess gespielt wird (mit den Filtern aus Datenbank → Lichess). Dafür
  musst du unter **Benutzer** bei Lichess angemeldet sein.
- **Grün, deine Partien:** wie oft der Zug in deinen eigenen Partien vorkam,
  in denen du die Farbe des Repertoires hattest. Grundlage sind die unter
  **Benutzer** heruntergeladenen Chess.com- und Lichess-Partien. Unter einem
  Gegnerzug ergeben deine Varianten plus „sonstige Züge“ zusammen 100 %. Bei
  Repertoires für andere Personen fehlt diese Leiste, weil es nicht deren Partien sind.

Ist der meistgespielte Lichess-Zug (nur Platz 1) eines Gegners nicht in
deinem Repertoire, steht er gestrichelt und abgeblasst unter deinen Varianten. Das heißt
nicht, dass er gut oder schlecht ist, nur dass er oft kommt.

**Zugumstellungen:** Entsteht dieselbe Stellung über verschiedene
Zugfolgen, zeigt ein gestrichelter violetter Pfeil von der einen Zugfolge zur
anderen, und der Zug trägt oben rechts ein violettes ⇄. Ein Klick auf ⇄
klappt den Baum bei der anderen Zugfolge auf und springt hin, ein weiterer
Klick geht zur nächsten.

### Deine bisher gespielten Eröffnungen

- **Als Statistik:** Benutzer → deine Spielerkarte → Tab **Eröffnungen** →
  „Als Weiß“ oder „Als Schwarz“ → **In der Analyse öffnen**. Rechts im Tab
  **Datenbank** siehst du für jede Stellung, welche Züge du wie oft gespielt
  hast und wie sie ausgingen.
- **Mit dem Repertoire vergleichen:** im selben Tab **Mit meinem
  Eröffnungsbuch vergleichen**, oder auf der Repertoire-Seite bei deinen
  Repertoires **Mit meinen Partien vergleichen**. Es zählen nur Züge, die du
  mindestens 2-mal gespielt hast (oben einstellbar). Oben stehen drei Listen:
  wo du überrascht wirst (Gegnerzug ohne Antwort im Repertoire), wo du
  abweichst (du spielst nicht deinen vorbereiteten Zug) und wo dein
  Repertoire endet, obwohl deine Partien weitergehen. Darunter liegen deine
  Partien als gezeichneter Baum, mit Anzahl und Ergebnis an jedem Zug; der
  Rahmen ist grün (im Repertoire), orange (Überraschung), rot (Abweichung) oder
  blau (Repertoire endet). Wie im Repertoire-Baum zeigen die Leisten, wie oft
  der Zug auf Lichess (blau) und in deinen Partien (grün) gespielt wird. Ein
  oranges „L“ heißt: Dein Zug ist nicht der meistgespielte auf Lichess, der
  Tooltip nennt den Hauptzug. Ein Klick zeigt die Stellung auf dem kleinen Brett. Ein
  Klick auf eine Variante öffnet sie in einer neuen Analyse, von dort fügst
  du sie mit dem Knopf unter „Brett drehen“ zum Repertoire hinzu.
  Zugumstellungen werden erkannt: führt eine andere Zugfolge in eine
  Stellung deines Repertoires, gilt sie als Repertoire.

### Training „Linien“

Öffne ein Repertoire, Tab **Training → Linien**. Das Training läuft Linie für
Linie, ähnlich wie bei Chessable:

- Die Gegnerzüge spielt das Programm, deine Züge findest du selbst. Pro Zug
  hast du **30 Sekunden** (Balken).
- Stehen in deinem Repertoire noch **andere Gegnerzüge**, zeigen blaue Pfeile
  sie kurz bevor der Gegner zieht, und sie stehen als Liste daneben.
- **Falsch oder Zeit abgelaufen:** Ein grüner Pfeil zeigt den richtigen Zug,
  du spielst ihn nach, und die Linie geht weiter. Die Stellung kommt am Ende
  der Runde nochmal (ab einem Zug davor) und später wieder, nach dem
  Wiederholungsplan (gleiche Karten wie im Tab „Training“).
- **Nächste Linie:** Sie startet nicht wieder bei Zug 1, sondern einen Zug vor
  der Stelle, an der sie von der vorigen abweicht. So siehst du genau, was
  anders ist.
- **Fällig** übt nur Linien mit neuen oder fälligen Stellungen,
  **Alle Linien** das ganze Repertoire.

## Zugbewertungen

Nach **Analyse → Bericht erstellen** bekommt jeder Zug eine Bewertung wie bei
Chess.com: Brillant, Großartiger Zug, Bester Zug, Exzellent, Gut, Buchzug,
Ungenauigkeit, Fehler, Patzer. Grundlage ist der Verlust an Gewinnchance
gegenüber dem besten Engine-Zug (Ungenauigkeit ab 5 %, Fehler ab 10 %,
Patzer ab 20 %). „Bester Zug“ heißt, die Engine hätte genau diesen Zug
gespielt, „Buchzug“, dass die Stellung eine bekannte Eröffnung ist.
Die Bewertung erscheint als Plakette auf dem Zielfeld, im Bericht als Tabelle
pro Farbe (ein Klick springt zum nächsten solchen Zug) und mit dem Hinweis,
welcher Zug besser gewesen wäre. Die Bewertungen werden nicht in die PGN
geschrieben, die klassischen Zeichen (!!, ?, ?? …) schon.

## Engines einrichten

Engines sind eigenständige Programme und werden nicht mitgeliefert.

### Stockfish

1. Download: <https://stockfishchess.org/download/>
   - Windows mit Ryzen 3600: Version **„AVX2“** nehmen
     (der Ryzen 3600 kann BMI2, auf Zen 2 ist AVX2 aber meist schneller).
2. Entpacken, z. B. nach `C:\Engines\Stockfish\`.
3. In JBLBase: **Engines → Hinzufügen → Lokal** und die `.exe` auswählen.
4. Empfohlene Optionen (in der Engine-Box über das Zahnrad):
   - `Threads`: **10** (lässt 2 Threads für Oberfläche und zweite Engine frei)
   - `Hash`: **4096** MB (bei 32 GB RAM unbedenklich)
   - `MultiPV`: nach Geschmack 1–3

### Patricia (aggressive Engine)

Patricia ist eine Open-Source-Engine (MIT-Lizenz) von Adam Kulju, gebaut auf
möglichst aggressives, opferfreudiges Spiel.

1. Download: <https://github.com/Adam-Kulju/Patricia/releases>, die neueste
   Windows-`.exe`.
2. Wie oben als lokale Engine hinzufügen.
3. Optionen: `Threads` 2, `Hash` 1024 MB.

**macOS (Apple Silicon):** Patricia bietet selbst keinen Mac-Download an.
Unser Workflow „Build Patricia (macOS)“ kompiliert den unveränderten
Quellcode. Unter **Actions → Build Patricia (macOS) → letzter Lauf →
Artifacts** die ZIP-Datei laden, entpacken und einmal im Terminal ausführen:

```bash
xattr -dr com.apple.quarantine ~/Downloads/patricia-5.1-macos-arm64
chmod +x ~/Downloads/patricia-5.1-macos-arm64
```

Danach am besten in einen festen Ordner verschieben (z. B. `~/Engines/`) und
in JBLBase über **Engines → Engine hinzufügen → Lokal** auswählen.

Beide gleichzeitig: In der Analyse beide Engines aktivieren. Jede bekommt
ihre eigene Box mit Linien und Bewertung. Der Ryzen 3600 hat 12 Threads,
deshalb zusammen nicht mehr als etwa 12 Threads vergeben.

Die GTX 1080 hilft hier nicht: Stockfish und Patricia rechnen auf der CPU.

## Bauen

Voraussetzungen: Node 22, pnpm, Rust (stable), unter Windows zusätzlich die
„Desktop development with C++“-Werkzeuge von Visual Studio und WebView2
(bei Windows 10/11 meist schon da).

```bash
pnpm install
pnpm prepare:aix-extension   # lädt eine Hilfsbibliothek für die Partiedatenbank
pnpm tauri build             # Installer landet in src-tauri/target/release/bundle
```

Zum Entwickeln: `pnpm dev`.

Tests des Positionsspeichers:

```bash
cd src-tauri
cargo test eval_cache
# mit echter Engine:
JBLBASE_TEST_ENGINE=/pfad/zu/stockfish cargo test -- --ignored engine_cache
```

## Releases und Updates

Neue Versionen entstehen so: Version in `package.json` und
`src-tauri/Cargo.toml` erhöhen, dann auf GitHub unter **Releases → Draft a new
release** ein Release mit neuem Tag (z. B. `v1.0.1`) veröffentlichen. Alternativ
unter **Actions → Release → Run workflow** den Tag eingeben, dann legt der
Workflow das Release selbst an (als Entwurf, veröffentlicht erst, wenn beide Builds fertig sind; so bleibt der Update-Check währenddessen intakt). Der Workflow „Release“ baut dann signierte Installer für Windows und macOS und
veröffentlicht sie unter Releases. Installierte Apps finden das Update über
**Einstellungen → Nach Updates suchen** (und prüfen beim Start automatisch).

Die Update-Pakete sind mit einem eigenen Schlüssel signiert. Der private
Schlüssel liegt als Secret `TAURI_SIGNING_PRIVATE_KEY` im Repo, sein Passwort
als `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Geht eins davon verloren, können installierte Apps keine Updates mehr annehmen.
Die Installer sind nicht von Apple bzw. Microsoft beglaubigt.

**Windows:** Beim ersten Start erscheint eine SmartScreen-Warnung. Klicke auf
„Weitere Informationen“ und dann auf „Trotzdem ausführen“.

**macOS:** Die App ist nur ad-hoc signiert, nicht von Apple notarisiert. Das
würde ein kostenpflichtiges Apple-Developer-Konto (99 $/Jahr) voraussetzen.
Beim ersten Start meldet macOS deshalb „JBLBase“ kann nicht geöffnet werden.
Klicke auf **Fertig** und gehe dann so vor:

1. JBLBase aus der `.dmg` in den Ordner **Programme** ziehen.
2. Einmal starten und die Meldung mit **Fertig** schließen.
3. **Systemeinstellungen → Datenschutz & Sicherheit** öffnen, ganz nach unten
   scrollen und bei „JBLBase wurde blockiert“ auf **Trotzdem öffnen** klicken.
   Danach mit dem Passwort bestätigen.

Alternativ geht es im Terminal mit einem Befehl:

```bash
xattr -dr com.apple.quarantine /Applications/JBLBase.app
```

Danach startet die App normal, auch bei allen weiteren Starts. Nach jedem
neuen Download einer neuen Version ist der Schritt einmal zu wiederholen.
(Der früher übliche Weg „Rechtsklick → Öffnen“ funktioniert seit macOS 15
nicht mehr.)
