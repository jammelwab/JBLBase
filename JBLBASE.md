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
5. **Matts zählen extra.** Hat eine Engine ein Matt sicher, meldet sie eine
   künstliche Höchsttiefe (Stockfish 245). Solche Einträge bleiben immer
   erhalten, zählen in der Statistik aber nicht als „maximale Tiefe“.
6. **Speichergrenze für Nutzerkonten.** Bist du mit einem normalen Konto
   angemeldet, rechnet die Engine so tief wie immer, dauerhaft gespeichert wird
   aber höchstens Tiefe 28. Das tiefere Ergebnis bleibt bis zum Schließen der
   App im Arbeitsspeicher und wird in dieser Sitzung weiter genutzt. Matts
   werden nie begrenzt. Admins und die App ohne Konto speichern ohne Grenze;
   meldet sich ein Admin an, werden die nur im Arbeitsspeicher gehaltenen
   Ergebnisse vollständig gespeichert.

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

Das Schreibprotokoll (`eval_cache.sqlite3-wal`) wird beim Start in die
Hauptdatei übernommen und danach auf höchstens 1 MB begrenzt. Vorher blieb es
dauerhaft bei etwa 4 MB stehen.

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

**Ordner:** Die Seite ist nach Spieler → Weiß/Schwarz → Ordner aufgebaut. Für
verschiedene Eröffnungen legst du mehrere Repertoires an und sortierst sie in
Ordner, z. B. Weiß → `1.d4` → `Londoner System`. Den Ordner gibst du beim
Anlegen an oder später mit dem Ordner-Symbol oben rechts auf der Karte
(**In Ordner verschieben**); Unterordner trennst du mit `/`
(`1.d4/Londoner System`). Ein Ordner gibt es, solange ein Repertoire darin
liegt. Das **+** an einem Ordner legt ein neues Repertoire direkt dort an.
Liegen mehrere Repertoires in einem Ordner (oder unter Weiß/Schwarz), zeigen
**Baum von allem** und **Mit meinen Partien vergleichen** sie zusammen als ein
Baum. Der Vergleich über die Spielerkarte nimmt ebenfalls alle Repertoires
dieser Farbe zusammen.

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

### Ordner anlegen und Ordner importieren

Ordner legst du mit dem Ordner-Plus-Symbol an, unter Weiß/Schwarz oder in einem
anderen Ordner; sie bleiben auch leer erhalten (gespeichert in
`repertoire-folders.json` im Dokumente-Ordner). Mit dem Stift benennst du einen Ordner
um, alles darin wandert mit; leere Ordner löschst du mit dem Papierkorb. Repertoires
behalten dabei ihre ID, der Trainingsfortschritt bleibt also erhalten.

**Ordner importieren** nimmt einen Ordner mit PGN-Dateien von der Festplatte: Jede
PGN wird ein Repertoire mit dem Dateinamen als Namen (ihre Partien wie ein Kurs
importiert, mit Eintrag in der Import-Historie), Unterordner werden zu Ordnern. Du
wählst Spieler, Farbe, einen Zielordner und ob der Name des gewählten Ordners als
oberste Ebene übernommen wird. Gibt es einen Namen schon, bekommt das neue
Repertoire „(2)“ angehängt.

### Haupt-Repertoire

„Ich Weiß“ und „Ich Schwarz“ (allgemein: „Spieler Farbe“ auf oberster Ebene) sind die
**Haupt-Repertoires**, erkennbar am grünen Abzeichen. Sie enthalten alle Linien der
anderen Repertoires derselben Farbe: Was du als Kurs, als Ordner oder als einzelne
Linie in ein anderes Repertoire importierst, kommt automatisch auch ins
Haupt-Repertoire, mit eigenem Eintrag in dessen Import-Historie. Fehlen ihm Züge, etwa
aus Importen von vor dieser Version, zeigt die Karte „N fehlende Züge übernehmen“.
Züge, die das Haupt-Repertoire schon hat, bleiben unverändert; was du nur aus einem
Unter-Repertoire löschst, bleibt im Haupt-Repertoire stehen. Beim ersten Abgleich wird
es in der `.info` als Haupt-Repertoire markiert (`main`), damit es das auch nach dem
Umbenennen bleibt.

### Repertoire im Datenbank-Bereich des Analysebretts

