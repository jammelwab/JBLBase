# Sicherheitsrichtlinie

## Unterstützte Versionen

Sicherheitskorrekturen gibt es nur für die jeweils neueste Version von
JBLBase. Die App aktualisiert sich selbst (**Einstellungen → Nach Updates
suchen**), die aktuelle Version steht unter
[Releases](https://github.com/jammelwab/jblbase/releases/latest).

| Version         | Unterstützt |
| --------------- | ----------- |
| Neueste Version | ja          |
| Alle älteren    | nein        |

## Eine Schwachstelle melden

Bitte Sicherheitslücken **nicht** als öffentliches Issue melden.

Stattdessen eine private Meldung über GitHub anlegen:
[Schwachstelle melden](https://github.com/jammelwab/jblbase/security/advisories/new)
(Reiter **Security → Report a vulnerability**).

Hilfreich sind:

- betroffene Version und Betriebssystem (Windows oder macOS)
- eine Beschreibung des Problems und der möglichen Auswirkungen
- Schritte zum Nachstellen, wenn möglich mit Beispieldatei (z. B. PGN)

JBLBase ist ein Hobbyprojekt mit einem einzelnen Maintainer. Eine erste
Rückmeldung kommt in der Regel innerhalb einer Woche. Bestätigte Lücken werden
mit dem nächsten Release behoben, die Meldung wird danach veröffentlicht und
auf Wunsch mit Namensnennung versehen.

## Was dazugehört

- die Desktop-App (Rust- und TypeScript-Code in diesem Repository)
- der Update-Mechanismus und die Release-Installer
- Anmeldung, Konten und Synchronisation über Firebase, einschließlich der
  Regeln im Ordner [`firebase`](./firebase)
- der Import von PGN-Dateien und von Partien aus Chess.com und Lichess

## Was nicht dazugehört

- Lücken in Engines wie Stockfish oder Patricia. Sie werden nicht mitgeliefert
  und sollten beim jeweiligen Projekt gemeldet werden.
- Lücken, die auch im Ursprungsprojekt
  [En Croissant](https://github.com/franciscoBSalgueiro/en-croissant)
  bestehen. Diese bitte zusätzlich dort melden.
- Die Systemwarnungen beim ersten Start. Die Installer sind nicht von
  Microsoft bzw. Apple beglaubigt, das ist bekannt und im README beschrieben.
