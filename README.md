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

**Schon da (Version 1.1)**

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
- Neu in 1.1: Bewertungen über die Cloud teilen, damit keine Stellung doppelt gerechnet wird
- Neu in 1.1.3: Papierkorb mit Rückgängig, automatische Sicherung, Tutorials, „Lücken finden“ und Hinweise beim Repertoire-Aufbau, brillante Züge in einer Variante suchen, Repertoire mit einem anderen Konto teilen
- Neu in 1.1.4: „Öffnen“ funktioniert wieder bei großen Repertoires
- Neu in 1.1.5: dünne graue Pfeile am Brett für alle Varianten ab der aktuellen Stellung
- Neu in 1.1.6: Ordner im Repertoire-Bereich auf ein Repertoire ziehen (z. B. „Ich Weiß“), um alle seine Varianten dort zu übernehmen
- Neu in 1.1.7: Repertoire-Wiederholung bewertet automatisch (unter 30 s „Leicht“, sonst „Gut“, im zweiten Versuch „Schwer“, zweimal falsch „Erneut“) und geht nach einem richtigen Zug ohne Klick weiter; nach dem ersten Fehler gibt es einen Tipp und einen zweiten Versuch
- Neu in 1.1.8: Repertoire-Wiederholung wartet nach einem richtigen Zug 2 Sekunden (einstellbar) und zeigt dieselbe Stellung nicht mehr zweimal hintereinander
- Neu in 1.1.9: „Aktualisieren“ auf der Kontokarte lädt neue Partien und Wertungen und meldet das Ergebnis; „Lücken finden“ lässt sich abbrechen, ignoriert Zug 1 und meldet nur noch Gegnerzüge ohne Antwort (im Weiß-Repertoire schwarze, im Schwarz-Repertoire weiße Züge)
- Neu in 1.1.10: „Fehler melden“ im Einstellungsmenü oben rechts (kopiert Version, System und Protokoll und öffnet ein GitHub-Issue), verständliche Meldung beim Bearbeiten einer Engine als JSON, und die freiwillige Nutzungsstatistik zählt jetzt auch, ob Cloud-Abgleich, Positionsspeicher und Engines laufen
- Neu in 1.1.11: Admin-Übersicht in den Einstellungen (nur für Admins): aktive Konten und Geräte, Cloud-Verbrauch der letzten 7 Tage gegen das kostenlose Firebase-Kontingent, Konten am Limit und Direktlinks zu Analytics, Firestore und Budget
- Neu in 1.1.12: Stockfish 19 und Patricia 5.1 sind im Installer dabei und werden beim ersten Start mit passenden Einstellungen angelegt (Stockfish bis 10 Threads und 4 GB, Patricia 2 Threads und 1 GB); eigene Engines bleiben, wie sie sind; kurze Tutorials für alle Bereiche, das Fragezeichen oben rechts startet das Tutorial zur Seite
- Neu in 1.2.0: JBL Coach: auf dem Startbildschirm steht statt „Partie importieren“ die Coach-Karte mit Figur, Level, XP und immer der nächsten Aufgabe; „Coach öffnen“ zeigt die eigene Coach-Seite mit allem, was heute ansteht (Repertoire wiederholen, gegen JBL spielen mit sieben Stärkestufen, Puzzles); „Partie importieren“ sitzt jetzt oben rechts bei den zuletzt geöffneten Dateien
- Neu in 1.2.1: Gegen JBL spielen: eigene Startseite der Partie (Farbe und Stärke wählen), JBL spielt mit Stockfish in der gewählten Stärke und kommentiert deine Züge mit !!, !, !?, ?!, ? und ?? samt Animation und Sprechblase; nach ? und ?? kannst du den Zug zurücknehmen, nach zugelassenem Matt in 1 nicht
- Neu in 1.2.2: XP und Sperre: nach jeder Partie gegen JBL gibt es einen Kassenzettel mit den XP (Partie, Sieg oder Remis je nach Stärke, !! und !, Bonus für eine saubere Partie und für die Serie), Level und Titel steigen; die Serie zählt die Tage in Folge mit dem Coach; nach einer Niederlage sind erst drei Puzzles dran, nach einem Remis eines, bevor JBL wieder spielt
- Neu in 1.2.3: Vitrine und Tagesaufgabe: jedes Level schaltet eine Verzierung für JBL frei (Sonnenbrille, Schal, Mütze, Kopfhörer, Fliege, blaue Box, Krone), dazu Rahmen, Titel zum Auswählen und Trophäen; nach einer Niederlage ist die erste Aufgabe dein schlimmster eigener Zug („Finde den besseren Zug“); jeden Tag eine Tagesaufgabe für 40 XP; ab und zu ein Bonus-Track mit doppelten XP; nach 5 Partien schätzt JBL deine Spielstärke; 2 XP für jeden richtig gewussten Repertoire-Zug
- Neu in 1.2.8: Einführung beim ersten Start in fünf kurzen Schritten (auch später über das Fragezeichen) und ein Lernpfad mit 12 Lektionen in vier Pfaden, vom ersten Matt bis zum erstickten Matt; jedes Level schaltet eine Lektion frei
- Neu in 1.2.7: Boss-Challenge (ab Level 5 fordert manchmal der Boss heraus, dreifache XP bei einem Sieg) und Duell zwischen Rivalen mit Level-Balken und Partien über die Cloud
- Neu in 1.2.6: Angriffsmodus ab Level 5 (JBL spielt mit Patricia), Easter Eggs mit Hasenohren, Bass-Drop, Karottenrahmen, Salto bei en passant und ein paar Überraschungen, die hier nicht verraten werden
- Neu in 1.2.5: JBL merkt sich deine Partien und steuert in Linien, die dir Probleme machen; Eröffnungs-Sparring gegen dein eigenes Repertoire; nach der Partie siehst du, wo du das Repertoire verlassen hast, und übernimmst die Linie mit einem Klick; Hinweise auf Repertoire-Lücken; ab Level 10 lässt sich JBLs Tagebuch lesen
- Neu in 1.2.4: Coach über die Cloud: XP, Trophäen, Verzierungen, Serie und Einstellungen des Coaches gleichen sich zwischen den Rechnern eines Kontos ab; Geburtstagsfeier mit Partyhütchen, Torte zum Auspusten, 250 XP, doppelten XP und ohne Pflichtaufgaben (Geburtstag trägt der Admin im Coach-Profil ein)

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

Stockfish 19 und Patricia 5.1 kommen mit dem Installer und stehen nach dem
ersten Start unter **Engines** bereit. Wer schon eine eigene Stockfish- oder
Patricia-Engine eingebunden hat, behält sie; die mitgelieferte wird dann nicht
zusätzlich angelegt. Beide sind unverändert: Stockfish steht unter der
[GPL-3.0](https://github.com/official-stockfish/Stockfish/blob/master/Copying.txt),
Patricia unter der [MIT-Lizenz](https://github.com/Adam-Kulju/Patricia/blob/main/LICENSE);
Lizenztexte und Quellcode-Links liegen neben den Programmen im Engines-Ordner
(`bundled/`).

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