Im Datenbank-Bereich des Analysebretts gibt es neben Lokal, Lichess Alle und Lichess
Meister die Quelle **Repertoire**. Sie sieht aus wie die anderen Datenbanken: die Züge deines
Repertoires in der aktuellen Stellung mit Anteil und Anzahl der Varianten dahinter,
jede Variante einmal gezählt, auch wenn sie in mehreren Repertoires steht (etwa im
Haupt-Repertoire und im Unter-Repertoire). Fährst du über den Balken, siehst du, in
welchen Repertoires der Zug vorkommt. Ein Klick auf eine Zeile spielt den Zug. Oben wählst du
„Alle meine Repertoires“ oder ein bestimmtes Repertoire (auch das eines anderen
Spielers).

### Import-Historie

Vor jedem Import in ein Repertoire (Kurs importieren oder Zeile aus einer Partie
hinzufügen) wird der Stand davor gespeichert. Über das Uhr-Symbol auf der
Repertoire-Karte öffnest du die **Import-Historie**: jeder Import mit Datum, Quelle
und Anzahl der neuen Züge. **Rückgängig** setzt das Repertoire auf den Stand vor
diesem Import zurück. Spätere Importe und Änderungen von Hand seit diesem Import
gehen dabei ebenfalls verloren, darauf weist ein Hinweis vorher hin. Die letzten 30
Importe werden aufbewahrt, in der Datei `Name.history.json` neben dem Repertoire.

### Baumdiagramm

Auf der Repertoire-Seite öffnet **Baum** das Repertoire als gezeichnetes
Baumdiagramm, das sich von links („Start“) nach rechts verzweigt. Weiße Züge
sind helle Kästchen, schwarze Züge dunkle, deine eigenen Züge haben einen
blauen Rahmen. Ein Klick auf einen Zug zeigt die Stellung unten rechts auf
einem kleinen Brett, darunter die Zugfolge (weiße Züge hell, schwarze dunkel)
und den Knopf **Auf dem Brett öffnen**. Auf dem kleinen Brett zeigen grüne
Pfeile die Züge deines Repertoires aus dieser Stellung und ein blauer Pfeil
den meistgespielten Lichess-Zug (mit Anteil darunter). Der Zug, hinter dem die meisten
Varianten deines Repertoires stehen, hat den kräftigsten grünen Pfeil, die anderen sind
dünner. Die Größe des kleinen Bretts ziehst du an der Ecke oben links (Doppelklick setzt
sie zurück), sie wird gemerkt.

Auf dem kleinen Brett kannst du auch selbst ziehen, der Baum folgt dann deinem
Repertoire: Steht der Zug im Repertoire, springt der Baum dorthin (klappt auf und
markiert ihn), und die Pfeile zeigen die nächsten Züge. Erreichst du eine Stellung über
eine andere Zugfolge, zeigt der Baum sie dort. Verlässt du das Repertoire, steht
„Nicht in deinem Repertoire“ unter dem Brett, die Züge außerhalb sind orange
umrandet, und **Zeile hinzufügen** nimmt die Zeile ins Repertoire auf (landet auch in
der Import-Historie). Der Pfeil oben nimmt den letzten Zug zurück.

Unter jedem Zug zeigt eine blaue Leiste den Anteil auf Lichess und eine grüne den Anteil
deiner Varianten, die hinter diesem Zug stehen. Deine eigenen Züge sind nach Repertoire
sortiert (oben der mit den meisten Varianten), die Züge des Gegners nach Lichess (oben
der meistgespielte). Mit gedrückter Maus verschiebst du
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

## Datenbank als Baum

Unter **Datenbanken** eine Datenbank anklicken und **Als Baum öffnen** wählen, oder nach
**Erkunden** den Tab **Baum** öffnen. Die Datenbank erscheint als gezeichneter
Eröffnungsbaum wie beim Repertoire. Damit er auch bei einer Million Partien übersichtlich
bleibt, stehen dort nur Züge, die in **mindestens 15 %** der Partien aus der jeweiligen
Stellung gespielt wurden. Die Grenze stellst du oben rechts ein (0 % zeigt alle Züge).
An jedem Zug stehen die Anzahl der Partien und sein Anteil, der Tooltip nennt die
Ergebnisse. Die Stellungen werden erst gezählt, wenn du einen Zug mit **+** aufklappst.
Ein Klick auf einen Zug zeigt die Stellung auf dem kleinen Brett, **Auf dem Brett
öffnen** öffnet die Zugfolge in der Analyse. Repertoire-Bäume bleiben ungefiltert.

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

## Trainingsfortschritt

Der Fortschritt beim Training (FSRS-Karten und alle Wiederholungen) liegt in
`training.sqlite3` im App-Datenordner, neben dem Positionsspeicher.

- Jedes Repertoire bekommt beim ersten Training eine feste ID in seiner
  `.info`-Datei. Der Fortschritt hängt an dieser ID, nicht am Dateipfad. Er
  übersteht deshalb Umbenennen und Verschieben.
