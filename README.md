<div align="center">
  <img width="120" height="120" src="assets/icon.png" alt="JBLBase">
  <h1>JBLBase</h1>
  <p>Schachprogramm für Eröffnungsvorbereitung und Analyse<br/>Windows · macOS (Apple Silicon)</p>
</div>

JBLBase hilft beim Aufbau eigener Eröffnungsrepertoires und analysiert
Partien mit zwei Engines gleichzeitig: Stockfish und der aggressiven Patricia.
Alles läuft lokal. Jede einmal bewertete Stellung wird gespeichert und beim
nächsten Mal sofort angezeigt.

JBLBase ist ein Fork von
[En Croissant](https://github.com/franciscoBSalgueiro/en-croissant).

## Funktionen

- Brett, Notation, Varianten, PGN-Import und -Export
- Partien von **Chess.com** und **Lichess** laden
- Bis zu zwei Engines parallel, jede mit eigenen Linien und Bewertung
- **Positionsspeicher:** alle Engine-Bewertungen in einer lokalen
  SQLite-Datenbank, wiederverwendet bei jeder Analyse
- Eingebaute Updates (Einstellungen → „Nach Updates suchen“)

In Arbeit: eigene Repertoire-Bäume, Eröffnungsbaum aus den eigenen Partien
und der Vergleich der beiden.

## Installieren

Die neueste Version gibt es unter
[**Releases**](https://github.com/jammelwab/JBLBase/releases/latest):
`.exe` für Windows, `.dmg` für den Mac. Danach aktualisiert sich JBLBase
selbst.

Die Installer sind nicht von Microsoft bzw. Apple beglaubigt:

- **Windows:** Bei der SmartScreen-Warnung auf „Weitere Informationen“ und
  dann „Trotzdem ausführen“ klicken.
- **macOS:** Nach der Warnung unter **Systemeinstellungen → Datenschutz &
  Sicherheit** auf **„Trotzdem öffnen“** klicken. Das ist nur einmal nötig.

Engines werden separat installiert, siehe
[Anleitung](JBLBASE.md#engines-einrichten).

## Selbst bauen

```bash
pnpm install
pnpm tauri build
```

Voraussetzungen und Tests stehen in der [Anleitung](JBLBASE.md#bauen).

## Danke

JBLBase baut auf der Arbeit vieler Open-Source-Projekte auf. Herzlichen Dank!

- [En Croissant](https://github.com/franciscoBSalgueiro/en-croissant) von
  Francisco Salgueiro, die Grundlage des ganzen Programms
- [Stockfish](https://github.com/official-stockfish/Stockfish) und
  [Patricia](https://github.com/Adam-Kulju/Patricia) von Adam Kulju, die Engines
- [chessground](https://github.com/lichess-org/chessground),
  [chessops](https://github.com/niklasf/chessops) und
  [shakmaty](https://github.com/niklasf/shakmaty) von Lichess bzw. Niklas Fiekas:
  Brett und Schachregeln
- [Tauri](https://github.com/tauri-apps/tauri),
  [React](https://github.com/facebook/react),
  [Mantine](https://github.com/mantinedev/mantine),
  [DuckDB](https://github.com/duckdb/duckdb),
  [SQLite](https://sqlite.org) / [rusqlite](https://github.com/rusqlite/rusqlite)
- [Lichess API](https://lichess.org/api) und
  [Chess.com Published-Data API](https://www.chess.com/news/view/published-data-api)
- Springer im Logo: Figurensatz „cburnett“ von Colin M. L. Burnett (GPLv2+)

Alle weiteren Bibliotheken stehen in [package.json](package.json) und
[src-tauri/Cargo.toml](src-tauri/Cargo.toml).

## Lizenz

[GPL-3.0](LICENSE), wie En Croissant.
