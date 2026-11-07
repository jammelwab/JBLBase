<div align="center">
  <img width="115" height="115" src="src-tauri/icons/128x128@2x.png" alt="JBLBase Logo">

<h1 align="center">JBLBase</h1>

  <p align="center">
    Mein eigenes Schachprogramm für Eröffnungsvorbereitung und Analyse
    <br />
    Windows · macOS (Apple Silicon) · aufgebaut auf En Croissant
  </p>
</div>

## Worum geht es?

JBLBase ist ein Schachprogramm, das ich für meine eigene Eröffnungsarbeit
baue. Ich möchte damit ein eigenes Repertoire für Weiß und Schwarz aufbauen,
ein kleines Repertoire für meinen Freund Aaron zusammenstellen und meine
Partien mit zwei sehr unterschiedlichen Engines analysieren: dem
weltstärksten Stockfish und Patricia, einer Engine, die bewusst aggressiv
spielt und gern Material für Angriff opfert.

Alles läuft lokal auf dem eigenen Rechner. Jede Stellung, die eine Engine
einmal bewertet hat, wird gespeichert, damit sie beim nächsten Mal sofort da
ist und nicht neu gerechnet werden muss.

Das Programm ist ein Fork von
[En Croissant](https://github.com/franciscoBSalgueiro/en-croissant), einer
Open-Source-Schachoberfläche (Tauri, Rust und React). Brett, Notation,
Datenbank und Engine-Anbindung kommen von dort, JBLBase ergänzt das, was ich
für meine Vorbereitung brauche.

## Was schon funktioniert

| Funktion                                                                   | Stand                            |
| -------------------------------------------------------------------------- | -------------------------------- |
| Brett, Notation, Varianten, Kommentare                                     | aus En Croissant übernommen      |
| PGN-Import und -Export                                                     | aus En Croissant übernommen      |
| Partien von **Chess.com** und **Lichess** herunterladen                    | übernommen, in JBLBase repariert |
| 0 bis 2 Engines gleichzeitig, jede mit eigener Box (Linien und Bewertung)  | aus En Croissant übernommen      |
| **Positionsspeicher**: lokale SQLite-Datenbank aller bewerteten Stellungen | **neu**                          |
| Einstellungsseite „Positionsspeicher“ (Statistik, Speicher leeren)         | **neu**                          |
| Fertige Installer für Windows und macOS über GitHub Actions                | **neu**                          |
| macOS-Build der Patricia-Engine                                            | **neu**                          |

### Der Positionsspeicher

Das Herzstück von JBLBase. Jede Bewertung einer lokalen Engine landet in
einer SQLite-Datei im App-Datenordner. Gespeichert wird nach Stellung (nicht
nach Zugfolge), getrennt nach Engine und Anzahl der Linien. Ein flacheres
Ergebnis überschreibt nie ein tieferes.

Beim nächsten Besuch einer Stellung wird das gespeicherte Ergebnis sofort
angezeigt. Ist es schon tief genug, startet die Engine gar nicht erst. Bei der
Partieanalyse werden bekannte Stellungen übersprungen.

Die genaue Funktionsweise steht in [JBLBASE.md](JBLBASE.md#positionsspeicher).

## Was noch kommt

- **Repertoire-Bäume:** mein eigenes Repertoire für Weiß und für Schwarz,
  dazu ein kleineres Repertoire für Aaron.
- **Opening Tree aus meinen Partien:** Welche Eröffnungen spiele ich wirklich,
  wie oft und mit welchem Ergebnis?
- **Vergleich:** Mein gespielter Baum neben meinem Repertoire. Wo weiche ich
  ab, wo fehlt mir eine Vorbereitung, wo spielt der Gegner etwas, das ich
  noch nicht abgedeckt habe?
- **Lichess-Eröffnungsdatenbank** online direkt im Baum.
- **Training** des Repertoires.

## Installieren

Bei jedem Push auf `main` baut GitHub Actions einen Windows-Installer
(`.exe`) und eine macOS-Version (`.dmg`, Apple Silicon). Zu finden unter
**Actions → Build installers → letzter Lauf → Artifacts**.

Die Installer sind nicht von Microsoft bzw. Apple beglaubigt. Deshalb warnt
das Betriebssystem beim ersten Start.

### Windows

Beim ersten Start erscheint eine SmartScreen-Warnung. Auf
**„Weitere Informationen“** und dann auf **„Trotzdem ausführen“** klicken.

### macOS: „Trotzdem öffnen“

Die App ist nur ad-hoc signiert und nicht von Apple notarisiert (dafür wäre
ein kostenpflichtiges Apple-Developer-Konto nötig). macOS meldet deshalb beim
ersten Start, dass „JBLBase“ nicht geöffnet werden kann.

1. JBLBase aus der `.dmg` in den Ordner **Programme** ziehen.
2. Die App einmal starten und die Meldung mit **Fertig** schließen.
3. **Systemeinstellungen → Datenschutz & Sicherheit** öffnen, ganz nach unten
   scrollen und bei „JBLBase wurde blockiert“ auf **Trotzdem öffnen** klicken.
4. Mit dem Passwort bzw. Touch ID bestätigen.

Alternativ im Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/JBLBase.app
```

Danach startet die App normal. Nach dem Download einer neuen Version muss der
Schritt einmal wiederholt werden. Der frühere Weg „Rechtsklick → Öffnen“
funktioniert seit macOS 15 nicht mehr.

## Engines einrichten

Engines sind eigenständige Programme und werden nicht mitgeliefert. In
JBLBase werden sie über **Engines → Engine hinzufügen → Lokal** eingebunden.

- **Stockfish 19:** Download unter <https://stockfishchess.org/download/>.
  Unter Windows mit Ryzen die Version „AVX2“ nehmen.
- **Patricia:** Windows-Version unter
  <https://github.com/Adam-Kulju/Patricia/releases>. Für den Mac gibt es keinen
  offiziellen Download, deshalb baut der Workflow **Build Patricia (macOS)**
  den unveränderten Quellcode. Die geladene Datei einmal freigeben:

  ```bash
  xattr -dr com.apple.quarantine ~/Downloads/patricia-5.1-macos-arm64
  chmod +x ~/Downloads/patricia-5.1-macos-arm64
  ```

Empfohlene Einstellungen (Threads, Hash, MultiPV) stehen in
[JBLBASE.md](JBLBASE.md#engines-einrichten).

## Selbst bauen

Voraussetzungen: Node 22, pnpm, Rust (stable). Unter Windows zusätzlich die
„Desktop development with C++“-Werkzeuge von Visual Studio und WebView2.

```bash
pnpm install
pnpm prepare:aix-extension   # lädt die DuckDB-Erweiterung für die Partiedatenbank
pnpm tauri build             # Installer landet in src-tauri/target/release/bundle
```

Zum Entwickeln: `pnpm dev`. Tests und weitere Details stehen in
[JBLBASE.md](JBLBASE.md#bauen).

## Lizenz

JBLBase steht wie En Croissant unter der
[GPL-3.0](LICENSE). Wer das Programm weitergibt, muss den Quellcode
mitliefern bzw. zugänglich machen.

## Genutzte Projekte

JBLBase steht auf den Schultern dieser Open-Source-Projekte. Vielen Dank an
alle, die daran arbeiten.

### Grundlage und Engines

| Projekt                                                             | Wofür                                             | Lizenz  |
| ------------------------------------------------------------------- | ------------------------------------------------- | ------- |
| [En Croissant](https://github.com/franciscoBSalgueiro/en-croissant) | Grundlage des ganzen Programms (Fork)             | GPL-3.0 |
| [Stockfish](https://github.com/official-stockfish/Stockfish)        | Hauptengine, wird separat installiert             | GPL-3.0 |
| [Patricia](https://github.com/Adam-Kulju/Patricia)                  | Aggressive Zweit-Engine, macOS-Build per Workflow | MIT     |

### Schachlogik und Brett

| Projekt                                                           | Wofür                                                      | Lizenz        |
| ----------------------------------------------------------------- | ---------------------------------------------------------- | ------------- |
| [chessground](https://github.com/lichess-org/chessground)         | Das Schachbrett in der Oberfläche                          | GPL-3.0       |
| [chessops](https://github.com/niklasf/chessops)                   | Schachregeln und PGN im Frontend                           | GPL-3.0       |
| [shakmaty](https://github.com/niklasf/shakmaty)                   | Schachregeln im Rust-Backend                               | GPL-3.0       |
| [pgn-reader](https://github.com/niklasf/rust-pgn-reader)          | Schnelles Einlesen von PGN-Dateien                         | GPL-3.0       |
| [vampirc-uci](https://github.com/franciscoBSalgueiro/vampirc-uci) | Kommunikation mit den Engines (UCI), Fork von En Croissant | Apache-2.0    |
| [polyglot-book-rs](https://crates.io/crates/polyglot-book-rs)     | Eröffnungsbücher im Polyglot-Format                        | siehe Projekt |

### Datenbanken

| Projekt                                                                                       | Wofür                                                     | Lizenz              |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------- |
| [rusqlite](https://github.com/rusqlite/rusqlite) / [SQLite](https://sqlite.org)               | Positionsspeicher                                         | MIT / Public Domain |
| [duckdb-rs](https://github.com/duckdb/duckdb-rs) / [DuckDB](https://github.com/duckdb/duckdb) | Partiedatenbank                                           | MIT                 |
| [aix](https://github.com/franciscoBSalgueiro/aix)                                             | Komprimierte Speicherung von Partien (DuckDB-Erweiterung) | siehe Projekt       |

### App und Oberfläche

| Projekt                                                      | Wofür                                   | Lizenz           |
| ------------------------------------------------------------ | --------------------------------------- | ---------------- |
| [Tauri](https://github.com/tauri-apps/tauri)                 | Desktop-App aus Rust und Web-Oberfläche | MIT / Apache-2.0 |
| [React](https://github.com/facebook/react)                   | Oberfläche                              | MIT              |
| [Mantine](https://github.com/mantinedev/mantine)             | Bedienelemente und Layout               | MIT              |
| [Tabler Icons](https://github.com/tabler/tabler-icons)       | Symbole                                 | MIT              |
| [Recharts](https://github.com/recharts/recharts)             | Bewertungsdiagramme                     | MIT              |
| [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | Wiederholungsplan für späteres Training | MIT              |
| [Candle](https://github.com/huggingface/candle)              | Stellungserkennung aus Bildern          | MIT / Apache-2.0 |

Die vollständige Liste aller Bibliotheken steht in
[package.json](package.json) und [src-tauri/Cargo.toml](src-tauri/Cargo.toml).

### Online-Dienste

| Dienst                                                                             | Wofür                                                           |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [Lichess API](https://lichess.org/api)                                             | Partien herunterladen, Eröffnungsdatenbank, Endspiel-Tablebases |
| [Chess.com Published-Data API](https://www.chess.com/news/view/published-data-api) | Partien herunterladen                                           |