- Eine Karte gehört zu einer Stellung (FEN ohne Zugzähler). Dieselbe
  Stellung über eine andere Zugfolge ist dieselbe Karte.
- Wiederholungen werden nur angehängt, nie geändert. „Zurücksetzen“ setzt
  die Karten neu auf, das Protokoll bleibt.
- Beim ersten Öffnen nach dem Update wird der alte Fortschritt aus dem
  Browser-Speicher übernommen. Eine Kopie bleibt dort unter
  `deck-backup-…` liegen.

## Cloud (im Aufbau)

Der Sync über Firebase liegt im Ordner `firebase/`: Sicherheitsregeln,
Kostenbremse und Rollen. Beschreibung in `firebase/README.md`, die Schritte
in der Konsole in `firebase/SETUP.md`. Ohne Anmeldung ändert sich an der App
nichts.

**JBLBase-Konto** (Einstellungen → JBLBase-Konto):

- Anmelden oder registrieren mit E-Mail und Passwort, mit Bestätigungsmail
  und „Passwort vergessen“.
- „Mit Lichess anmelden“ öffnet den normalen Lichess-Login im Browser. Die
  Cloud Function `lichessLogin` fragt Lichess, wem das Token gehört, und
  meldet die App als `lichess:<id>` an. Das Lichess-Token wird nicht
  gespeichert, und es wird kein Lichess-Konto in der Kontenliste angelegt.
- Chess.com hat keine Anmeldung für fremde Apps und wird nur mit dem
  Benutzernamen verknüpft (geprüft über die öffentliche Chess.com-API).
- Die Rolle (Nutzer oder Admin) wird angezeigt. Sie steuert die
  Tiefengrenze 28 beim Speichern; Matts werden immer gespeichert.
- Firebase wird erst geladen, wenn man sich auf diesem Gerät einmal
  angemeldet hat.

**Private Cloud (Freigabeliste):** Nur Konten in `config/access` (Felder
`emails` und `lichess`, kleingeschrieben) und Admins dürfen synchronisieren;
E-Mail-Konten erst nach Bestätigung der Adresse. Nicht freigeschaltete
Lichess-Konten werden gar nicht angelegt. Einrichten: `firebase/SETUP.md`.

**Nutzungsbedingungen und Datenschutz** (`src/legal/`):

- Vor dem Registrieren und vor „Mit Lichess anmelden“ erscheint ein Fenster
  mit einer Kurzfassung, den vollen Texten und drei Häkchen
  (Nutzungsbedingungen, Datenschutzerklärung, mindestens 16 Jahre). Erst
  danach wird das Konto angelegt.
- Die Zustimmung wird unter `users/{uid}/consents/<AGB-Version>_<Datenschutz-Version>`
  gespeichert (Fassung, Weg, App-Version, Serverzeit). Die Regeln erlauben nur
  Anlegen, kein Ändern.
- Ändert sich ein Text inhaltlich, die Version in `src/legal/legal.ts` erhöhen.
  Angemeldete Konten werden dann beim nächsten Start gefragt; bis zur
  Zustimmung wird nicht synchronisiert. Kann die Zustimmung nicht geprüft
  werden (offline, Regeln noch nicht veröffentlicht), läuft der Sync weiter.
- Die Texte stehen auch unter Einstellungen → Datenschutz und Profil & Konten.
- **Konto löschen** (Profil & Konten) ruft die Cloud Function `deleteAccount`
  auf: Sie löscht alles unter `users/{uid}` und das Firebase-Konto. Die
  Dateien auf dem Gerät bleiben.
- Die Telemetrie von En Croissant (PostHog) ist entfernt; die App schickt keine
  Nutzungsdaten mehr.

**Synchronisierung** (läuft nur angemeldet; beim Start, alle 5 Minuten,
kurz nach Änderungen und per Knopf):

- **Repertoires** werden als ganze Dateien abgeglichen
  (`src/utils/cloud/repertoireSync.ts`). Jedes Gerät merkt sich pro
  Repertoire den Stand nach dem letzten Abgleich. Nur hier geändert:
  hochladen. Nur dort geändert: herunterladen. Beides geändert: Die neuere
  Fassung gilt, die andere bleibt als Datei „… (Konflikt <Datum>)“ (Typ
  „Sonstiges“) liegen. Umbenennen und Verschieben wandern mit. Gelöschte
  Repertoires bekommen eine Löschmarke; auf den anderen Geräten wird die
  Datei in `*.pgn.deleted-<Zeit>` umbenannt, nicht gelöscht. Fehlen auf
  einmal die meisten Dateien (z. B. anderer Ordner), wird nichts gelöscht.
