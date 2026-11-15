<div align="center">
  <img width="128" height="128" src="src-tauri/icons/128x128@2x.png" alt="JBLBase Logo">
  <h1>JBLBase</h1>
  <p>Mein eigenes Schachprogramm für Eröffnungsvorbereitung und Analyse<br>
  Windows · macOS (Apple Silicon) · ein Fork von <a href="https://github.com/franciscoBSalgueiro/en-croissant">En Croissant</a></p>
</div>

## Worum geht es?

Mit JBLBase baue ich mein eigenes Repertoire für Weiß und Schwarz auf (und ein
kleines für einen Freund). Analysiert wird lokal mit zwei Engines
gleichzeitig: **Stockfish 19** für die objektiv beste Fortsetzung und
**Patricia**, die bewusst aggressiv spielt und gern Gambits wählt.

Jede Stellung, die eine Engine einmal bewertet hat, landet im
**Positionsspeicher**. Beim nächsten Mal ist das Ergebnis sofort da und muss
nicht neu gerechnet werden.

## Funktionen

**Schon da (Version 1.0)**

- Brett, Notation, Varianten, PGN-Import und -Export
- Partien von Chess.com und Lichess herunterladen, Konten und Datenbanken pro Spieler zusammenfassen
- Bis zu zwei Engines nebeneinander (Stockfish und Patricia), jede mit eigener Bewertung
- Positionsspeicher (lokale SQLite-Datenbank) mit eigener Einstellungsseite
- Repertoires für Weiß, Schwarz und für Freunde, mit Ordnern, Haupt-Repertoire, Kurs- und Ordner-Import und Import-Historie
- Repertoire, eigene Partien und ganze Datenbanken als gezeichneter Eröffnungsbaum
- Vergleich: Was spiele ich wirklich, was steht in meinem Repertoire?
- Training des Repertoires (Linien und Wiederholungsplan)
- Partiebericht mit Zugbewertungen wie bei Chess.com, Suche nach brillanten Zügen
- Insight über alle eigenen Partien, Taktiksuche, Lichess-Puzzles und Puzzle-Streak
- Konto mit Cloud-Sync von Repertoires und Trainingsfortschritt (E-Mail oder Lichess)
- Updates direkt in der App

**Als Nächstes**

- Repertoire an Freunde freigeben, die mit eigenem Fortschritt trainieren
- Bewertungen über die Cloud teilen, damit keine Stellung doppelt gerechnet wird
- Stockfish und Patricia direkt mitliefern

## Installieren

Die neueste Version für Windows (`.exe`) und macOS (`.dmg`, Apple Silicon)
gibt es unter [Releases](https://github.com/jammelwab/JBLBase/releases/latest).
Die Installer sind nicht von Microsoft bzw. Apple beglaubigt, deshalb warnt
das System beim ersten Start:

- **Windows:** „Weitere Informationen“ → „Trotzdem ausführen“.
- **macOS:** App in **Programme** ziehen und einmal starten. Dann
  **Systemeinstellungen → Datenschutz & Sicherheit** → ganz unten
  **Trotzdem öffnen**. Oder im Terminal:
  ```bash
  xattr -dr com.apple.quarantine /Applications/JBLBase.app
  ```

Neue Versionen holt sich die App selbst: **Einstellungen → Nach Updates
suchen** oder im Hilfe-Menü.

Engines werden nicht mitgeliefert. [Stockfish](https://stockfishchess.org/download/)
und [Patricia](https://github.com/Adam-Kulju/Patricia/releases) herunterladen
und unter **Engines → Engine hinzufügen → Lokal** einbinden.

Details zu Positionsspeicher, Engine-Einstellungen, Patricia für macOS und zum
Selbstbauen stehen in [JBLBASE.md](JBLBASE.md).

## Dank

> „Wenn ich weiter gesehen habe, dann deshalb, weil ich auf den Schultern von
> Riesen stehe.“ – Isaac Newton

JBLBase gäbe es ohne diese Open-Source-Projekte nicht. Danke an alle, die
daran arbeiten.

- [En Croissant](https://github.com/franciscoBSalgueiro/en-croissant) – die Grundlage des ganzen Programms
- [Stockfish](https://github.com/official-stockfish/Stockfish) – Hauptengine
- [Patricia](https://github.com/Adam-Kulju/Patricia) – aggressive Zweit-Engine
- [chessground](https://github.com/lichess-org/chessground) – das Schachbrett
- [chessops](https://github.com/niklasf/chessops), [shakmaty](https://github.com/niklasf/shakmaty), [pgn-reader](https://github.com/niklasf/rust-pgn-reader) – Schachregeln und PGN
- [vampirc-uci](https://github.com/franciscoBSalgueiro/vampirc-uci) – Kommunikation mit den Engines
- [polyglot-book-rs](https://crates.io/crates/polyglot-book-rs) – Eröffnungsbücher
- [rusqlite](https://github.com/rusqlite/rusqlite) und [SQLite](https://sqlite.org) – Positionsspeicher
- [DuckDB](https://github.com/duckdb/duckdb), [duckdb-rs](https://github.com/duckdb/duckdb-rs) und [aix](https://github.com/franciscoBSalgueiro/aix) – Partiedatenbank
- [Tauri](https://github.com/tauri-apps/tauri), [React](https://github.com/facebook/react), [Mantine](https://github.com/mantinedev/mantine), [Tabler Icons](https://github.com/tabler/tabler-icons), [Recharts](https://github.com/recharts/recharts) – App und Oberfläche
- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) – Wiederholungsplan fürs Training
- [Candle](https://github.com/huggingface/candle) – Stellungserkennung aus Bildern
- [Lichess API](https://lichess.org/api) und [Chess.com API](https://www.chess.com/news/view/published-data-api) – Partien, Eröffnungsdatenbank, Tablebases

Alle weiteren Bibliotheken stehen in [package.json](package.json) und
[src-tauri/Cargo.toml](src-tauri/Cargo.toml).

## Lizenz

[GPL-3.0](LICENSE), wie En Croissant.
