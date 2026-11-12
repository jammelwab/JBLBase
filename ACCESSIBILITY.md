# Barrierefreiheit

JBLBase soll für möglichst viele Menschen nutzbar sein. Die App ist ein
Hobbyprojekt mit einem einzelnen Maintainer und wurde bisher **nicht** formal
gegen einen Standard wie WCAG 2.2 geprüft. Dieses Dokument beschreibt ehrlich,
was heute geht, wo es hakt und wie sich Barrieren melden lassen.

## Unterstützte Umgebungen

- Windows 10 und 11 (WebView2)
- macOS auf Apple Silicon (WKWebView)

Die Oberfläche ist eine Web-Oberfläche in einer Tauri-App, gebaut mit React
und Mantine. Hilfstechnologien greifen deshalb so darauf zu wie auf eine
Webseite.

## Was die App heute bietet

- **Helles und dunkles Design**, wahlweise automatisch nach Systemeinstellung
- **Einstellbare Schriftgröße** für die gesamte Oberfläche
- **Frei belegbare Tastenkürzel** für Navigation in der Partie, Brett drehen,
  Engine starten und weitere Aktionen
- **Figurensätze und Brettdesigns zur Auswahl**
- **Koordinaten am Brett** einblendbar (am Rand oder auf jedem Feld)
- **Figurenanimation abschaltbar** oder in der Geschwindigkeit wählbar
- **Zugtöne** mit einstellbarer Lautstärke als akustische Rückmeldung
- **Oberfläche in mehreren Sprachen**, darunter Deutsch und Englisch
- **Züge per Tastatur eingeben:** Unter **Einstellungen → Eingabe** lässt sich
  ein Textfeld einschalten, in das Züge getippt werden (z. B. `Sf3`/`Nf3`)
- Züge stehen zusätzlich zum Brett immer als **Text in der Notation**

Alle Punkte finden sich unter **Einstellungen**.

## Bekannte Einschränkungen

- **Screenreader:** Das Schachbrett selbst ist für Screenreader nicht
  beschrieben. Stellungen und Züge lassen sich nur über die Notation erfassen,
  nicht über das Brett. Brett-Editor und Pfeile brauchen Maus oder Touch.
- **Farben:** Zugbewertungen, Pfeile und die Bewertungsleiste arbeiten
  teilweise nur mit Farbe (z. B. Rot und Grün).
- **Diagramme:** Repertoire-Bäume und Statistik-Grafiken haben keine
  Textalternative.
- **Beschriftungen:** Nicht alle Symbol-Schaltflächen haben einen für
  Screenreader lesbaren Namen.
- **Tastaturfokus:** Die Reihenfolge und Sichtbarkeit des Fokus wurde nicht
  systematisch geprüft.

## Barrieren melden

Wenn etwas nicht oder nur schwer bedienbar ist, bitte ein
[Issue anlegen](https://github.com/jammelwab/jblbase/issues/new/choose) und
dazuschreiben:

- was versucht wurde und was nicht ging
- Betriebssystem und App-Version
- verwendete Hilfstechnologie (z. B. NVDA, VoiceOver, Bildschirmlupe,
  Sprachsteuerung), falls zutreffend

Solche Meldungen werden wie Fehler behandelt. Eine feste Bearbeitungszeit kann
ein Ein-Personen-Projekt nicht zusagen, eine erste Antwort kommt in der Regel
innerhalb einer Woche.

## Beim Mitentwickeln

Neue Bedienelemente sollen per Tastatur erreichbar sein, einen lesbaren Namen
haben (`aria-label` bei reinen Symbol-Schaltflächen) und Informationen nicht
nur über Farbe vermitteln. Die Checkliste im Pull-Request-Template erinnert
daran.
