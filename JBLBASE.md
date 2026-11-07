# JBLBase: Anleitung

Eigenes Schachprogramm von Jannick Schwab, aufgebaut auf
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
einem Klick die vier Standard-Repertoires an: „Jannick Weiß“, „Jannick
Schwarz“, „Aaron Weiß“ und „Aaron Schwarz“. Weitere Repertoires gehen über
**Neues Repertoire** (Name, für wen, Farbe). Ein Repertoire ist eine normale
PGN-Datei im Dokumente-Ordner, die Varianten bilden den Baum, ohne
Tiefenlimit.

**Eine Stellung ins Repertoire aufnehmen:**

1. In irgendeiner Partie oder Analyse zur gewünschten Stellung gehen.
2. Neben dem Brett auf das Lesezeichen-Symbol **Ins Repertoire aufnehmen**
   klicken (oder im Tab **Repertoire** auf den gleichnamigen Knopf).
3. Repertoire auswählen und **Aufnehmen**. Aufgenommen wird die Linie vom
   Start bis zum aktuellen Zug. Züge, die schon drin sind, werden
   wiederverwendet, die neue Linie zweigt dort ab, wo sie abweicht. Mit
   „Auch alle folgenden Züge und Varianten aufnehmen“ kommt alles ab der
   Stellung mit, z. B. eine ganze vorbereitete Analyse.

Der Tab **Repertoire** neben dem Brett zeigt für jede Stellung, ob sie in
deinen Repertoires steht und was du dort spielst bzw. gegen welche Züge du
vorbereitet bist. Zugumstellungen werden erkannt. Ein Klick auf einen Zug
spielt ihn auf dem Brett.

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

Neue Versionen entstehen, indem ein Tag wie `v1.0.1` gepusht wird (vorher
die Version in `package.json` und `src-tauri/Cargo.toml` erhöhen). Der Workflow
„Release“ baut dann signierte Installer für Windows und macOS und
veröffentlicht sie unter Releases. Installierte Apps finden das Update über
**Einstellungen → Nach Updates suchen** (und prüfen beim Start automatisch).

Die Update-Pakete sind mit einem eigenen Schlüssel signiert. Der private
Schlüssel liegt als Secret `TAURI_SIGNING_PRIVATE_KEY` im Repo. Geht er
verloren, können installierte Apps keine Updates mehr annehmen.
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