- Beim ersten Abgleich auf einem zweiten Gerät werden Repertoires mit
  gleichem Pfad im Dateien-Ordner verknüpft. Sie übernehmen die ID aus der
  Cloud, der lokale Trainingsfortschritt zieht mit.
- **Trainingsfortschritt** (`src/utils/cloud/trainingSync.ts`): Karten mit
  „letzte Änderung gewinnt“, Wiederholungen nur anhängen. Der lokale
  Speicher merkt sich, was noch hochgeladen werden muss (Schema 2 in
  `training.rs`).
- PGN-Dateien über 900 KB werden nicht hochgeladen; die Einstellungsseite
  sagt dann, welche.

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

## Lichess-Puzzles

Im Puzzle-Tab unter **Datenbank hinzufügen** gibt es die Karte
„Lichess-Puzzles (offiziell)“. Sie lädt
<https://database.lichess.org/lichess_db_puzzle.csv.zst> (über 5 Mio. Aufgaben,
CC0) und baut daraus lokal die Datei `Lichess Puzzles.duckdb` im
Puzzle-Ordner. Wer die Datei schon hat, nimmt „Aus Datei importieren“
(`.csv.zst` oder entpackte `.csv`). Ein erneuter Import ersetzt die alte
Fassung, Lichess aktualisiert die Datei monatlich.

## Taktiksuche im Repertoire

Jede Repertoire-Karte hat den Knopf **Taktiken suchen**. Die Engine prüft jede
Stellung, in der der Repertoire-Besitzer am Zug ist (Standardtiefe 18):

- Eine Aufgabe entsteht, wenn es genau einen klar gewinnenden Zug gibt
  (mindestens +2,0 oder Matt, der zweitbeste Zug hält keinen Vorteil) und der
  letzte Zug des Gegners ein echter Fehler war. Erzwungenes Zurückschlagen in
  gewonnener Stellung zählt also nicht.
- Die Lösung läuft weiter, solange es jeweils nur einen Gewinnzug gibt.
- Motive (Gabel, Fesselung, Spieß, Abzug, Opfer, Matt in N, Grundreihenmatt …)
  tragen die Lichess-Namen, der Filter im Puzzle-Tab funktioniert also.
- Die Elo-Schätzung richtet sich danach, ab welcher Suchtiefe die Engine den
  Zug findet, wie lang die Lösung ist und ob geopfert wird. Die Gewichte sind
  vorerst von Hand gesetzt (`src-tauri/src/tactics/rating.rs`) und noch nicht
  an den Lichess-Wertungen geeicht.

Die Aufgaben landen in `Repertoire-Taktiken.duckdb` im Puzzle-Ordner und
erscheinen im Puzzle-Tab als eigene Datenbank. Eine neue Suche ersetzt die
Aufgaben desselben Repertoires. Alle Bewertungen gehen in den
Positionsspeicher, eine zweite Suche rechnet also nur neue Stellungen.

Test mit echter Engine:

```bash
cd src-tauri
JBLBASE_TEST_ENGINE=/pfad/zu/stockfish cargo test -- --ignored tactics
```

## Insight

Die Seite **Insight** (Seitenleiste) analysiert alle Partien der verbundenen
Lichess- und Chess.com-Konten, die neuesten zuerst.

- Tiefe 18 (Standard) oder 24, wahlweise nur eine bestimmte Zahl Partien pro
  Lauf. Anhalten verliert nichts: Fertige Partien stehen in
  `insight.sqlite3` im App-Datenordner, alle Bewertungen im Positionsspeicher.
- Je Zug wird gemessen, wie viel Gewinnchance er kostet (Formeln wie bei
  Lichess): ab 10 Punkten Ungenauigkeit, ab 20 Fehler, ab 30 Patzer (auf der
  Skala von -100 bis 100).
- Statistiken: Genauigkeit gesamt und pro Monat, nach Partiephase, Farbe,
  Bedenkzeit, Ergebnis und Eröffnung, dazu die größten Patzer.
- Übersehene Taktiken (du hattest einen einzigen Gewinnzug und hast ihn nicht
  gespielt) werden zu Aufgaben in `Partien-Taktiken.duckdb` und erscheinen im
  Puzzle-Tab, mit Motiv und geschätzter Elo wie bei der Repertoire-Suche.

Test mit echter Engine:

```bash
cd src-tauri
JBLBASE_TEST_ENGINE=/pfad/zu/stockfish cargo test -- --ignored insight
```
